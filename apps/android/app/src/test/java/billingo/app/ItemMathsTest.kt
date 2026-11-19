package billingo.app

import billingo.app.data.ItemFull
import billingo.app.data.Movement
import billingo.app.ui.items.ItemMaths
import billingo.app.ui.items.ItemMaths.Kind
import billingo.app.ui.items.ItemMaths.Status
import billingo.app.ui.items.ItemMaths.Word
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

/** The Items screens' rules (step 8.4a, design 7.4c). */
class ItemMathsTest {
    private fun i(name: String, stock: String, level: String = "ok", value: String = "0", kind: String = "goods", brand: String = "", series: String = "", group: String = "", sale: String = "100") =
        ItemFull(id = name + brand, name = name, kind = kind, stock = BigDecimal(stock), level = level, value = BigDecimal(value), brand = brand, series = series, group = group, sale = BigDecimal(sale))

    private val all = listOf(
        i("LED Bulb 9W", "120", value = "8400", brand = "Philips"),
        i("Havells Wire 90 m", "4", "low", "4600", brand = "Havells"),
        i("Modular Switch 16A", "60", value = "4560", brand = "Anchor", series = "Roma", group = "Modular Switch 16A", sale = "95"),
        i("Modular Switch 16A", "0", "out", brand = "Havells", series = "Coral", group = "Modular Switch 16A", sale = "110"),
        i("Havells MCB 32A", "0", "out", brand = "Havells"),
        i("Wiring Labour Per Point", "0", kind = "service"),
    )

    @Test fun `stock value, low and out leave services out`() {
        val t = ItemMaths.totals(all)
        assertEquals(BigDecimal("17560"), t.value)
        assertEquals(1, t.low)
        assertEquals(2, t.out)
    }

    @Test fun `tabs, stock filter, brand and search`() {
        fun names(k: Kind, s: Status, b: String = "", q: String = "") = all.filter { ItemMaths.matches(it, k, s, b, q) }.map { it.name + it.brand }
        assertEquals(listOf("Wiring Labour Per Point"), names(Kind.Services, Status.All))
        assertEquals(5, names(Kind.Products, Status.All).size)
        assertEquals(listOf("Havells Wire 90 mHavells"), names(Kind.All, Status.Low))
        assertEquals(2, names(Kind.All, Status.Out).size)
        assertEquals(3, names(Kind.All, Status.All, "havells").size)
        assertEquals(listOf("Modular Switch 16AAnchor"), names(Kind.All, Status.All, q = "roma"))
    }

    @Test fun `items of one group show under one line, by brand`() {
        val e = ItemMaths.entries(all, all)
        assertEquals(5, e.size)
        val g = e.filterIsInstance<ItemMaths.Entry.Group>().single()
        assertEquals("Modular Switch 16A", g.name)
        assertEquals(2, g.members.size)
        assertTrue(g.byBrand)
        assertEquals("Anchor Roma", ItemMaths.variantName(g.members[0]))
        // a group with one item left in the list still shows as a group (it has others)
        val one = ItemMaths.entries(all.filter { it.brand != "Havells" || it.group.isEmpty() }, all)
        assertEquals(1, one.filterIsInstance<ItemMaths.Entry.Group>().single().members.size)
        assertEquals(2, one.filterIsInstance<ItemMaths.Entry.Group>().single().all.size)
    }

    @Test fun `margin and stock after an adjustment`() {
        assertEquals(BigDecimal("15") to BigDecimal("21.4"), ItemMaths.margin(BigDecimal("85"), BigDecimal("70")))
        assertEquals(BigDecimal.ZERO to BigDecimal("0.0"), ItemMaths.margin(BigDecimal("150"), BigDecimal("150")))
        assertEquals(BigDecimal("118"), ItemMaths.after(BigDecimal("120"), "2", add = false))
        assertEquals(BigDecimal("122.5"), ItemMaths.after(BigDecimal("120"), "2.5", add = true))
        assertEquals(BigDecimal("120"), ItemMaths.after(BigDecimal("120"), "", add = true))
    }

    @Test fun `what each movement is called`() {
        fun m(src: String?, kind: String, ref: String = "") = Movement(id = "1", date = "2026-11-01", kind = kind, sourceType = src, ref = ref)
        assertEquals(Word.Sale, ItemMaths.word(m("sales_document", "sale", "INV-0107")))
        assertEquals(Word.Return, ItemMaths.word(m("sales_document", "return", "CN-0003")))
        assertEquals(Word.Cancelled, ItemMaths.word(m("sales_document", "cancel", "INV-0100")))
        assertEquals(Word.Purchase, ItemMaths.word(m("purchase_document", "purchase", "PB-0029")))
        assertEquals(Word.Adjustment, ItemMaths.word(m("stock_adjustment", "adjust", "ADJ-0012")))
        assertEquals(Word.Opening, ItemMaths.word(m(null, "opening")))
        assertTrue(ItemMaths.inFilter(m("purchase_document", "purchase"), ItemMaths.Filter.Buy))
    }
}
