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

    /** A new, empty bill; the shop's lists are loaded again so prices and stock are fresh. */
    fun start(scope: CoroutineScope, features: List<String>, partyId: String? = null, itemId: String? = null) {
        draft = SaleMaths.Draft(date = Format.todayIso())
        ask = null
        load(scope, features) { c ->
            var d = SaleMaths.Draft(date = Format.todayIso(), cash = c.cashDefault && partyId == null)
            c.parties.firstOrNull { it.id == partyId }?.let { d = SaleMaths.withParty(c, d.copy(cash = false), it) }
            c.items.firstOrNull { it.id == itemId }?.let { d = d.copy(lines = listOf(SaleMaths.newLine(c, d, it))) }
            draft = d
        }
    }

    fun reload(scope: CoroutineScope, features: List<String>) = load(scope, features) {}

    /** A party added from Choose Customer: the lists are loaded again so it is there, then it goes on the bill. */
    fun addParty(scope: CoroutineScope, features: List<String>, id: String) = load(scope, features) { c ->
        val p = c.parties.firstOrNull { it.id == id }
        if (p != null) change { SaleMaths.withParty(c, it, p) }
    }

    private fun load(scope: CoroutineScope, features: List<String>, then: (SaleMaths.Ctx) -> Unit) {
        problem = null
        scope.launch {
            try {
                // all six at once; one refusal stops the rest and is shown with Try Again (never closes the app)
                val c = coroutineScope {
                    val s = async { api.settings() }; val b = async { api.shop() }; val l = async { api.priceLists() }
                    val p = async { api.prices() }; val i = async { api.itemsFull() }; val pa = async { api.partiesFull() }
                    SaleMaths.ctx(s.await(), b.await().stateCode, l.await(), p.await(), features, i.await(), pa.await())
                }
                ctx = c
                then(c)
                refreshNumber(scope)
            } catch (e: ApiError) { problem = e }
        }
    }

    /** The next number for the bill's date (it changes with the financial year). */
    fun refreshNumber(scope: CoroutineScope) {
        val d = draft ?: return
        scope.launch { try { number = api.nextSaleNumber(d.date).number } catch (_: ApiError) {} }
    }

    fun change(f: (SaleMaths.Draft) -> SaleMaths.Draft) { draft?.let { draft = f(it) } }

    /**
     * Send the bill. Its one-time key stays the same for every try, so weak internet can't make two
     * bills. A "Save anyway?" question is kept in [ask]; other refusals are returned.
     */
    suspend fun save(): ApiError? {
        val c = ctx ?: return null
        val d = draft ?: return null
        busy = true
        try {
            val r = api.saveSale(SaleMaths.body(c, d), d.key)
            saved = r to d
            return null
        } catch (e: ApiError) {
            if (e.code in SaleMaths.ASK_AGAIN && e.code !in d.confirmed) { ask = e; return null }
            return e
        } finally { busy = false }
    }

    /** "Save anyway": the same bill again with that answer; a fresh key, because the bill sent is different. */
    fun confirm(code: String) { change { it.copy(confirmed = it.confirmed + code, key = java.util.UUID.randomUUID().toString()) }; ask = null }
}
