package billingo.app

import billingo.app.data.BillRow
import billingo.app.data.DocParty
import billingo.app.data.Due
import billingo.app.data.ReceiptRow
import billingo.app.ui.docs.DocMaths
import billingo.app.ui.parts.Format
import billingo.app.ui.print.PFmt
import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigDecimal

/** Payments received (step 8.6e-1, design 7.4e): settling bills oldest first, the advance, the list and the receipt message. */
class ReceiptTest {
    private val dues = listOf(
        Due("opening", "opening", "Opening balance", "2026-04-01", null, "500.00", "500.00"),
        Due("inv-90", "invoice", "INV-0090", "2026-09-20", null, "8400.00", "8400.00"),
        Due("inv-98", "invoice", "INV-0098", "2026-10-05", null, "19626.40", "6000.00"),
    )
    private fun bd(s: String) = BigDecimal(s)

    @Test fun `a payment settles the ticked bills oldest first, the rest is advance`() {
        val all = dues.map { it.to }.toSet()
        val s = DocMaths.allocate(dues, all, bd("10000"))
        assertEquals(listOf("opening" to bd("500.00"), "inv-90" to bd("8400.00"), "inv-98" to bd("1100.00")), s.to)
        assertEquals(0, s.advance.signum())
        // more than everything owed: the rest is kept as advance
        val more = DocMaths.allocate(dues, all, bd("16000"))
        assertEquals(0, bd("1100").compareTo(more.advance))
        // an unticked bill is left unpaid, and the next one gets the money
        val skip = DocMaths.allocate(dues, all - "inv-90", bd("3000"))
        assertEquals(listOf("opening" to bd("500.00"), "inv-98" to bd("2500.00")), skip.to)
    }

    private fun r(no: String, date: String, amt: String, mode: String = "Cash", ref: String = "", against: String = "") =
        ReceiptRow(id = no, number = no, date = date, party = DocParty("m", "Mehta Electricals", phone = "9839012345"), partyName = "Mehta Electricals", mode = mode, reference = ref, against = against, amount = amt)

    @Test fun `the boxes, the payment type choice and search`() {
        val rows = listOf(r("PR-0046", "2026-11-20", "4123.00", "UPI", "UTR 4471"), r("PR-0045", "2026-11-02", "1000.00"), r("PR-0035", "2026-10-28", "8400.00", "Cheque", "000123", "INV-0090"))
        val bills = listOf(
            BillRow(id = "a", number = "INV-0107", date = "2026-11-14", total = "2123.00", balance = "2123.00"),
            BillRow(id = "b", number = "INV-0104", date = "2026-11-10", total = "999.00", balance = "999.00", cancelled = true),
        )
        val (month, collect) = DocMaths.prSummary(rows, bills, "2026-11-22")
        assertEquals(0, bd("5123").compareTo(month))
        assertEquals(0, bd("2123").compareTo(collect))
        fun nos(f: Int, q: String = "") = rows.filter { DocMaths.prMatches(it, f, q) }.map { it.number }
        assertEquals(listOf("PR-0045"), nos(1))
        assertEquals(listOf("PR-0046"), nos(2))
        assertEquals(listOf("PR-0035"), nos(4))
        assertEquals(listOf("PR-0046"), nos(0, "4471"))
        assertEquals(listOf("PR-0035"), nos(0, "inv-0090"))
    }

    @Test fun `the web's WhatsApp receipt`() {
        val m = DocMaths.receiptMessage(r("PR-0046", "2026-11-20", "4123.00", "UPI", "UTR 4471"), { Format.inr(DocMaths.num(it)) }, { PFmt.dmy(it) })
        assertEquals("Dear Mehta Electricals, we have received 4,123.00 by UPI (ref UTR 4471) on 20/11/2026. Receipt PR-0046. Thank you!", m)
    }
}
