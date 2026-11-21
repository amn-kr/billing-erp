package billingo.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** A price list (GET /price-lists): the default one is the item's sale price; others serve party groups. */
@Serializable
data class PriceList(val id: String, val name: String, val isDefault: Boolean = false, val active: Boolean = true, val groups: List<String> = emptyList())

@Serializable
data class ListPrice(val price: String = "0", val fixed: Boolean = false)

@Serializable
data class PricedItem(val id: String, val lists: Map<String, ListPrice> = emptyMap())

/** Every item's price in every active list (GET /prices). */
@Serializable
data class Prices(val items: List<PricedItem> = emptyList())

@Serializable
data class TaxRate(val id: String, val kind: String = "GST", val rate: String = "0")

/** The shop's settings (GET /settings): GST on or off, and the rest as the web keeps it. */
@Serializable
data class ShopSettings(val gstEnabled: Boolean = false, val data: JsonObject = JsonObject(emptyMap()), val taxes: List<TaxRate> = emptyList())

/** The shop itself (GET /businesses/current): its state decides CGST + SGST or IGST. */
@Serializable
data class Shop(val id: String = "", val name: String = "", val stateCode: String? = null)

@Serializable
data class NextNumber(val number: String = "")

/** What the server answers when a bill is saved (POST /sales). */
@Serializable
data class SaleSaved(
    val id: String,
    val number: String,
    val total: String = "0",
    val balance: String = "0",
    val advance: String = "0",
    val settledOld: String = "0",
)
