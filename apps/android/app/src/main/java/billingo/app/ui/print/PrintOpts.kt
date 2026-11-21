package billingo.app.ui.print

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Settings › Print And Invoice, as the web keeps it (BusinessSettings.data.print): a copy of
 * apps/web/src/features/print/opts.ts. Anything missing or not understood falls back to the
 * web's default, so the phone's PDF follows exactly the same choices as the web's printed invoice.
 */
object Opts {
    val NAME_PX = mapOf("s" to 16f, "m" to 20f, "l" to 24f, "xl" to 28f)
    val TEXT_PX = mapOf("s" to 11f, "m" to 12f, "l" to 13.5f)
    val MARGIN_PX = mapOf("narrow" to 18f, "normal" to 30f, "wide" to 48f)
    /** paper in CSS px (96 dpi), portrait */
    val PAPER = mapOf("A4" to (794f to 1123f), "A5" to (559f to 794f))

    /** Item Table Customisation: key, default heading, on by default, flags (the web's COLDEF). */
    class ColDef(val key: String, val label: String, val on: Boolean, val lock: Boolean = false, val n: Boolean = false, val gst: Boolean = false, val disc: Boolean = false, val money: Boolean = false)

    val COLDEF = listOf(
        ColDef("sl", "#", true), ColDef("name", "Item Name", true, lock = true), ColDef("code", "Item Code", false), ColDef("hsn", "HSN/SAC", false, gst = true),
        ColDef("brand", "Brand", false), ColDef("series", "Series", false), ColDef("cat", "Category", false), ColDef("grp", "Item group", false),
        ColDef("mrp", "MRP", false, n = true, money = true), ColDef("list", "List price", false, n = true, money = true), ColDef("whole", "Wholesale price", false, n = true, money = true),
        ColDef("qty", "Billed Qty", true, n = true), ColDef("unit", "Unit", true, n = true), ColDef("price", "Price/Unit", false, n = true, money = true),
        ColDef("discAmt", "Discount", false, n = true, disc = true, money = true), ColDef("discPct", "Disc %", false, n = true, disc = true, money = true),
        ColDef("txPrice", "Taxable Price/Unit", false, n = true, money = true), ColDef("taxAmt", "Tax Amount", false, n = true, gst = true, money = true), ColDef("taxPct", "Tax %", false, n = true, gst = true, money = true),
        ColDef("taxable", "Taxable Amount", false, n = true, money = true), ColDef("rate", "Final Rate", true, n = true, money = true), ColDef("amount", "Amount", true, n = true, lock = true, money = true),
    )
    val TOP = listOf("title", "biz", "bill")
    val BOT = listOf("bank", "terms", "sign")
}

data class Col(val on: Boolean, val label: String)

/** The shop's print choices (the web's PrintOpts). */
data class PrintOpts(
    val theme: String = "classic",
    val color: String = "#6b7280",
    val showName: Boolean = true,
    val showAddr: Boolean = true,
    val showEmail: Boolean = true,
    val showPhone: Boolean = true,
    val firm: String = "",
    val paper: String = "A4",
    val landscape: Boolean = false,
    val nameSize: String = "m",
    val textSize: String = "m",
    val cols: Map<String, Col> = Opts.COLDEF.associate { it.key to Col(it.on, it.label) },
    val names: Map<String, String> = emptyMap(),
    val bos: Boolean = false,
    val top: List<String> = Opts.TOP,
    val bot: List<String> = Opts.BOT,
    val hide: List<String> = emptyList(),
    val margin: String = "normal",
    val area: String = "fill",
    val minRows: String = "10",
    val totalQty: Boolean = true,
    val received: Boolean = true,
    val balance: Boolean = true,
    val partyBal: Boolean = false,
    val taxTable: Boolean = true,
    val saved: Boolean = false,
    val words: Boolean = true,
    val grouping: Boolean = true,
    val description: Boolean = true,
    val terms: String = "",
    val sign: String = "Authorized Signatory",
    val payMode: Boolean = true,
    val copies: Map<String, Boolean> = mapOf("orig" to true, "dup" to false, "trip" to false),
) {
    /** paper width and height in CSS px */
    val size: Pair<Float, Float> get() {
        val p = Opts.PAPER[paper] ?: Opts.PAPER.getValue("A4")
        return if (landscape) p.second to p.first else p
    }

    /**
     * The height the web's paper fills when printed: its page is 1 mm shorter than the sheet
     * (print.css: min-height (297 − 1) mm on A4), so the foot sits a little above the sheet's edge.
     */
    val printHeight: Float get() {
        val mm = when (paper) { "A5" -> 148f to 210f; else -> 210f to 297f }
        return ((if (landscape) mm.first else mm.second) - 1f) * 96f / 25.4f
    }

    companion object {
        /** the saved choices on top of the defaults (the web's mergePrint) */
        fun from(saved: JsonObject?): PrintOpts {
            val d = PrintOpts()
            val s = saved ?: return d
            fun str(k: String, def: String) = (s[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: def
            fun bool(k: String, def: Boolean) = (s[k] as? JsonPrimitive)?.booleanOrNull ?: def
            fun pick(k: String, def: String, all: Set<String>) = str(k, def).takeIf { it in all } ?: def
            fun keep(k: String, all: List<String>): List<String> {
                val l = (s[k] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.filter { it in all }.distinct()
                return l + all.filter { it !in l }
            }
            val savedCols = s["cols"] as? JsonObject
            val cols = Opts.COLDEF.associate { c ->
                val o = savedCols?.get(c.key) as? JsonObject
                c.key to if (o == null) Col(c.on, c.label) else Col(
                    if (c.lock) true else (o["on"] as? JsonPrimitive)?.booleanOrNull ?: false,
                    (o["label"] as? JsonPrimitive)?.contentOrNull ?: "",
                )
            }
            val names = (s["names"] as? JsonObject).orEmpty().mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { k to it } }.toMap()
            val cp = s["copies"] as? JsonObject
            fun copy(k: String) = (cp?.get(k) as? JsonPrimitive)?.booleanOrNull ?: d.copies.getValue(k)
            return PrintOpts(
                theme = str("theme", d.theme), color = str("color", d.color),
                showName = bool("showName", d.showName), showAddr = bool("showAddr", d.showAddr), showEmail = bool("showEmail", d.showEmail), showPhone = bool("showPhone", d.showPhone),
                firm = str("firm", d.firm), paper = pick("paper", d.paper, Opts.PAPER.keys), landscape = bool("landscape", d.landscape),
                nameSize = pick("nameSize", d.nameSize, Opts.NAME_PX.keys), textSize = pick("textSize", d.textSize, Opts.TEXT_PX.keys),
                cols = cols, names = names, bos = bool("bos", d.bos), top = keep("top", Opts.TOP), bot = keep("bot", Opts.BOT),
                hide = (s["hide"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content },
                margin = pick("margin", d.margin, Opts.MARGIN_PX.keys), area = pick("area", d.area, setOf("auto", "fill", "min")), minRows = str("minRows", d.minRows),
                totalQty = bool("totalQty", d.totalQty), received = bool("received", d.received), balance = bool("balance", d.balance), partyBal = bool("partyBal", d.partyBal),
                taxTable = bool("taxTable", d.taxTable), saved = bool("saved", d.saved), words = bool("words", d.words), grouping = bool("grouping", d.grouping),
                description = bool("description", d.description), terms = str("terms", d.terms), sign = str("sign", d.sign), payMode = bool("payMode", d.payMode),
                copies = mapOf("orig" to copy("orig"), "dup" to copy("dup"), "trip" to copy("trip")),
            )
        }
    }
}
