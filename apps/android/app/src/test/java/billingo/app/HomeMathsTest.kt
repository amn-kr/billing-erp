package billingo.app

import billingo.app.data.Party
import billingo.app.data.SaleRow
import billingo.app.data.newer
import billingo.app.ui.home.HomeMaths
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

/** What Home shows (step 8.2d): the two summary cards, the order of parties, a bill's badge. */
class HomeMathsTest {
    private fun p(name: String, bal: String) = Party(id = name, name = name, balance = bal)
    private fun bill(total: String, balance: String, due: String? = null, cancelled: Boolean = false) =
        SaleRow(id = "x", number = "INV-0001", date = "2026-11-01", dueDate = due, total = total, balance = balance, cancelled = cancelled)

    @Test fun `you'll get and you'll give add up exactly, with how many parties`() {
        val t = HomeMaths.totals(listOf(p("Mehta", "21749.40"), p("Gupta", "4123.00"), p("Kanpur Cables", "-60119.00"), p("Shree", "0.00")))
        assertEquals(BigDecimal("25872.40"), t.get)
        assertEquals(2, t.getCount)
        assertEquals(BigDecimal("60119.00"), t.give)
        assertEquals(1, t.giveCount)
    }

    @Test fun `money to get first, then to give, then settled`() {
        val o = HomeMaths.ordered(listOf(p("Shree", "0"), p("Kanpur", "-60119"), p("Gupta", "4123"), p("Mehta", "21749.40"), p("Anand", "-10")))
        assertEquals(listOf("Mehta", "Gupta", "Kanpur", "Anand", "Shree"), o.map { it.name })
    }

    @Test fun `a bill's badge`() {
        val today = "2026-11-16"
        assertEquals(HomeMaths.Status.Cancelled, HomeMaths.status(bill("100", "100", cancelled = true), today))
        assertEquals(HomeMaths.Status.Paid, HomeMaths.status(bill("100", "0"), today))
        assertEquals(HomeMaths.Status.Overdue(12), HomeMaths.status(bill("100", "40", due = "2026-11-04"), today))
        assertEquals(HomeMaths.Status.PartPaid, HomeMaths.status(bill("100", "40", due = "2026-11-20"), today))
        assertEquals(HomeMaths.Status.Credit, HomeMaths.status(bill("100", "100"), today))
        // due today is not overdue yet
        assertEquals(HomeMaths.Status.Credit, HomeMaths.status(bill("100", "100", due = today), today))
    }

    @Test fun `versions compare as numbers`() {
        assertTrue(newer("1.0.10", "1.0.9"))
        assertTrue(newer("1.1.0", "1.0.99"))
        assertFalse(newer("1.0.0", "1.0.0"))
        assertFalse(newer("0.9.9", "1.0.0"))
    }
}
