package billingo.app.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import java.math.BigDecimal

/** Money from the server, as a string ("1234.50") or a number (1234.5), kept exact (never a float). */
object Exact : KSerializer<BigDecimal> {
    override val descriptor = PrimitiveSerialDescriptor("Exact", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder): BigDecimal {
        val e = (decoder as JsonDecoder).decodeJsonElement()
        val s = (e as? JsonPrimitive)?.content ?: e.jsonPrimitive.content
        return if (s.isBlank() || s == "null") BigDecimal.ZERO else BigDecimal(s)
    }
    override fun serialize(encoder: Encoder, value: BigDecimal) = encoder.encodeString(value.toPlainString())
}

@Serializable
data class Address(val line: String = "", val city: String = "", val pin: String = "", val state: String = "")

/** A party as the party list and page show it (GET /parties, /parties/:id). */
@Serializable
data class PartyFull(
    val id: String,
    val name: String,
    val kind: String = "customer",
    val group: String = "",
    val phone: String = "",
    val email: String = "",
    val gstin: String = "",
    @Serializable(with = Exact::class) val balance: BigDecimal = BigDecimal.ZERO,
    val creditLimit: String? = null,
    val creditDays: Int = 0,
    val billing: Address? = null,
    val archived: Boolean = false,
    val billingName: String = "",
    val gstType: String = "",
    val state: String = "",
    val shipping: String = "",
    val openingBalance: String = "0.00",
    val openingType: String = "receive",
    val openingDate: String? = null,
    val contacts: List<Contact> = emptyList(),
)

@Serializable
data class Contact(val label: String, val value: String)

/** Whether a party can be deleted, and if not, why (GET /parties/:id/usage). */
@Serializable
data class Usage(val canDelete: Boolean, val message: String = "")

@Serializable
data class PartyGroup(val id: String, val name: String, val parties: Int = 0)

@Serializable
data class Saved(val id: String, val name: String)

/** One line of a party's transactions (GET /reports/party-tx/:id): what is still open on it, and when it was due. */
@Serializable
data class PartyTx(
    val type: String,
    val no: String,
    val date: String,
    @Serializable(with = Exact::class) val total: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val bal: BigDecimal = BigDecimal.ZERO,
    val due: String = "",
)

@Serializable
data class StatementRow(
    val date: String,
    val no: String = "",
    val type: String,
    @Serializable(with = Exact::class) val dr: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val cr: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val run: BigDecimal = BigDecimal.ZERO,
)

@Serializable
data class StatementParty(val name: String, val sup: Boolean = false)

/** A party's statement for a period (GET /reports/statement/:id): opening, entries with running balance, closing. */
@Serializable
data class Statement(
    val party: StatementParty,
    val from: String,
    val to: String,
    @Serializable(with = Exact::class) val open: BigDecimal = BigDecimal.ZERO,
    val rows: List<StatementRow> = emptyList(),
    @Serializable(with = Exact::class) val dr: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val cr: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val close: BigDecimal = BigDecimal.ZERO,
)
