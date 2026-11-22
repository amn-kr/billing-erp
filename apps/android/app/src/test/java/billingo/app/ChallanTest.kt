package billingo.app

import billingo.app.data.ChallanRow
import billingo.app.data.DocLine
import billingo.app.data.DocParty
import billingo.app.data.ItemFull
import billingo.app.data.ListPrice
import billingo.app.data.PartyFull
import billingo.app.data.PriceList
import billingo.app.data.PricedItem
import billingo.app.data.Prices
import billingo.app.data.SaleDoc
import billingo.app.data.ShopSettings
import billingo.app.ui.docs.DocMaths
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

/** Delivery challans (step 8.6d): the list, what is sent, Edit Challan and Convert To Bill. */
class ChallanTest {
    private val led = ItemFull(id = "led", name = "LED Bulb 9W", sale = BigDecimal("85"), gstRate = "12", unit = "PCS")
    private val sw = ItemFull(id = "sw", name = "Switch", sale = BigDecimal("950"), gstRate = "18", unit = "PCS", packUnit = "BOX", packSize = "10")
    private val mehta = PartyFull(id = "m", name = "Mehta Electricals", group = "Electricians")
    private val c = SaleMaths.ctx(
        ShopSettings(gstEnabled = true), "09", listOf(PriceList("def", "Retail", isDefault = true), PriceList("wh", "Wholesale", groups = listOf("Electricians"))),
        Prices(listOf(PricedItem("led", mapOf("def" to ListPrice("85"), "wh" to ListPrice("80"))))), listOf("pack_loose"), listOf(led, sw), listOf(mehta),
    )
    private fun row(no: String, status: String = "open", qty: String = "10", x: Boolean = false, party: String? = "Mehta Electricals", names: List<String> = emptyList()) =
        ChallanRow(id = no, number = no, date = "2026-11-15", party = party?.let { DocParty(id = "m", name = it) }, partyName = party ?: "Walk-In Suresh", status = status, cancelled = x, qty = qty, lineNames = names)

    @Test fun `the boxes and the status choice`() {
        val rows = listOf(row("DC-0012", qty = "32", names = listOf("LED Bulb 9W")), row("DC-0011", "invoiced", "58"), row("DC-0010", "cancelled", "10", x = true, party = null))
        val (open, out) = DocMaths.chSummary(rows)
        assertEquals(1, open)
        assertEquals(0, BigDecimal("32").compareTo(out))
        fun nos(f: Int, t: String = "") = rows.filter { DocMaths.chMatches(it, f, t, "Counter Customer") }.map { it.number }
        assertEquals(listOf("DC-0012"), nos(1))
        assertEquals(listOf("DC-0011"), nos(2))
        assertEquals(listOf("DC-0010"), nos(3))
        assertEquals(listOf("DC-0012"), nos(0, "led bulb"))
        assertEquals(listOf("DC-0010"), nos(0, "suresh"))
    }

    @Test fun `a challan needs a customer or a name, and items with quantities`() {
        val d = SaleMaths.Draft(date = "2026-11-22", challan = true)
        assertEquals(SaleMaths.ChProblem.NoCustomer, SaleMaths.chProblem(d))
        assertEquals(SaleMaths.ChProblem.NoItems, SaleMaths.chProblem(d.copy(cashName = "Suresh")))
        assertNull(SaleMaths.chProblem(d.copy(partyId = "m", lines = listOf(SaleMaths.newLine(c, d, led)))))
    }

    @Test fun `what is sent for a challan`() {
        val base = SaleMaths.Draft(date = "2026-11-22", challan = true, partyId = "m", transport = " Self ", vehicle = "UP78", notes = "Site: Civil Lines")
        val d = base.copy(lines = listOf(SaleMaths.newLine(c, base, led).copy(qty = "30"), SaleMaths.newLine(c, base, sw).copy(qty = "2")))
        val b = SaleMaths.challanBody(c, d)
        assertEquals("m", b["partyId"]!!.jsonPrimitive.content)
        assertEquals("", b["cashName"]!!.jsonPrimitive.content)
        val lines = b["lines"]!!.jsonArray.map { it.jsonObject }
        assertEquals("30", lines[0]["qty"]!!.jsonPrimitive.content)
        assertEquals("", lines[0]["unit"]!!.jsonPrimitive.content)
        // packs on: the switch starts in boxes, and the box is sent as its unit
        assertEquals("BOX", lines[1]["unit"]!!.jsonPrimitive.content)
        assertEquals("Self", b["transport"]!!.jsonPrimitive.content)
        assertEquals("Site: Civil Lines", b["note"]!!.jsonPrimitive.content)
        // a counter customer: the name, no party
        val walk = SaleMaths.challanBody(c, d.copy(partyId = null, cashName = "Walk-In Suresh"))
        assertEquals("Walk-In Suresh", walk["cashName"]!!.jsonPrimitive.content)
    }

    private val saved = SaleDoc(
        id = "dc1", number = "DC-0012", kind = "challan", date = "2026-11-15", party = DocParty(id = "m", name = "Mehta Electricals"), partyName = "Mehta Electricals",
        lines = listOf(DocLine(itemId = "led", name = "LED Bulb 9W", qty = "30.000", unit = "PCS"), DocLine(itemId = "sw", name = "Switch", qty = "2.000", unit = "BOX")),
        notes = "Site: Civil Lines", extra = buildJsonObject { put("transport", "Self"); put("vehicle", "UP78 CD 4521") },
    )

    @Test fun `edit challan loads it as it was`() {
        val (d, missing) = SaleMaths.challanFromSaved(c, saved)
        assertTrue(missing.isEmpty())
        d!!
        assertTrue(d.challan)
        assertEquals("DC-0012", d.edit!!.number)
        assertEquals("m", d.partyId)
        assertEquals(listOf("30", "2"), d.lines.map { it.qty })
        assertEquals("BOX", d.lines[1].unit)
        assertEquals("UP78 CD 4521", d.vehicle)
        assertEquals("Site: Civil Lines", d.notes)
    }

    @Test fun `convert to bill uses today's prices and puts the challan's number on the bill`() {
        val (d, n) = SaleMaths.billFromChallan(c, saved, "2026-11-22")
        assertEquals(2, n)
        assertEquals(false, d.challan)
        assertEquals("m", d.partyId)
        // Mehta's group list: 80 for the LED; the switch box at its sale price
        assertEquals(BigDecimal("80"), d.lines[0].price)
        assertEquals("30", d.lines[0].qty)
        assertEquals(BigDecimal("950"), d.lines[1].price)
        assertEquals("Self", d.transport)
        val b = SaleMaths.body(c, d)
        assertEquals(JsonPrimitive("dc1"), b["fromChallanId"])
        assertEquals("DC-0012", b["extra"]!!.jsonObject["challanNo"]!!.jsonPrimitive.content)
        assertEquals("invoice", b["kind"]!!.jsonPrimitive.content)
        // a counter customer's challan: a counter sale with the name
        val walk = SaleMaths.billFromChallan(c, saved.copy(party = null, partyName = "Walk-In Suresh", cashName = "Walk-In Suresh"), "2026-11-22").first
        assertTrue(walk.cash)
        assertEquals("Walk-In Suresh", SaleMaths.body(c, walk)["cashName"]!!.jsonPrimitive.content)
    }
}
