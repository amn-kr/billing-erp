package billingo.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A refusal from the server, with its message in plain words; status 0 means no internet. */
class ApiError(val status: Int, override val message: String, val code: String? = null, val field: String? = null) : Exception(message)

@Serializable
data class Tokens(val accessToken: String, val expiresIn: Int = 900, val refreshToken: String? = null, val refreshExpires: String? = null, val owner: Boolean = false)

@Serializable
data class MeUser(val id: String, val name: String = "", val email: String, val mustChangePassword: Boolean = false)

@Serializable
data class MeBusiness(val id: String, val name: String, val short: String? = null, val city: String? = null, val gstin: String? = null, val gstEnabled: Boolean = false, val plan: String = "trial", val features: List<String> = emptyList(), val itemOptions: kotlinx.serialization.json.JsonObject? = null)

@Serializable
data class Membership(val businessId: String, val businessName: String, val businessShort: String? = null, val city: String? = null, val gstin: String? = null, val role: String)

@Serializable
data class Party(val id: String, val name: String, val kind: String = "customer", val balance: String = "0", val phone: String = "")

@Serializable
data class SaleParty(val id: String, val name: String)

@Serializable
data class SaleRow(
    val id: String,
    val number: String,
    val date: String,
    val dueDate: String? = null,
    val mode: String = "credit",
    val partyName: String = "",
    val total: String = "0",
    val balance: String = "0",
    val cancelled: Boolean = false,
)

@Serializable
data class Item(
    val id: String,
    val name: String,
    val kind: String = "goods",
    val unit: String = "",
    val sale: String = "0",
    val purchase: String = "0",
    val stock: String? = null,
    val level: String = "ok",
)

@Serializable
data class AppVersion(val latest: String? = null, val date: String? = null, val download: String? = null, val notes: String = "", val minimum: String? = null)

@Serializable
data class Me(val user: MeUser, val business: MeBusiness? = null, val role: String? = null, val memberships: List<Membership> = emptyList())

/**
 * The phone's calls to the server (step 8.2c). It says it is the phone (`x-app-client: phone`), so
 * sign-in answers carry the "stay signed in" token, kept in the [store]. The short-lived access
 * token stays in memory and is renewed by itself when the server says it ran out.
 *
 * The free server sleeps when unused; the first call can take up to a minute ("Server Is Waking
 * Up…"), so the waiting time is long.
 */
class Api(private val base: String, private val store: Store, private val client: OkHttpClient = defaultClient()) {
    @Volatile var access: String? = null
        private set
    private val renewing = Mutex()

    /**
     * Calls taking longer than [SLOW_MS] right now: the free server is probably waking up, and the
     * app shows "Server Is Waking Up…" (design 7.4j) until they are answered.
     */
    val slow = MutableStateFlow(0)

    suspend fun login(email: String, password: String): Tokens =
        keep(send("POST", "/auth/login", buildJsonObject { put("email", email); put("password", password) }, Tokens.serializer(), auth = false))

    suspend fun register(name: String, email: String, password: String): Tokens =
        keep(send("POST", "/auth/register", buildJsonObject { put("name", name); put("email", email); put("password", password) }, Tokens.serializer(), auth = false))

    suspend fun me(): Me = send("GET", "/me", null, Me.serializer())

    suspend fun parties(): List<Party> = send("GET", "/parties", null, ListSerializer(Party.serializer()))
    suspend fun sales(): List<SaleRow> = send("GET", "/sales?kind=invoice", null, ListSerializer(SaleRow.serializer()))
    suspend fun items(): List<Item> = send("GET", "/items", null, ListSerializer(Item.serializer()))

    suspend fun partiesFull(archived: Boolean = false): List<PartyFull> =
        send("GET", if (archived) "/parties?archived=true" else "/parties", null, ListSerializer(PartyFull.serializer()))
    suspend fun party(id: String): PartyFull = send("GET", "/parties/$id", null, PartyFull.serializer())
    suspend fun partyTx(id: String): List<PartyTx> = send("GET", "/reports/party-tx/$id", null, ListSerializer(PartyTx.serializer()))
    suspend fun statement(id: String, from: String, to: String): Statement = send("GET", "/reports/statement/$id?from=$from&to=$to", null, Statement.serializer())

    suspend fun createParty(body: JsonObject): Saved = send("POST", "/parties", body, Saved.serializer())
    suspend fun updateParty(id: String, body: JsonObject): Saved = send("PATCH", "/parties/$id", body, Saved.serializer())
    suspend fun partyUsage(id: String): Usage = send("GET", "/parties/$id/usage", null, Usage.serializer())
    suspend fun deleteParty(id: String) { send<Unit>("POST", "/parties/$id/delete", null, null) }
    suspend fun archiveParty(id: String, archived: Boolean) { send<Unit>("POST", "/parties/$id/" + (if (archived) "archive" else "restore"), null, null) }
    suspend fun partyGroups(): List<PartyGroup> = send("GET", "/party-groups", null, ListSerializer(PartyGroup.serializer()))
    suspend fun addPartyGroup(name: String): PartyGroup = send("POST", "/party-groups", buildJsonObject { put("name", name) }, PartyGroup.serializer())

    suspend fun itemsFull(): List<ItemFull> = send("GET", "/items", null, ListSerializer(ItemFull.serializer()))
    suspend fun item(id: String): ItemDetail = send("GET", "/items/$id", null, ItemDetail.serializer())
    suspend fun adjustStock(body: JsonObject) { send<Unit>("POST", "/stock-adjustments", body, null) }
    suspend fun catalogue(): Catalogue = send("GET", "/catalogue", null, Catalogue.serializer())
    suspend fun nextItemCode(): NextCode = send("GET", "/items/next-code", null, NextCode.serializer())
    suspend fun addBrand(name: String): Named = send("POST", "/catalogue/brands", buildJsonObject { put("name", name) }, Named.serializer())
    suspend fun addCategory(name: String): Named = send("POST", "/catalogue/categories", buildJsonObject { put("name", name) }, Named.serializer())
    suspend fun createItem(body: JsonObject): Saved = send("POST", "/items", body, Saved.serializer())
    suspend fun updateItem(id: String, body: JsonObject): Saved = send("PATCH", "/items/$id", body, Saved.serializer())
    suspend fun itemUsage(id: String): Usage = send("GET", "/items/$id/usage", null, Usage.serializer())
    suspend fun deleteItem(id: String) { send<Unit>("POST", "/items/$id/delete", null, null) }
    suspend fun archiveItem(id: String) { send<Unit>("POST", "/items/$id/archive", null, null) }
    /** Inactive items too (Bulk Active / Inactive). */
    suspend fun itemsAll(): List<ItemFull> = send("GET", "/items?archived=all", null, ListSerializer(ItemFull.serializer()))
    suspend fun bulkActive(ids: List<String>, active: Boolean): BulkDone =
        send("POST", "/items/bulk-active", buildJsonObject { put("ids", JsonArray(ids.map(::JsonPrimitive))); put("active", active) }, BulkDone.serializer())

    // 8.4c: godowns and transfers, brands and series, stock adjustments, Price Manager with PIN
    suspend fun godowns(): List<Godown> = send("GET", "/godowns", null, ListSerializer(Godown.serializer()))
    suspend fun addGodown(body: JsonObject) { send<Unit>("POST", "/godowns", body, null) }
    suspend fun transfers(): List<Transfer> = send("GET", "/stock-transfers", null, ListSerializer(Transfer.serializer()))
    suspend fun transfer(body: JsonObject) { send<Unit>("POST", "/stock-transfers", body, null) }
    suspend fun brands(): List<Brand> = send("GET", "/brands", null, ListSerializer(Brand.serializer()))
    suspend fun series(): List<Series> = send("GET", "/brand-series", null, ListSerializer(Series.serializer()))
    suspend fun newBrand(name: String) { send<Unit>("POST", "/brands", buildJsonObject { put("name", name) }, null) }
    suspend fun newSeries(brandId: String, name: String) { send<Unit>("POST", "/brand-series", buildJsonObject { put("brandId", brandId); put("name", name) }, null) }
    suspend fun adjustments(): List<AdjustmentRow> = send("GET", "/stock-adjustments", null, ListSerializer(AdjustmentRow.serializer()))
    suspend fun priceHistory(itemId: String): List<PriceChange> = send("GET", "/prices/history?itemId=$itemId", null, ListSerializer(PriceChange.serializer()))
    suspend fun pinState(): PinState = send("GET", "/prices/pin", null, PinState.serializer())
    suspend fun setPin(pin: String) { send<Unit>("POST", "/prices/pin", buildJsonObject { put("pin", pin) }, null) }
    /** Price Setup: the server checks the PIN (5 wrong tries wait 60 seconds) and checks it again on every save. */
    suspend fun unlockPrices(pin: String) { send<Unit>("POST", "/prices/unlock", buildJsonObject { put("pin", pin) }, null) }
    suspend fun changePrices(body: JsonObject) { send<Unit>("POST", "/prices/changes", body, null) }

    // 8.5b: New Sale
    suspend fun priceLists(): List<PriceList> = send("GET", "/price-lists", null, ListSerializer(PriceList.serializer()))
    suspend fun prices(): Prices = send("GET", "/prices", null, Prices.serializer())
    suspend fun settings(): ShopSettings = send("GET", "/settings", null, ShopSettings.serializer())
    suspend fun shop(): Shop = send("GET", "/businesses/current", null, Shop.serializer())
    suspend fun nextSaleNumber(date: String): NextNumber = send("GET", "/sales/next-number?kind=invoice&date=$date", null, NextNumber.serializer())
    /** Save a bill. [key] stays the same for the same bill, so sending it twice (weak internet) makes one bill. */
    suspend fun saveSale(body: JsonObject, key: String): SaleSaved = send("POST", "/sales", body, SaleSaved.serializer(), key = key)

    // 8.5c
    suspend fun referrers(): List<Referrer> = send("GET", "/referrers", null, ListSerializer(Referrer.serializer()))
    suspend fun addReferrer(body: JsonObject): Referrer = send("POST", "/referrers", body, Referrer.serializer())
    suspend fun commissionRules(): List<CommissionRule> = send("GET", "/commission-rules", null, ListSerializer(CommissionRule.serializer()))
    suspend fun batches(): Map<String, List<StockBatch>> = send("GET", "/batches", null, kotlinx.serialization.builtins.MapSerializer(String.serializer(), ListSerializer(StockBatch.serializer())))
    suspend fun pastPrices(itemId: String, partyId: String): List<PastPrice> = send("GET", "/sales/price-history?item=$itemId&party=$partyId", null, ListSerializer(PastPrice.serializer()))
    suspend fun quotations(): List<QuoteRow> = send("GET", "/sales?kind=quotation", null, ListSerializer(QuoteRow.serializer()))
    suspend fun saleDoc(id: String): SaleDoc = send("GET", "/sales/$id", null, SaleDoc.serializer())
    // 8.6a: Sale Bills
    suspend fun bills(): List<BillRow> = send("GET", "/sales?kind=invoice", null, ListSerializer(BillRow.serializer()))
    /** Cancel a sale document; with the transaction passcode switched on, [passcode] is sent along (asked every time). */
    suspend fun cancelSale(id: String, passcode: String? = null): Cancelled =
        send("POST", "/sales/$id/cancel", buildJsonObject {}, Cancelled.serializer(), passcode = passcode)
    suspend fun saleCost(body: JsonObject): SaleCost = send("POST", "/sales/cost", body, SaleCost.serializer())

    /** Check For Update: the newest phone version on the releases page (no sign-in needed). */
    suspend fun appVersion(): AppVersion = send("GET", "/app-version?app=android", null, AppVersion.serializer(), auth = false)

    /** Work in another company: new tokens for it. */
    suspend fun switchCompany(businessId: String): Tokens =
        keep(send("POST", "/businesses/switch", buildJsonObject { put("businessId", businessId) }, Tokens.serializer()))

    /** Sign out on the server too, then forget everything on the phone. */
    suspend fun logout() {
        val rt = store.refreshToken
        try {
            if (rt != null) send<Unit>("POST", "/auth/logout", null, null, auth = false, refresh = rt)
        } catch (_: ApiError) {
            // signing out on the phone must work without internet
        }
        access = null
        store.clearSignIn()
    }

    /**
     * A new access token from the saved "stay signed in" token. False when there is none or the
     * server refused it (then the person signs in again); no internet is an ApiError with status 0.
     */
    suspend fun renew(): Boolean = renewing.withLock {
        val rt = store.refreshToken ?: return false
        try {
            keep(send("POST", "/auth/refresh", null, Tokens.serializer(), auth = false, refresh = rt))
            true
        } catch (e: ApiError) {
            if (e.status == 401) { access = null; store.clearSignIn(); false } else throw e
        }
    }

    private fun keep(t: Tokens): Tokens {
        access = t.accessToken
        if (t.refreshToken != null) {
            store.refreshToken = t.refreshToken
            store.refreshExpires = t.refreshExpires
        }
        return t
    }

    private suspend fun <T> send(
        method: String,
        path: String,
        body: JsonElement?,
        answer: KSerializer<T>?,
        auth: Boolean = true,
        refresh: String? = null,
        again: Boolean = true,
        /** one-time key against double saves (step 8.1b): the same key when the same save is sent again */
        key: String? = null,
        /** the transaction passcode (Settings › Transactions) for an edit or cancel; never kept */
        passcode: String? = null,
    ): T {
        val r = withSlowWatch { withContext(Dispatchers.IO) {
            val b = Request.Builder().url(base.trimEnd('/') + "/api" + path)
                .header("x-app-client", "phone")
                .header("Accept", "application/json")
            if (auth) access?.let { b.header("Authorization", "Bearer $it") }
            if (refresh != null) b.header("x-refresh-token", refresh)
            if (key != null) b.header("Idempotency-Key", key)
            if (passcode != null) b.header(PASSCODE_HEADER, passcode)
            val rb = (body?.toString() ?: if (method == "GET") null else "{}")?.toRequestBody(JSON_TYPE)
            b.method(method, rb)
            try {
                client.newCall(b.build()).execute().use { res -> res.code to (res.body?.string() ?: "") }
            } catch (e: IOException) {
                throw ApiError(0, NO_INTERNET)
            }
        } }
        val (code, text) = r
        if (code == 401 && auth && again && store.refreshToken != null && renew()) return send(method, path, body, answer, auth, refresh, again = false, key = key, passcode = passcode)
        if (code !in 200..299) throw problem(code, text)
        @Suppress("UNCHECKED_CAST")
        return if (answer == null || text.isBlank()) Unit as T else JSON.decodeFromString(answer, text)
    }

    private suspend fun <T> withSlowWatch(work: suspend () -> T): T = coroutineScope {
        var counted = false
        val timer = launch { delay(SLOW_MS); counted = true; slow.update { it + 1 } }
        try { work() } finally { timer.cancel(); if (counted) slow.update { it - 1 } }
    }

    private fun problem(code: Int, text: String): ApiError {
        val o = try { JSON.parseToJsonElement(text) as? JsonObject } catch (_: Exception) { null }
        val m = when (val v = o?.get("message")) {
            is JsonArray -> v.firstOrNull()?.jsonPrimitive?.contentOrNull
            is JsonPrimitive -> v.contentOrNull
            else -> null
        }
        val msg = when {
            code == 429 -> "Too many tries. Wait a minute and try again."
            m != null -> m
            else -> "Something went wrong."
        }
        return ApiError(code, msg, (o?.get("code") as? JsonPrimitive)?.contentOrNull, (o?.get("field") as? JsonPrimitive)?.contentOrNull)
    }

    companion object {
        const val NO_INTERNET = "No internet connection."
        /** packages/shared PASSCODE_HEADER; a refusal for it has code "passcode" */
        const val PASSCODE_HEADER = "x-txn-passcode"
        const val PASSCODE = "passcode"
        const val SLOW_MS = 4_000L
        val JSON = Json { ignoreUnknownKeys = true; explicitNulls = false }
        private val JSON_TYPE = "application/json".toMediaType()
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(70, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS)
            .build()
    }
}
