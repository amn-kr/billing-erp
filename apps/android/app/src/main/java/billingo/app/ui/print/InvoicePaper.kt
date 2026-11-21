package billingo.app.ui.print

import java.math.BigDecimal

/*
 * The invoice paper, drawn the way the web prints it (apps/web/src/features/print/Paper.tsx, the
 * "Classic" layout, and print.css), in CSS pixels at 96 dpi. Laying out is plain Kotlin: it gives
 * a list of pages of simple drawing steps. The phone turns them into a PDF (PdfMaker); the tests
 * turn them into pictures to compare with the web.
 *
 * Colours: the invoice is a printed document, not a phone screen. Like the web's paper it uses
 * the colour chosen in Settings › Print And Invoice and the web's dark text, not the app's 20
 * colours (those are for the screens).
 */

/** Measures text: the width of [s] at [px] pixels in font weight [w] (400 regular … 700 bold), in the same pixels. */
fun interface Ink {
    fun width(s: String, px: Float, w: Int): Float
}

fun Ink.width(s: String, px: Float, bold: Boolean) = width(s, px, if (bold) 700 else 400)

sealed interface Op
/** text with its baseline at [y]; [spacing] is extra space after each letter */
data class TextOp(val s: String, val x: Float, val y: Float, val px: Float, val w: Int, val argb: Int, val spacing: Float = 0f) : Op
data class LineOp(val x1: Float, val y1: Float, val x2: Float, val y2: Float, val argb: Int, val w: Float = 1f) : Op
/** a rounded outline (the CANCELLED stamp) */
data class FrameOp(val x: Float, val y: Float, val w: Float, val h: Float, val r: Float, val argb: Int, val stroke: Float) : Op
/** a filled box; with [to], a 135° gradient from [argb] to [to] (the Simple layout's logo) */
data class FillOp(val x: Float, val y: Float, val w: Float, val h: Float, val r: Float, val argb: Int, val to: Int? = null) : Op

class Page(val w: Float, val h: Float) {
    val ops = mutableListOf<Op>()
}

/** Inter's line metrics (hhea), so the text sits in its line exactly as in the browser. */
private const val ASC = 0.96875f
private const val DESC = 0.2421875f
private const val LH = 1.35f

/** the web's paper text colour and the copy label's grey */
private const val TEXT = 0xFF151B2E.toInt()
private const val GREY = 0xFF5B6478.toInt()
private const val RED = 0xFFEF4444.toInt()
/** the web's light line between table rows (app.html td: border-top 1px var(--bd)) */
private const val ROW_LINE = 0xFFE8EAF2.toInt()

/** "#6b7280" → ARGB; anything else is the web's default grey */
fun argbOf(hex: String): Int {
    val h = hex.trim().removePrefix("#")
    val full = if (h.length == 3) h.map { "$it$it" }.joinToString("") else h
    return full.takeIf { it.length == 6 }?.toLongOrNull(16)?.let { (0xFF000000L or it).toInt() } ?: 0xFF6B7280.toInt()
}

/** A laid-out piece of the paper: its height for its width, and how to draw it at a place. */
private class Blk(val h: Float, val draw: (Page, Float, Float) -> Unit)

private class Lay(val ink: Ink, val fs: Float, val ratio: Float = LH) {
    val sm = fs * 0.92f

    fun lh(px: Float) = px * ratio

    /** words wrapped to [w]; a word longer than the line is cut; "\n" starts a new line */
    fun wrap(text: String, px: Float, bold: Boolean, w: Float): List<String> {
        val out = mutableListOf<String>()
        for (para in text.split("\n")) {
            var cur = ""
            for (word in para.split(" ")) {
                val next = if (cur.isEmpty()) word else "$cur $word"
                if (ink.width(next, px, bold) <= w || cur.isEmpty() && ink.width(word, px, bold) <= w) { cur = next; continue }
                if (cur.isNotEmpty()) out += cur
                cur = ""
                var rest = word
                while (ink.width(rest, px, bold) > w && rest.length > 1) {
                    var n = rest.length - 1
                    while (n > 1 && ink.width(rest.take(n), px, bold) > w) n--
                    out += rest.take(n)
                    rest = rest.drop(n)
                }
                cur = rest
            }
            out += cur
        }
        return out
    }

    /** one line of text in a line box starting at [top] */
    fun text(p: Page, s: String, x: Float, top: Float, px: Float, bold: Boolean, color: Int = TEXT, spacing: Float = 0f) =
        textW(p, s, x, top, px, if (bold) 700 else 400, color, spacing)

    fun textW(p: Page, s: String, x: Float, top: Float, px: Float, w: Int, color: Int = TEXT, spacing: Float = 0f) {
        if (s.isEmpty()) return
        val base = top + (px * ratio - px * (ASC + DESC)) / 2 + px * ASC
        p.ops += TextOp(s, x, base, px, w, color, spacing)
    }

    /** width with letter spacing (CSS adds it after every letter) */
    fun wd(s: String, px: Float, w: Int, spacing: Float = 0f) = ink.width(s, px, w) + spacing * s.codePointCount(0, s.length)

    /** like [para], with a weight, letter spacing and capitals (the Simple layout's small labels) */
    fun paraW(s: String, px: Float, w: Int, width: Float, align: Char = 'l', color: Int = TEXT, spacing: Float = 0f, nowrap: Boolean = false): Blk {
        val ls = if (nowrap) listOf(s) else wrapW(s, px, w, width, spacing)
        return Blk(ls.size * lh(px)) { p, x, y ->
            ls.forEachIndexed { i, l ->
                val lw = wd(l, px, w, spacing)
                val lx = when (align) { 'c' -> x + (width - lw) / 2; 'r' -> x + width - lw; else -> x }
                textW(p, l, lx, y + i * lh(px), px, w, color, spacing)
            }
        }
    }

    fun wrapW(text: String, px: Float, w: Int, width: Float, spacing: Float = 0f): List<String> {
        val out = mutableListOf<String>()
        for (para in text.split("\n")) {
            var cur = ""
            for (word in para.split(" ")) {
                val next = if (cur.isEmpty()) word else "$cur $word"
                if (wd(next, px, w, spacing) <= width || cur.isEmpty()) { cur = next; continue }
                out += cur
                cur = word
            }
            out += cur
        }
        return out
    }

    /** a paragraph: wrapped lines, left, centred or right in [w] */
    fun para(s: String, px: Float, bold: Boolean, w: Float, align: Char = 'l', color: Int = TEXT, nowrap: Boolean = false): Blk {
        val ls = if (nowrap) listOf(s) else wrap(s, px, bold, w)
        return Blk(ls.size * lh(px)) { p, x, y ->
            ls.forEachIndexed { i, l ->
                val lw = ink.width(l, px, bold)
                val lx = when (align) { 'c' -> x + (w - lw) / 2; 'r' -> x + w - lw; else -> x }
                text(p, l, lx, y + i * lh(px), px, bold, color)
            }
        }
    }

    /** blocks one under another, with a gap above each ([gaps]) */
    fun stack(items: List<Pair<Float, Blk>>): Blk = Blk(items.sumOf { (g, b) -> (g + b.h).toDouble() }.toFloat()) { p, x, y ->
        var yy = y
        for ((g, b) in items) { yy += g; b.draw(p, x, yy); yy += b.h }
    }

    fun pad(b: Blk, top: Float, bottom: Float, left: Float): Blk = Blk(b.h + top + bottom) { p, x, y -> b.draw(p, x + left, y + top) }

    fun line(p: Page, x1: Float, y1: Float, x2: Float, y2: Float, c: Int) { p.ops += LineOp(x1, y1, x2, y2, c) }
}

/** The table's column widths, as a browser's automatic table layout shares them out. */
private fun shareWidths(min: List<Float>, max: List<Float>, w: Float): List<Float> {
    val sMax = max.sum()
    val sMin = min.sum()
    return when {
        sMax <= w -> max.map { it + (w - sMax) * (if (sMax > 0) it / sMax else 1f / max.size) }
        sMin >= w -> min
        else -> {
            val room = max.zip(min).sumOf { (a, b) -> (a - b).toDouble() }.toFloat()
            min.indices.map { i -> min[i] + (w - sMin) * (if (room > 0) (max[i] - min[i]) / room else 0f) }
        }
    }
}

/**
 * Every page of the document: one set of pages per chosen copy (Original for recipient, …), as
 * the web prints them.
 */
fun paperPages(d: PDoc, o: PrintOpts, biz: Biz, ink: Ink): List<Page> {
    val list = if (d.kind == "invoice") copiesOf(o) else listOf("")
    return (list.ifEmpty { listOf("") }).flatMap { if (o.theme == "simple") simple(d, o, biz, ink, it) else classic(d, o, biz, ink, it) }
}

/** The "Classic" boxed layout (the owner's sample bill, the web's default). */
private fun classic(d: PDoc, o: PrintOpts, biz: Biz, ink: Ink, copy: String): List<Page> {
    val (pw, ph) = o.size
    val pad = Opts.MARGIN_PX[o.margin] ?: 30f
    val fs = Opts.TEXT_PX[o.textSize] ?: 12f
    val namePx = Opts.NAME_PX[o.nameSize] ?: 20f
    val c = argbOf(o.color)
    val L = Lay(ink, fs)
    val sm = L.sm
    val m = { v: String? -> PFmt.money(v, o.grouping) }
    val dec = PFmt::dec
    val cols = columns(d, o)
    val g = d.taxMode == "gst"
    val q = d.kind == "quotation"
    val inter = dec(d.igst).signum() > 0
    fun show(b: String) = b !in o.hide
    val addr = listOf(biz.address, listOf(biz.city, biz.pin).filter { it.isNotBlank() }.joinToString(" ")).filter { it.isNotBlank() }.joinToString(", ")
    val name = biz.name.ifBlank { "My Business" }
    val title = docTitle(d, o)
    val W = pw - 2 * pad
    val Wi = W - 2 // inside the box's border

    // ---- the pieces above the table
    val meta = buildList {
        if (!d.hideNo) add((if (q) "Quotation No." else "Invoice No.") to d.number)
        add("Date" to PFmt.dmy(d.date) + (if (d.time.isNotEmpty()) " · ${d.time}" else ""))
        d.refs.filter { it.first != "Billing name" }.forEach { (k, v) -> add((if (k == "Challan no.") "Challan No." else k) to v) }
        if (q) add("Valid till" to PFmt.dmy(d.dueDate)) else if (d.kind == "invoice" && d.mode == "credit" && !d.dueDate.isNullOrBlank()) add("Due date" to PFmt.dmy(d.dueDate))
        if (g) add("Place of supply" to "${stateName(d.placeOfSupply)} (${d.placeOfSupply})")
        if (size % 2 == 1) add("" to "")
    }
    val billing = d.refs.firstOrNull { it.first == "Billing name" }?.second

    fun titleBlk(w: Float, inside: Boolean): Blk {
        val t = L.para(title, 15f, true, w, 'c')
        val parts = mutableListOf(0f to t)
        if (copy.isNotEmpty()) parts += 0f to L.para(copy, sm, false, w, 'c', GREY)
        val s = L.stack(parts)
        // outside the box it has 6 px under it; inside, 6 px all round
        return if (inside) L.pad(s, 6f, 6f, 6f) else Blk(s.h + 6f) { p, x, y -> s.draw(p, x, y) }
    }

    fun bizBlk(): Blk {
        val half = Wi / 2
        val lw = half - 16
        val left = buildList {
            if (o.showName) { add(0f to L.para(name, namePx, true, lw)); add(2f to Blk(0f) { _, _, _ -> }) }
            if (o.showAddr && addr.isNotEmpty()) add(0f to L.para(addr, sm, false, lw))
            if (o.showPhone && biz.phone.isNotBlank()) add(0f to L.para("Phone no.: ${biz.phone}", sm, false, lw))
            if (o.showEmail && biz.email.isNotBlank()) add(0f to L.para("Email: ${biz.email}", sm, false, lw))
            if (o.firm.isNotBlank()) add(0f to L.para("Firm Name : ${o.firm}", sm, false, lw))
            if (g && biz.gstin.isNotBlank()) add(0f to L.para("GSTIN : ${biz.gstin}", sm, false, lw))
        }.let { L.pad(L.stack(it), 6f, 6f, 8f) }
        val mw = half - 1 // the meta grid, inside its left border
        val cw = mw / 2
        val cells = meta.map { (k, v) ->
            if (k.isEmpty()) Blk(10f) { _, _, _ -> } else L.pad(L.stack(listOf(0f to L.para(k, fs, false, cw - 16), 0f to L.para(v, fs, true, cw - 16))), 5f, 5f, 8f)
        }
        val rows = cells.chunked(2)
        val rowH0 = rows.mapIndexed { i, r -> r.maxOf { it.h } + (if (i < rows.size - 1) 1f else 0f) }
        val metaH = rowH0.sum()
        val h = maxOf(left.h, metaH)
        val extra = if (rows.isNotEmpty() && metaH < h) (h - metaH) / rows.size else 0f
        return Blk(h) { p, x, y ->
            left.draw(p, x, y)
            val mx = x + half
            L.line(p, mx, y, mx, y + h, c)
            var yy = y
            rows.forEachIndexed { i, r ->
                val rh = rowH0[i] + extra
                r.forEachIndexed { j, cell -> cell.draw(p, mx + 1 + j * cw, yy) }
                // odd cells have a right border; every row but the last a bottom border
                L.line(p, mx + 1 + cw, yy, mx + 1 + cw, yy + rh, c)
                if (i < rows.size - 1) L.line(p, mx + 1, yy + rh - 0.5f, x + Wi, yy + rh - 0.5f, c)
                yy += rh
            }
        }
    }

    fun billBlk(): Blk {
        val w = Wi - 16
        val parts = mutableListOf(0f to L.para("Bill To", fs, false, w), 4f to L.para(d.partyName, fs, true, w))
        if (!billing.isNullOrBlank()) parts += 0f to L.para(billing, sm, false, w)
        val cp = listOf(d.partyCity, if (d.partyPhone.isNotBlank()) "+91 ${d.partyPhone}" else "").filter { it.isNotBlank() }
        if (cp.isNotEmpty()) parts += 0f to L.para(cp.joinToString(" · "), sm, false, w)
        if (g && d.partyGstin.isNotBlank()) parts += 0f to L.para("GSTIN : ${d.partyGstin}", sm, false, w)
        if (o.description && d.description.isNotBlank()) parts += 0f to L.para(d.description, sm, false, w)
        return L.pad(L.stack(parts), 5f, 5f, 8f)
    }

    // ---- the item table
    val qtyTotal = d.lines.fold(BigDecimal.ZERO) { a, l -> a + dec(l.qty) }
    val amtTotal = d.lines.fold(BigDecimal.ZERO) { a, l -> a + dec(l.amount) }
    val batchPx = fs * 0.85f
    val cellText = d.lines.mapIndexed { i, l -> cols.map { it.v(l, i) } }
    val totalCells = cols.map { when (it.key) { "name" -> "Total"; "qty" -> PFmt.qty(qtyTotal.toPlainString()); "amount" -> m(amtTotal.toPlainString()); else -> "" } }
    val minW = cols.indices.map { k ->
        val col = cols[k]
        fun need(s: String, px: Float, bold: Boolean) = if (col.n) ink.width(s, px, bold) else s.split(" ", "\n").maxOfOrNull { ink.width(it, px, bold) } ?: 0f
        maxOf(
            need(col.label, fs, true),
            cellText.maxOfOrNull { need(it[k], fs, col.key == "name") } ?: 0f,
            if (col.key == "name") d.lines.maxOfOrNull { need(it.batch, batchPx, false) } ?: 0f else 0f,
            need(totalCells[k], fs, true),
        ) + 12f
    }
    val maxW = cols.indices.map { k ->
        val col = cols[k]
        maxOf(
            ink.width(col.label, fs, true),
            cellText.maxOfOrNull { ink.width(it[k], fs, col.key == "name") } ?: 0f,
            if (col.key == "name") d.lines.maxOfOrNull { ink.width(it.batch, batchPx, false) } ?: 0f else 0f,
            ink.width(totalCells[k], fs, true),
        ) + 12f
    }
    val cw = shareWidths(minW, maxW, Wi)
    val cx = cw.runningFold(0f) { a, w -> a + w }

    /** one table row: the cells' text, bold or not, with the name cell's batch line */
    fun row(texts: List<String>, bold: (Int) -> Boolean, batch: String = ""): Blk {
        val cells = texts.mapIndexed { k, s ->
            val col = cols[k]
            val w = cw[k] - 12
            val main = L.para(s, fs, bold(k), w, if (col.n) 'r' else 'l', nowrap = col.n)
            if (col.key == "name" && batch.isNotEmpty()) L.stack(listOf(0f to main, 0f to L.para(batch, batchPx, false, w))) else main
        }
        val h = (cells.maxOfOrNull { it.h } ?: L.lh(fs)) + 10f
        return Blk(h) { p, x, y -> cells.forEachIndexed { k, b -> b.draw(p, x + cx[k] + 6, y + 5) } }
    }
    val head = row(cols.map { it.label }, { true })
    val body = d.lines.mapIndexed { i, l -> row(cellText[i], { cols[it].key == "name" }, l.batch) }
    val empties = if (o.area == "min") maxOf(0, (o.minRows.toIntOrNull() ?: 0) - d.lines.size) else 0
    val emptyRow = row(cols.map { "" }, { false })
    val totalRow = if (o.totalQty) row(totalCells, { totalCells[it].isNotEmpty() }) else null

    // ---- the box under the table: amount in words, tax table, amounts
    fun sumBlk(): Blk? {
        if (!(show("words") || show("amts"))) return null
        val half = Wi / 2
        val lw = half - 16
        val left = mutableListOf<Pair<Float, Blk>>()
        if (show("words") && o.words) {
            left += 0f to L.para("${if (q) "Quotation" else "Invoice"} Amount in Words", fs, false, lw)
            left += 4f to L.para(d.words, fs, true, lw)
        }
        if (g && o.taxTable) {
            val sums = linkedMapOf<String, Pair<BigDecimal, BigDecimal>>()
            for (l in d.lines) {
                val k = dec(l.gst).stripTrailingZeros().toPlainString()
                val r = sums[k] ?: (BigDecimal.ZERO to BigDecimal.ZERO)
                sums[k] = (r.first + dec(l.taxable)) to (r.second + dec(l.tax))
            }
            // the web keeps them in a JavaScript object: whole-number rates come first, smallest first, then the others as they came
            val whole = sums.keys.filter { it.all(Char::isDigit) }.sortedBy { it.toLong() }
            val rates = (whole + sums.keys.filter { it !in whole }).associateWith { sums.getValue(it) }
            val heads = listOf("GST rate", "Taxable") + if (inter) listOf("IGST") else listOf("CGST", "SGST")
            val data = rates.map { (r, x) ->
                listOf(PFmt.pct(r), m(PFmt.r2(x.first).toPlainString())) + if (inter) listOf(m(PFmt.r2(x.second).toPlainString())) else listOf(m(PFmt.r2(x.second.divide(BigDecimal(2))).toPlainString()), m(PFmt.r2(x.second.divide(BigDecimal(2))).toPlainString()))
            }
            val tMin = heads.indices.map { k -> maxOf(ink.width(heads[k], fs, true), data.maxOfOrNull { ink.width(it[k], fs, false) } ?: 0f) + 10f }
            val tw = shareWidths(tMin, tMin, lw)
            val tx = tw.runningFold(0f) { a, w -> a + w }
            // collapsed 1 px borders round every cell: n rows take n × (text + padding) + (n + 1) px
            val rh = L.lh(fs) + 6f
            val n = data.size + 1
            left += 8f to Blk(n * rh + n + 1) { p, x, y ->
                for (r in 0..n) L.line(p, x, y + r * (rh + 1) + 0.5f, x + lw, y + r * (rh + 1) + 0.5f, c)
                for (k in 0..heads.size) L.line(p, x + tx[k], y, x + tx[k], y + n * (rh + 1) + 1, c)
                (listOf(heads) + data).forEachIndexed { r, cells ->
                    cells.forEachIndexed { k, s ->
                        val sw = ink.width(s, fs, r == 0)
                        L.text(p, s, if (k == 0) x + tx[k] + 5 else x + tx[k + 1] - 5 - sw, y + r * (rh + 1) + 1 + 3, fs, r == 0)
                    }
                }
            }
        }
        if (d.taxMode == "bos") left += 0f to L.para("Composition taxable person, not eligible to collect tax on supplies.", sm, false, lw)
        if (d.notes.isNotBlank()) { left += 6f to L.para("Notes", fs, false, lw); left += 0f to L.para(d.notes, sm, false, lw) }
        val leftB = L.pad(L.stack(left), 5f, 5f, 8f)
        var right: Blk? = null
        if (show("amts")) {
            val rows = mutableListOf<Triple<String, String, Boolean>>()
            if (dec(d.billDiscount).signum() != 0) rows += Triple("Discount", "−" + m(d.billDiscount), false)
            rows += Triple(if (g) "Taxable value" else "Sub Total", m(d.taxable), false)
            if (g) { if (inter) rows += Triple("IGST", m(d.igst), false) else { rows += Triple("CGST", m(d.cgst), false); rows += Triple("SGST", m(d.sgst), false) } }
            if (dec(d.tcs).signum() != 0) rows += Triple("TCS", m(d.tcs), false)
            if (dec(d.transport).signum() != 0) rows += Triple("Transport charge", m(d.transport), false)
            if (dec(d.labour).signum() != 0) rows += Triple("Labour charge", m(d.labour), false)
            if (dec(d.bankCharge).signum() != 0) rows += Triple("Bank comm.", m(d.bankCharge), false)
            if (dec(d.roundAmount).signum() != 0) rows += Triple("Round off", (if (dec(d.roundAmount).signum() > 0) "+" else "−") + m(dec(d.roundAmount).abs().toPlainString()), false)
            rows += Triple("Total", m(d.total), true)
            if (!q && o.received) rows += Triple("Received" + (if (o.payMode && d.payMode.isNotEmpty()) " (${d.payMode})" else ""), m(d.received), false)
            if (!q && o.balance) rows += Triple("Balance", m(d.balance), false)
            if (!q && o.partyBal && d.partyBalance != null) rows += Triple("Current balance", m(d.partyBalance), false)
            if (o.saved) {
                val saved = d.lines.fold(BigDecimal.ZERO) { a, l -> if (dec(l.mrp).signum() != 0) a + dec(l.mrp) * dec(l.qty) - dec(l.amount) else a }
                if (saved.signum() > 0) rows += Triple("You saved", m(saved.toPlainString()), false)
            }
            val rw = half - 1 - 16
            val rh = L.lh(fs) + 8f
            val headH = L.lh(fs) + 8f
            right = Blk(headH + rows.size * (rh + 1)) { p, x, y ->
                L.text(p, "Amounts", x + 8, y + 4, fs, true)
                rows.forEachIndexed { i, (k, v, b) ->
                    val top = y + headH + i * (rh + 1)
                    L.line(p, x, top + 0.5f, x + half - 1, top + 0.5f, c)
                    L.text(p, k, x + 8, top + 1 + 4, fs, b)
                    L.text(p, v, x + 8 + rw - ink.width(v, fs, b), top + 1 + 4, fs, b)
                }
            }
        }
        val h = maxOf(leftB.h, right?.h ?: 0f)
        return Blk(h) { p, x, y ->
            leftB.draw(p, x, y)
            L.line(p, x + half, y, x + half, y + h, c)
            right?.draw(p, x + half + 1, y)
        }
    }

    // ---- the foot: bank details, terms, signature
    fun footBlk(): Blk? {
        val bot = o.bot.filter { show(it) }
        if (bot.isEmpty()) return null
        val fw = Wi / bot.size
        val parts = bot.mapIndexed { i, b ->
            val w = fw - 16 - (if (i > 0) 1 else 0)
            when (b) {
                "bank" -> L.stack(listOfNotNull(0f to L.para("Bank Details", fs, true, w), if (upiOk(d.upi) && !q) 4f to L.para("UPI: ${d.upi}", sm, false, w) else null))
                "terms" -> L.stack(listOfNotNull(0f to L.para("Terms and conditions", fs, true, w), if (o.terms.isNotBlank()) 4f to L.para(o.terms, sm, false, w) else null))
                else -> L.stack(listOf(0f to L.para("For : $name", sm, false, w, 'c'), 38f to L.para(o.sign.ifBlank { "Authorized Signatory" }, fs, true, w, 'c')))
            }
        }
        val h = maxOf(92f, (parts.maxOfOrNull { it.h } ?: 0f) + 12f)
        return Blk(h) { p, x, y ->
            parts.forEachIndexed { i, b ->
                val bx = x + i * fw
                if (i > 0) L.line(p, bx, y, bx, y + h, c)
                b.draw(p, bx + 8 + (if (i > 0) 1 else 0), y + 6)
            }
        }
    }

    val tops = o.top.filter { show(it) }
    val outsideTitle = tops.firstOrNull() == "title"
    val boxTop = tops.filter { !(it == "title" && outsideTitle) }.map { when (it) { "title" -> titleBlk(Wi - 12, true); "biz" -> bizBlk(); else -> billBlk() } }
    val sum = sumBlk()
    val foot = footBlk()

    // ---- pages
    val pages = mutableListOf<Page>()
    val bottom = o.printHeight - pad
    lateinit var page: Page
    var y = 0f
    var boxY = 0f
    var first = true // nothing in this page's box yet (the first piece has no top border)
    var tableTop = 0f // where this page's part of the table starts (its column lines run from here)

    fun section(b: Blk) {
        if (!first) { L.line(page, pad + 1, y + 0.5f, pad + 1 + Wi, y + 0.5f, c); y += 1f }
        b.draw(page, pad + 1, y)
        y += b.h
        first = false
    }

    fun closeBox() {
        // the box runs to the foot of the page, as on the web
        page.ops += FrameOp(pad + 0.5f, boxY + 0.5f, W - 1, bottom - boxY - 1, 0f, c, 1f)
    }

    fun newPage() {
        page = Page(pw, ph)
        pages += page
        y = pad
        first = true
    }

    fun openBox() { boxY = y; y += 1f }

    fun columnsDown(from: Float, to: Float) {
        for (k in 1 until cols.size) L.line(page, pad + 1 + cx[k], from, pad + 1 + cx[k], to, c)
    }

    fun tableHead() {
        if (!first) { L.line(page, pad + 1, y + 0.5f, pad + 1 + Wi, y + 0.5f, c); y += 1f }
        first = false
        tableTop = y
        head.draw(page, pad + 1, y)
        y += head.h
        L.line(page, pad + 1, y + 0.5f, pad + 1 + Wi, y + 0.5f, c)
        y += 1f
    }

    newPage()
    if (d.cancelled) {
        val h = L.lh(fs) + 12f + 4f
        page.ops += FrameOp(pad + 1, y + 1, W - 2, h - 2, 8f, RED, 2f)
        val sp = fs * 0.2f
        val tw = ink.width("CANCELLED", fs, true) + sp * 9
        L.text(page, "CANCELLED", pad + (W - tw) / 2, y + 8, fs, true, RED, sp)
        y += h + 12f
    }
    if (outsideTitle) { titleBlk(W, false).also { it.draw(page, pad, y); y += it.h } }
    openBox()
    boxTop.forEach { section(it) }
    tableHead()

    val tail = (totalRow?.h ?: 0f) + (if (totalRow != null) 1f else 0f) + (sum?.let { it.h + 1 } ?: 0f) + (foot?.let { it.h + 1 } ?: 0f)
    val rows = body + List(empties) { emptyRow }
    /** the light line on top of every body row but the first */
    fun rowLine() = L.line(page, pad + 1, y + 0.5f, pad + 1 + Wi, y + 0.5f, ROW_LINE)
    rows.forEachIndexed { i, r ->
        if (y + r.h > bottom - 1) {
            columnsDown(tableTop, bottom - 1)
            closeBox()
            newPage(); openBox(); tableHead()
        }
        if (i > 0) rowLine()
        r.draw(page, pad + 1, y)
        y += r.h
    }
    if (y + tail > bottom - 1) {
        columnsDown(tableTop, bottom - 1)
        closeBox()
        newPage(); openBox(); tableHead()
    }
    // the fill row stretches the table so the foot sits at the bottom of the page
    if (o.area == "fill" && y < bottom - 1 - tail) { if (rows.isNotEmpty()) rowLine(); y = bottom - 1 - tail }
    if (totalRow != null) {
        L.line(page, pad + 1, y + 0.5f, pad + 1 + Wi, y + 0.5f, c)
        y += 1f
        columnsDown(tableTop, y + totalRow.h)
        totalRow.draw(page, pad + 1, y)
        y += totalRow.h
    } else columnsDown(tableTop, y)
    first = false
    sum?.let { section(it) }
    foot?.let { section(it) }
    closeBox()
    return pages
}

/* ───────── "Simple": the prototype's invoice (app.css .ivpg / .ivh / .ivg / .ivtab / .ivf / .ivtot), the web's Simple() ───────── */

private val SIMPLE_TEXT = mapOf("s" to 11.5f, "m" to 12.5f, "l" to 13.5f)
private val SIMPLE_NAME = mapOf("s" to 14f, "m" to 16f, "l" to 20f, "xl" to 24f)
private const val S_GREY = 0xFF5B6478.toInt()
private const val S_T2 = 0xFF66708A.toInt()
private const val S_LINE = 0xFFE3E6EE.toInt()
private const val S_HEAD = 0xFFF2F4F8.toInt()
private const val S_DUE = 0xFFB91C1C.toInt()
/** the logo's gradient is the viewer's colour theme on the web (var(--ac), var(--ac2)); the default theme is "Ledger teal" */
private const val S_LOGO1 = 0xFF0F766E.toInt()
private const val S_LOGO2 = 0xFF0D9488.toInt()
private const val WHITE = 0xFFFFFFFF.toInt()
/** the page's line height (body: 14px/1.45); inside tables the font's own ("normal") */
private const val S_LH = 1.45f
private const val S_TLH = ASC + DESC

private fun simple(d: PDoc, o: PrintOpts, biz: Biz, ink: Ink, copy: String): List<Page> {
    val (pw, ph) = o.size
    val pm = Opts.MARGIN_PX[o.margin] ?: 30f
    val fs = SIMPLE_TEXT[o.textSize] ?: 12.5f
    val namePx = SIMPLE_NAME[o.nameSize] ?: 16f
    val c = argbOf(o.color)
    val L = Lay(ink, fs, S_LH)
    val small = fs / 1.2f // the browser's "smaller"
    val m = { v: String? -> PFmt.money(v, o.grouping) }
    val dec = PFmt::dec
    val g = d.taxMode == "gst"
    val q = d.kind == "quotation"
    val inter = dec(d.igst).signum() > 0
    val name = biz.name.ifBlank { "My Business" }
    // Settings › General: with the currency symbol off (the default), the web removes every ₹ (curFix)
    val cur = if (d.showCurrency) "₹" else ""
    val padX = pm + 4
    val W = pw - 2 * padX
    val x0 = padX
    fun up(px: Float) = px * 0.05f
    fun label(t: String, w: Float, px: Float = 11f) = L.paraW(t.uppercase(), px, 400, w, color = S_GREY, spacing = up(px))
    fun gap(h: Float) = Blk(h) { _, _, _ -> }

    // ---- head: logo and the business on the left, the document's name on the right
    val title = docTitle(d, o).uppercase()
    val sub = if (q) (if (!d.dueDate.isNullOrBlank()) "Valid till ${PFmt.dmy(d.dueDate)}" else "") else copy
    val ivtW = maxOf(L.wd(title, 15f, 700, 15f * 0.08f), ink.width(sub, small, 400))
    val bs = biz.stateCode.ifBlank { "09" }
    val line = listOf(
        listOf(if (o.showAddr) biz.address else "", if (o.showAddr) listOf(biz.city, biz.pin).filter { it.isNotBlank() }.joinToString(" ") else "").filter { it.isNotBlank() }.joinToString(", "),
        if (o.showPhone) biz.phone else "",
    ).filter { it.isNotBlank() }.joinToString(" · ")
    val tw = W - ivtW - 16 - 44 - 12
    val bizText = L.stack(buildList {
        if (o.showName) add(0f to L.paraW(name, namePx, 700, tw))
        add(0f to L.paraW(line, small, 400, tw, color = S_GREY))
        if (o.showEmail && biz.email.isNotBlank()) add(0f to L.paraW(biz.email, small, 400, tw, color = S_GREY))
        if (o.firm.isNotBlank()) add(0f to L.paraW(o.firm, small, 400, tw, color = S_GREY))
        if (g) add(0f to L.paraW("GSTIN ${biz.gstin} · State ${stateName(bs)} ($bs)", small, 400, tw, color = S_GREY))
    })
    val ivt = L.stack(listOf(0f to L.paraW(title, 15f, 700, ivtW, 'r', c, 15f * 0.08f, nowrap = true), 0f to L.paraW(sub, small, 400, ivtW, 'r', S_GREY, nowrap = true)))
    val rowH = maxOf(44f, bizText.h, ivt.h)
    val head = Blk(rowH + 14 + 2) { p, x, y ->
        val ly = y + (rowH - 44) / 2
        p.ops += FillOp(x, ly, 44f, 44f, 9f, S_LOGO1, S_LOGO2)
        val letter = (name.firstOrNull() ?: 'B').uppercaseChar().toString()
        L.textW(p, letter, x + (44 - ink.width(letter, 18f, 800)) / 2, ly + (44 - 18f * S_LH) / 2, 18f, 800, WHITE)
        bizText.draw(p, x + 44 + 12, y + (rowH - bizText.h) / 2)
        ivt.draw(p, x + W - ivtW, y)
        p.ops += LineOp(x, y + rowH + 14 + 1, x + W, y + rowH + 14 + 1, c, 2f)
    }

    // ---- Bill to, number and date, due date and place of supply
    val avail = W - 32
    val cw = listOf(avail * 1.4f / 3.4f, avail / 3.4f, avail / 3.4f)
    fun b13(t: String, w: Float) = L.paraW(t, 13f, 700, w)
    val col1 = L.stack(buildList {
        add(0f to label("Bill to", cw[0])); add(0f to b13(d.partyName, cw[0]))
        if (d.partyCity.isNotBlank()) add(0f to L.paraW(d.partyCity, small, 400, cw[0], color = S_GREY))
        if (d.partyPhone.isNotBlank()) add(0f to L.paraW("+91 ${d.partyPhone}", small, 400, cw[0], color = S_GREY))
        if (g && d.partyGstin.isNotBlank()) add(0f to L.paraW("GSTIN ${d.partyGstin}", small, 400, cw[0], color = S_GREY))
    })
    val col2 = L.stack(buildList {
        if (!d.hideNo) { add(0f to label(if (q) "Quotation no." else "Invoice no.", cw[1])); add(0f to b13(d.number, cw[1])) }
        add((if (d.hideNo) 0f else 6f) to label("Date", cw[1])); add(0f to b13(PFmt.dmy(d.date) + (if (d.time.isNotEmpty()) " · ${d.time}" else ""), cw[1]))
    })
    val col3 = L.stack(buildList {
        if (d.mode == "credit" || q) { add(0f to label(if (q) "Valid till" else "Due date", cw[2])); add(0f to b13(PFmt.dmy(d.dueDate ?: d.date), cw[2])) }
        else { add(0f to label("Payment", cw[2])); add(0f to b13("Cash sale", cw[2])) }
        if (g) { add(6f to label("Place of supply", cw[2])); add(0f to b13("${stateName(d.placeOfSupply)} (${d.placeOfSupply})", cw[2])) }
    })
    val gh = maxOf(col1.h, col2.h, col3.h)
    val grid = Blk(14 + gh + 14 + 1) { p, x, y ->
        col1.draw(p, x, y + 14); col2.draw(p, x + cw[0] + 16, y + 14); col3.draw(p, x + cw[0] + cw[1] + 32, y + 14)
        L.line(p, x, y + 14 + gh + 14 + 0.5f, x + W, y + 14 + gh + 14 + 0.5f, S_LINE)
    }

    // ---- references (Challan no., transport, …): side by side, wrapping
    val refs: Blk? = if (d.refs.isEmpty()) null else {
        val items = d.refs.map { (k, t) -> Triple(k.uppercase(), t, maxOf(L.wd(k.uppercase(), 10f, 700, 0.5f), ink.width(t, 12f, 400))) }
        val rows = mutableListOf<MutableList<Triple<String, String, Float>>>()
        var used = 0f
        for (it in items) {
            if (rows.isEmpty() || used + 18 + it.third > W) { rows += mutableListOf(it); used = it.third } else { rows.last() += it; used += 18 + it.third }
        }
        val rh = 10f * S_LH + 12f * S_LH
        Blk(12 + rows.size * rh + (rows.size - 1) * 6 + 4) { p, x, y ->
            rows.forEachIndexed { r, row ->
                var xx = x
                val yy = y + 12 + r * (rh + 6)
                row.forEach { (k, t, w) ->
                    L.textW(p, k, xx, yy, 10f, 700, S_GREY, 0.5f)
                    L.textW(p, t, xx, yy + 10f * S_LH, 12f, 400)
                    xx += w + 18
                }
            }
        }
    }
    val desc = if (o.description && d.description.isNotBlank()) L.stack(listOf(8f to L.paraW(d.description, 12.5f, 400, W))) else null

    // ---- the item table
    val cols = columns(d, o)
    val td = 13f
    val batchPx = td * 0.85f
    val right = { k: Int -> cols[k].n && cols[k].key != "unit" }
    val texts = d.lines.mapIndexed { i, l -> cols.map { it.v(l, i) } }
    fun cellPx(k: Int) = if (cols[k].key == "code") 11f else td
    val minW = cols.indices.map { k ->
        val nowrap = right(k)
        fun need(t: String, px: Float, w: Int) = if (nowrap) ink.width(t, px, w) else t.split(" ").maxOfOrNull { ink.width(it, px, w) } ?: 0f
        maxOf(ink.width(cols[k].label, 11f, 600), texts.maxOfOrNull { need(it[k], cellPx(k), if (nowrap) 700 else 400) } ?: 0f,
            if (cols[k].key == "name") d.lines.maxOfOrNull { need(it.batch, batchPx, 400) } ?: 0f else 0f) + 16
    }
    val maxW = cols.indices.map { k ->
        maxOf(ink.width(cols[k].label, 11f, 600), texts.maxOfOrNull { ink.width(it[k], cellPx(k), if (right(k)) 700 else 400) } ?: 0f,
            if (cols[k].key == "name") d.lines.maxOfOrNull { ink.width(it.batch, batchPx, 400) } ?: 0f else 0f) + 16
    }
    val widths = shareWidths(minW, maxW, W)
    val cx = widths.runningFold(0f) { a, w -> a + w }
    val T = Lay(ink, td, S_TLH)
    val thH = 11f * S_TLH + 16
    val thead = Blk(12 + thH) { p, x, y ->
        p.ops += FillOp(x, y + 12, W, thH, 0f, S_HEAD)
        cols.forEachIndexed { k, col ->
            val w = ink.width(col.label, 11f, 600)
            T.textW(p, col.label, if (right(k)) x + cx[k + 1] - 8 - w else x + cx[k] + 8, y + 12 + 8, 11f, 600, S_GREY)
        }
    }
    val rows = d.lines.mapIndexed { i, l ->
        val cells = cols.indices.map { k ->
            val w = widths[k] - 16
            val px = cellPx(k)
            // number cells are bold (app.css td.n)
            val main = T.paraW(texts[i][k], px, if (right(k)) 700 else 400, w, if (right(k)) 'r' else 'l', if (cols[k].key == "code") S_GREY else TEXT, nowrap = right(k))
            if (cols[k].key == "name" && l.batch.isNotEmpty()) T.stack(listOf(0f to main, 0f to T.paraW(l.batch, batchPx, 400, w, color = S_T2))) else main
        }
        // every row but the first has a 1 px line on top
        val bw = if (i > 0) 1f else 0f
        val inner = cells.maxOf { it.h }
        i to Blk(inner + 16 + bw) { p, x, y ->
            if (i > 0) L.line(p, x, y + 0.5f, x + W, y + 0.5f, S_LINE)
            // cells sit in the middle of the row (td: vertical-align middle)
            cells.forEachIndexed { k, b -> b.draw(p, x + cx[k] + 8, y + bw + 8 + (inner - b.h) / 2) }
        }
    }

    // ---- under the table: tax table, words, notes, UPI, terms | the totals and signature
    val totW = 280f
    val lw = W - totW - 24
    val left = mutableListOf<Pair<Float, Blk>>()
    if (g && o.taxTable) {
        val sums = linkedMapOf<String, Pair<BigDecimal, BigDecimal>>()
        for (l in d.lines) {
            val k = dec(l.gst).stripTrailingZeros().toPlainString()
            val r = sums[k] ?: (BigDecimal.ZERO to BigDecimal.ZERO)
            sums[k] = (r.first + dec(l.taxable)) to (r.second + dec(l.tax))
        }
        // one rate: the bill's own totals (they include the bill discount)
        if (sums.size == 1) sums[sums.keys.first()] = dec(d.taxable) to (dec(d.cgst) + dec(d.sgst) + dec(d.igst))
        val whole = sums.keys.filter { it.all(Char::isDigit) }.sortedBy { it.toLong() }
        val rates = (whole + sums.keys.filter { it !in whole }).associateWith { sums.getValue(it) }
        val heads = listOf("GST rate", "Taxable") + if (inter) listOf("IGST") else listOf("CGST", "SGST")
        val half = { v: BigDecimal -> m(PFmt.r2(v.divide(BigDecimal(2))).toPlainString()) }
        val data = rates.map { (r, x) -> listOf(PFmt.pct(r), m(PFmt.r2(x.first).toPlainString())) + if (inter) listOf(m(PFmt.r2(x.second).toPlainString())) else listOf(half(x.second), half(x.second)) }
        val tw0 = heads.indices.map { k -> maxOf(ink.width(heads[k], 11f, 600), data.maxOfOrNull { ink.width(it[k], td, if (k > 0) 700 else 400) } ?: 0f) + 16 }
        val tws = shareWidths(tw0, tw0, lw)
        val tx = tws.runningFold(0f) { a, w -> a + w }
        val rh = td * S_TLH + 16
        left += 12f to Blk(thH + data.size * (rh + 1) - 1) { p, x, y ->
            p.ops += FillOp(x, y, lw, thH, 0f, S_HEAD)
            heads.forEachIndexed { k, h -> val w = ink.width(h, 11f, 600); T.textW(p, h, if (k == 0) x + tx[k] + 8 else x + tx[k + 1] - 8 - w, y + 8, 11f, 600, S_GREY) }
            data.forEachIndexed { r, row ->
                val top = y + thH + r * (rh + 1) - (if (r > 0) 1 else 0)
                if (r > 0) L.line(p, x, top + 0.5f, x + lw, top + 0.5f, S_LINE)
                row.forEachIndexed { k, t -> val wt = if (k > 0) 700 else 400; val w = ink.width(t, td, wt); T.textW(p, t, if (k == 0) x + tx[k] + 8 else x + tx[k + 1] - 8 - w, top + (if (r > 0) 1 else 0) + 8, td, wt) }
            }
        }
    } else if (d.taxMode == "bos") left += 12f to L.paraW("Composition taxable person, not eligible to collect tax on supplies.", 12f, 400, lw, color = S_GREY)
    fun words(k: String, body: Blk) { left += 12f to L.stack(listOf(0f to label(k, lw), 0f to body)) }
    if (o.words) words("Amount in words", L.paraW(d.words, fs, 700, lw))
    // notes are not pre-wrapped on the web: line breaks read as spaces
    if (d.notes.isNotBlank()) words("Notes", L.paraW(d.notes.trim().replace(Regex("""\s+"""), " "), 12f, 400, lw))
    if (upiOk(d.upi) && !q) words("Pay by UPI", L.paraW(d.upi, 12f, 400, lw))
    if (o.terms.isNotBlank()) words("Terms and conditions", L.paraW(o.terms, 12f, 400, lw))
    val leftB = L.stack(left)

    class Row(val k: String, val v: String, val kind: Int = 0) // 1 = Total, 2 = Balance due
    val tr = mutableListOf<Row>()
    if (dec(d.billDiscount).signum() != 0) tr += Row("Discount", "−" + m(d.billDiscount))
    tr += Row(if (g) "Taxable value" else "Sub total", m(d.taxable))
    if (g) { if (inter) tr += Row("IGST", m(d.igst)) else { tr += Row("CGST", m(d.cgst)); tr += Row("SGST", m(d.sgst)) } }
    if (dec(d.tcs).signum() != 0) tr += Row("TCS", m(d.tcs))
    if (dec(d.transport).signum() != 0) tr += Row("Transport charge", m(d.transport))
    if (dec(d.labour).signum() != 0) tr += Row("Labour charge", m(d.labour))
    if (dec(d.bankCharge).signum() != 0) tr += Row("Bank comm.", m(d.bankCharge))
    if (dec(d.roundAmount).signum() != 0) tr += Row("Round off", (if (dec(d.roundAmount).signum() > 0) "+" else "−") + m(dec(d.roundAmount).abs().toPlainString()))
    tr += Row("Total", cur + m(d.total), 1)
    if (!q) {
        if (o.received) tr += Row("Received" + (if (o.payMode && d.payMode.isNotEmpty()) " (${d.payMode})" else ""), m(d.received))
        if (o.balance) tr += Row("Balance due", cur + m(d.balance), 2)
        if (o.partyBal && d.partyBalance != null) tr += Row("Current balance", cur + m(d.partyBalance))
    }
    if (o.saved) {
        val saved = d.lines.fold(BigDecimal.ZERO) { a, l -> if (dec(l.mrp).signum() != 0) a + dec(l.mrp) * dec(l.qty) - dec(l.amount) else a }
        if (saved.signum() > 0) tr += Row("You saved", cur + m(saved.toPlainString()))
    }
    fun rowH(r: Row) = (if (r.kind == 1) 15f else fs) * S_LH + 12
    val sigText = listOf("For $name", o.sign.ifBlank { "Authorized Signatory" })
    val totH = 12 + tr.mapIndexed { i, r -> rowH(r) + (if (i == 0) 0f else if (r.kind == 1) 2f else 1f) }.sum() + 34 + 6 + 1 + 6 + 2 * 11f * S_LH + 6
    val tot = Blk(totH) { p, x, y ->
        var yy = y + 12
        tr.forEachIndexed { i, r ->
            if (i > 0) { val bw = if (r.kind == 1) 2f else 1f; p.ops += LineOp(x, yy + bw / 2, x + totW, yy + bw / 2, if (r.kind == 1) c else S_LINE, bw); yy += bw }
            val px = if (r.kind == 1) 15f else fs
            val kw = if (r.kind == 1) 700 else 400
            val vw = if (r.kind == 1) 800 else 700
            L.textW(p, r.k, x, yy + 6, px, kw, if (r.kind == 1) c else S_GREY)
            L.textW(p, r.v, x + totW - ink.width(r.v, px, vw), yy + 6, px, vw, when (r.kind) { 1 -> c; 2 -> S_DUE; else -> TEXT })
            yy += rowH(r)
        }
        yy += 34 + 6
        L.line(p, x + 20, yy + 0.5f, x + totW - 20, yy + 0.5f, TEXT)
        yy += 1 + 6
        sigText.forEachIndexed { i, t -> L.textW(p, t, x + (totW - ink.width(t, 11f, 400)) / 2, yy + i * 11f * S_LH, 11f, 400, S_GREY) }
    }
    val foot = Blk(6 + maxOf(leftB.h, tot.h)) { p, x, y -> leftB.draw(p, x, y + 6); tot.draw(p, x + lw + 24, y + 6) }

    // ---- pages: everything flows down; a long table goes on with its heading on the next page
    val pages = mutableListOf<Page>()
    val bottom = o.printHeight - pm
    var page = Page(pw, ph).also { pages += it }
    var y = pm
    fun place(b: Blk) {
        if (y + b.h > bottom && y > pm) { page = Page(pw, ph).also { pages += it }; y = pm }
        b.draw(page, x0, y); y += b.h
    }
    if (d.cancelled) {
        val h = fs * S_LH + 12 + 4
        page.ops += FrameOp(x0 + 1, y + 1, W - 2, h - 2, 8f, RED, 2f)
        val sp = fs * 0.2f
        val t = "CANCELLED"
        L.textW(page, t, x0 + (W - L.wd(t, fs, 800, sp)) / 2, y + 8, fs, 800, RED, sp)
        y += h + 12
    }
    place(head); place(grid); refs?.let(::place); desc?.let(::place)
    place(thead)
    for ((_, r) in rows) {
        if (y + r.h > bottom) { page = Page(pw, ph).also { pages += it }; y = pm; place(Blk(thH) { p, x, yy -> thead.draw(p, x, yy - 12) }) }
        r.draw(page, x0, y); y += r.h
    }
    place(foot)
    return pages
}
