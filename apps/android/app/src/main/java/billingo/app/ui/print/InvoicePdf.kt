package billingo.app.ui.print

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import androidx.core.content.FileProvider
import androidx.core.content.res.ResourcesCompat
import billingo.app.R
import billingo.app.data.Api
import billingo.app.data.SaleDoc
import billingo.app.ui.parts.Format
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import java.io.File
import java.io.FileOutputStream

/**
 * The invoice PDF on the phone (step 8.5d): the saved bill and the shop's print choices from the
 * server, laid out by [paperPages] exactly as the web prints it, drawn with Android's PDF maker.
 * Nothing runs on the server. The file stays in the app's cache and is handed to WhatsApp, other
 * apps or the phone's print screen.
 */
object InvoicePdf {
    /** A finished PDF and what the share message needs. */
    class Made(val file: File, val title: String, val doc: SaleDoc, val shop: String, val paper: String)

    /** CSS px → PDF points (96 → 72 per inch) */
    private const val PT = 0.75f

    private class Fonts(ctx: Context) {
        val regular: Typeface = ResourcesCompat.getFont(ctx, R.font.inter_regular) ?: Typeface.DEFAULT
        val medium: Typeface = ResourcesCompat.getFont(ctx, R.font.inter_medium) ?: regular
        val semibold: Typeface = ResourcesCompat.getFont(ctx, R.font.inter_semibold) ?: regular
        val bold: Typeface = ResourcesCompat.getFont(ctx, R.font.inter_bold) ?: Typeface.DEFAULT_BOLD
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { fontFeatureSettings = "tnum" }

        /** Inter in 4 weights inside the app: 800 prints as bold */
        fun paint(px: Float, w: Int): Paint = paint.apply {
            typeface = when { w >= 700 -> bold; w >= 600 -> semibold; w >= 500 -> medium; else -> regular }
            textSize = px; letterSpacing = 0f
        }
        val ink = Ink { s, px, b -> paint(px, b).measureText(s) }
    }

    /** Fetches the bill and the shop's choices, lays the paper out and writes the PDF. */
    suspend fun make(ctx: Context, api: Api, saleId: String, features: List<String>, itemOptions: JsonObject?): Made = coroutineScope {
        val doc = async { api.saleDoc(saleId) }
        val settings = async { api.settings() }
        val shop = async { api.shop() }
        val v = doc.await()
        val data = settings.await().data
        val o = PrintOpts.from(data["print"] as? JsonObject)
        val partyBal = if (o.partyBal && v.kind == "invoice") v.party?.id?.let { id -> runCatching { api.party(id).balance.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString() }.getOrNull() } else null
        val s = shop.await()
        fun str(k: String) = (data[k] as? JsonPrimitive)?.contentOrNull ?: ""
        fun flag(k: String) = (data[k] as? JsonPrimitive)?.booleanOrNull
        val labels = (itemOptions?.get("labels") as? JsonObject).orEmpty().mapNotNull { (k, x) -> (x as? JsonPrimitive)?.contentOrNull?.let { k to it } }.toMap()
        val d = fromSale(
            v,
            DocOpts(
                batches = "batch_no" in features, mrp = "mrp" in features, upi = str("upi"), partyBalance = partyBal,
                // Settings › Transactions (the web's txnOpts)
                showNo = flag("txnInvNo") != false, time = flag("txnTime") == true, billName = flag("txnBillName") == true,
                words = labels, expFormat = (itemOptions?.get("expFormat") as? JsonPrimitive)?.contentOrNull ?: "month",
                hideCols = listOf("category" to "cat", "brand" to "brand", "series" to "series").filter { "no_${it.first}" in features }.map { it.second },
                showCurrency = flag("showCurrency") == true,
            ),
        )
        val biz = Biz(s.name, s.phone.orEmpty(), s.address.orEmpty(), s.city.orEmpty(), s.pin.orEmpty(), s.stateCode.orEmpty(), s.gstin.orEmpty(), s.email.orEmpty())
        val title = "${docTitle(d, o)} ${d.number}".replace(Regex("""[\\/:*?"<>|]+"""), "-").replace(Regex("""\s+"""), " ").trim()
        val file = withContext(Dispatchers.Default) { val f = Fonts(ctx); write(ctx, paperPages(d, o, biz, f.ink), title, f) }
        Made(file, title, v, s.name.ifBlank { "My Business" }, o.paper)
    }

    private fun write(ctx: Context, pages: List<Page>, title: String, f: Fonts): File {
        val dir = File(ctx.cacheDir, "pdf").apply { mkdirs() }
        // only the newest few bills are kept
        dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(10)?.forEach { it.delete() }
        val out = File(dir, "$title.pdf")
        val pdf = PdfDocument()
        val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        try {
            pages.forEachIndexed { n, p ->
                val page = pdf.startPage(PdfDocument.PageInfo.Builder(Math.round(p.w * PT), Math.round(p.h * PT), n + 1).create())
                val cv = page.canvas
                cv.scale(PT, PT)
                for (op in p.ops) when (op) {
                    is TextOp -> {
                        val paint = f.paint(op.px, op.w).apply { color = op.argb; letterSpacing = op.spacing / op.px }
                        cv.drawText(op.s, op.x, op.y, paint)
                    }
                    is LineOp -> { line.color = op.argb; line.strokeWidth = op.w; cv.drawLine(op.x1, op.y1, op.x2, op.y2, line) }
                    is FrameOp -> { line.color = op.argb; line.strokeWidth = op.stroke; cv.drawRoundRect(RectF(op.x, op.y, op.x + op.w, op.y + op.h), op.r, op.r, line) }
                    is FillOp -> {
                        fill.color = op.argb
                        fill.shader = op.to?.let { LinearGradient(op.x, op.y, op.x + op.w, op.y + op.h, op.argb, it, Shader.TileMode.CLAMP) }
                        cv.drawRoundRect(RectF(op.x, op.y, op.x + op.w, op.y + op.h), op.r, op.r, fill)
                    }
                }
                pdf.finishPage(page)
            }
            FileOutputStream(out).use { pdf.writeTo(it) }
        } finally { pdf.close() }
        return out
    }

    /** The web's WhatsApp message for this bill. */
    fun message(m: Made): String {
        val v = m.doc
        // a delivery challan is shared as the PDF alone (the web has no message for it)
        if (v.kind == "challan") return ""
        val bal = PFmt.dec(v.balance)
        val total = Format.inr(v.total)
        return if (v.kind == "quotation") "Hello ${v.partyName}, here is our quotation ${v.number} dated ${PFmt.dmy(v.date)} for ₹$total${if (!v.dueDate.isNullOrBlank()) ", valid till ${PFmt.dmy(v.dueDate)}" else ""}. — ${m.shop}"
        else "Hello ${v.partyName}, here is your invoice ${v.number} dated ${PFmt.dmy(v.date)} from ${m.shop}. Total ₹$total" +
            (if (bal.signum() > 0) ", balance due ₹${Format.inr(bal)}${if (v.mode == "credit" && !v.dueDate.isNullOrBlank()) " by " + PFmt.dmy(v.dueDate) else ""}" else ", fully paid") + ". Thank you!"
    }

    private fun send(ctx: Context, m: Made): Intent {
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", m.file)
        return Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            message(m).takeIf { it.isNotEmpty() }?.let { putExtra(Intent.EXTRA_TEXT, it) }
            putExtra(Intent.EXTRA_SUBJECT, m.title)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    /** WhatsApp with the PDF and the message (WhatsApp Business when only that is on the phone); otherwise Share. Returns false when neither opened. */
    fun whatsApp(ctx: Context, m: Made): Boolean {
        for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
            try { ctx.startActivity(send(ctx, m).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return true } catch (_: ActivityNotFoundException) {}
        }
        return share(ctx, m, ctx.getString(R.string.pdf_no_wa))
    }

    /** Android's Share: Gmail, Drive, print apps and others. */
    fun share(ctx: Context, m: Made, title: String = m.title): Boolean = try {
        ctx.startActivity(Intent.createChooser(send(ctx, m), title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
    } catch (_: ActivityNotFoundException) { false }

    /** The phone's print screen, with this PDF on the shop's paper size. */
    fun print(ctx: Context, m: Made) {
        val pm = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
        val media = if (m.paper == "A5") PrintAttributes.MediaSize.ISO_A5 else PrintAttributes.MediaSize.ISO_A4
        pm.print(m.title, FileAdapter(m.file, m.title), PrintAttributes.Builder().setMediaSize(media).build())
    }

    private class FileAdapter(val f: File, val name: String) : PrintDocumentAdapter() {
        override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, cancel: CancellationSignal?, cb: LayoutResultCallback, extras: Bundle?) {
            if (cancel?.isCanceled == true) { cb.onLayoutCancelled(); return }
            cb.onLayoutFinished(PrintDocumentInfo.Builder("$name.pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true)
        }

        override fun onWrite(pages: Array<out PageRange>?, dest: ParcelFileDescriptor, cancel: CancellationSignal?, cb: WriteResultCallback) {
            try {
                f.inputStream().use { i -> FileOutputStream(dest.fileDescriptor).use { i.copyTo(it) } }
                cb.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
            } catch (e: Exception) { cb.onWriteFailed(e.message) }
        }
    }
}
