package billingo.app.ui.items

import billingo.app.data.ItemDetail
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * The New / Edit Item form (design 7.4c) and how it becomes the server's item, following the web's
 * Add Item window so an item saved on the phone is the same on the web.
 */
@Serializable
data class ItemForm(
    val service: Boolean = false,
    val variant: Boolean = false,
    /** the parent item of a variant (the web's "group") */
    val parent: String = "",
    val series: String = "",
    val name: String = "",
    val brand: String = "",
    val category: String = "",
    val code: String = "",
    val unit: String = "PCS",
    val pack: Boolean = false,
    val packUnit: String = "BOX",
    val packSize: String = "",
    val sale: String = "",
    val purchase: String = "",
    val mrp: String = "",
    val wholesale: String = "",
    val wholesaleQty: String = "",
    val gst: Int = 18,
    val hsn: String = "",
    val openingQty: String = "",
    val openingRate: String = "",
    val minStock: String = "",
    val batchNo: String = "",
    val expiry: String = "",
    val location: String = "",
) {
    companion object {
        val GST_RATES = listOf(0, 5, 12, 18, 28)

        val saver = androidx.compose.runtime.saveable.Saver<ItemForm, String>(
            save = { Json.encodeToString(serializer(), it) },
            restore = { Json.decodeFromString(serializer(), it) },
        )

        private fun plain(v: BigDecimal) = if (v.signum() == 0) "" else v.stripTrailingZeros().toPlainString()

        /** The form filled from a saved item (Edit Item). */
        fun of(d: ItemDetail): ItemForm {
            val variant = d.group.isNotBlank() && d.series.isNotBlank()
            return ItemForm(
                service = d.kind == "service",
                variant = variant,
                parent = d.group,
                series = d.series,
                name = d.name,
                brand = d.brand,
                category = d.category,
                code = d.code,
                unit = d.unit.ifBlank { "PCS" },
                pack = d.packUnit.isNotBlank(),
                packUnit = d.packUnit.ifBlank { "BOX" },
                packSize = plain(d.packSize),
                sale = plain(d.sale),
                purchase = plain(d.purchase),
                mrp = plain(d.mrp),
                wholesale = plain(d.wholesale),
                wholesaleQty = plain(d.wholesaleMinQty),
                gst = d.gstRate.toBigDecimalOrNull()?.toInt() ?: 0,
                hsn = d.hsn,
                minStock = plain(d.minStock),
                location = d.location,
            )
        }
    }

    /** A variant's name, as the web makes it: "Modular Switch 16A · Havells Coral". */
    val fullName: String
        get() = if (variant) "${parent.trim()} · " + listOf(brand.trim(), series.trim()).filter { it.isNotEmpty() }.joinToString(" ") else name.trim()

    /** What is missing before saving, as one of the form's words (the screen says it). */
    enum class Missing { Name, Parent, Series }

    val missing: Missing?
        get() = when {
            variant && parent.isBlank() -> Missing.Parent
            variant && series.isBlank() -> Missing.Series
            !variant && name.isBlank() -> Missing.Name
            else -> null
        }

    /** Sale minus purchase as money and as a share of the purchase price, when both are given. */
    fun margin(): Pair<BigDecimal, BigDecimal>? {
        val s = sale.toBigDecimalOrNull() ?: return null
        val p = purchase.toBigDecimalOrNull() ?: return null
        if (p.signum() <= 0) return null
        val m = s - p
        return m to m.multiply(BigDecimal(100)).divide(p, 1, RoundingMode.HALF_UP)
    }

    /**
     * The item for the server. [editing]: an edit never sends opening stock. [packOn] / [batchOn]: the
     * shop's Settings › Items switches (Pack and loose, Batch No.).
     */
    fun toJson(editing: Boolean, packOn: Boolean, batchOn: Boolean, today: String): JsonObject = buildJsonObject {
        fun money(v: String) = v.replace(",", "").trim().let { if (it.isEmpty()) JsonNull else JsonPrimitive(it) }
        val goods = !service
        put("name", fullName)
        put("kind", if (goods) "goods" else "service")
        put("code", code.trim())
        put("hsn", hsn.trim())
        put("unit", unit.trim().ifBlank { "PCS" })
        put("category", category)
        put("brand", if (goods) brand else "")
        put("series", if (variant) series.trim() else "")
        if (variant) put("group", parent.trim())
        put("gstRate", gst)
        put("sale", money(sale))
        put("purchase", money(purchase))
        put("mrp", money(mrp))
        put("wholesale", if (goods) money(wholesale) else JsonNull)
        put("wholesaleMinQty", if (goods) money(wholesaleQty) else JsonNull)
        put("minStock", if (goods) money(minStock) else JsonNull)
        put("location", if (goods) location.trim() else "")
        if (packOn && goods) {
            put("packUnit", if (pack) packUnit.trim() else "")
            put("packSize", if (pack) money(packSize) else JsonNull)
        }
        val oq = openingQty.replace(",", "").trim().toBigDecimalOrNull()
        if (!editing && goods && oq != null && oq.signum() > 0) {
            put("openingQty", oq.toPlainString())
            put("openingRate", money(openingRate.ifBlank { purchase }))
            put("openingDate", today)
            if (batchOn && batchNo.isNotBlank()) {
                put("trackBatch", true)
                put("openingBatchNo", batchNo.trim())
                if (expiry.isNotBlank()) put("openingExpiry", expiry)
            }
        }
    }
}
