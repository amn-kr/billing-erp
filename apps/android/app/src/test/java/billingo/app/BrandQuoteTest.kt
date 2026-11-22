package billingo.app

import billingo.app.data.CommissionRule
import billingo.app.data.DocParty
import billingo.app.data.ItemFull
import billingo.app.data.ListPrice
import billingo.app.data.PartyFull
import billingo.app.data.PriceList
import billingo.app.data.PricedItem
import billingo.app.data.Prices
import billingo.app.data.QRow
import billingo.app.data.QSer
import billingo.app.data.QuoteGrid
import billingo.app.data.SaleDoc
import billingo.app.data.ShopSettings
import billingo.app.ui.docs.BrandMaths
import billingo.app.ui.sale.SaleMaths
import kotlinx.serialization.json.JsonArray
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

/** Brand-wise quotations (step 8.6c-2): rates, totals, ranking, what is saved, Convert To Bill and the message. */
class BrandQuoteTest {
    private fun it(id: String, grp: String, brand: String, series: String, sale: String, cat: String = "Switches") =
        ItemFull(id = id, name = "$brand $series $grp", group = grp, brand = brand, series = series, sale = BigDecimal(sale), unit = "PCS", gstRate = "18", category = cat)

    // two ranges: Anchor Roma has the switch and the plate; Legrand Myrius has only the switch
    private val items = listOf(
        it("a-sw", "6A Switch", "Anchor", "Roma", "45"), it("a-pl", "2M Plate", "Anchor", "Roma", "120", "Plates"),
        it("l-sw", "6A Switch", "Legrand", "Myrius", "40"),
    )
    private val g = QuoteGrid(
        rows = listOf(QRow("r1", "6A Switch", "acc"), QRow("r2", "2M Plate", "plate")),
        ser = listOf(QSer("s1", "Anchor", "Roma"), QSer("s2", "Legrand", "Myrius"), QSer("s3", "Havells", "Crabtree", "White")),
    )
    private val mehta = PartyFull(id = "m", name = "Mehta Electricals")
    private fun ctx(rules: List<CommissionRule> = emptyList()) = SaleMaths.ctx(
        ShopSettings(gstEnabled = true), "09", listOf(PriceList("def", "Retail", isDefault = true), PriceList("wh", "Wholesale")),
        Prices(listOf(PricedItem("a-sw", mapOf("def" to ListPrice("45"), "wh" to ListPrice("42"))))), emptyList(), items, listOf(mehta), rules,
    )
    private val d = BrandMaths.Draft(no = "Q-0104", date = "2026-11-22", cust = "Mehta Electricals", sel = listOf("s1", "s2", "s3"), qty = mapOf("r1" to BigDecimal("10"), "r2" to BigDecimal("2")))

    @Test fun `each range's total, what it hasn't got, and the order`() {
        val c = ctx()
        val t = BrandMaths.totals(c, g, d)
        // Anchor: 45 × 10 + plate 120 × 2 = 690; Legrand: 40 × 10, no plate; Havells: nothing
        assertEquals(0, BigDecimal("450").compareTo(t[0].acc))
        assertEquals(0, BigDecimal("240").compareTo(t[0].plate))
        assertEquals(0, BigDecimal("690").compareTo(t[0].total))
        assertEquals(0, BigDecimal("400").compareTo(t[1].total))
        assertEquals(1, t[1].miss)
        assertEquals(2, t[2].miss)
        // all items first, then cheapest
        assertEquals(listOf("s1", "s2", "s3"), BrandMaths.ranked(t).map { it.s.id })
        assertEquals("s1", BrandMaths.lowest(t)!!.s.id)
        assertEquals(listOf("Anchor", "Legrand"), BrandMaths.brandsFor(c, g, g.rows[0]))
    }

    @Test fun `the rate list and the discount`() {
        val c = ctx()
        val t = BrandMaths.totals(c, g, d.copy(pl = "wh", disc = BigDecimal("10")))
        // wholesale 42 × 10 + plate 120 × 2 = 660, less 10% = 594
        assertEquals(0, BigDecimal("660").compareTo(t[0].sub))
        assertEquals(0, BigDecimal("594").compareTo(t[0].total))
    }

    @Test fun `a referral loads its commission on the rates`() {
        val c = ctx(listOf(CommissionRule("Switches", "percent", "10")))
        val r = BrandMaths.rate(c, d.copy(ref = "raju"), g.rows[0], g.ser[0])
        assertEquals(BigDecimal("49.50"), r.v)
        assertEquals(BigDecimal("45"), r.base)
    }

    @Test fun `what is saved`() {
        val b = BrandMaths.body(ctx(), g, d)
        assertEquals("", b["number"]!!.jsonPrimitive.content)
        assertEquals("Mehta Electricals", b["cust"]!!.jsonPrimitive.content)
        assertEquals(2, b["items"]!!.jsonPrimitive.content.toInt())
        assertEquals("12", b["pcs"]!!.jsonPrimitive.content)
        assertEquals("Anchor Roma", b["low"]!!.jsonObject["name"]!!.jsonPrimitive.content)
        assertEquals("690.00", b["low"]!!.jsonObject["total"]!!.jsonPrimitive.content)
        assertEquals(3, b["sel"]!!.jsonArray.size)
    }

    @Test fun `a saved one loads, dropping ranges no longer in the grid`() {
        val v = SaleDoc(
            id = "q", number = "Q-0101", kind = "quotation", date = "2026-10-01", partyName = "", referrerId = null,
            extra = buildJsonObject {
                put("type", "brand"); put("cust", "Gupta"); put("disc", 5); put("priceListId", "wh")
                put("sel", JsonArray(listOf(JsonPrimitive("s2"), JsonPrimitive("gone")))); put("qty", buildJsonObject { put("r1", 4) })
            },
        )
        val x = BrandMaths.fromSaved(g, v)
        assertEquals("q", x.id)
        assertEquals(listOf("s2"), x.sel)
        assertEquals(BigDecimal("4"), x.qty["r1"])
        assertEquals("wh", x.pl)
        assertEquals("Gupta", x.cust)
        assertEquals(BigDecimal("5"), x.disc)
    }

    @Test fun `convert to bill for one brand leaves out what it hasn't got`() {
        val c = ctx()
        val (bill, n) = BrandMaths.bill(c, g, d.copy(id = "q4"), g.ser[1], "2026-11-22")
        assertEquals(1, n)
        assertEquals("m", bill.partyId)
        assertEquals(BigDecimal("40"), bill.lines.single().price)
        assertEquals("10", bill.lines.single().qty)
        assertEquals("Legrand Myrius", bill.quotes.single().brand)
        val body = SaleMaths.body(c, bill)
        assertEquals("As per quotation Q-0104 (Legrand Myrius).", body["notes"]!!.jsonPrimitive.content)
        assertEquals("Legrand Myrius", body["extra"]!!.jsonObject["quoteRefs"]!!.jsonArray.single().jsonObject["brand"]!!.jsonPrimitive.content)
        assertEquals(listOf(JsonPrimitive("q4")), body["fromQuotationIds"]!!.jsonArray.toList())
        // a customer who isn't a party: a counter sale with the name
        val (walk, _) = BrandMaths.bill(c, g, d.copy(cust = "Sharma Ji"), g.ser[0], "2026-11-22")
        assertTrue(walk.cash)
        assertNull(walk.partyId)
        assertEquals("Sharma Ji", SaleMaths.body(c, walk)["cashName"]!!.jsonPrimitive.content)
    }

    @Test fun `the WhatsApp message, cheapest first`() {
        val m = BrandMaths.message(ctx(), g, d, "Gupta Electricals", true) { it.setScale(2).toPlainString() }!!
        val lines = m.split("\n")
        assertEquals("*Quotation Q-0104* for Mehta Electricals", lines[1])
        assertEquals("2 items · 12 pcs", lines[2])
        assertEquals("Legrand Myrius: ₹400.00 (1 item not available)", lines[4])
        assertEquals("Anchor Roma: ₹690.00", lines[5])
        assertEquals("Rates include GST. Valid for 15 days.", lines.last())
    }
}
