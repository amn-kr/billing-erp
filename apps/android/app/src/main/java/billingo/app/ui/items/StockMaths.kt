package billingo.app.ui.items

import billingo.app.data.AdjustmentRow
import billingo.app.data.ItemFull
import java.math.BigDecimal
import java.math.RoundingMode

/** What the 8.4c screens work out (Price Manager, Transfer Stock, Stock Adjustments), kept apart so it can be tested. */
object StockMaths {
    /** Which price Price Setup changes; [field] is the server's name for it. */
    enum class Which(val field: String) { Sale("sale"), Purchase("purchase"), Mrp("mrp") }

    fun price(i: ItemFull, w: Which): BigDecimal = when (w) { Which.Sale -> i.sale; Which.Purchase -> i.purchase; Which.Mrp -> i.mrp }

    data class Change(val item: ItemFull, val old: BigDecimal, val new: BigDecimal)

    /**
     * Price Setup (design 7.4c): raise or lower the chosen price of the ticked items by a % or by
     * rupees; the new price is rounded to the nearest rupee and never below 0. An item with no MRP
     * keeps none; prices that would not change are left out.
     */
    fun changes(items: List<ItemFull>, w: Which, up: Boolean, percent: Boolean, howMuch: String): List<Change> {
        val v = howMuch.replace(",", "").trim().toBigDecimalOrNull() ?: return emptyList()
        if (v.signum() <= 0) return emptyList()
        return items.mapNotNull { i ->
            val old = price(i, w)
            if (w == Which.Mrp && old.signum() == 0) return@mapNotNull null
            val by = if (percent) (old * v).movePointLeft(2) else v
            val raw = if (up) old + by else old - by
            val new = raw.max(BigDecimal.ZERO).setScale(0, RoundingMode.HALF_UP)
            if (new.compareTo(old) == 0) null else Change(i, old, new)
        }
    }

    /** Price View and Price Setup list products only, active ones, by search (name or code) and brand. */
    fun priced(all: List<ItemFull>, query: String, brand: String): List<ItemFull> {
        val q = query.trim().lowercase()
        return all.filter { i ->
            !ItemMaths.isService(i) && !i.archived &&
                (brand.isEmpty() || i.brand.equals(brand, ignoreCase = true)) &&
                (q.isEmpty() || "${i.name} ${i.code}".lowercase().contains(q))
        }.sortedBy { it.name.lowercase() }
    }

    enum class TransferProblem { SameGodown, NoQuantity, NotEnough }

    /** Transfer Stock: From and To differ, a quantity is typed, and the From godown has that much. */
    fun transferProblem(fromId: String, toId: String, qty: String, have: BigDecimal): TransferProblem? {
        if (fromId == toId) return TransferProblem.SameGodown
        val q = qty.replace(",", "").trim().toBigDecimalOrNull()
        if (q == null || q.signum() <= 0) return TransferProblem.NoQuantity
        if (q > have) return TransferProblem.NotEnough
        return null
    }

    /** Stock Adjustments: the value added, reduced, and the net effect, of the ones not cancelled. */
    data class AdjTotals(val added: BigDecimal, val reduced: BigDecimal) { val net: BigDecimal get() = added - reduced }

    fun adjTotals(rows: List<AdjustmentRow>): AdjTotals {
        var a = BigDecimal.ZERO; var r = BigDecimal.ZERO
        for (x in rows) if (!x.cancelled) { if (x.qty.signum() > 0) a += x.value else r += x.value }
        return AdjTotals(a, r)
    }

    /**
     * The day in India of a server time ("2026-11-16T20:15:00.000Z" → "2026-11-17"), so a change
     * made late in the evening shows the shop's date, not London's.
     */
    fun indiaDay(at: String): String {
        if (at.length < 19 || at[10] != 'T') return at.take(10)
        val f = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
        val t = f.parse(at.take(19)) ?: return at.take(10)
        return java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("Asia/Kolkata") }.format(t)
    }

    fun adjMatches(a: AdjustmentRow, query: String): Boolean {
        val q = query.trim().lowercase()
        return q.isEmpty() || "${a.item} ${a.number} ${a.reason.orEmpty()}".lowercase().contains(q)
    }
}
