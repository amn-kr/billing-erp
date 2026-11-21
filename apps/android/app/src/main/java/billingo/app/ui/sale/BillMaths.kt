package billingo.app.ui.sale

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

/**
 * Bill maths for the phone (step 8.5a): a Kotlin copy of packages/shared/src/invoice.ts
 * (saleTotals, purchaseTotals, amountInWords), with the same rounding points. What the phone shows
 * while you type is only a preview; the server's figure is the one saved. Both must give the answers
 * in packages/shared/examples/maths.json (BillMathsTest), so they can't drift apart.
 */
object BillMaths {
    /** gst = tax invoice; bos = bill of supply (composition dealer); none = GST off */
    enum class Mode { Gst, Bos, None }

    data class Line(
        val qty: BigDecimal,
        /** sale: the price; purchase: the rate */
        val price: BigDecimal,
        /** discount % */
        val disc: BigDecimal = BigDecimal.ZERO,
        /** GST rate % */
        val gst: BigDecimal = BigDecimal.ZERO,
        /** sales only: a row with an item or a typed name (blank rows don't count) */
        val counted: Boolean = true,
    )

    data class Bill(
        val mode: Mode,
        /** prices include GST */
        val incl: Boolean,
        /** place of supply is another state (IGST) */
        val inter: Boolean,
        val lines: List<Line>,
        val roundOff: Boolean,
        /** bill discount: % (wins when given, as on the web: send null, not 0, to use the amount) or an amount */
        val bdiscP: BigDecimal? = null,
        val bdisc: BigDecimal? = null,
        /** sales only: TCS rate % when TCS is on */
        val tcsRate: BigDecimal? = null,
        val chTr: BigDecimal? = null,
        val chLab: BigDecimal? = null,
        val chBank: BigDecimal? = null,
    )

    data class Row(val gross: BigDecimal, val disc: BigDecimal, val taxable: BigDecimal, val tax: BigDecimal, val amount: BigDecimal)
    data class Rate(val taxable: BigDecimal, val tax: BigDecimal)

    data class Totals(
        val rows: List<Row>,
        val items: BigDecimal,
        val billDiscount: BigDecimal,
        val chTr: BigDecimal,
        val chLab: BigDecimal,
        val chBank: BigDecimal,
        val taxable: BigDecimal,
        val tax: BigDecimal,
        val cgst: BigDecimal,
        val sgst: BigDecimal,
        val igst: BigDecimal,
        val inter: Boolean,
        val tcs: BigDecimal,
        val roundOff: BigDecimal,
        val total: BigDecimal,
        /** taxable value and tax per GST rate ("18" → …), for the tax summary */
        val byRate: Map<String, Rate>,
        val count: Int,
    )

    /** Like decimal.js in the web maths: 40 significant digits, half up. */
    private val MC = MathContext(40, RoundingMode.HALF_UP)
    private val ZERO = BigDecimal.ZERO
    private val HUNDRED = BigDecimal(100)

    fun round2(v: BigDecimal): BigDecimal = v.setScale(2, RoundingMode.HALF_UP)
    private fun roundRupee(v: BigDecimal): BigDecimal = v.setScale(0, RoundingMode.HALF_UP)
    private fun pct(v: BigDecimal, p: BigDecimal) = v.multiply(p, MC).divide(HUNDRED, MC)
    private fun div(a: BigDecimal, b: BigDecimal) = a.divide(b, MC)
    private fun nz(v: BigDecimal?) = v ?: ZERO
    /** "18", "5", "0.25": the rate as the web writes it (decimal.js toString) */
    private fun rateKey(v: BigDecimal) = v.stripTrailingZeros().let { if (it.signum() == 0) "0" else it.toPlainString() }

    private data class Split(val cgst: BigDecimal, val sgst: BigDecimal, val igst: BigDecimal)

    /** CGST is half the tax; SGST takes the rest, so the two always add up to the tax. */
    private fun split(tax: BigDecimal, inter: Boolean): Split {
        if (inter) return Split(ZERO, ZERO, tax)
        val c = round2(div(tax, BigDecimal(2)))
        return Split(c, tax - c, ZERO)
    }

    private class Acc { var tv: BigDecimal = ZERO; var tx: BigDecimal = ZERO }

    /** Sales invoice / quotation / challan totals (web saleTotals). */
    fun sale(d: Bill): Totals {
        val gst = d.mode == Mode.Gst
        var taxable = ZERO
        var taxSum = ZERO
        var count = 0
        val byRate = linkedMapOf<String, Acc>()
        val rows = d.lines.map { l ->
            val gross = l.qty.multiply(l.price, MC)
            val disc = pct(gross, l.disc)
            val net = gross - disc
            val r = if (gst) div(l.gst, HUNDRED) else ZERO
            val tv: BigDecimal
            val tx: BigDecimal
            when {
                !gst -> { tv = net; tx = ZERO }
                d.incl -> { tv = div(net, r + BigDecimal.ONE); tx = net - tv }
                else -> { tv = net; tx = net.multiply(r, MC) }
            }
            if (l.counted) {
                taxable += tv; taxSum += tx; count++
                if (gst) byRate.getOrPut(rateKey(l.gst)) { Acc() }.let { it.tv += tv; it.tx += tx }
            }
            Row(gross, disc, round2(tv), round2(tx), round2(tv + tx))
        }
        val items = round2(taxable + taxSum)
        val want = if (d.bdiscP != null) round2(pct(items, d.bdiscP)) else nz(d.bdisc)
        val bd = want.max(ZERO).min(items)
        if (bd.signum() > 0 && items.signum() > 0) {
            val f = div(items - bd, items)
            taxable = taxable.multiply(f, MC); taxSum = taxSum.multiply(f, MC)
            byRate.values.forEach { it.tv = it.tv.multiply(f, MC); it.tx = it.tx.multiply(f, MC) }
        }
        var total = taxable + taxSum
        var tcs = ZERO
        if (gst && d.tcsRate != null && d.tcsRate.signum() != 0) { tcs = round2(pct(total, d.tcsRate)); total += tcs }
        val chTr = nz(d.chTr); val chLab = nz(d.chLab); val chBank = nz(d.chBank)
        total = total + chTr + chLab + chBank
        val exact = round2(total)
        val rounded = if (d.roundOff) roundRupee(exact) else exact
        val tax = round2(taxSum)
        val s = split(tax, d.inter && gst)
        return Totals(
            rows, items, round2(bd), chTr, chLab, chBank, round2(taxable), tax, s.cgst, s.sgst, s.igst, d.inter && gst,
            tcs, round2(rounded - exact), round2(rounded), byRate.mapValues { (_, b) -> Rate(round2(b.tv), round2(b.tx)) }, count,
        )
    }

    /** Purchase bill / order / debit note totals (web purchaseTotals). */
    fun purchase(d: Bill): Totals {
        val gst = d.mode == Mode.Gst
        var taxable = ZERO
        var tax = ZERO
        val byRate = linkedMapOf<String, Acc>()
        val rows = d.lines.map { l ->
            val g = if (gst) l.gst else ZERO
            val gross = l.qty.multiply(l.price, MC)
            val disc = pct(gross, l.disc)
            val net = gross - disc
            val tv: BigDecimal
            val tx: BigDecimal
            if (d.incl && g.signum() != 0) { tv = div(net, div(g, HUNDRED) + BigDecimal.ONE); tx = net - tv } else { tv = net; tx = pct(net, g) }
            taxable += tv; tax += tx
            if (gst) byRate.getOrPut(rateKey(g)) { Acc() }.let { it.tv += tv; it.tx += tx }
            Row(gross, round2(disc), round2(tv), round2(tx), round2(tv + tx))
        }
        taxable = round2(taxable)
        tax = round2(tax)
        val items = round2(taxable + tax)
        val want = if (d.bdiscP != null) round2(pct(items, d.bdiscP)) else nz(d.bdisc)
        val bd = want.max(ZERO).min(items)
        if (bd.signum() > 0 && items.signum() > 0) {
            val f = div(items - bd, items)
            taxable = round2(taxable.multiply(f, MC)); tax = round2(tax.multiply(f, MC))
            byRate.values.forEach { it.tv = it.tv.multiply(f, MC); it.tx = it.tx.multiply(f, MC) }
        }
        val chTr = nz(d.chTr); val chLab = nz(d.chLab)
        val raw = taxable + tax + chTr + chLab
        val total = if (!d.roundOff) round2(raw) else roundRupee(raw)
        val s = split(tax, d.inter && gst)
        return Totals(
            rows, items, round2(bd), chTr, chLab, ZERO, taxable, tax, s.cgst, s.sgst, s.igst, d.inter && gst,
            ZERO, round2(total - raw), total, byRate.mapValues { (_, b) -> Rate(round2(b.tv), round2(b.tx)) }, d.lines.size,
        )
    }

    private val A = listOf("", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen")
    private val T = listOf("", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety")
    private fun two(x: Long): String = if (x < 20) A[x.toInt()] else T[(x / 10).toInt()] + (if (x % 10 != 0L) " " + A[(x % 10).toInt()] else "")
    private fun three(x: Long): String = (if (x >= 100) A[(x / 100).toInt()] + " Hundred" + (if (x % 100 != 0L) " " else "") else "") + (if (x % 100 != 0L) two(x % 100) else "")
    private fun spell(n: Long): String {
        if (n == 0L) return "Zero"
        var x = n
        val sb = StringBuilder()
        val cr = x / 10_000_000; x %= 10_000_000
        val lk = x / 100_000; x %= 100_000
        val th = x / 1_000; x %= 1_000
        if (cr != 0L) sb.append(if (cr > 99) spell(cr) else two(cr)).append(" Crore ")
        if (lk != 0L) sb.append(two(lk)).append(" Lakh ")
        if (th != 0L) sb.append(two(th)).append(" Thousand ")
        if (x != 0L) sb.append(three(x))
        return sb.toString().trim()
    }

    /** Amount in words, Indian style: "Rupees One Lakh Twenty Thousand and Fifty Paise Only". */
    fun amountInWords(v: BigDecimal): String {
        val n = round2(v)
        val r = n.setScale(0, RoundingMode.FLOOR)
        val p = (n - r).movePointRight(2).toLong()
        return "Rupees " + spell(r.toLong()) + (if (p != 0L) " and " + two(p) + " Paise" else "") + " Only"
    }
}
