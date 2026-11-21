package billingo.app

import billingo.app.data.AdjustmentRow
import billingo.app.data.ItemFull
import billingo.app.ui.items.StockMaths
import billingo.app.ui.items.StockMaths.TransferProblem
import billingo.app.ui.items.StockMaths.Which
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

/** Price Manager, Transfer Stock and Stock Adjustments (step 8.4c, design 7.4c). */
class StockMathsTest {
    private fun i(name: String, sale: String, purchase: String = "0", mrp: String = "0", kind: String = "goods", brand: String = "", code: String = "", archived: Boolean = false) =
        ItemFull(id = name, name = name, kind = kind, sale = BigDecimal(sale), purchase = BigDecimal(purchase), mrp = BigDecimal(mrp), brand = brand, code = code, archived = archived)

    private val led = i("LED Bulb 9W", "85", "70", "99", brand = "Philips", code = "LED9")
    private val wire = i("Havells Wire 90 m", "1390", "1150", brand = "Havells")
    private val labour = i("Wiring Labour", "50", kind = "service")
    private val old = i("Old Tube Light", "120", archived = true)

    @Test fun `5 percent up is rounded to the rupee`() {
        val c = StockMaths.changes(listOf(led, wire), Which.Sale, up = true, percent = true, howMuch = "5")
        // 85 + 4.25 = 89.25 → 89; 1390 + 69.50 = 1459.50 → 1460
        assertEquals(listOf("89", "1460"), c.map { it.new.toPlainString() })
        assertEquals(BigDecimal("85"), c[0].old)
    }

    @Test fun `rupees down never goes below zero`() {
        val c = StockMaths.changes(listOf(led), Which.Purchase, up = false, percent = false, howMuch = "100")
        assertEquals("0", c.single().new.toPlainString())
    }

    @Test fun `an item with no MRP keeps none, and unchanged prices are left out`() {
        assertEquals(listOf("LED Bulb 9W"), StockMaths.changes(listOf(led, wire), Which.Mrp, true, true, "10").map { it.item.name })
        // 0.4% of 85 is 0.34: still 85 after rounding, so nothing changes
        assertTrue(StockMaths.changes(listOf(led), Which.Sale, true, true, "0.4").isEmpty())
    }

    @Test fun `nothing changes for an empty or zero amount`() {
        assertTrue(StockMaths.changes(listOf(led), Which.Sale, true, true, "").isEmpty())
        assertTrue(StockMaths.changes(listOf(led), Which.Sale, true, true, "0").isEmpty())
        assertTrue(StockMaths.changes(listOf(led), Which.Sale, true, true, "abc").isEmpty())
    }

    @Test fun `price list shows active products by name, code and brand`() {
        val all = listOf(wire, led, labour, old)
        assertEquals(listOf("Havells Wire 90 m", "LED Bulb 9W"), StockMaths.priced(all, "", "").map { it.name })
        assertEquals(listOf("LED Bulb 9W"), StockMaths.priced(all, "led9", "").map { it.name })
        assertEquals(listOf("Havells Wire 90 m"), StockMaths.priced(all, "", "havells").map { it.name })
    }

    @Test fun `transfer checks godowns, quantity and what is there`() {
        val have = BigDecimal("120")
        assertEquals(TransferProblem.SameGodown, StockMaths.transferProblem("a", "a", "5", have))
        assertEquals(TransferProblem.NoQuantity, StockMaths.transferProblem("a", "b", "", have))
        assertEquals(TransferProblem.NoQuantity, StockMaths.transferProblem("a", "b", "0", have))
        assertEquals(TransferProblem.NotEnough, StockMaths.transferProblem("a", "b", "200", have))
        assertNull(StockMaths.transferProblem("a", "b", "120", have))
        assertNull(StockMaths.transferProblem("a", "b", "2.5", have))
    }

    @Test fun `adjustment totals leave cancelled ones out`() {
        fun a(qty: String, value: String, cancelled: Boolean = false) = AdjustmentRow(id = qty + value, date = "2026-11-14", itemId = "x", qty = BigDecimal(qty), value = BigDecimal(value), cancelled = cancelled)
        val t = StockMaths.adjTotals(listOf(a("10", "700"), a("-2", "140"), a("-5", "350", cancelled = true)))
        assertEquals(BigDecimal("700"), t.added)
        assertEquals(BigDecimal("140"), t.reduced)
        assertEquals(BigDecimal("560"), t.net)
    }

    @Test fun `a late evening change shows the date in India`() {
        assertEquals("2026-11-17", StockMaths.indiaDay("2026-11-16T20:15:00.000Z"))
        assertEquals("2026-11-16", StockMaths.indiaDay("2026-11-16T10:00:00.000Z"))
        assertEquals("2026-11-16", StockMaths.indiaDay("2026-11-16"))
    }
}
