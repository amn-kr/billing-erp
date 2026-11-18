package billingo.app

import billingo.app.data.Address
import billingo.app.data.Contact
import billingo.app.data.Contacts
import billingo.app.data.PartyFull
import billingo.app.ui.parties.PartyForm
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

/** New / Edit Party (step 8.3b): the form becomes the same party the web would save. */
class PartyFormTest {
    private val today = "2026-11-18"

    @Test fun `a new party is a customer unless the opening balance is to pay`() {
        val j = PartyForm(name = " Raju Electrician ", phone = "98765 43210", opening = "1,500", asOf = "").toJson(null, today)
        assertEquals("Raju Electrician", j["name"]!!.jsonPrimitive.content)
        assertEquals("customer", j["kind"]!!.jsonPrimitive.content)
        assertEquals("9876543210", j["phone"]!!.jsonPrimitive.content)
        assertEquals("1500", j["openingBalance"]!!.jsonPrimitive.content)
        assertEquals("receive", j["openingType"]!!.jsonPrimitive.content)
        assertEquals(today, j["openingDate"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, j["creditLimit"])
        assertEquals(30, j["creditDays"]!!.jsonPrimitive.int)
        assertEquals("", j["shipping"]!!.jsonPrimitive.content)
        assertEquals("Unregistered / consumer", j["gstType"]!!.jsonPrimitive.content)
        assertTrue(j["contacts"]!!.jsonArray.isEmpty())
        assertEquals("supplier", PartyForm(name = "Kanpur Cables", pay = true).toJson(null, today)["kind"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, PartyForm(name = "X", opening = "").toJson(null, today)["openingBalance"])
    }

    @Test fun `limit, shipping, GST and the extra details`() {
        val j = PartyForm(
            name = "Mehta", gstin = "09abcpm1234k1z5", gstType = 1, state = "09", address = "Shop 4", city = "Kanpur", pin = "208001",
            sameShipping = false, shipping = "Godown, Fazalganj", customLimit = true, limit = "50,000", days = "45",
            contactPerson = "Ramesh", dob = "1980-05-02", transport = "UP78 AB 1234",
        ).toJson(null, today)
        assertEquals("09ABCPM1234K1Z5", j["gstin"]!!.jsonPrimitive.content)
        assertEquals("Registered business – regular", j["gstType"]!!.jsonPrimitive.content)
        assertEquals("Kanpur", j["billing"]!!.jsonObject["city"]!!.jsonPrimitive.content)
        assertEquals("Godown, Fazalganj", j["shipping"]!!.jsonPrimitive.content)
        assertEquals("50000", j["creditLimit"]!!.jsonPrimitive.content)
        assertEquals(45, j["creditDays"]!!.jsonPrimitive.int)
        assertEquals(listOf("Contact person", "Date of birth", "Transport / Vehicle no."), j["contacts"]!!.jsonArray.map { it.jsonObject["label"]!!.jsonPrimitive.content })
    }

    @Test fun `editing keeps the party's kind unless To Receive or To Pay changed`() {
        val sup = PartyFull(id = "1", name = "Gupta", kind = "supplier", openingType = "receive", balance = BigDecimal.ZERO)
        assertEquals("supplier", PartyForm.of(sup).toJson(sup, today)["kind"]!!.jsonPrimitive.content)
        assertEquals("supplier", PartyForm.of(sup).copy(pay = true).toJson(sup, today)["kind"]!!.jsonPrimitive.content)
        val cus = PartyFull(id = "2", name = "Mehta", kind = "customer", openingType = "receive", balance = BigDecimal.ZERO)
        assertEquals("supplier", PartyForm.of(cus).copy(pay = true).toJson(cus, today)["kind"]!!.jsonPrimitive.content)
    }

    @Test fun `the form is filled from a saved party`() {
        val p = PartyFull(
            id = "1", name = "Mehta", phone = "9839012345", group = "Electricians", gstin = "09ABCPM1234K1Z5", gstType = "Registered business – composition",
            state = "09", billing = Address(line = "Shop 4", city = "Kanpur", pin = "208001"), shipping = "", openingBalance = "2000.00", openingType = "receive",
            openingDate = "2026-10-19", creditLimit = "50000.00", creditDays = 30, contacts = listOf(Contact("Contact person", "Ramesh")), balance = BigDecimal("9625"),
        )
        val f = PartyForm.of(p)
        assertEquals(2, f.gstType)
        assertEquals("2000", f.opening)
        assertEquals(true, f.customLimit)
        assertEquals("50000", f.limit)
        assertEquals("Ramesh", f.contactPerson)
        assertEquals(true, f.sameShipping)
        assertEquals("2026-10-19", f.asOf)
    }

    @Test fun `phone numbers from contacts become 10-digit mobiles`() {
        assertEquals("9876543210", PartyForm.mobile("+91 98765-43210"))
        assertEquals("9876543210", PartyForm.mobile("098765 43210"))
        val c = Contacts.tidy(listOf("Raju" to "+91 98765 43210", "Raju again" to "9876543210", "Landline" to "0512 2345678", "anil" to "90055 66778", "" to "8840011223"))
        assertEquals(listOf("8840011223", "anil", "Raju"), c.map { it.name })
    }
}
