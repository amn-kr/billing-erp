package billingo.app.ui.parties

import billingo.app.data.PartyFull
import billingo.app.data.PartyTx
import billingo.app.ui.parts.Format
import java.math.BigDecimal

/** What the Parties screens work out from the server's lists (design 7.4b), kept apart so it can be tested. */
object PartyMaths {
    /** All / Customers / Suppliers */
    enum class Kind { All, Customers, Suppliers }

    /** All Balances / To Receive / To Pay / Settled */
    enum class Bal { All, Receive, Pay, Settled }

    fun matches(p: PartyFull, kind: Kind, bal: Bal, query: String): Boolean {
        if (kind == Kind.Customers && p.kind == "supplier") return false
        if (kind == Kind.Suppliers && p.kind != "supplier") return false
        val b = p.balance.signum()
        if (bal == Bal.Receive && b <= 0) return false
        if (bal == Bal.Pay && b >= 0) return false
        if (bal == Bal.Settled && b != 0) return false
        val q = query.trim().lowercase()
        if (q.isEmpty()) return true
        val digits = q.filter { it.isDigit() }
        return p.name.lowercase().contains(q) || (digits.isNotEmpty() && p.phone.filter { it.isDigit() }.contains(digits))
    }

    /** ↓ To Receive and ↑ To Pay over every active party (the list's two boxes). */
    fun totals(all: List<PartyFull>): Pair<BigDecimal, BigDecimal> {
        var rec = BigDecimal.ZERO
        var pay = BigDecimal.ZERO
        for (p in all) if (p.balance.signum() > 0) rec += p.balance else pay += p.balance.negate()
        return rec to pay
    }

    /** "9839012345" → "98390 12345", as the design writes mobile numbers. */
    fun showPhone(phone: String): String {
        val d = phone.filter { it.isDigit() }.let { if (it.length == 12 && it.startsWith("91")) it.drop(2) else it }
        return if (d.length == 10) d.take(5) + " " + d.drop(5) else phone
    }

    /** The detail line of a party: "+91 98390 12345 · Kanpur", or just the city. */
    fun detail(p: PartyFull): String {
        val city = p.billing?.city.orEmpty()
        return if (p.phone.isNotBlank()) "+91 ${showPhone(p.phone)}" + (if (city.isNotBlank()) " · $city" else "") else city
    }

    /** A transaction's badge on the party page. */
    sealed interface State {
        data object Received : State
        data object Given : State
        data object Paid : State
        data object PartPaid : State
        data class Overdue(val days: Int) : State
        data object Unpaid : State
    }

    fun isPayment(t: PartyTx) = t.type == "Payment-In" || t.type == "Payment-Out"

    fun state(t: PartyTx, today: String): State {
        if (t.type == "Payment-In") return State.Received
        if (t.type == "Payment-Out") return State.Given
        if (t.bal.signum() <= 0) return State.Paid
        if (t.bal < t.total) return State.PartPaid
        if (t.due.isNotBlank()) { val late = Format.daysBetween(t.due, today); if (late > 0) return State.Overdue(late) }
        return State.Unpaid
    }

    /** All / Unpaid / Overdue / Paid; payments and the opening balance show only under All. */
    enum class Filter { All, Unpaid, Overdue, Paid }

    fun filtered(rows: List<PartyTx>, f: Filter, today: String): List<PartyTx> = rows.filter { t ->
        if (f == Filter.All) return@filter true
        if (isPayment(t) || t.type == "Opening balance") return@filter false
        when (f) {
            Filter.Unpaid -> t.bal.signum() > 0
            Filter.Overdue -> state(t, today) is State.Overdue
            Filter.Paid -> t.bal.signum() <= 0
            Filter.All -> true
        }
    }

    /** Statement periods: This Month, Last Month, This Year (the financial year starts 1 April). */
    enum class Period { Month, LastMonth, Year, Custom }

    fun period(p: Period, today: String): Pair<String, String> {
        val (y, m, _) = today.split("-").map { it.toInt() }
        return when (p) {
            Period.Month -> "%04d-%02d-01".format(y, m) to today
            Period.LastMonth -> {
                val (ly, lm) = if (m == 1) (y - 1) to 12 else y to (m - 1)
                "%04d-%02d-01".format(ly, lm) to "%04d-%02d-%02d".format(ly, lm, daysIn(ly, lm))
            }
            Period.Year, Period.Custom -> "%04d-04-01".format(if (m >= 4) y else y - 1) to today
        }
    }

    private fun daysIn(y: Int, m: Int) = when (m) {
        2 -> if (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)) 29 else 28
        4, 6, 9, 11 -> 30
        else -> 31
    }

    /** The reminder message, the same as the web app's. */
    fun reminder(party: String, shop: String, balance: BigDecimal): String =
        "Dear $party, your balance with $shop is ₹${Format.inr(balance)}. Please pay at the earliest. Thank you."

    /** A phone number for WhatsApp and calls: India's code in front of a 10-digit number. */
    fun phoneForLink(phone: String): String {
        val d = phone.filter { it.isDigit() }
        return if (d.length == 10) "91$d" else d
    }
}
