package billingo.app

import billingo.app.data.Api
import billingo.app.data.DocBatch
import billingo.app.data.SaleDoc
import billingo.app.ui.print.Biz
import billingo.app.ui.print.DocOpts
import billingo.app.ui.print.FillOp
import billingo.app.ui.print.FrameOp
import billingo.app.ui.print.Ink
import billingo.app.ui.print.LineOp
import billingo.app.ui.print.Page
import billingo.app.ui.print.PrintOpts
import billingo.app.ui.print.TextOp
import billingo.app.ui.print.batchPrintLine
import billingo.app.ui.print.columns
import billingo.app.ui.print.docTitle
import billingo.app.ui.print.fromSale
import billingo.app.ui.print.paperPages
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer

/**
 * The invoice paper (8.5d): the same layout the phone turns into a PDF, measured with the same
 * Inter font and drawn into a picture (build/invoice-*.png) to look at beside the web's print.
 */
class InvoicePaperTest {
    /** Inter's advance widths, read straight from the font file (cmap and hmtx tables), without kerning. */
    private class Ttf(file: File) {
        private val b = ByteBuffer.wrap(file.readBytes())
        private val tables = (0 until b.getShort(4).toInt()).associate { i ->
            val o = 12 + i * 16
            String(ByteArray(4) { b.get(o + it) }) to b.getInt(o + 8)
        }
        private val upem = b.getShort(tables.getValue("head") + 18).toInt() and 0xFFFF
        private val nh = b.getShort(tables.getValue("hhea") + 34).toInt() and 0xFFFF
        private val glyphs = HashMap<Int, Int>()

        init {
            val c = tables.getValue("cmap")
            val n = b.getShort(c + 2).toInt()
            val subs = (0 until n).map { b.getShort(c + 4 + it * 8).toInt() to (b.getShort(c + 6 + it * 8).toInt() to b.getInt(c + 8 + it * 8)) }
            val off = c + (subs.firstOrNull { it.first == 3 && it.second.first == 10 } ?: subs.first { it.first == 3 && it.second.first == 1 }).second.second
            when (b.getShort(off).toInt()) {
                12 -> for (g in 0 until b.getInt(off + 12)) {
                    val o = off + 16 + g * 12
                    val s0 = b.getInt(o); val e0 = b.getInt(o + 4); val st = b.getInt(o + 8)
                    for (cp in s0..e0) glyphs[cp] = st + cp - s0
                }
                else -> {
                    val seg = (b.getShort(off + 6).toInt() and 0xFFFF) / 2
                    for (i in 0 until seg) {
                        val end = b.getShort(off + 14 + i * 2).toInt() and 0xFFFF
                        val st = b.getShort(off + 16 + seg * 2 + i * 2).toInt() and 0xFFFF
                        val delta = b.getShort(off + 16 + seg * 4 + i * 2).toInt()
                        val ro = off + 16 + seg * 6 + i * 2
                        val range = b.getShort(ro).toInt() and 0xFFFF
                        for (cp in st..end) {
                            if (cp == 0xFFFF) continue
                            glyphs[cp] = if (range == 0) (cp + delta) and 0xFFFF else (b.getShort(ro + range + (cp - st) * 2).toInt() and 0xFFFF).let { if (it == 0) 0 else (it + delta) and 0xFFFF }
                        }
                    }
                }
            }
        }

        fun width(s: String, px: Float): Float {
            val h = tables.getValue("hmtx")
            var w = 0
            s.codePoints().forEach { cp ->
                val g = glyphs[cp] ?: 0
                w += b.getShort(h + 4 * minOf(g, nh - 1)).toInt() and 0xFFFF
            }
            return w * px / upem
        }
    }

    private val fonts = File("src/main/res/font")
    private val weights = mapOf(400 to "regular", 500 to "medium", 600 to "semibold", 700 to "bold")
    private val ttf = weights.mapValues { Ttf(fonts.resolve("inter_${it.value}.ttf")) }
    private fun face(w: Int) = when { w >= 700 -> 700; w >= 600 -> 600; w >= 500 -> 500; else -> 400 }
    private val ink = Ink { s, px, w -> ttf.getValue(face(w)).width(s, px) }

    private fun hex(argb: Int) = "#%06x".format(argb and 0xFFFFFF)
    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    /** each page as an SVG with Inter, kerning off (the measuring above has none) */
    private fun picture(pages: List<Page>, name: String) {
        val font = fonts.absoluteFile
        pages.forEachIndexed { n, p ->
            val sb = StringBuilder()
            sb.append("""<svg xmlns="http://www.w3.org/2000/svg" width="${p.w}" height="${p.h}" viewBox="0 0 ${p.w} ${p.h}"><style>${weights.entries.joinToString("") { (w, n) -> "@font-face{font-family:I;font-weight:$w;src:url(file://$font/inter_$n.ttf)}" }}text{font-family:I;font-kerning:none;white-space:pre}</style><rect width="100%" height="100%" fill="#fff"/>""")
            for (op in p.ops) when (op) {
                is TextOp -> sb.append("""<text x="${op.x}" y="${op.y}" font-size="${op.px}" font-weight="${face(op.w)}" fill="${hex(op.argb)}"${if (op.spacing > 0) " letter-spacing=\"${op.spacing}\"" else ""}>${esc(op.s)}</text>""")
                is LineOp -> sb.append("""<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${hex(op.argb)}" stroke-width="${op.w}"/>""")
                is FillOp -> sb.append(if (op.to == null) """<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" rx="${op.r}" fill="${hex(op.argb)}"/>""" else """<defs><linearGradient id="g$n" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hex(op.argb)}"/><stop offset="1" stop-color="${hex(op.to)}"/></linearGradient></defs><rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" rx="${op.r}" fill="url(#g$n)"/>""")
                is FrameOp -> sb.append("""<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" rx="${op.r}" fill="none" stroke="${hex(op.argb)}" stroke-width="${op.stroke}"/>""")
            }
            sb.append("</svg>")
            File("build/$name-${n + 1}.svg").writeText(sb.toString())
        }
    }

    private val biz = Biz(name = "Sharma Electricals", phone = "9876543210", address = "12 Station Road", city = "Lucknow", pin = "226001", stateCode = "09", gstin = "09ABCDE1234F1Z5", email = "shop@example.com")

    private fun doc(json: String): SaleDoc = Api.JSON.decodeFromString(SaleDoc.serializer(), json)

    private val gstBill = """
        {"id":"s1","kind":"invoice","number":"INV-0107","date":"2026-11-21","dueDate":"2026-12-06","mode":"credit","taxMode":"gst","placeOfSupply":"09",
         "partyName":"Raju Traders","party":{"id":"p1","name":"Raju Traders","phone":"9811111111","gstin":"09AAACR1234A1Z1","city":"Kanpur"},
         "billDiscount":"0.00","taxable":"3709.32","cgst":"333.84","sgst":"333.84","igst":"0.00","tcs":"0.00","transport":"0.00","labour":"0.00","bankCharge":"0.00",
         "roundAmount":"0.00","total":"4377.00","words":"Rupees Four Thousand Three Hundred Seventy Seven Only","balance":"4377.00","notes":"",
         "extra":{"transport":"Shree Logistics","vehicle":"UP32 AB 1234","quoteRefs":[{"no":"QT-0003","date":"2026-11-20","brand":"Item-wise"}]},
         "payment":null,
         "lines":[
          {"itemId":"i1","name":"Finolex 1.5 sq mm Wire 90 m","hsn":"8544","qty":"2.000","unit":"ROLL","price":"1450.00","discPct":"0","gstRate":"18","taxable":"2457.63","tax":"442.37","amount":"2900.00"},
          {"itemId":"i2","name":"Havells MCB 32A Double Pole","hsn":"8536","qty":"3.000","unit":"PCS","price":"492.33","discPct":"0","gstRate":"18","taxable":"1251.69","tax":"225.31","amount":"1477.00"}
         ]}
    """.trimIndent()

    @Test
    fun `a GST bill prints as one A4 page with the web's columns`() {
        val o = PrintOpts.from(null)
        val d = fromSale(doc(gstBill))
        assertEquals("Tax Invoice", docTitle(d, o))
        assertEquals(listOf("sl", "name", "qty", "unit", "rate", "amount"), columns(d, o).map { it.key })
        val pages = paperPages(d, o, biz, ink)
        assertEquals(1, pages.size)
        val words = pages[0].ops.filterIsInstance<TextOp>().map { it.s }
        assertTrue(words.containsAll(listOf("Tax Invoice", "Original for recipient", "Sharma Electricals", "INV-0107", "21/11/2026", "Raju Traders", "Uttar Pradesh (09)", "Shree Logistics", "QT-0003 (20/11/2026)", "4,377.00", "1,450.00")))
        picture(pages, "invoice-gst")
    }

    @Test
    fun `a plain bill with cash received, three copies and a long list`() {
        val lines = (1..40).joinToString(",") { """{"name":"Item number $it with a fairly long name","qty":"$it.000","unit":"PCS","price":"10.00","discPct":"0","gstRate":"0","taxable":"${it * 10}.00","tax":"0.00","amount":"${it * 10}.00"}""" }
        val d = fromSale(doc("""{"id":"s2","number":"INV-0108","date":"2026-11-21","mode":"cash","taxMode":"none","partyName":"Counter Customer","cashPhone":"","taxable":"8200.00","total":"8200.00","words":"Rupees Eight Thousand Two Hundred Only","payment":{"amount":"8200.00","mode":"Cash"},"lines":[$lines]}"""))
        val o = PrintOpts.from(Json.parseToJsonElement("""{"copies":{"orig":true,"dup":true,"trip":true},"terms":"Goods once sold will not be taken back.\nSubject to Lucknow jurisdiction."}""") as JsonObject)
        assertEquals("Bill", docTitle(d, o))
        val pages = paperPages(d, o, biz, ink)
        // 40 lines do not fit one A4 page; each of the 3 copies takes the same pages
        assertTrue(pages.size >= 6 && pages.size % 3 == 0)
        val all = pages.flatMap { p -> p.ops.filterIsInstance<TextOp>().map { it.s } }
        assertTrue(all.contains("Received (Cash)"))
        assertTrue(all.containsAll(listOf("Original for recipient", "Duplicate for transporter", "Triplicate for supplier")))
        picture(pages.take(2), "invoice-plain")
    }

    @Test
    fun `batches print under the name, and GST rates in the web's order`() {
        val b = listOf(DocBatch("b1", "A1", "2040-03-31", "3", "120"), DocBatch(null, "No batch", null, "1"))
        assertEquals("Batch A1 × 3 PCS (Exp 03/2040, MRP 120.00), No batch × 1 PCS", batchPrintLine(b, true, "PCS", DocOpts()))
        assertEquals("Lot A1 × 3 (Use By 31/03/40), No batch × 1", batchPrintLine(b, false, null, DocOpts(words = mapOf("batch" to "Lot", "exp" to "Use By"), expFormat = "dd/mm/yy")))
        assertEquals("", batchPrintLine(listOf(DocBatch(null, "No batch", null, "2")), true, null, DocOpts()))
        val line = { g: String -> """{"name":"X","qty":"1","unit":"PCS","price":"100","gstRate":"$g","taxable":"100","tax":"1","amount":"101"}""" }
        val d = fromSale(doc("""{"id":"s3","number":"INV-0109","date":"2026-11-21","taxMode":"gst","placeOfSupply":"09","partyName":"A","total":"303","lines":[${line("18")},${line("2.5")},${line("12")}]}"""))
        val words = paperPages(d, PrintOpts.from(null), biz, ink)[0].ops.filterIsInstance<TextOp>().map { it.s }
        assertEquals(listOf("12%", "18%", "2.5%"), words.filter { it.endsWith("%") })
    }

    @Test
    fun `the time a bill was saved, in India time`() {
        assertEquals("1:35 pm", billingo.app.ui.print.PFmt.timeIst("2026-11-21T08:05:13.123Z"))
        assertEquals("12:00 am", billingo.app.ui.print.PFmt.timeIst("2026-11-20T18:30:00Z"))
    }

    @Test
    fun `the web's paper stops 1 mm short of the sheet`() {
        assertEquals(1118.74f, PrintOpts().printHeight, 0.01f)
        assertEquals(789.92f, PrintOpts(paper = "A5").printHeight, 0.01f)
    }

    @Test
    fun `the Simple layout, with or without the rupee sign`() {
        val o = PrintOpts.from(Json.parseToJsonElement("""{"theme":"simple","terms":"Goods once sold will not be taken back."}""") as JsonObject)
        val pages = paperPages(fromSale(doc(gstBill)), o, biz, ink)
        assertEquals(1, pages.size)
        val words = pages[0].ops.filterIsInstance<TextOp>().map { it.s }
        assertTrue(words.containsAll(listOf("TAX INVOICE", "BILL TO", "INVOICE NO.", "PLACE OF SUPPLY", "TRANSPORT", "Shree Logistics", "AMOUNT IN WORDS", "Balance due", "4,377.00", "For Sharma Electricals")))
        assertTrue(words.none { "₹" in it })
        assertTrue(pages[0].ops.any { it is FillOp && it.to != null }) // the logo
        val withSign = paperPages(fromSale(doc(gstBill), DocOpts(showCurrency = true)), o, biz, ink)[0].ops.filterIsInstance<TextOp>().map { it.s }
        assertTrue(withSign.contains("₹4,377.00"))
        // a long bill goes on to a second page
        val lines = (1..40).joinToString(",") { """{"name":"Item $it","qty":"1","unit":"PCS","price":"10","taxable":"10","tax":"0","amount":"10"}""" }
        assertTrue(paperPages(fromSale(doc("""{"id":"s4","number":"INV-0110","date":"2026-11-21","partyName":"A","total":"400","lines":[$lines]}""")), o, biz, ink).size >= 2)
    }

    // 8.6d-2: a delivery challan, as the web prints it
    private val challan = """
        {"id":"c1","kind":"challan","number":"DC-0012","date":"2026-11-15","mode":"credit","taxMode":"gst","placeOfSupply":"09","status":"invoiced",
         "partyName":"Mehta Electricals","party":{"id":"p2","name":"Mehta Electricals","phone":"9839012345","gstin":"09AAACM1234A1Z1","city":"Kanpur"},
         "total":"0.00","notes":"Site: Civil Lines, near the water tank","extra":{"transport":"Self","vehicle":"UP78 CD 4521","invoiceNo":"INV-0106"},
         "lines":[
          {"itemId":"i1","name":"LED Bulb 9W","hsn":"8539","qty":"30.000","unit":"PCS","price":"0.00","discPct":"0","gstRate":"12","taxable":"0","tax":"0","amount":"0.00"},
          {"itemId":"i2","name":"Finolex 1.5 sq mm Wire 90 m","hsn":"8544","qty":"2.000","unit":"ROLL","price":"0.00","discPct":"0","gstRate":"18","taxable":"0","tax":"0","amount":"0.00"}
         ]}
    """.trimIndent()

    @Test
    fun `a challan in Classic has no prices, Deliver To and Received by`() {
        val o = PrintOpts.from(null)
        val d = fromSale(doc(challan))
        assertEquals("Delivery Challan", docTitle(d, o))
        assertEquals(listOf("sl", "name", "qty", "unit"), columns(d, o).map { it.key })
        val pages = paperPages(d, o, biz, ink)
        assertEquals(1, pages.size)
        val words = pages[0].ops.filterIsInstance<TextOp>().map { it.s }
        assertTrue(words.containsAll(listOf("Delivery Challan", "Challan No.", "DC-0012", "Deliver To", "Mehta Electricals", "Transport: Self · UP78 CD 4521", "Total", "32", "Received by", "Name & signature", "For : Sharma Electricals")))
        // no copy label, no amounts box, no bank details
        assertTrue(words.none { it == "Original for recipient" || it == "Amounts" || it == "Bank Details" || it.contains("Amount in Words") })
        picture(pages, "challan-classic")
    }

    @Test
    fun `a challan in Simple is the web's delivery note`() {
        val o = PrintOpts.from(Json.parseToJsonElement("""{"theme":"simple"}""") as JsonObject)
        val pages = paperPages(fromSale(doc(challan)), o, biz, ink)
        assertEquals(1, pages.size)
        val words = pages[0].ops.filterIsInstance<TextOp>().map { it.s }
        assertTrue(words.containsAll(listOf("DELIVERY CHALLAN", "DC-0012 · 15/11/2026", "Billed in INV-0106", "DELIVER TO", "Mehta Electricals", "+91 9839012345", "Transport: Self · UP78 CD 4521",
            "#", "Item", "HSN", "Qty", "Unit", "LED Bulb 9W", "8539", "30", "Total quantity", "32", "Received by (name & signature)", "For Sharma Electricals")))
        assertTrue(words.none { it.contains("₹") || it.contains(".00") })
        picture(pages, "challan-simple")
    }
}
