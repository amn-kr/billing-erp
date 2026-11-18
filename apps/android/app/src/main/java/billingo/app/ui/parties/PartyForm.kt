package billingo.app.ui.parties

import billingo.app.data.PartyFull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.math.BigDecimal

/**
 * The New / Edit Party form's values (design 7.4b) and how they become the server's party,
 * following the web's Add Party window, so a party saved on the phone looks the same on the web.
 */
@Serializable
data class PartyForm(
    val name: String = "",
    val phone: String = "",
    val group: String = "General",
    val gstin: String = "",
    val gstType: Int = 0,
    val state: String = "",
    val address: String = "",
    val city: String = "",
    val pin: String = "",
    val sameShipping: Boolean = true,
    val shipping: String = "",
    val opening: String = "",
    /** the opening balance is money to pay (they are a supplier) */
    val pay: Boolean = false,
    val asOf: String = "",
    val customLimit: Boolean = false,
    val limit: String = "",
    val days: String = "30",
    val contactPerson: String = "",
    val email: String = "",
    val dob: String = "",
    val anniversary: String = "",
    val transport: String = "",
) {
    companion object {
        /** keeps what was typed when Android redraws the screen (for example after a language change) */
        val saver = androidx.compose.runtime.saveable.Saver<PartyForm, String>(
            save = { Json.encodeToString(serializer(), it) },
            restore = { Json.decodeFromString(serializer(), it) },
        )

        /** the web's GST types, as stored (shown with capitals on the phone) */
        val GST_TYPES = listOf("Unregistered / consumer", "Registered business – regular", "Registered business – composition", "Overseas", "SEZ")
        val GST_TYPE_WORDS = listOf("Unregistered / Consumer", "Registered Business – Regular", "Registered Business – Composition", "Overseas", "SEZ")

        /** the web's labels for the extra details */
        const val CONTACT = "Contact person"
        const val DOB = "Date of birth"
        const val ANNIVERSARY = "Anniversary"
        const val TRANSPORT = "Transport / Vehicle no."

        /** The form filled from a saved party (Edit Party). */
        fun of(p: PartyFull): PartyForm {
            fun extra(label: String) = p.contacts.firstOrNull { it.label.equals(label, ignoreCase = true) }?.value.orEmpty()
            val ob = runCatching { BigDecimal(p.openingBalance) }.getOrDefault(BigDecimal.ZERO)
            val lim = p.creditLimit?.let { runCatching { BigDecimal(it) }.getOrNull() }
            return PartyForm(
                name = p.name,
                phone = p.phone,
                group = p.group.ifBlank { "General" },
                gstin = p.gstin,
                gstType = GST_TYPES.indexOfFirst { it.equals(p.gstType, ignoreCase = true) }.coerceAtLeast(0),
                state = p.state,
                address = p.billing?.line.orEmpty(),
                city = p.billing?.city.orEmpty(),
                pin = p.billing?.pin.orEmpty(),
                sameShipping = p.shipping.isBlank(),
                shipping = p.shipping,
                opening = if (ob.signum() == 0) "" else ob.stripTrailingZeros().toPlainString(),
                pay = p.openingType == "pay",
                asOf = p.openingDate.orEmpty(),
                customLimit = lim != null && lim.signum() > 0,
                limit = lim?.stripTrailingZeros()?.toPlainString().orEmpty(),
                days = p.creditDays.toString(),
                contactPerson = extra(CONTACT),
                email = p.email,
                dob = extra(DOB),
                anniversary = extra(ANNIVERSARY),
                transport = extra(TRANSPORT),
            )
        }

        /** "+91 98765-43210", "098765 43210" → "9876543210": the 10-digit mobile number, as the server keeps it. */
        fun mobile(raw: String): String {
            val d = raw.filter { it.isDigit() }
            return when {
                d.length == 12 && d.startsWith("91") -> d.drop(2)
                d.length == 11 && d.startsWith("0") -> d.drop(1)
                else -> d
            }
        }
    }

    /** "Enter the party name." is the only check on the phone; the server checks the rest and says what is wrong. */
    val nameMissing get() = name.isBlank()

    /**
     * The party for the server. [before] is the saved party when editing: it keeps its kind unless the
     * opening balance was switched between To Receive and To Pay (as on the web).
     */
    fun toJson(before: PartyFull?, today: String): JsonObject = buildJsonObject {
        put("name", name.trim())
        val type = if (pay) "pay" else "receive"
        put("kind", if (before != null && type == before.openingType) before.kind else if (pay) "supplier" else "customer")
        put("group", group.ifBlank { "General" })
        put("phone", mobile(phone))
        put("email", email.trim())
        put("gstin", gstin.trim().uppercase())
        put("gstType", GST_TYPES[gstType])
        put("state", state)
        put("billing", buildJsonObject { put("line", address.trim()); put("city", city.trim()); put("pin", pin.trim()); put("state", "") })
        put("shipping", if (sameShipping) "" else shipping.trim())
        val ob = opening.replace(",", "").trim()
        put("openingBalance", if (ob.isEmpty()) JsonPrimitive(null as String?) else JsonPrimitive(ob))
        put("openingType", type)
        put("openingDate", asOf.ifBlank { today })
        put("creditLimit", if (customLimit && limit.isNotBlank()) JsonPrimitive(limit.replace(",", "").trim()) else JsonPrimitive(null as String?))
        put("creditDays", days.trim().toIntOrNull() ?: 0)
        put("contacts", buildJsonArray {
            listOf(CONTACT to contactPerson, DOB to dob, ANNIVERSARY to anniversary, TRANSPORT to transport)
                .filter { it.second.isNotBlank() }
                .forEach { (l, v) -> add(buildJsonObject { put("label", l); put("value", v.trim()) }) }
        })
    }
}
