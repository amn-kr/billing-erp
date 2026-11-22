package billingo.app

import billingo.app.data.BillRow
import billingo.app.data.DocParty
import billingo.app.data.SaleDoc
import billingo.app.ui.docs.DocMaths
import billingo.app.ui.docs.DocMaths.Filter
import billingo.app.ui.docs.DocMaths.State
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigDecimal

/** Sale Bills and the Bill View (step 8.6a, design 7.4e): the boxes, the badges, the filter and Cancel's words. */
class DocMathsTest {
    private val today = "2026-11-22"
    private fun b(no: String, date: String, total: String, bal: String, party: String? = "Mehta Electricals", cash: String = "", due: String? = null, x: Boolean = false) =
        BillRow(id = no, number = no, date = date, dueDate = due, party = party?.let { DocParty(id = "p-$it", name = it) }, partyName = party ?: cash, total = total, balance = bal, cancelled = x)

    private val rows = listOf(
        b("INV-0107", "2026-11-14", "2123.00", "2123.00"),
        b("INV-0106", "2026-11-12", "8246.00", "4123.00", party = "Gupta Lighting House"),
        b("INV-0105", "2026-11-12", "640.00", "0.00", party = null, cash = "Walk-In Ramesh"),
        b("INV-0104", "2026-11-10", "999.00", "0.00", x = true),
        b("INV-0098", "2026-10-05", "19626.40", "500.00", due = "2026-11-04"),
        b("INV-0097", "2026-10-02", "300.00", "0.00", party = null),
    )

    @Test fun `this month's sales and what is still to get leave out cancelled bills`() {
        val (sales, dues) = DocMaths.summary(rows, today)
        assertEquals(BigDecimal("11009.00"), sales) // 2123 + 8246 + 640 (INV-0104 cancelled)
        assertEquals(BigDecimal("6746.00"), dues) // 2123 + 4123 + 500
    }

    @Test fun `badges follow the party's transactions`() {
        assertEquals(State.Unpaid, DocMaths.state(rows[0], today))
        assertEquals(State.PartPaid, DocMaths.state(rows[1], today))
        assertEquals(State.Paid, DocMaths.state(rows[2], today))
        assertEquals(State.Cancelled, DocMaths.state(rows[3], today))
        // part paid comes before overdue, as on the party page
        assertEquals(State.PartPaid, DocMaths.state(rows[4], today))
        assertEquals(State.Overdue(18), DocMaths.state(false, BigDecimal("500"), BigDecimal("500"), "2026-11-04", today))
        assertEquals(State.Unpaid, DocMaths.state(false, BigDecimal("500"), BigDecimal("500"), "2026-11-30", today))
    }

    @Test fun `status choice and search by number or name`() {
        fun nos(f: Filter, q: String = "") = rows.filter { DocMaths.matches(it, f, q, "Counter Customer") }.map { it.number }
        assertEquals(6, nos(Filter.All).size)
        assertEquals(listOf("INV-0107", "INV-0106", "INV-0098"), nos(Filter.Due))
        assertEquals(listOf("INV-0105", "INV-0097"), nos(Filter.Paid))
        assertEquals(listOf("INV-0104"), nos(Filter.Cancelled))
        assertEquals(listOf("INV-0106"), nos(Filter.All, "gupta"))
        assertEquals(listOf("INV-0105"), nos(Filter.All, "ramesh"))
        assertEquals(listOf("INV-0097"), nos(Filter.All, "counter"))
        assertEquals(listOf("INV-0098"), nos(Filter.All, " inv-0098 "))
    }

    @Test fun `a walk-in without a name is the Counter Customer`() {
        assertEquals("Counter Customer", DocMaths.name(rows[5], "Counter Customer"))
        assertEquals("Walk-In Ramesh", DocMaths.name(rows[2], "Counter Customer"))
        assertEquals("Counter Customer", DocMaths.name(SaleDoc(id = "x", number = "INV-1"), "Counter Customer"))
    }

    @Test fun `where the bill came from and its charges`() {
        val d = SaleDoc(
            id = "x", number = "INV-0098", transport = "150.00", labour = "50.00", bankCharge = "12.50",
            extra = buildJsonObject {
                put("quoteRefs", JsonArray(listOf(buildJsonObject { put("no", "QT-0030") }, buildJsonObject { put("no", "QT-0030") })))
                put("challanNo", JsonPrimitive("DC-0011"))
            },
        )
        assertEquals(listOf("QT-0030", "DC-0011"), DocMaths.sources(d))
        assertEquals(emptyList<String>(), DocMaths.sources(SaleDoc(id = "y", number = "INV-1")))
        assertEquals(BigDecimal("212.50"), DocMaths.charges(d))
    }

    @Test fun `cancel tells the dues that go and the money kept as advance`() {
        val c = DocMaths.cancelNote(SaleDoc(id = "x", number = "INV-0106", party = DocParty(id = "p", name = "Gupta Lighting House"), total = "8246.00", balance = "4123.00"))
        assertEquals("Gupta Lighting House", c.party)
        assertEquals(BigDecimal("4123.00"), c.dues)
        assertEquals(BigDecimal("4123.00"), c.paid)
        val walkIn = DocMaths.cancelNote(SaleDoc(id = "y", number = "INV-0105", total = "640.00", balance = "0.00"))
        assertEquals(null, walkIn.party)
        assertEquals(BigDecimal("640.00"), walkIn.paid)
    }
}
