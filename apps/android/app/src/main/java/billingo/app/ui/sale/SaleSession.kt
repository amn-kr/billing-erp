package billingo.app.ui.sale

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.SaleSaved
import billingo.app.ui.parts.Format
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * The bill being made (step 8.5b). It lives above the screens, so Choose Customer and the item page
 * change the same bill, and it is kept while the phone turns or another screen is on top.
 */
class SaleSession(private val api: Api) {
    /** the server, for the sheets that ask it something (quotations, last prices, profit) */
    val server: Api get() = api
    /** the shop's features when this bill started (batches, pack and loose) */
    private var features: List<String> = emptyList()
    var ctx by mutableStateOf<SaleMaths.Ctx?>(null)
        private set
    var problem by mutableStateOf<ApiError?>(null)
        private set
    var draft by mutableStateOf<SaleMaths.Draft?>(null)
    /** the number the next bill gets (shown, never typed: owner, 18 Nov 2026) */
    var number by mutableStateOf("")
        private set
    var busy by mutableStateOf(false)
        private set
    /** the server asks "Save anyway?" (over the credit limit, expired batch, above MRP) */
    var ask by mutableStateOf<ApiError?>(null)
    /** the last save, for Bill Saved */
    var saved by mutableStateOf<Pair<SaleSaved, SaleMaths.Draft>?>(null)
        private set

    /** what Bill Saved does by itself once it opens: "share" or "print" (the bottom ⋮), or nothing */
    var after by mutableStateOf("")

    /**
     * Edit Bill (8.6b): the saved bill is loaded into Sale as it was (the web's fillFrom 'edit').
     * Items no longer in the shop's list stop it with a message, so nothing on the bill is lost.
     */
    fun edit(scope: CoroutineScope, features: List<String>, id: String) {
        this.features = features
        editing = id
        after = ""
        draft = null
        ask = null
        pass = null
        load(scope, features, number = false) { c ->
            val v = api.saleDoc(id)
            val (d, missing) = SaleMaths.fromSaved(c, v)
            if (d == null) throw ApiError(400, missingWords(missing))
            ctx = SaleMaths.withSavedStock(c, d)
            number = v.number
            draft = d
        }
    }

    /** the saved bill being opened for Edit Bill (kept for Try Again) */
    var editing: String? = null
        private set

    /** Try Again after a refusal: the same saved bill again, or a fresh new one. */
    fun again(scope: CoroutineScope, features: List<String>) { val e = editing; if (e != null) edit(scope, features, e) else start(scope, features) }

    /** how the "no longer in your items" refusal is worded (set by the screen, in the app's language) */
    var missingWords: (List<String>) -> String = { "These items are no longer in your items: ${it.joinToString(", ")}. Change this bill on the computer." }

    /** the shop asks for the transaction passcode before a saved bill is changed: null = not asked; the text = why it was refused */
    var pass by mutableStateOf<String?>(null)
    /** goes up with each refused passcode, so the dots empty */
    var passTries by mutableStateOf(0)
        private set

    /** A new, empty bill; the shop's lists are loaded again so prices and stock are fresh. */
    fun start(scope: CoroutineScope, features: List<String>, partyId: String? = null, itemId: String? = null) {
        this.features = features
        editing = null
        after = ""
        pass = null
        draft = SaleMaths.Draft(date = Format.todayIso())
        ask = null
        load(scope, features) { c ->
            var d = SaleMaths.Draft(date = Format.todayIso(), cash = c.cashDefault && partyId == null)
            c.parties.firstOrNull { it.id == partyId }?.let { d = SaleMaths.withParty(c, d.copy(cash = false), it) }
            c.items.firstOrNull { it.id == itemId }?.let { d = d.copy(lines = listOf(SaleMaths.newLine(c, d, it))) }
            draft = d
        }
    }

    fun reload(scope: CoroutineScope, features: List<String>) { val e = editing; if (e != null) edit(scope, features, e) else load(scope, features) {} }

    /** A party added from Choose Customer: the lists are loaded again so it is there, then it goes on the bill. */
    fun addParty(scope: CoroutineScope, features: List<String>, id: String) = load(scope, features) { c ->
        val p = c.parties.firstOrNull { it.id == id }
        if (p != null) change { SaleMaths.withParty(c, it, p) }
    }

    private fun load(scope: CoroutineScope, features: List<String>, number: Boolean = true, then: suspend (SaleMaths.Ctx) -> Unit) {
        problem = null
        scope.launch {
            try {
                // all six at once; one refusal stops the rest and is shown with Try Again (never closes the app)
                val c = coroutineScope {
                    val s = async { api.settings() }; val b = async { api.shop() }; val l = async { api.priceLists() }
                    val p = async { api.prices() }; val i = async { api.itemsFull() }; val pa = async { api.partiesFull() }
                    // referral and batches are extras: without them (no access, an older server) the bill still works
                    suspend fun <T> extra(get: suspend () -> T, none: T): T = try { get() } catch (e: ApiError) { if (e.status == 0) throw e; none }
                    val r = async { extra({ api.commissionRules() }, emptyList()) }; val rf = async { extra({ api.referrers() }, emptyList()) }
                    val bt = async { if ("batch_no" in features) extra({ api.batches() }, emptyMap()) else emptyMap() }
                    SaleMaths.ctx(s.await(), b.await().stateCode, l.await(), p.await(), features, i.await(), pa.await(), r.await(), rf.await(), bt.await())
                }
                ctx = c
                then(c)
                if (number) refreshNumber(scope)
            } catch (e: ApiError) { problem = e }
        }
    }

    /** The next number for the bill's date (it changes with the financial year). */
    fun refreshNumber(scope: CoroutineScope) {
        val d = draft ?: return
        // a saved bill keeps its number for good
        if (d.edit != null) return
        scope.launch { try { number = api.nextSaleNumber(d.date).number } catch (_: ApiError) {} }
    }

    fun change(f: (SaleMaths.Draft) -> SaleMaths.Draft) { draft?.let { draft = f(it) } }

    /**
     * Send the bill. Its one-time key stays the same for every try, so weak internet can't make two
     * bills. A "Save anyway?" question is kept in [ask]; other refusals are returned.
     */
    suspend fun save(passcode: String? = null): ApiError? {
        val c = ctx ?: return null
        val d = draft ?: return null
        busy = true
        try {
            val e = d.edit
            val r = if (e != null) api.updateSale(e.id, SaleMaths.body(c, d), passcode) else api.saveSale(SaleMaths.body(c, d), d.key)
            pass = null
            saved = r to d
            return null
        } catch (e: ApiError) {
            // Edit Bill with the passcode on: ask for it, then the same save again
            if (e.code == billingo.app.data.Api.PASSCODE && d.edit != null) { if (passcode != null) passTries++; pass = if (passcode == null) "" else e.message; return null }
            if (e.code in SaleMaths.ASK_AGAIN && e.code !in d.confirmed) { ask = e; return null }
            return e
        } finally { busy = false }
    }

    /** A new electrician, added from Referral: the lists are loaded again so it is there, then it is chosen. */
    fun addReferrer(scope: CoroutineScope, id: String) = load(scope, features) { c -> change { SaleMaths.withReferrer(c, it, id) } }

    /** "Save anyway": the same bill again with that answer; a fresh key, because the bill sent is different. */
    fun confirm(code: String) { change { it.copy(confirmed = it.confirmed + code, key = java.util.UUID.randomUUID().toString()) }; ask = null }
}
