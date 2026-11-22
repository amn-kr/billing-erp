package billingo.app

import billingo.app.data.DocLine
import billingo.app.data.DocParty
import billingo.app.data.ItemFull
import billingo.app.data.ListPrice
import billingo.app.data.PartyFull
import billingo.app.data.PriceList
import billingo.app.data.PricedItem
import billingo.app.data.Prices
import billingo.app.data.QuoteRow
import billingo.app.data.SaleDoc
import billingo.app.data.ShopSettings
import billingo.app.ui.docs.DocMaths
import billingo.app.ui.docs.DocMaths.QState
import billingo.app.ui.sale.SaleMaths
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

/** Item-wise quotations (step 8.6c, design 7.4e): the list, what is sent, Copy and Convert To Bill. */
class QuoteTest {
    private val led = ItemFull(id = "led", name = "LED Bulb 9W", sale = BigDecimal("85"), gstRate = "12", unit = "PCS", hsn = "8539")
    private val mehta = PartyFull(id = "m", name = "Mehta", gstin = "09ABCDE1234F1Z5", creditDays = 15)
    private val c = SaleMaths.ctx(
        ShopSettings(gstEnabled = true), "09", listOf(PriceList("def", "Retail", isDefault = true)),
        Prices(listOf(PricedItem("led", mapOf("def" to ListPrice("85"))))), emptyList(), listOf(led), listOf(mehta),
    )
    private fun q(no: String, status: String = "open", x: Boolean = false, party: String? = "Mehta", qtype: String = "items") =
        QuoteRow(id = no, number = no, date = "2026-11-14", party = party?.let { DocParty(id = "m", name = it) }, partyName = party ?: "", total = "100.00", status = status, cancelled = x, qtype = qtype)

    @Test fun `states, the boxes and the status choice`() {
        val rows = listOf(q("QT-0033"), q("QT-0032", "converted"), q("QT-0031", x = true), q("QT-0030", qtype = "brand", party = null))
        assertEquals(listOf(QState.Open, QState.Converted, QState.Cancelled, QState.Open), rows.map { DocMaths.qState(it) })
        assertEquals(2 to 1, DocMaths.qSummary(rows))
        fun nos(f: Int, t: String = "") = rows.filter { DocMaths.qMatches(it, f, t, "Counter Customer") }.map { it.number }
        assertEquals(listOf("QT-0033", "QT-0030"), nos(1))
        assertEquals(listOf("QT-0032"), nos(2))
        assertEquals(listOf("QT-0031"), nos(3))
        assertEquals(listOf("QT-0030"), nos(0, "counter"))
    }

    @Test fun `a quotation is sent as a quotation, valid for 15 days, without payments`() {
        val d = SaleMaths.Draft(date = "2026-11-22", partyId = "m", quote = true, chgOk = true).let { it.copy(lines = listOf(SaleMaths.newLine(c, it, led))) }
        val b = SaleMaths.body(c, d)
        assertEquals("quotation", b["kind"]!!.jsonPrimitive.content)
        assertEquals("2026-12-07", b["dueDate"]!!.jsonPrimitive.content)
        assertEquals("2026-12-07", b["extra"]!!.jsonObject["validTill"]!!.jsonPrimitive.content)
        assertEquals(0, b["payments"]!!.jsonArray.size)
        assertEquals(SaleMaths.EST, b["notes"]!!.jsonPrimitive.content)
    }

    private val saved = SaleDoc(
        id = "q1", number = "QT-0033", kind = "quotation", date = "2026-11-10", dueDate = "2026-11-25", mode = "credit",
        party = DocParty(id = "m", name = "Mehta"), partyName = "Mehta", status = "open",
        lines = listOf(DocLine(itemId = "led", name = "LED Bulb 9W", qty = "20", unit = "PCS", price = "82.00", discPct = "0", gstRate = "12")),
        transport = "50.00", notes = "Valid for site A only.", total = "1690.00",
        extra = buildJsonObject { put("vehicle", "UP78"); put("validTill", "2026-11-25") },
    )

    @Test fun `editing keeps it a quotation with its own validity`() {
        val d = SaleMaths.fromSaved(c, saved).first!!
        assertTrue(d.quote)
        val b = SaleMaths.body(c, d)
        assertEquals("quotation", b["kind"]!!.jsonPrimitive.content)
        assertEquals("2026-11-25", b["dueDate"]!!.jsonPrimitive.content)
        assertEquals(0, b["payments"]!!.jsonArray.size)
        assertEquals("Valid for site A only.", b["notes"]!!.jsonPrimitive.content)
    }

    @Test fun `copy as new is a new quotation dated today`() {
        val d = SaleMaths.copyOf(c, saved, "2026-11-22").first!!
        assertNull(d.edit)
        assertTrue(d.quote)
        assertEquals("2026-11-22", d.date)
        val b = SaleMaths.body(c, d)
        assertEquals("", b["number"]!!.jsonPrimitive.content)
        assertEquals("2026-12-07", b["dueDate"]!!.jsonPrimitive.content)
        assertEquals("Valid for site A only.", b["notes"]!!.jsonPrimitive.content)
        assertEquals("20", d.lines.single().qty)
    }

    @Test fun `convert to bill brings the items, customer, charges and the quotation link`() {
        val (d, n) = SaleMaths.billFromQuote(c, saved, "2026-11-22")
        assertEquals(1, n)
        assertEquals(false, d.quote)
        assertEquals("m", d.partyId)
        assertEquals(BigDecimal("82.00"), d.lines.single().price)
        assertEquals("QT-0033", d.lines.single().fromQ)
        assertEquals("50", d.chTr)
        assertEquals("UP78", d.vehicle)
        val b = SaleMaths.body(c, d)
        assertEquals("invoice", b["kind"]!!.jsonPrimitive.content)
        assertEquals(listOf(JsonPrimitive("q1")), b["fromQuotationIds"]!!.jsonArray.toList())
        assertEquals("As per quotation QT-0033.", b["notes"]!!.jsonPrimitive.content)
    }

    @Test fun `the bill a quotation turned into, and brand-wise ones`() {
        val conv = saved.copy(status = "converted", extra = buildJsonObject { put("invoiceNo", "INV-0108") })
        assertEquals("INV-0108", DocMaths.invoiceOf(conv))
        assertEquals(QState.Converted, DocMaths.qState(conv.cancelled, conv.status))
        assertTrue(DocMaths.isBrandWise(saved.copy(extra = buildJsonObject { put("type", "brand") })))
    }
}
