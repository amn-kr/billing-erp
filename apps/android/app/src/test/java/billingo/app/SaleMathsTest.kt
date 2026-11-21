package billingo.app

import billingo.app.data.ItemFull
import billingo.app.data.ListPrice
import billingo.app.data.PartyFull
import billingo.app.data.PriceList
import billingo.app.data.PricedItem
import billingo.app.data.Prices
import billingo.app.data.CommissionRule
import billingo.app.data.DocLine
import billingo.app.data.DocParty
import billingo.app.data.Referrer
import billingo.app.data.SaleDoc
import billingo.app.data.ShopSettings
import billingo.app.data.StockBatch
import billingo.app.data.TaxRate
import billingo.app.ui.sale.BillMaths
import billingo.app.ui.sale.SaleMaths
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

/** The New Sale rules (step 8.5b): prices per customer, final rate ↔ discount, payments, and what is sent. */
class SaleMathsTest {
    private val led = ItemFull(id = "led", name = "LED Bulb 9W", sale = BigDecimal("85"), gstRate = "12", unit = "PCS", hsn = "8539")
    private val box = ItemFull(id = "sw", name = "Switch", sale = BigDecimal("950"), gstRate = "18", unit = "PCS", packUnit = "BOX", packSize = "10")
    private val mehta = PartyFull(id = "m", name = "Mehta", group = "Electricians", gstin = "09ABCDE1234F1Z5", balance = BigDecimal("1200"), creditDays = 15)
    private val delhi = PartyFull(id = "d", name = "Delhi Traders", state = "07")

    private fun ctx(features: List<String> = emptyList(), settings: ShopSettings = ShopSettings(gstEnabled = true)) = SaleMaths.ctx(
        settings, "09",
        listOf(PriceList("def", "Retail", isDefault = true), PriceList("wh", "Wholesale", groups = listOf("Electricians")), PriceList("old", "Old", active = false, groups = listOf("Electricians"))),
        Prices(listOf(PricedItem("led", mapOf("def" to ListPrice("85"), "wh" to ListPrice("80"))))),
        features, listOf(led, box), listOf(mehta, delhi),
    )

    @Test fun `a customer's group list gives the price, others the default`() {
        val c = ctx()
        assertEquals(BigDecimal("80"), SaleMaths.priceFor(c, led, mehta, "PCS"))
        assertEquals(BigDecimal("85"), SaleMaths.priceFor(c, led, delhi, "PCS"))
        assertEquals(BigDecimal("85"), SaleMaths.priceFor(c, led, null, "PCS"))
        // no list price for the item: its sale price
        assertEquals(BigDecimal("950"), SaleMaths.priceFor(c, box, mehta, "BOX"))
    }

    @Test fun `packs start in the pack unit only with the feature on, loose is the pack price divided`() {
        val d = SaleMaths.Draft(date = "2026-11-21")
        assertEquals("PCS", SaleMaths.newLine(ctx(), d, box).unit)
        val on = ctx(listOf("pack_loose"))
        val l = SaleMaths.newLine(on, d, box)
        assertEquals("BOX", l.unit)
        assertEquals(BigDecimal("950"), l.price)
        assertEquals(BigDecimal("95.00"), SaleMaths.priceFor(on, box, null, "PCS"))
        assertEquals(listOf("BOX", "PCS"), SaleMaths.units(on, box))
    }

    @Test fun `state comes from the GSTIN, then the party, then the shop`() {
        val c = ctx()
        assertEquals("09", SaleMaths.partyState(c, mehta))
        assertEquals("07", SaleMaths.partyState(c, delhi))
        assertEquals("09", SaleMaths.partyState(c, null))
        val bill = SaleMaths.bill(c, SaleMaths.withParty(c, SaleMaths.Draft(date = "2026-11-21"), delhi).copy(lines = listOf(SaleMaths.newLine(c, SaleMaths.Draft(date = "2026-11-21"), led))))
        assertTrue("another state is IGST", bill.inter)
    }

    @Test fun `changing the customer re-prices every line`() {
        val c = ctx()
        val d = SaleMaths.Draft(date = "2026-11-21").let { it.copy(lines = listOf(SaleMaths.newLine(c, it, led))) }
        assertEquals(BigDecimal("85"), d.lines[0].price)
        assertEquals(BigDecimal("80"), SaleMaths.withParty(c, d, mehta).lines[0].price)
    }

    @Test fun `final rate gives the discount, and above the list rate a minus one`() {
        val l = SaleMaths.newLine(ctx(), SaleMaths.Draft(date = "2026-11-21"), led)
        val down = SaleMaths.withFinal(l, BigDecimal("80.75"))
        assertEquals(0, BigDecimal("5").compareTo(down.disc))
        assertEquals(BigDecimal("80.75"), SaleMaths.finalRate(down))
        assertTrue(SaleMaths.withFinal(l, BigDecimal("100")).disc.signum() < 0)
        // however large, the sale price stays the list rate (owner, 21 Nov 2026)
        val huge = SaleMaths.withFinal(l, BigDecimal("9000"))
        assertEquals(BigDecimal("85"), huge.price)
        assertEquals(BigDecimal("9000.00"), SaleMaths.finalRate(huge))
        // no list rate: the typed rate becomes the price
        val free = SaleMaths.withFinal(l.copy(price = BigDecimal.ZERO), BigDecimal("50"))
        assertEquals(BigDecimal("50"), free.price)
        assertEquals(0, free.disc.signum())
    }

    @Test fun `a cash bill is fully received, a credit bill not until changed`() {
        val total = BigDecimal("2230")
        val cash = SaleMaths.Draft(date = "2026-11-21", cash = true)
        assertEquals(0, total.compareTo(SaleMaths.received(cash, total)))
        val credit = SaleMaths.Draft(date = "2026-11-21", pays = listOf(SaleMaths.Pay("UPI", "500")))
        assertEquals(0, SaleMaths.received(credit, total).signum())
        val touched = credit.copy(payTouched = true)
        assertEquals(BigDecimal("500"), SaleMaths.received(touched, total))
        assertEquals(BigDecimal("1730"), SaleMaths.dues(touched, total))
    }

    @Test fun `problems in the web's order`() {
        assertEquals(SaleMaths.Problem.NoParty, SaleMaths.problem(SaleMaths.Draft(date = "2026-11-21")))
        assertEquals(SaleMaths.Problem.NoItems, SaleMaths.problem(SaleMaths.Draft(date = "2026-11-21", cash = true)))
        val c = ctx()
        val l = SaleMaths.newLine(c, SaleMaths.Draft(date = "2026-11-21"), led).copy(qty = "0")
        assertEquals(SaleMaths.Problem.NoQty, SaleMaths.problem(SaleMaths.Draft(date = "2026-11-21", cash = true, lines = listOf(l))))
        assertNull(SaleMaths.problem(SaleMaths.Draft(date = "2026-11-21", cash = true, lines = listOf(l.copy(qty = "2")))))
    }

    @Test fun `TCS and composition come from the settings`() {
        val tcs = ShopSettings(true, JsonObject(mapOf("tcs" to JsonPrimitive(true), "tcsRate" to JsonPrimitive("t1"))), listOf(TaxRate("t1", "TCS", "0.1")))
        assertEquals(BigDecimal("0.1"), ctx(settings = tcs).tcsRate)
        assertEquals(BillMaths.Mode.Bos, ctx(settings = ShopSettings(true, JsonObject(mapOf("reg" to JsonPrimitive("composition"))))).mode)
        assertEquals(BillMaths.Mode.None, ctx(settings = ShopSettings(false)).mode)
    }

    @Test fun `the body sent to the server`() {
        val c = ctx()
        var d = SaleMaths.withParty(c, SaleMaths.Draft(date = "2026-11-21"), mehta)
        d = d.copy(lines = listOf(SaleMaths.newLine(c, d, led).copy(qty = "3")), bdiscP = "5", bdisc = "40", chTr = "150", payTouched = true,
            pays = listOf(SaleMaths.Pay("Cash", "100"), SaleMaths.Pay("UPI", "")), confirmed = setOf("over_credit_limit"))
        val b = SaleMaths.body(c, d)
        fun s(k: String) = b[k]!!.jsonPrimitive.content
        assertEquals("", s("number"))
        assertEquals("credit", s("mode"))
        assertEquals("m", s("partyId"))
        assertEquals("2026-12-06", s("dueDate"))
        assertEquals("true", s("pricesInclTax"))
        assertEquals("09", s("placeOfSupply"))
        assertEquals("5", s("billDiscPct"))
        assertEquals(JsonNull, b["billDiscAmt"])
        assertEquals("150", s("transport"))
        assertEquals("true", s("confirmOverLimit"))
        assertFalse(b.containsKey("confirmExpired"))
        val line = b["lines"]!!.jsonArray[0].jsonObject
        assertEquals("80", line["price"]!!.jsonPrimitive.content)
        assertEquals("3", line["qty"]!!.jsonPrimitive.content)
        assertEquals("12", line["gstRate"]!!.jsonPrimitive.content)
        // a payment of 0 is not sent
        assertEquals(1, (b["payments"] as JsonArray).size)
        // a cash bill: no party, fully received
        val cash = SaleMaths.body(c, SaleMaths.Draft(date = "2026-11-21", cash = true, lines = d.lines))
        assertEquals(JsonNull, cash["partyId"])
        val total = SaleMaths.totals(c, SaleMaths.Draft(date = "2026-11-21", cash = true, lines = d.lines)).total
        assertEquals(0, total.compareTo(BigDecimal(cash["payments"]!!.jsonArray[0].jsonObject["amount"]!!.jsonPrimitive.content)))
    }

    /* ───────── 8.5c ───────── */

    private val ledC = led.copy(category = "Lighting")
    private val boxC = box.copy(category = "Switches")
    private fun ctx2(features: List<String> = listOf("pack_loose")) = SaleMaths.ctx(
        ShopSettings(gstEnabled = true), "09",
        listOf(PriceList("def", "Retail", isDefault = true)), Prices(emptyList()), features, listOf(ledC, boxC), listOf(mehta, delhi),
        rules = listOf(CommissionRule("Lighting", "percent", "5"), CommissionRule("Switches", "fixed", "20")),
        referrers = listOf(Referrer("r1", "Raju Electrician")),
        batches = mapOf("led" to listOf(
            StockBatch("b-late", "B2", "2027-06-30", "40"), StockBatch("b-old", "B0", "2026-01-31", "5"),
            StockBatch("b-soon", "B1", "2027-01-31", "0"), StockBatch(null, "", null, "10"),
        )),
    )

    @Test fun `referral loads each category's rule on the rate and comes off again`() {
        val c = ctx2()
        var d = SaleMaths.Draft(date = "2026-11-21", cash = true)
        d = d.copy(lines = listOf(SaleMaths.newLine(c, d, ledC), SaleMaths.newLine(c, d, boxC)))
        assertNull(d.lines[0].bp)
        d = SaleMaths.withReferrer(c, d, "r1")
        // 5% on ₹85 = ₹89.25; ₹20 per box on ₹950 = ₹970
        assertEquals(BigDecimal("89.25"), d.lines[0].price)
        assertEquals(BigDecimal("85"), d.lines[0].bp)
        assertEquals(BigDecimal("970.00"), d.lines[1].price)
        d = SaleMaths.withReferrer(c, d, null)
        assertEquals(BigDecimal("85"), d.lines[0].price)
        assertNull(d.lines[0].bp)
    }

    @Test fun `a rule for this bill replaces the saved ones, and a fixed amount is per pack`() {
        val c = ctx2()
        var d = SaleMaths.withReferrer(c, SaleMaths.Draft(date = "2026-11-21", cash = true), "r1")
        d = d.copy(lines = listOf(SaleMaths.newLine(c, d, ledC), SaleMaths.newLine(c, d, boxC).copy(unit = "PCS", price = BigDecimal("95.00"), bp = null)))
        d = SaleMaths.withBillRule(c, d, SaleMaths.Rule('f', BigDecimal("10")))
        assertEquals(BigDecimal("95.00"), d.lines[0].price)
        // a loose piece of a box of 10 carries ₹1 of the ₹10
        assertEquals(BigDecimal("96.00"), d.lines[1].price)
    }

    @Test fun `commission is quantity times the difference, without GST`() {
        val c = ctx2()
        var d = SaleMaths.withReferrer(c, SaleMaths.Draft(date = "2026-11-21", cash = true), "r1")
        d = d.copy(lines = listOf(SaleMaths.newLine(c, d, ledC).copy(qty = "10")))
        // 10 × ₹4.25 = ₹42.50 including 12% GST → ₹37.95
        assertEquals(BigDecimal("37.95"), SaleMaths.lineCommission(c, d.lines[0]))
    }

    @Test fun `batches show expired first, and automatic skips expired and empty ones`() {
        val c = ctx2()
        assertEquals(listOf("b-old", null, "b-soon", "b-late"), SaleMaths.sortedBatches(c, "led", "2026-11-21").map { it.id })
        // No batch is the oldest stock, so it goes first
        assertNull(SaleMaths.autoBatch(c, "led", "2026-11-21")!!.id)
        val noLoose = c.copy(batches = mapOf("led" to c.batches["led"]!!.filter { it.id != null }))
        assertEquals("b-late", SaleMaths.autoBatch(noLoose, "led", "2026-11-21")!!.id)
    }

    @Test fun `a quotation's items keep their quoted rates and bring the customer and referral`() {
        val c = ctx2()
        val q = SaleDoc("q1", "QT-0033", "2026-11-10", "Mehta", DocParty("m", "Mehta"), "r1",
            listOf(DocLine("led", "LED Bulb 9W", "4", "PCS", "82", "0", "12"), DocLine("gone", "Old Item", "1", "PCS", "10")))
        val (d, n) = SaleMaths.withQuote(c, SaleMaths.Draft(date = "2026-11-21"), q)
        assertEquals(1, n)
        assertEquals("m", d.partyId)
        assertEquals("r1", d.referrerId)
        assertEquals(BigDecimal("82"), d.lines[0].price)
        assertEquals("QT-0033", d.lines[0].fromQ)
        // another customer: the quoted rate stays
        assertEquals(BigDecimal("82"), SaleMaths.withParty(c, d, delhi).lines[0].price)
        val b = SaleMaths.body(c, d)
        assertEquals("q1", b["fromQuotationIds"]!!.jsonArray[0].jsonPrimitive.content)
        assertEquals("QT-0033", b["extra"]!!.jsonObject["quoteRefs"]!!.jsonArray[0].jsonObject["no"]!!.jsonPrimitive.content)
        assertEquals("r1", b["referrerId"]!!.jsonPrimitive.content)
    }

    @Test fun `the body carries the base rate, this bill's rule per category, details and a chosen batch`() {
        val c = ctx2()
        var d = SaleMaths.withReferrer(c, SaleMaths.Draft(date = "2026-11-21", cash = true), "r1")
        d = d.copy(lines = listOf(SaleMaths.newLine(c, d, ledC).copy(qty = "2", batchId = "b-late"), SaleMaths.newLine(c, d, boxC)))
        d = SaleMaths.withBillRule(c, d, SaleMaths.Rule('p', BigDecimal("3"))).copy(transport = "Gupta Roadways", vehicle = "UP78 AB 1234")
        val b = SaleMaths.body(c, d)
        val line = b["lines"]!!.jsonArray[0].jsonObject
        assertEquals("85", line["basePrice"]!!.jsonPrimitive.content)
        assertEquals("b-late", line["batches"]!!.jsonArray[0].jsonObject["batchId"]!!.jsonPrimitive.content)
        // the box line is in packs: 1 box of 10 moves 10 pieces of stock
        assertEquals(BigDecimal("10"), SaleMaths.stockQty(c, d.lines[1]))
        val ex = b["extra"]!!.jsonObject
        assertEquals("Gupta Roadways", ex["transport"]!!.jsonPrimitive.content)
        assertEquals(setOf("Lighting", "Switches"), ex["commByCategory"]!!.jsonObject.keys)
        assertEquals("p", ex["commByCategory"]!!.jsonObject["Lighting"]!!.jsonObject["t"]!!.jsonPrimitive.content)
    }
}
