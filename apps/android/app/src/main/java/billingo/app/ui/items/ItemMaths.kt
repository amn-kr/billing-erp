package billingo.app.ui.items

import billingo.app.data.ItemFull
import billingo.app.data.Movement
import java.math.BigDecimal
import java.math.RoundingMode

/** What the Items screens work out from the server's lists (design 7.4c), kept apart so it can be tested. */
object ItemMaths {
    enum class Kind { All, Products, Services }
    enum class Status { All, In, Low, Out }

    fun isService(i: ItemFull) = i.kind == "service"

    /** In stock, low (below its minimum) or out (none left); the server works this out as "level". */
    fun status(i: ItemFull): Status = when {
        isService(i) -> Status.All
        i.level == "out" || i.stock.signum() <= 0 -> Status.Out
        i.level == "low" -> Status.Low
        else -> Status.In
    }

    /** Stock Value (what is left at its purchase rate), how many items are low and how many are out. */
    data class Totals(val value: BigDecimal, val low: Int, val out: Int)

    fun totals(all: List<ItemFull>): Totals {
        var v = BigDecimal.ZERO; var low = 0; var out = 0
        for (i in all) if (!isService(i)) {
            v += i.value
            when (status(i)) { Status.Low -> low++; Status.Out -> out++; else -> {} }
        }
        return Totals(v, low, out)
    }

    fun matches(i: ItemFull, kind: Kind, st: Status, brand: String, query: String): Boolean {
        if (kind == Kind.Products && isService(i)) return false
        if (kind == Kind.Services && !isService(i)) return false
        if (st != Status.All && (isService(i) || status(i) != st)) return false
        if (brand.isNotEmpty() && !i.brand.equals(brand, ignoreCase = true)) return false
        val q = query.trim().lowercase()
        return q.isEmpty() || "${i.name} ${i.brand} ${i.series} ${i.code}".lowercase().contains(q)
    }

    /** A line of the list: one item, or one name with its brands or variants under it. */
    sealed interface Entry {
        data class One(val item: ItemFull) : Entry
        /** [members]: the ones shown; [all]: every item of the group */
        data class Group(val name: String, val members: List<ItemFull>, val byBrand: Boolean, val all: List<ItemFull> = members) : Entry
    }

    /**
     * Items in the same group are shown under one line when the group has more than one item
     * (as on the web); "Brands" when every one has its own brand, otherwise "Variants".
     */
    fun entries(shown: List<ItemFull>, all: List<ItemFull>): List<Entry> {
        val out = mutableListOf<Entry>()
        val seen = mutableSetOf<String>()
        for (i in shown) {
            val g = i.group
            val members = if (g.isBlank()) emptyList() else all.filter { it.group == g }
            if (members.size <= 1) { out += Entry.One(i); continue }
            if (!seen.add(g)) continue
            val inList = shown.filter { it.group == g }
            val byBrand = members.all { it.brand.isNotBlank() } && members.map { it.brand.lowercase() }.toSet().size == members.size
            out += Entry.Group(g, inList, byBrand, members)
        }
        return out
    }

    /** A variant's own name: its brand and series ("Anchor Roma"), or its full name. */
    fun variantName(i: ItemFull): String = "${i.brand} ${i.series}".trim().ifBlank { i.name }

    /** Sale minus purchase, and that as a share of the purchase price (one decimal). */
    fun margin(sale: BigDecimal, purchase: BigDecimal): Pair<BigDecimal, BigDecimal> {
        val m = sale - purchase
        val pct = if (purchase.signum() == 0) BigDecimal.ZERO else m.multiply(BigDecimal(100)).divide(purchase, 1, RoundingMode.HALF_UP)
        return m to pct
    }

    /** The item page's filter chips: All / Sale / Buy / Adjust. */
    enum class Filter { All, Sale, Buy, Adjust }

    fun inFilter(m: Movement, f: Filter) = when (f) {
        Filter.All -> true
        Filter.Sale -> m.sourceType == "sales_document"
        Filter.Buy -> m.sourceType == "purchase_document"
        Filter.Adjust -> m.sourceType == "stock_adjustment"
    }

    /** What a stock movement is, in the design's words (the screen turns it into English or Hindi). */
    enum class Word { Sale, Return, Purchase, PurchaseReturn, Cancelled, Adjustment, Transfer, Opening, Challan }

    fun word(m: Movement): Word = when (m.sourceType) {
        "sales_document" -> when {
            m.kind == "cancel" -> Word.Cancelled
            m.kind == "return" -> Word.Return
            m.ref.startsWith("CH", ignoreCase = true) || m.kind == "challan" -> Word.Challan
            else -> Word.Sale
        }
        "purchase_document" -> when (m.kind) {
            "cancel" -> Word.Cancelled
            "return", "debit_note" -> Word.PurchaseReturn
            else -> Word.Purchase
        }
        "stock_adjustment" -> Word.Adjustment
        "stock_transfer" -> Word.Transfer
        else -> Word.Opening
    }

    /** Stock after an adjustment. */
    fun after(stock: BigDecimal, qty: String, add: Boolean): BigDecimal {
        val q = qty.replace(",", "").trim().toBigDecimalOrNull() ?: BigDecimal.ZERO
        return if (add) stock + q else stock - q
    }
}
