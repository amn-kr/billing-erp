package billingo.app.ui.print

import billingo.app.data.DocBatch
import billingo.app.data.SaleDoc
import billingo.app.ui.parts.Format
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.math.BigDecimal
import java.math.RoundingMode

/** The shop at the top of the invoice (GET /businesses/current). */
data class Biz(val name: String = "", val phone: String = "", val address: String = "", val city: String = "", val pin: String = "", val stateCode: String = "", val gstin: String = "", val email: String = "")

/** One line, ready to print (the web's PLine). */
data class PLine(
    val batch: String, val name: String, val code: String, val hsn: String, val brand: String, val series: String, val cat: String, val grp: String,
    val qty: String, val unit: String, val mrp: String?, val list: String?, val whole: String?, val price: String, val discPct: String, val gst: String,
    val taxable: String, val tax: String, val amount: String,
)

/** One document, ready to print (the web's PDoc), for invoices and quotations. */
data class PDoc(
    val kind: String, val number: String, val date: String, val dueDate: String?, val mode: String, val taxMode: String, val placeOfSupply: String, val cancelled: Boolean,
    val partyName: String, val partyCity: String, val partyPhone: String, val partyGstin: String,
    /** printed references (Challan No., PO, transport, …) */
    val refs: List<Pair<String, String>>, val description: String, val notes: String,
    val lines: List<PLine>,
    val billDiscount: String, val taxable: String, val cgst: String, val sgst: String, val igst: String, val tcs: String, val transport: String, val labour: String, val bankCharge: String,
    val roundAmount: String, val total: String, val words: String,
    val received: String, val payMode: String, val balance: String, val partyBalance: String?, val upi: String,
    val hideNo: Boolean = false, val time: String = "", val mrpWord: String? = null, val hideCols: List<String> = emptyList(),
    /** Settings › General › Show ₹ symbol */
    val showCurrency: Boolean = false,
)

/** What the web's fromSale gets besides the bill: Settings › Items and Transactions, the UPI ID, the party's balance. */
data class DocOpts(
    val batches: Boolean = false, val mrp: Boolean = false, val upi: String = "", val partyBalance: String? = null,
    val showNo: Boolean = true, val time: Boolean = false, val billName: Boolean = false,
    /** Settings › Items: the owner's own words for Batch, Exp, MRP, and the expiry date format */
    val words: Map<String, String> = emptyMap(), val expFormat: String = "month",
    /** columns of boxes turned off in Settings › Items (cat, brand, series) */
    val hideCols: List<String> = emptyList(),
    val showCurrency: Boolean = false,
)

/** GST state codes, as the web lists them (packages/shared/src/india.ts). */
val STATES = listOf(
    "01" to "Jammu & Kashmir", "02" to "Himachal Pradesh", "03" to "Punjab", "04" to "Chandigarh", "05" to "Uttarakhand",
    "06" to "Haryana", "07" to "Delhi", "08" to "Rajasthan", "09" to "Uttar Pradesh", "10" to "Bihar", "11" to "Sikkim",
    "12" to "Arunachal Pradesh", "13" to "Nagaland", "14" to "Manipur", "15" to "Mizoram", "16" to "Tripura", "17" to "Meghalaya",
    "18" to "Assam", "19" to "West Bengal", "20" to "Jharkhand", "21" to "Odisha", "22" to "Chhattisgarh", "23" to "Madhya Pradesh",
    "24" to "Gujarat", "26" to "Dadra & Nagar Haveli and Daman & Diu", "27" to "Maharashtra", "29" to "Karnataka", "30" to "Goa",
    "31" to "Lakshadweep", "32" to "Kerala", "33" to "Tamil Nadu", "34" to "Puducherry", "35" to "Andaman & Nicobar",
    "36" to "Telangana", "37" to "Andhra Pradesh", "38" to "Ladakh",
)

fun stateName(code: String) = STATES.firstOrNull { it.first == code }?.second ?: ""

/** Numbers as the web prints them. */
object PFmt {
    fun dec(v: String?): BigDecimal = v?.trim()?.takeIf { it.isNotEmpty() }?.let { runCatching { BigDecimal(it) }.getOrNull() } ?: BigDecimal.ZERO

    /** dd/mm/yyyy (the web's dmy, used on the printed invoice) */
    fun dmy(iso: String?): String = if (iso.isNullOrBlank()) "" else iso.take(10).split("-").let { "${it[2]}/${it[1]}/${it[0]}" }

    /** the web's qfmt: Indian grouping, at most 2 decimals */
    fun qty(v: String?): String {
        val r = dec(v).setScale(2, RoundingMode.HALF_UP).stripTrailingZeros()
        return Format.qty(if (r.scale() < 0) r.setScale(0).toPlainString() else r.toPlainString())
    }

    /** the web's formatQty (batches): 2 decimals, a trailing zero dropped */
    fun bqty(v: String?): String {
        val r = dec(v).setScale(2, RoundingMode.HALF_UP)
        val s = if (r.stripTrailingZeros().scale() <= 0) r.setScale(0).toPlainString() else r.toPlainString().removeSuffix("0")
        val neg = s.startsWith("-")
        val b = s.removePrefix("-")
        return (if (neg) "-" else "") + Format.group(b.substringBefore('.')) + (if (b.contains('.')) "." + b.substringAfter('.') else "")
    }

    /** "18%", "2.5%" (the web's pct) */
    fun pct(v: String?): String = qty(v) + "%"

    /** Math.round(n × 100) / 100 */
    fun r2(v: BigDecimal): BigDecimal = v.setScale(2, RoundingMode.HALF_UP)

    /** money with Indian grouping (inr2f), or plain 2 decimals when grouping is off */
    fun money(v: BigDecimal, grouping: Boolean): String = if (grouping) Format.inr(v) else v.setScale(2, RoundingMode.HALF_UP).toPlainString()
    fun money(v: String?, grouping: Boolean): String = money(dec(v), grouping)

    /** "4:35 pm", India time (the web's timeIst) */
    fun timeIst(at: String): String {
        // "2026-11-21T08:05:13.123Z" (Android 7 has no java.time)
        val f = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
        val t = runCatching { f.parse(at.take(19)) }.getOrNull() ?: return ""
        val c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Kolkata")).apply { time = t }
        val hour = c.get(java.util.Calendar.HOUR_OF_DAY)
        val h = hour % 12
        return "${if (h == 0) 12 else h}:${c.get(java.util.Calendar.MINUTE).toString().padStart(2, '0')} ${if (hour < 12) "am" else "pm"}"
    }
}

private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** "Batch A123 × 3 (Exp 03/2040, MRP 120.00), No batch × 1" (the web's batchPrintLine); nothing when no batch is named. */
fun batchPrintLine(list: List<DocBatch>, withMrp: Boolean, unit: String?, o: DocOpts): String {
    fun word(k: String, usual: String) = o.words[k] ?: usual
    val named = list.filter { it.batchId != null }
    val none = list.filter { it.batchId == null }
    if (named.isEmpty()) return ""
    fun date(d: String): String = when (o.expFormat) {
        "month" -> "${d.substring(5, 7)}/${d.substring(0, 4)}"
        "mm/yy" -> "${d.substring(5, 7)}/${d.substring(2, 4)}"
        "dd/mm/yy" -> "${d.substring(8, 10)}/${d.substring(5, 7)}/${d.substring(2, 4)}"
        else -> "${MONTHS[d.substring(5, 7).toInt() - 1]} ${d.substring(0, 4)}"
    }
    fun text(b: DocBatch): String {
        val notes = listOfNotNull(
            b.expiry?.takeIf { it.isNotBlank() }?.let { "${word("exp", "Exp")} ${date(it)}" },
            if (withMrp && !b.mrp.isNullOrBlank()) "${word("mrp", "MRP")} ${PFmt.dec(b.mrp).setScale(2, RoundingMode.HALF_UP).toPlainString()}" else null,
        )
        return "${b.no} × ${PFmt.bqty(b.qty)}${if (!unit.isNullOrBlank()) " $unit" else ""}${if (notes.isNotEmpty()) " (${notes.joinToString(", ")})" else ""}"
    }
    return "${word("batch", "Batch")} ${(named + none).joinToString(", ") { text(it) }}"
}

/** A saved bill (GET /sales/:id) → a document to print: the web's fromSale, step for step. */
fun fromSale(v: SaleDoc, o: DocOpts = DocOpts()): PDoc {
    val x = v.extra ?: JsonObject(emptyMap())
    fun s(k: String) = (x[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: ""
    val qs = (x["quoteRefs"] as? JsonArray).orEmpty().mapNotNull { e ->
        val q = e as? JsonObject ?: return@mapNotNull null
        ((q["no"] as? JsonPrimitive)?.contentOrNull ?: "") to ((q["date"] as? JsonPrimitive)?.contentOrNull ?: "")
    }
    val g = v.taxMode == "gst"
    // like the web, the invoice shows the money taken with it (later payments are on the receipts)
    val atSale = PFmt.dec(v.payment?.amount)
    val total = PFmt.dec(v.total)
    val recv = if (atSale > total) total else atSale
    val bal = total - recv
    val billTo = o.billName && v.billName.isNotBlank()
    val refs = listOf(
        "Billing name" to (if (billTo) "" else v.billName), "Challan no." to s("challanNo"),
        "PO / estimate" to (if (s("poNo").isNotEmpty()) s("poNo") + (if (s("poDate").isNotEmpty()) " · " + PFmt.dmy(s("poDate")) else "") else ""),
        "Quotation" to qs.joinToString(", ") { (n, d) -> n + (if (d.isNotEmpty()) " (" + PFmt.dmy(d) + ")" else "") },
        "E-way bill" to (if (g) s("ewb") else ""), "Transport" to s("transport"), "Vehicle / bilty" to s("vehicle"),
        "Delivery date" to (if (s("deliveryDate").isNotEmpty()) PFmt.dmy(s("deliveryDate")) else ""),
    ).filter { it.second.isNotEmpty() }
    return PDoc(
        mrpWord = o.words["mrp"], hideCols = o.hideCols, showCurrency = o.showCurrency,
        kind = v.kind, number = v.number, date = v.date, dueDate = v.dueDate, mode = v.mode, taxMode = v.taxMode, placeOfSupply = v.placeOfSupply, cancelled = v.cancelled,
        partyName = if (billTo) v.billName else v.partyName, partyCity = v.party?.city ?: "", partyPhone = v.party?.phone?.takeIf { it.isNotBlank() } ?: v.cashPhone, partyGstin = v.party?.gstin ?: "",
        refs = refs, description = s("description"), notes = v.notes,
        hideNo = !o.showNo, time = if (o.time && v.savedAt != null && !v.legacy) PFmt.timeIst(v.savedAt) else "",
        lines = v.lines.map { l ->
            // a batch's MRP is per pack; on a line sold loose the MRP is the loose unit's
            val batchMrps = l.batches.map { b -> if (b.mrp != null && l.looseOf != null) PFmt.r2(PFmt.dec(b.mrp).divide(PFmt.dec(l.looseOf), 20, RoundingMode.HALF_UP)).toPlainString() else b.mrp }
            PLine(
                batch = if (o.batches) batchPrintLine(l.batches, o.mrp, l.batchUnit.ifBlank { null }, o) else "",
                name = if (l.group.isNotBlank() && l.brand.isNotBlank()) l.group else l.name, code = l.code, hsn = l.hsn, brand = l.brand, series = l.series, cat = l.category, grp = l.group,
                qty = l.qty, unit = l.unit,
                mrp = if (o.mrp && l.batches.isNotEmpty()) effectiveMrp(l.mrp, batchMrps)?.setScale(2, RoundingMode.HALF_UP)?.toPlainString() else l.mrp,
                list = l.listPrice, whole = l.wholesalePrice, price = l.price, discPct = l.discPct, gst = l.gstRate, taxable = l.taxable, tax = l.tax, amount = l.amount,
            )
        },
        billDiscount = v.billDiscount, taxable = v.taxable, cgst = v.cgst, sgst = v.sgst, igst = v.igst, tcs = v.tcs, transport = v.transport, labour = v.labour, bankCharge = v.bankCharge,
        roundAmount = v.roundAmount, total = v.total, words = v.words,
        received = recv.setScale(2, RoundingMode.HALF_UP).toPlainString(), payMode = if (recv.signum() > 0) v.payment?.mode ?: "" else "",
        balance = (if (bal.signum() < 0) BigDecimal.ZERO else bal).setScale(2, RoundingMode.HALF_UP).toPlainString(), partyBalance = o.partyBalance, upi = o.upi,
    )
}

/** The lowest MRP of the stock a line uses: a batch's own, else the item's (the web's effectiveMrp). */
fun effectiveMrp(itemMrp: String?, batchMrps: List<String?>): BigDecimal? {
    fun positive(v: String?) = !v.isNullOrBlank() && PFmt.dec(v).signum() > 0
    val list = (if (batchMrps.isNotEmpty()) batchMrps.map { if (positive(it)) it else itemMrp } else listOf(itemMrp)).filter(::positive).map { PFmt.dec(it) }
    return list.minOrNull()
}

/** The printed name of a document (Change Transaction Names). */
fun docTitle(d: PDoc, o: PrintOpts): String {
    fun n(k: String, def: String) = (o.names[k] ?: "").trim().ifEmpty { def }
    if (d.kind == "quotation") return n("estimate", "Quotation")
    if (d.taxMode == "bos" || (d.taxMode == "none" && o.bos)) return "Bill of Supply"
    return n("sale", if (d.taxMode == "gst") "Tax Invoice" else "Bill")
}

private val COPY = listOf("orig" to "Original for recipient", "dup" to "Duplicate for transporter", "trip" to "Triplicate for supplier")
fun copiesOf(o: PrintOpts): List<String> = COPY.filter { o.copies[it.first] == true }.map { it.second }

fun upiOk(v: String) = Regex("""^[\w.\-]{2,}@[a-zA-Z][\w.\-]{1,}$""").matches(v.trim())

/** One printed column: its key, heading, right-aligned (numbers), and its text for a line. */
class PCol(val key: String, val label: String, val n: Boolean, val v: (PLine, Int) -> String)

/** print order of the columns */
private val ORDER = listOf("sl", "name", "code", "brand", "series", "cat", "grp", "hsn", "qty", "unit", "mrp", "list", "whole", "price", "discAmt", "discPct", "txPrice", "taxable", "taxPct", "taxAmt", "rate", "amount")

/** The item table's columns for this document (the web's columns). */
fun columns(d: PDoc, o: PrintOpts): List<PCol> {
    val g = d.taxMode == "gst"
    val m = { v: BigDecimal -> PFmt.money(v, o.grouping) }
    val dec = PFmt::dec
    // a final rate above the sale price is saved as a minus discount: never printed as a discount
    val anyDisc = d.lines.any { dec(it.discPct).signum() > 0 }
    val unitOn = o.cols["unit"]?.on == true
    val defs = Opts.COLDEF.associateBy { it.key }
    fun q(l: PLine) = dec(l.qty).let { if (it.signum() == 0) BigDecimal.ONE else it }
    fun per(a: String, l: PLine) = PFmt.r2(dec(a).divide(q(l), 20, RoundingMode.HALF_UP))
    fun pos(v: String?) = if (dec(v).signum() != 0) m(dec(v)) else ""
    fun value(k: String): (PLine, Int) -> String = { l, i ->
        when (k) {
            "sl" -> (i + 1).toString(); "name" -> l.name; "code" -> l.code; "hsn" -> l.hsn; "brand" -> l.brand; "series" -> l.series; "cat" -> l.cat; "grp" -> l.grp
            "mrp" -> pos(l.mrp); "list" -> pos(l.list); "whole" -> pos(l.whole)
            // no Unit column: the unit goes with the quantity ("66 PCS")
            "qty" -> if (unitOn) PFmt.qty(l.qty) else "${PFmt.qty(l.qty)} ${l.unit}"
            "unit" -> l.unit; "price" -> m(dec(l.price))
            "discAmt" -> if (dec(l.discPct).signum() > 0) m(PFmt.r2(dec(l.qty) * dec(l.price) * dec(l.discPct) / BigDecimal(100))) else ""
            "discPct" -> if (dec(l.discPct).signum() > 0) PFmt.qty(l.discPct) + "%" else ""
            "txPrice" -> m(per(l.taxable, l)); "taxable" -> m(dec(l.taxable)); "taxPct" -> PFmt.pct(l.gst); "taxAmt" -> m(dec(l.tax))
            "rate" -> m(per(l.amount, l)); else -> m(dec(l.amount))
        }
    }
    return ORDER.filter { k ->
        val x = defs.getValue(k)
        (o.cols[k]?.on == true) && !(x.gst && !g) && !(x.disc && !anyDisc)
    }.filter { it !in d.hideCols }.map { k ->
        val label = o.cols[k]?.label ?: ""
        PCol(k, if (k == "mrp" && label == "MRP" && d.mrpWord != null) d.mrpWord else label, defs.getValue(k).n, value(k))
    }
}
