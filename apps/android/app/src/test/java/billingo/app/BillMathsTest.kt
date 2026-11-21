package billingo.app

import billingo.app.ui.sale.BillMaths
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

/**
 * The shared maths examples (packages/shared/examples/maths.json, owner's answer 4 in
 * docs/PHASE8-PLAN.md): every bill and every amount in words must come out exactly as on the web
 * and the server. If one differs, the phone build fails before any APK is made.
 */
class BillMathsTest {
    private val file: JsonObject = Json.parseToJsonElement(
        javaClass.classLoader!!.getResource("maths.json")!!.readText(),
    ).jsonObject

    /** like the web's money(): "₹1,890" → 1890; missing or blank → null */
    private fun num(o: JsonObject, k: String): BigDecimal? =
        o[k]?.jsonPrimitive?.contentOrNull?.replace(Regex("[₹,\\s]"), "")?.takeIf { it.isNotEmpty() }?.let(::BigDecimal)

    private fun bill(o: JsonObject) = BillMaths.Bill(
        mode = when (o["mode"]!!.jsonPrimitive.content) { "gst" -> BillMaths.Mode.Gst; "bos" -> BillMaths.Mode.Bos; else -> BillMaths.Mode.None },
        incl = o["incl"]!!.jsonPrimitive.boolean,
        inter = o["inter"]!!.jsonPrimitive.boolean,
        roundOff = o["roundOff"]!!.jsonPrimitive.boolean,
        bdiscP = num(o, "bdiscP"), bdisc = num(o, "bdisc"), tcsRate = num(o, "tcsRate"),
        chTr = num(o, "chTr"), chLab = num(o, "chLab"), chBank = num(o, "chBank"),
        lines = o["lines"]!!.jsonArray.map { e ->
            val l = e.jsonObject
            BillMaths.Line(
                qty = num(l, "qty") ?: BigDecimal.ZERO, price = num(l, "price") ?: BigDecimal.ZERO,
                disc = num(l, "disc") ?: BigDecimal.ZERO, gst = num(l, "gst") ?: BigDecimal.ZERO,
                counted = l["counted"]?.jsonPrimitive?.boolean ?: true,
            )
        },
    )

    private fun f(v: BigDecimal) = v.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()

    /** the same shape as the web test's shown(): every figure with 2 decimals */
    private fun shown(t: BillMaths.Totals): Map<String, Any> = linkedMapOf(
        "rows" to t.rows.map { mapOf("taxable" to f(it.taxable), "tax" to f(it.tax), "amount" to f(it.amount)) },
        "items" to f(t.items), "billDiscount" to f(t.billDiscount), "taxable" to f(t.taxable), "tax" to f(t.tax),
        "cgst" to f(t.cgst), "sgst" to f(t.sgst), "igst" to f(t.igst), "tcs" to f(t.tcs), "roundOff" to f(t.roundOff), "total" to f(t.total),
        "byRate" to t.byRate.mapValues { (_, r) -> mapOf("taxable" to f(r.taxable), "tax" to f(r.tax)) },
    )

    private fun expected(e: JsonObject): Map<String, Any> = linkedMapOf(
        "rows" to e["rows"]!!.jsonArray.map { r -> r.jsonObject.mapValues { it.value.jsonPrimitive.content } },
        "items" to e.s("items"), "billDiscount" to e.s("billDiscount"), "taxable" to e.s("taxable"), "tax" to e.s("tax"),
        "cgst" to e.s("cgst"), "sgst" to e.s("sgst"), "igst" to e.s("igst"), "tcs" to e.s("tcs"), "roundOff" to e.s("roundOff"), "total" to e.s("total"),
        "byRate" to e["byRate"]!!.jsonObject.mapValues { (_, r) -> r.jsonObject.mapValues { it.value.jsonPrimitive.content } },
    )

    private fun JsonObject.s(k: String) = this[k]!!.jsonPrimitive.content

    @Test fun `every shared example bill gives the web's answers`() {
        val bills = file["bills"]!!.jsonArray.map { it.jsonObject }
        assertTrue("sales and purchases are there", bills.count { it.s("kind") == "sale" } >= 15 && bills.count { it.s("kind") == "purchase" } >= 5)
        for (b in bills) {
            val input = bill(b["bill"]!!.jsonObject)
            val got = if (b.s("kind") == "sale") BillMaths.sale(input) else BillMaths.purchase(input)
            assertEquals("${b.s("kind")}: ${b.s("name")}", expected(b["expect"]!!.jsonObject), shown(got))
        }
    }

    @Test fun `every shared amount in words`() {
        val words = file["words"]!!.jsonArray.map { it.jsonObject }
        assertTrue(words.size >= 10)
        for (w in words) assertEquals(w.s("amount"), w.s("expect"), BillMaths.amountInWords(BigDecimal(w.s("amount"))))
    }

    @Test fun `CGST and SGST always add up to the tax`() {
        val t = BillMaths.sale(BillMaths.Bill(BillMaths.Mode.Gst, false, false, listOf(BillMaths.Line(BigDecimal("1"), BigDecimal("0.15"), gst = BigDecimal("5"))), false))
        assertEquals(t.tax, t.cgst + t.sgst)
    }
}
