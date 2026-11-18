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
class ApiError(val status: Int, override val message: String, val code: String? = null) : Exception(message)

@Serializable
data class Tokens(val accessToken: String, val expiresIn: Int = 900, val refreshToken: String? = null, val refreshExpires: String? = null, val owner: Boolean = false)

@Serializable
data class MeUser(val id: String, val name: String = "", val email: String, val mustChangePassword: Boolean = false)

@Serializable
data class MeBusiness(val id: String, val name: String, val short: String? = null, val city: String? = null, val gstin: String? = null, val gstEnabled: Boolean = false, val plan: String = "trial")

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
    ): T {
        val r = withSlowWatch { withContext(Dispatchers.IO) {
            val b = Request.Builder().url(base.trimEnd('/') + "/api" + path)
                .header("x-app-client", "phone")
                .header("Accept", "application/json")
            if (auth) access?.let { b.header("Authorization", "Bearer $it") }
            if (refresh != null) b.header("x-refresh-token", refresh)
            val rb = (body?.toString() ?: if (method == "GET") null else "{}")?.toRequestBody(JSON_TYPE)
            b.method(method, rb)
            try {
                client.newCall(b.build()).execute().use { res -> res.code to (res.body?.string() ?: "") }
            } catch (e: IOException) {
                throw ApiError(0, NO_INTERNET)
            }
        } }
        val (code, text) = r
        if (code == 401 && auth && again && store.refreshToken != null && renew()) return send(method, path, body, answer, auth, refresh, again = false)
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
        return ApiError(code, msg, (o?.get("code") as? JsonPrimitive)?.contentOrNull)
    }

    companion object {
        const val NO_INTERNET = "No internet connection."
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
