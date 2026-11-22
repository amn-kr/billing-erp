package billingo.app.ui.docs

import billingo.app.data.ItemFull
import billingo.app.data.QRow
import billingo.app.data.QSer
import billingo.app.data.QuoteGrid
import billingo.app.data.SaleDoc
import billingo.app.ui.sale.BillMaths
import billingo.app.ui.sale.SaleMaths
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Brand-wise quotations (step 8.6c-2): a copy of the web's apps/web/src/features/quotations/model.ts
 * (prototype qItem / qRate / qTotals / qComm). Rows of item groups against brand ranges; every rate is
 * the matching item's price on the quotation's rate list, with the electrician's commission loaded when
 * a referral is set. Totals are exact decimals.
 */
object BrandMaths {
    /** The quotation being made or changed. [qty]: row id → quantity. */
    data class Draft(
        val id: String? = null,
        val no: String = "",
        val date: String,
        val cust: String = "",
        val disc: BigDecimal = BigDecimal.ZERO,
        /** the rate list (null = the default) */
        val pl: String? = null,
        val sel: List<String> = emptyList(),
        val qty: Map<String, BigDecimal> = emptyMap(),
        val ref: String? = null,
    )

    /** One brand's total. */
    data class Total(val s: QSer, val acc: BigDecimal, val plate: BigDecimal, val sub: BigDecimal, val dis: BigDecimal, val total: BigDecimal, val miss: Int)

    private fun low(t: String) = t.trim().lowercase()
    private fun r2(v: BigDecimal) = v.setScale(2, RoundingMode.HALF_UP)

    /** the item group a row stands for, and a range's series text (shared qGrp / qSeries / qSerName) */
    fun grp(r: QRow) = r.grp?.takeIf { it.isNotEmpty() } ?: r.n
    fun series(s: QSer) = if (s.f.isNotEmpty() && !s.f.equals("white", ignoreCase = true)) "${s.r} ${s.f}" else s.r
    fun serName(s: QSer) = "${s.b} ${s.r}" + (if (s.f.isNotEmpty()) " ${s.f}" else "")

    /** the item for a cell: same parent item (group), brand and series, ignoring capital letters in brand and series */
    fun item(c: SaleMaths.Ctx, r: QRow, s: QSer): ItemFull? = c.items.firstOrNull { it.group == grp(r) && low(it.brand) == low(s.b) && low(it.series) == low(series(s)) }

    /** a rate with the referral commission loaded on it (prototype cmLoadPrice, by item category) */
    fun cmLoad(c: SaleMaths.Ctx, ref: String?, it: ItemFull, v: BigDecimal): BigDecimal {
        if (ref == null) return v
        val r = c.rules[it.category] ?: SaleMaths.Rule.NONE
        return when {
            r.t == 'p' && r.v.signum() > 0 -> r2(v.multiply(BigDecimal.ONE + r.v.movePointLeft(2)))
            r.t == 'f' && r.v.signum() > 0 -> r2(v + r.v)
            else -> v
        }
    }

    /** A cell's rate: the item's price on the rate list (the default list = its sale price), with commission when a referral is set. */
    data class Rate(val v: BigDecimal?, val it: ItemFull? = null, val base: BigDecimal? = null)

    fun rate(c: SaleMaths.Ctx, d: Draft, r: QRow, s: QSer): Rate {
        val it = item(c, r, s) ?: return Rate(null)
        val list = d.pl ?: c.defaultList
        val v = if (list == null || list == c.defaultList) it.sale else c.listPrice[it.id]?.get(list) ?: it.sale
        return if (d.ref != null) Rate(cmLoad(c, d.ref, it, v), it, v) else Rate(v, it)
    }

    fun cols(g: QuoteGrid, d: Draft): List<QSer> = g.ser.filter { it.id in d.sel }

    fun totals(c: SaleMaths.Ctx, g: QuoteGrid, d: Draft): List<Total> = cols(g, d).map { s ->
        var acc = BigDecimal.ZERO
        var plate = BigDecimal.ZERO
        var miss = 0
        for (row in g.rows) {
            val q = d.qty[row.id] ?: continue
            if (q.signum() == 0) continue
            val v = rate(c, d, row, s).v
            if (v == null) { miss++; continue }
            if (row.c == "plate") plate += v.multiply(q) else acc += v.multiply(q)
        }
        val sub = acc + plate
        val dis = sub.multiply(d.disc).divide(BigDecimal(100), 10, RoundingMode.HALF_UP)
        Total(s, acc, plate, sub, dis, sub - dis, miss)
    }

    /** best first: all items available, then cheapest (prototype openConvert / qRanked) */
    fun ranked(t: List<Total>): List<Total> = t.sortedWith(compareBy<Total>({ it.miss }, { it.total }))

    /** the cheapest brand that has every item (what the list shows; prototype qSnapshot) */
    fun lowest(t: List<Total>): Total? = t.filter { it.miss == 0 && it.total.signum() > 0 }.minByOrNull { it.total }

    /** The brands that have an item for a row ("In Anchor, Legrand"), first word of each brand, as the design shows. */
    fun brandsFor(c: SaleMaths.Ctx, g: QuoteGrid, r: QRow): List<String> =
        g.ser.filter { item(c, r, it) != null }.map { it.b.trim().split(" ").first() }.distinct()

    fun pcs(d: Draft): BigDecimal = d.qty.values.fold(BigDecimal.ZERO, BigDecimal::add)

    private fun plain(v: BigDecimal) = v.stripTrailingZeros().let { if (it.scale() < 0) it.setScale(0) else it }.toPlainString()

    /** The body of POST /quotations/brand (the web's snapshot); a saved one is sent without its number. */
    fun body(c: SaleMaths.Ctx, g: QuoteGrid, d: Draft): JsonObject {
        val lo = lowest(totals(c, g, d))
        return buildJsonObject {
            put("number", ""); put("date", d.date); put("cust", d.cust.trim())
            put("priceListId", d.pl?.let(::JsonPrimitive) ?: JsonNull)
            put("disc", JsonPrimitive(d.disc))
            put("sel", JsonArray(d.sel.map(::JsonPrimitive)))
            put("qty", buildJsonObject { d.qty.filterValues { it.signum() > 0 }.forEach { (k, v) -> put(k, JsonPrimitive(v)) } })
            put("referrerId", d.ref?.let(::JsonPrimitive) ?: JsonNull)
            put("items", d.qty.count { it.value.signum() > 0 }); put("pcs", JsonPrimitive(pcs(d)))
            put("low", lo?.let { buildJsonObject { put("name", serName(it.s)); put("total", JsonPrimitive(r2(it.total))) } } ?: JsonNull)
        }
    }

    /** A saved brand-wise quotation as a draft (the web's load()): ranges no longer in the grid are dropped, all of them when none is left. */
    fun fromSaved(g: QuoteGrid, v: SaleDoc): Draft {
        val x = v.extra ?: JsonObject(emptyMap())
        fun str(k: String) = (x[k] as? JsonPrimitive)?.contentOrNull
        val saved = (x["sel"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.toSet()
        val sel = g.ser.map { it.id }.filter { it in saved }.ifEmpty { g.ser.map { it.id } }
        val qty = (x["qty"] as? JsonObject).orEmpty().mapNotNull { (k, q) -> (q as? JsonPrimitive)?.contentOrNull?.toBigDecimalOrNull()?.let { k to it } }.toMap()
        return Draft(
            id = v.id, no = v.number, date = v.date, cust = str("cust") ?: v.partyName, disc = str("disc")?.toBigDecimalOrNull() ?: BigDecimal.ZERO,
            pl = str("priceListId"), sel = sel, qty = qty, ref = v.referrerId,
        )
    }

    /**
     * Convert To Bill for one brand (the web's convertBrand): every row that brand has, at its rate, with
     * the quotation's discount; a rate with commission keeps its base so the bill knows the commission.
     * Rows the brand doesn't have are left out. The customer is found by name; else a counter sale.
     */
    fun bill(c: SaleMaths.Ctx, g: QuoteGrid, d: Draft, s: QSer, today: String): Pair<SaleMaths.Draft, Int> {
        val brand = serName(s)
        val start = SaleMaths.Draft(date = today)
        val lines = g.rows.filter { (d.qty[it.id] ?: BigDecimal.ZERO).signum() > 0 }.mapNotNull { row ->
            val o = rate(c, d, row, s)
            val it = o.it ?: return@mapNotNull null
            val v = o.v ?: return@mapNotNull null
            val l = SaleMaths.newLine(c, start, it)
            val rule = c.rules[it.category]
            val bp = if (d.ref != null && rule != null && rule.t != 'n' && rule.v.signum() > 0)
                r2(if (rule.t == 'p') v.divide(BigDecimal.ONE + rule.v.movePointLeft(2), 10, RoundingMode.HALF_UP) else v - rule.v) else null
            // the unit a new line starts in (the web's lineFor); the rate is the item's price for it
            l.copy(qty = plain(d.qty.getValue(row.id)), price = v, disc = d.disc, bp = bp, fromQ = d.no)
        }
        val p = c.parties.firstOrNull { d.cust.isNotBlank() && it.name.trim().equals(d.cust.trim(), ignoreCase = true) }
        var nd = start.copy(
            lines = lines, referrerId = d.ref, notes = "As per quotation ${d.no} ($brand).",
            quotes = listOf(SaleMaths.QuoteRef(d.id.orEmpty(), d.no, d.date, d.cust, brand)),
        )
        nd = if (p != null) nd.copy(partyId = p.id) else nd.copy(cash = true, cashName = d.cust.trim())
        return nd to lines.size
    }

    /** The web's WhatsApp message: each brand's total, cheapest first, with the items not available. */
    fun message(c: SaleMaths.Ctx, g: QuoteGrid, d: Draft, shop: String, gst: Boolean, inr: (BigDecimal) -> String): String? {
        val t = totals(c, g, d).filter { it.total.signum() > 0 }.sortedBy { it.total }
        if (t.isEmpty()) return null
        val used = g.rows.count { (d.qty[it.id] ?: BigDecimal.ZERO).signum() > 0 }
        val head = listOf(
            "*$shop*", "*Quotation ${d.no}*" + (if (d.cust.isNotBlank()) " for ${d.cust.trim()}" else ""),
            "$used items · ${plain(pcs(d))} pcs" + (if (d.disc.signum() > 0) " · ${plain(d.disc)}% discount applied" else ""), "",
        )
        val rows = t.mapIndexed { k, x ->
            (if (k == 0 && x.miss == 0) "✅ " else "") + "${serName(x.s)}: ₹${inr(x.total)}" + (if (x.miss > 0) " (${x.miss} item${if (x.miss > 1) "s" else ""} not available)" else "")
        }
        return (head + rows + listOf("", (if (gst) "Rates include GST. " else "") + "Valid for 15 days.")).joinToString("\n")
    }

    /** used by the GST check in the message */
    fun gstOn(c: SaleMaths.Ctx) = c.mode != BillMaths.Mode.None
}
