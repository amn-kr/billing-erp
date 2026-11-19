package billingo.app

import billingo.app.data.ItemDetail
import billingo.app.ui.items.ItemForm
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

/** New / Edit Item (step 8.4b): the form becomes the same item the web would save. */
class ItemFormTest {
    private val today = "2026-11-19"

    @Test fun `a new product with opening stock`() {
        val j = ItemForm(name = " LED Bulb 9W ", brand = "Philips", unit = "PCS", sale = "85", purchase = "70", gst = 18, hsn = "8539", openingQty = "120", minStock = "20").toJson(false, packOn = false, batchOn = false, today = today)
        assertEquals("LED Bulb 9W", j["name"]!!.jsonPrimitive.content)
        assertEquals("goods", j["kind"]!!.jsonPrimitive.content)
        assertEquals(18, j["gstRate"]!!.jsonPrimitive.int)
        assertEquals("120", j["openingQty"]!!.jsonPrimitive.content)
        assertEquals("70", j["openingRate"]!!.jsonPrimitive.content) // the purchase price when no rate is given
        assertEquals(today, j["openingDate"]!!.jsonPrimitive.content)
        assertFalse("group" in j)
        assertFalse("packUnit" in j)
    }

    @Test fun `a variant is named like the web, Parent · Brand Series`() {
        val f = ItemForm(variant = true, parent = "Modular Switch 16A", brand = "Havells", series = "Coral")
        assertEquals("Modular Switch 16A · Havells Coral", f.fullName)
        val j = f.toJson(false, false, false, today)
        assertEquals("Modular Switch 16A", j["group"]!!.jsonPrimitive.content)
        assertEquals("Coral", j["series"]!!.jsonPrimitive.content)
        assertEquals(ItemForm.Missing.Series, f.copy(series = "").missing)
        assertEquals(ItemForm.Missing.Parent, f.copy(parent = "").missing)
        assertEquals(ItemForm.Missing.Name, ItemForm().missing)
        assertNull(f.missing)
    }

    @Test fun `a service has no stock, brand or wholesale, and an edit never sends opening stock`() {
        val s = ItemForm(service = true, name = "Wiring Labour", brand = "X", sale = "150", wholesale = "100", openingQty = "5").toJson(false, false, false, today)
        assertEquals("service", s["kind"]!!.jsonPrimitive.content)
        assertEquals("", s["brand"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, s["wholesale"])
        assertFalse("openingQty" in s)
        assertFalse("openingQty" in ItemForm(name = "A", openingQty = "5").toJson(true, false, false, today))
    }

    @Test fun `pack and batch only when the shop has them switched on`() {
        val f = ItemForm(name = "Paracetamol 500", pack = true, packUnit = "STRIP", packSize = "10", openingQty = "100", batchNo = "B-77", expiry = "2027-03-31")
        val on = f.toJson(false, packOn = true, batchOn = true, today = today)
        assertEquals("STRIP", on["packUnit"]!!.jsonPrimitive.content)
        assertEquals("10", on["packSize"]!!.jsonPrimitive.content)
        assertEquals("B-77", on["openingBatchNo"]!!.jsonPrimitive.content)
        assertTrue(on["trackBatch"]!!.jsonPrimitive.content.toBoolean())
        val off = f.toJson(false, packOn = false, batchOn = false, today = today)
        assertFalse("packUnit" in off)
        assertFalse("openingBatchNo" in off)
    }

    @Test fun `margin and filling the form from a saved item`() {
        assertEquals(BigDecimal("15") to BigDecimal("21.4"), ItemForm(sale = "85", purchase = "70").margin())
        assertNull(ItemForm(sale = "85").margin())
        val d = ItemDetail(id = "1", name = "Modular Switch 16A · Havells Coral", group = "Modular Switch 16A", brand = "Havells", series = "Coral", unit = "PCS",
            sale = BigDecimal("110.00"), purchase = BigDecimal("88.00"), gstRate = "18", minStock = BigDecimal("10.000"))
        val f = ItemForm.of(d)
        assertTrue(f.variant)
        assertEquals("Modular Switch 16A · Havells Coral", f.fullName)
        assertEquals("110", f.sale)
        assertEquals("10", f.minStock)
        assertEquals(18, f.gst)
    }
}
