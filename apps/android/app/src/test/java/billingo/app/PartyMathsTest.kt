package billingo.app

import billingo.app.data.Address
import billingo.app.data.PartyFull
import billingo.app.data.PartyTx
import billingo.app.ui.parties.PartyMaths
import billingo.app.ui.parties.PartyMaths.Bal
import billingo.app.ui.parties.PartyMaths.Filter
import billingo.app.ui.parties.PartyMaths.Kind
import billingo.app.ui.parties.PartyMaths.Period
import billingo.app.ui.parties.PartyMaths.State
import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigDecimal

/** The Parties screens' rules (step 8.3a, design 7.4b). */
class PartyMathsTest {
    private fun p(name: String, bal: String, kind: String = "customer", phone: String = "", city: String = "") =
        PartyFull(id = name, name = name, kind = kind, phone = phone, balance = BigDecimal(bal), billing = Address(city = city))
    private val list = listOf(
        p("Mehta Electricals", "21749.40", phone = "98390 12345", city = "Kanpur"),
        p("Gupta Lighting House", "4123.00", phone = "94150 22110"),
        p("Kanpur Cables Pvt Ltd", "-60119.00", kind = "supplier"),
        p("Shree Ganesh", "0"),
    )
    private fun names(k: Kind, b: Bal, q: String = "") = list.filter { PartyMaths.matches(it, k, b, q) }.map { it.name }

    @Test fun `tabs, balance filter and search`() {
        assertEquals(listOf("Kanpur Cables Pvt Ltd"), names(Kind.Suppliers, Bal.All))
        assertEquals(3, names(Kind.Customers, Bal.All).size)
        assertEquals(listOf("Mehta Electricals", "Gupta Lighting House"), names(Kind.All, Bal.Receive))
        assertEquals(listOf("Kanpur Cables Pvt Ltd"), names(Kind.All, Bal.Pay))
        assertEquals(listOf("Shree Ganesh"), names(Kind.All, Bal.Settled))
        assertEquals(listOf("Mehta Electricals"), names(Kind.All, Bal.All, "MEHTA"))
        assertEquals(listOf("Gupta Lighting House"), names(Kind.All, Bal.All, "9415022"))
    }

    @Test fun `the two boxes add up exactly`() {
        assertEquals(BigDecimal("25872.40") to BigDecimal("60119.00"), PartyMaths.totals(list))
    }

    @Test fun `a party's detail line`() {
        assertEquals("+91 98390 12345 · Kanpur", PartyMaths.detail(list[0]))
        assertEquals("+91 94150 22110", PartyMaths.detail(list[1]))
        assertEquals("", PartyMaths.detail(list[2]))
        assertEquals("+91 98390 12345", PartyMaths.detail(p("A", "0", phone = "9839012345")))
    }

    private fun tx(type: String, total: String, bal: String, due: String = "") = PartyTx(type, "X-1", "2026-10-05", BigDecimal(total), BigDecimal(bal), due)

    @Test fun `each transaction's badge`() {
        val today = "2026-11-16"
        assertEquals(State.Received, PartyMaths.state(tx("Payment-In", "8400", "0"), today))
        assertEquals(State.Given, PartyMaths.state(tx("Payment-Out", "8400", "0"), today))
        assertEquals(State.Paid, PartyMaths.state(tx("Sale", "8400", "0"), today))
        assertEquals(State.PartPaid, PartyMaths.state(tx("Sale", "8246", "4123", "2026-11-01"), today))
        assertEquals(State.Overdue(12), PartyMaths.state(tx("Sale", "19626.40", "19626.40", "2026-11-04"), today))
        assertEquals(State.Unpaid, PartyMaths.state(tx("Sale", "2123", "2123", "2026-12-14"), today))
    }

    @Test fun `filters leave payments and the opening balance under All only`() {
        val rows = listOf(tx("Sale", "100", "0"), tx("Sale", "100", "100", "2026-11-01"), tx("Payment-In", "100", "0"), tx("Opening balance", "50", "50"))
        val today = "2026-11-16"
        assertEquals(4, PartyMaths.filtered(rows, Filter.All, today).size)
        assertEquals(1, PartyMaths.filtered(rows, Filter.Unpaid, today).size)
        assertEquals(1, PartyMaths.filtered(rows, Filter.Overdue, today).size)
        assertEquals(1, PartyMaths.filtered(rows, Filter.Paid, today).size)
    }

    @Test fun `statement periods follow the calendar and the financial year`() {
        assertEquals("2026-11-01" to "2026-11-16", PartyMaths.period(Period.Month, "2026-11-16"))
        assertEquals("2026-10-01" to "2026-10-31", PartyMaths.period(Period.LastMonth, "2026-11-16"))
        assertEquals("2025-12-01" to "2025-12-31", PartyMaths.period(Period.LastMonth, "2026-01-10"))
        assertEquals("2024-02-01" to "2024-02-29", PartyMaths.period(Period.LastMonth, "2024-03-05"))
        assertEquals("2026-04-01" to "2026-11-16", PartyMaths.period(Period.Year, "2026-11-16"))
        assertEquals("2025-04-01" to "2026-02-20", PartyMaths.period(Period.Year, "2026-02-20"))
    }

    @Test fun `reminder message and phone links`() {
        assertEquals(
            "Dear Mehta Electricals, your balance with Sharma Electricals & Hardware is ₹21,749.40. Please pay at the earliest. Thank you.",
            PartyMaths.reminder("Mehta Electricals", "Sharma Electricals & Hardware", BigDecimal("21749.4")),
        )
        assertEquals("919839012345", PartyMaths.phoneForLink("98390 12345"))
        assertEquals("919839012345", PartyMaths.phoneForLink("919839012345"))
    }
}
