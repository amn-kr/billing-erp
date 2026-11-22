package billingo.app

import billingo.app.data.DocBatch
import billingo.app.data.DocLine
import billingo.app.data.DocParty
import billingo.app.data.DocPayment
import billingo.app.data.DocSplit
import billingo.app.data.ItemFull
import billingo.app.data.ListPrice
import billingo.app.data.PartyFull
import billingo.app.data.PriceList
import billingo.app.data.PricedItem
import billingo.app.data.Prices
import billingo.app.data.SaleDoc
import billingo.app.data.ShopSettings
import billingo.app.data.StockBatch
import billingo.app.ui.sale.SaleMaths
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
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

/** Edit Bill (step 8.6b): a saved bill loads as it was, keeps what the phone doesn't change, and goes back without a number. */
class EditBillTest {
    private val led = ItemFull(id = "led", name = "LED Bulb 9W", sale = BigDecimal("85"), gstRate = "12", unit = "PCS", hsn = "8539", category = "Lighting")
    private val mehta = PartyFull(id = "m", name = "Mehta", group = "Electricians", gstin = "07ABCDE1234F1Z5", balance = BigDecimal("1200"), creditDays = 15)
    private val c = SaleMaths.ctx(
        ShopSettings(gstEnabled = true), "09", listOf(PriceList("def", "Retail", isDefault = true)),
        Prices(listOf(PricedItem("led", mapOf("def" to ListPrice("85"))))), listOf("batch_no"), listOf(led), listOf(mehta),
        batches = mapOf("led" to listOf(StockBatch(id = "b1", no = "A1", qty = "4"), StockBatch(id = "b2", no = "A2", qty = "10"))),
    )

    private val saved = SaleDoc(
        id = "inv-1", number = "INV-0107", date = "2026-11-14", dueDate = "2026-11-30", mode = "credit",
        party = DocParty(id = "m", name = "Mehta"), partyName = "Mehta", placeOfSupply = "09", billName = "Mehta & Sons",
        lines = listOf(DocLine(itemId = "led", name = "LED Bulb 9W", qty = "10", unit = "PCS", price = "90.00", discPct = "5", gstRate = "12", hsn = "8539",
            batches = listOf(DocBatch(batchId = "b1", qty = "6"), DocBatch(batchId = "b2", qty = "4")), basePrice = "80.00",
            commOverride = buildJsonObject { put("t", "f"); put("v", 3) })),
        billDiscount = "20.00", transport = "150.00", roundOff = false, total = "1000.00", balance = "700.00", notes = "Our own terms.",
        referrerId = "raju",
        extra = buildJsonObject {
            put("challanNo", "DC-0011"); put("poNo", "PO-9"); put("transport", "Self"); put("vehicle", "UP78")
            put("quoteRefs", JsonArray(listOf(buildJsonObject { put("no", "QT-0030"); put("date", "2026-11-01"); put("cust", "Mehta") })))
            put("commByCategory", buildJsonObject { put("Lighting", buildJsonObject { put("t", "p"); put("v", 5) }) })
        },
        payment = DocPayment(amount = "300.00", mode = "UPI", splits = listOf(DocSplit("UPI", "300.00", "UTR 1", "acc-1"))),
    )

    @Test fun `a saved bill loads as it was`() {
        val (d, missing) = SaleMaths.fromSaved(c, saved)
        assertTrue(missing.isEmpty())
        d!!
        assertEquals("INV-0107", d.edit!!.number)
        assertEquals("m", d.partyId)
        val l = d.lines.single()
        assertEquals("10", l.qty)
        assertEquals(BigDecimal("90.00"), l.price)
        assertEquals(BigDecimal("80.00"), l.bp)
        assertEquals(listOf<Pair<String?, BigDecimal>>("b1" to BigDecimal("6"), "b2" to BigDecimal("4")), l.alloc)
        assertEquals("20", d.bdisc)
        assertEquals("150", d.chTr)
        assertEquals(false, d.roundOff)
        assertEquals(listOf(SaleMaths.Pay("UPI", "300", "UTR 1", "acc-1")), d.pays)
        assertTrue(d.payTouched && d.chgOk)
        assertEquals(SaleMaths.Rule('p', BigDecimal("5")), d.catRules["Lighting"])
        assertEquals("Self", d.transport)
        assertEquals(listOf("QT-0030"), d.quotes.map { it.no })
        // what Mehta owed before this bill: 1200 − the 700 it still owes
        assertEquals(BigDecimal("500.00"), SaleMaths.before(d, mehta))
    }

    @Test fun `it goes back without a number, keeping what the phone doesn't change`() {
        val d = SaleMaths.fromSaved(c, saved).first!!
        val b = SaleMaths.body(c, d)
        fun s(k: String) = b[k]!!.jsonPrimitive.content
        assertEquals("", s("number"))
        assertEquals("2026-11-30", s("dueDate"))
        // the saved place of supply (09), not the party's GSTIN state (07): no IGST
        assertEquals("09", s("placeOfSupply"))
        assertEquals("Mehta & Sons", s("billName"))
        assertEquals("Our own terms.", s("notes"))
        val x = b["extra"]!!.jsonObject
        assertEquals("DC-0011", x["challanNo"]!!.jsonPrimitive.content)
        assertEquals("PO-9", x["poNo"]!!.jsonPrimitive.content)
        assertEquals("Self", x["transport"]!!.jsonPrimitive.content)
        assertEquals("p", x["commByCategory"]!!.jsonObject["Lighting"]!!.jsonObject["t"]!!.jsonPrimitive.content)
        val l = b["lines"]!!.jsonArray.single().jsonObject
        assertEquals(2, l["batches"]!!.jsonArray.size)
        assertEquals("f", l["commOverride"]!!.jsonObject["t"]!!.jsonPrimitive.content)
        val pay = b["payments"]!!.jsonArray.single().jsonObject
        assertEquals("acc-1", pay["accountId"]!!.jsonPrimitive.content)
        // the quotation is already joined to this bill: not converted again
        assertEquals(0, b["fromQuotationIds"]!!.jsonArray.size)
    }

    @Test fun `a changed quantity lets the server pick the batches again`() {
        val d = SaleMaths.fromSaved(c, saved).first!!
        val more = d.copy(lines = d.lines.map { it.copy(qty = "12") })
        assertTrue(SaleMaths.allocOf(c, more.lines.single()).isEmpty())
        assertNull(SaleMaths.body(c, more)["lines"]!!.jsonArray.single().jsonObject["batches"])
        // a batch chosen by hand always goes
        val hand = d.copy(lines = d.lines.map { it.copy(qty = "12", batchId = "b2") })
        assertEquals(listOf<Pair<String?, BigDecimal>>("b2" to BigDecimal("12")), SaleMaths.allocOf(c, hand.lines.single()))
    }

    @Test fun `while it is changed its stock counts as back in its batches`() {
        val d = SaleMaths.fromSaved(c, saved).first!!
        val cc = SaleMaths.withSavedStock(c, d)
        assertEquals(listOf("10", "14"), cc.batches["led"]!!.map { it.qty })
    }

    @Test fun `another customer gets the usual due date and place of supply`() {
        val other = PartyFull(id = "o", name = "Other", state = "09", creditDays = 7)
        val cc = c.copy(parties = c.parties + other)
        val d = SaleMaths.fromSaved(cc, saved).first!!.copy(partyId = "o")
        val b = SaleMaths.body(cc, d)
        assertEquals("2026-11-21", b["dueDate"]!!.jsonPrimitive.content)
        assertEquals("09", b["placeOfSupply"]!!.jsonPrimitive.content)
        assertEquals(BigDecimal("0"), SaleMaths.before(d, other))
    }

    @Test fun `an item no longer in the list stops the edit`() {
        val gone = saved.copy(lines = saved.lines + DocLine(itemId = "old", name = "Old Fan"))
        val (d, missing) = SaleMaths.fromSaved(c, gone)
        assertNull(d)
        assertEquals(listOf("Old Fan"), missing)
    }

    @Test fun `a new bill is sent as before`() {
        val d = SaleMaths.Draft(date = "2026-11-21", partyId = "m", lines = listOf(SaleMaths.newLine(c, SaleMaths.Draft(date = "2026-11-21"), led)))
        val b = SaleMaths.body(c, d)
        assertEquals(SaleMaths.NOTES, b["notes"]!!.jsonPrimitive.content)
        assertEquals("07", b["placeOfSupply"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, b["lines"]!!.jsonArray.single().jsonObject["commOverride"])
        assertEquals(JsonPrimitive(true), b["pricesInclTax"])
    }
}
