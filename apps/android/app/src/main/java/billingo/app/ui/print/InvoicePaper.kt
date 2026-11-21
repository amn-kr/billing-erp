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

/** Measures text: the width of [s] at [px] pixels, regular or bold, in the same pixels. */
fun interface Ink {
    fun width(s: String, px: Float, bold: Boolean): Float
}

sealed interface Op
/** text with its baseline at [y]; [spacing] is extra space after each letter */
data class TextOp(val s: String, val x: Float, val y: Float, val px: Float, val bold: Boolean, val argb: Int, val spacing: Float = 0f) : Op
data class LineOp(val x1: Float, val y1: Float, val x2: Float, val y2: Float, val argb: Int, val w: Float = 1f) : Op
/** a rounded outline (the CANCELLED stamp) */
data class FrameOp(val x: Float, val y: Float, val w: Float, val h: Float, val r: Float, val argb: Int, val stroke: Float) : Op

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

private class Lay(val ink: Ink, val fs: Float) {
    val sm = fs * 0.92f

    fun lh(px: Float) = px * LH

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
    fun text(p: Page, s: String, x: Float, top: Float, px: Float, bold: Boolean, color: Int = TEXT, spacing: Float = 0f) {
        if (s.isEmpty()) return
        val base = top + (px * LH - px * (ASC + DESC)) / 2 + px * ASC
        p.ops += TextOp(s, x, base, px, bold, color, spacing)
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
    return (list.ifEmpty { listOf("") }).flatMap { classic(d, o, biz, ink, it) }
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
