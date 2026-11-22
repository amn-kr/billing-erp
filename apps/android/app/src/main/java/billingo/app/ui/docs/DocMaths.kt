package billingo.app.ui.docs

import billingo.app.data.BillRow
import billingo.app.data.SaleDoc
import billingo.app.ui.parts.Format
import java.math.BigDecimal

/**
 * The sums and choices of the sale documents' screens (step 8.6, design 7.4e), kept apart from
 * the screens so they can be tested. Every figure comes from the server; this only adds them up,
 * picks the badge and filters the list.
 */
object DocMaths {
    fun num(s: String?): BigDecimal = s?.toBigDecimalOrNull() ?: BigDecimal.ZERO

    /** A bill's badge: the same order as a party's transactions (design invState → txState). */
    sealed interface State {
        data object Cancelled : State
        data object Paid : State
        data object PartPaid : State
        data class Overdue(val days: Int) : State
        data object Unpaid : State
    }

    fun state(b: BillRow, today: String): State = state(b.cancelled, num(b.total), num(b.balance), b.dueDate, today)

    fun state(cancelled: Boolean, total: BigDecimal, balance: BigDecimal, due: String?, today: String): State {
        if (cancelled) return State.Cancelled
        if (balance.signum() <= 0) return State.Paid
        if (balance < total) return State.PartPaid
        if (!due.isNullOrBlank()) { val late = Format.daysBetween(due, today); if (late > 0) return State.Overdue(late) }
        return State.Unpaid
    }

    /** Sale Bills' status choice (design KD.inv): All, Due, Paid, Cancelled. */
    enum class Filter { All, Due, Paid, Cancelled }

    fun matches(b: BillRow, f: Filter, query: String, counter: String): Boolean {
        val due = num(b.balance).signum() > 0
        val ok = when (f) {
            Filter.All -> true
            Filter.Cancelled -> b.cancelled
            Filter.Due -> !b.cancelled && due
            Filter.Paid -> !b.cancelled && !due
        }
        if (!ok) return false
        val q = query.trim().lowercase()
        return q.isEmpty() || (b.number + " " + name(b, counter)).lowercase().contains(q)
    }

    /** The party's name, the walk-in's name, or "Counter Customer". */
    fun name(b: BillRow, counter: String): String = b.party?.name?.takeIf { it.isNotBlank() } ?: b.partyName?.takeIf { it.isNotBlank() } ?: counter
    fun name(d: SaleDoc, counter: String): String = d.party?.name?.takeIf { it.isNotBlank() } ?: d.partyName.ifBlank { counter }

    /** The two boxes at the top: This Month Sales (bills dated this month) and ↓ Still To Get (all dues); cancelled bills count in neither. */
    fun summary(rows: List<BillRow>, today: String): Pair<BigDecimal, BigDecimal> {
        val month = today.take(7)
        var sales = BigDecimal.ZERO
        var dues = BigDecimal.ZERO
        for (b in rows) {
            if (b.cancelled) continue
            if (b.date.take(7) == month) sales += num(b.total)
            dues += num(b.balance)
        }
        return sales to dues
    }

    /* ───────── quotations (8.6c) ───────── */

    enum class QState { Open, Converted, Cancelled }

    fun qState(cancelled: Boolean, status: String): QState = when { cancelled -> QState.Cancelled; status == "converted" -> QState.Converted; else -> QState.Open }
    fun qState(q: billingo.app.data.QuoteRow): QState = qState(q.cancelled, q.status)

    /** Quotations' status choice (design KD.qt): All, Open, Converted, Cancelled. */
    fun qMatches(q: billingo.app.data.QuoteRow, f: Int, query: String, counter: String): Boolean {
        val st = qState(q)
        val ok = when (f) { 1 -> st == QState.Open; 2 -> st == QState.Converted; 3 -> st == QState.Cancelled; else -> true }
        if (!ok) return false
        val t = query.trim().lowercase()
        val name = q.party?.name?.takeIf { it.isNotBlank() } ?: q.partyName.ifBlank { counter }
        return t.isEmpty() || (q.number + " " + name).lowercase().contains(t)
    }

    /** The two boxes: Open Quotations and Turned Into Bills (counts). */
    fun qSummary(rows: List<billingo.app.data.QuoteRow>): Pair<Int, Int> =
        rows.count { qState(it) == QState.Open } to rows.count { qState(it) == QState.Converted }

    /** The bill a quotation turned into (its number is kept with the quotation). */
    fun invoiceOf(d: SaleDoc): String = ((d.extra?.get("invoiceNo")) as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
    fun isBrandWise(d: SaleDoc): Boolean = ((d.extra?.get("type")) as? kotlinx.serialization.json.JsonPrimitive)?.content == "brand"

    /* ───────── delivery challans (8.6d) ───────── */

    fun chName(c: billingo.app.data.ChallanRow, counter: String): String = c.party?.name?.takeIf { it.isNotBlank() } ?: c.partyName?.takeIf { it.isNotBlank() } ?: counter

    private fun chOpen(c: billingo.app.data.ChallanRow) = !c.cancelled && c.status == "open"

    /** Open Challans (count) and Qty Out (Not Billed): the goods on open challans. */
    fun chSummary(rows: List<billingo.app.data.ChallanRow>): Pair<Int, BigDecimal> =
        rows.count(::chOpen) to rows.filter(::chOpen).fold(BigDecimal.ZERO) { a, c -> a + num(c.qty) }

    /** All / Not Billed / Invoiced / Cancelled; search by number, name or item. */
    fun chMatches(c: billingo.app.data.ChallanRow, f: Int, query: String, counter: String): Boolean {
        val ok = when (f) { 1 -> chOpen(c); 2 -> !c.cancelled && c.status == "invoiced"; 3 -> c.cancelled || c.status == "cancelled"; else -> true }
        if (!ok) return false
        val t = query.trim().lowercase()
        return t.isEmpty() || (c.number + " " + chName(c, counter) + " " + c.lineNames.joinToString(" ")).lowercase().contains(t)
    }

    /** A bill's charges (transport, labour, bank commission) as one figure, as the design shows them. */
    fun charges(d: SaleDoc): BigDecimal = num(d.transport) + num(d.labour) + num(d.bankCharge)

    /** Where the bill came from: its quotations and its challan ("From QT-0030"). */
    fun sources(d: SaleDoc): List<String> {
        val x = d.extra ?: return emptyList()
        val out = mutableListOf<String>()
        (x["quoteRefs"] as? kotlinx.serialization.json.JsonArray)?.forEach { r ->
            ((r as? kotlinx.serialization.json.JsonObject)?.get("no") as? kotlinx.serialization.json.JsonPrimitive)?.content?.takeIf { it.isNotBlank() }?.let(out::add)
        }
        ((x["challanNo"] as? kotlinx.serialization.json.JsonPrimitive)?.content)?.takeIf { it.isNotBlank() }?.let(out::add)
        return out.distinct()
    }

    /**
     * What Cancel tells first (design askCancel): the stock comes back, a party's dues go down by
     * the bill's balance, and money already received stays with the party as advance.
     */
    data class CancelNote(val party: String?, val dues: BigDecimal, val paid: BigDecimal)

    fun cancelNote(d: SaleDoc): CancelNote {
        val dues = num(d.balance)
        val paid = (num(d.total) - dues).max(BigDecimal.ZERO)
        return CancelNote(d.party?.name?.takeIf { d.party.id.isNotBlank() }, dues, paid)
    }
}
