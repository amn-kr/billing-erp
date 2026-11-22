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
data class Shop(
    val id: String = "",
    val name: String = "",
    val stateCode: String? = null,
    // 8.5d: printed at the top of the invoice
    val phone: String? = null,
    val address: String? = null,
    val city: String? = null,
    val pin: String? = null,
    val gstin: String? = null,
    val email: String? = null,
)

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

// 8.5c: referral, batches, last prices, quotation import, profit

/** An electrician or contractor who sends customers (GET /referrers). */
@Serializable
data class Referrer(val id: String, val name: String, val phone: String? = null, val city: String? = null)

/** A saved commission rule for an item category (GET /commission-rules): kind none / percent / fixed. */
@Serializable
data class CommissionRule(val category: String, val kind: String = "none", val value: String = "0")

/** One batch of an item and what is left in it (GET /batches → item id → its batches). */
@Serializable
data class StockBatch(val id: String? = null, val no: String = "", val expiry: String? = null, val qty: String = "0")

/** A price this customer got before (GET /sales/price-history). */
@Serializable
data class PastPrice(val date: String, val number: String, val qty: String = "0", val price: String = "0", val discPct: String = "0")

@Serializable
data class DocParty(val id: String, val name: String = "", val phone: String? = null, val gstin: String? = null, val city: String? = null)

/** A quotation in the list (GET /sales?kind=quotation). */
@Serializable
data class QuoteRow(
    val id: String,
    val number: String,
    val date: String,
    val party: DocParty? = null,
    val partyName: String = "",
    val total: String = "0",
    val items: Int = 0,
    val status: String = "",
    val cancelled: Boolean = false,
    val qtype: String = "items",
    val referrerId: String? = null,
)

/** A batch a saved line took its stock from (printed under the item's name). */
@Serializable
data class DocBatch(val batchId: String? = null, val no: String = "", val expiry: String? = null, val qty: String = "0", val mrp: String? = null)

@Serializable
data class DocLine(
    val itemId: String? = null,
    val name: String = "",
    val qty: String = "0",
    val unit: String = "",
    val price: String = "0",
    val discPct: String = "0",
    val gstRate: String = "0",
    // 8.5d: what the printed invoice shows
    val hsn: String = "",
    val taxable: String = "0",
    val tax: String = "0",
    val amount: String = "0",
    val code: String = "",
    val brand: String = "",
    val series: String = "",
    val group: String = "",
    val category: String = "",
    val batches: List<DocBatch> = emptyList(),
    val batchUnit: String = "",
    val looseOf: String? = null,
    val mrp: String? = null,
    val listPrice: String? = null,
    val wholesalePrice: String? = null,
    // 8.6b: what Edit Bill keeps
    val basePrice: String? = null,
    val commOverride: kotlinx.serialization.json.JsonElement? = null,
)

/** One part of the money taken with the bill (8.6b: kept as it was when the bill is edited). */
@Serializable
data class DocSplit(val mode: String = "Cash", val amount: String = "0", val ref: String = "", val accountId: String? = null)

/** The money taken with the bill. */
@Serializable
data class DocPayment(val amount: String = "0", val mode: String = "", val splits: List<DocSplit> = emptyList())

/** One saved document with its lines (GET /sales/:id). */
@Serializable
data class SaleDoc(
    val id: String,
    val number: String,
    val date: String = "",
    val partyName: String = "",
    val party: DocParty? = null,
    val referrerId: String? = null,
    val lines: List<DocLine> = emptyList(),
    // 8.5d: the rest, for the invoice PDF
    val kind: String = "invoice",
    val dueDate: String? = null,
    val mode: String = "credit",
    val cashPhone: String = "",
    val billName: String = "",
    val taxMode: String = "none",
    val placeOfSupply: String = "",
    val billDiscount: String = "0",
    val taxable: String = "0",
    val cgst: String = "0",
    val sgst: String = "0",
    val igst: String = "0",
    val tcs: String = "0",
    val transport: String = "0",
    val labour: String = "0",
    val bankCharge: String = "0",
    val roundAmount: String = "0",
    val total: String = "0",
    val words: String = "",
    val balance: String = "0",
    val notes: String = "",
    val extra: JsonObject? = null,
    val cancelled: Boolean = false,
    val legacy: Boolean = false,
    val savedAt: String? = null,
    val payment: DocPayment? = null,
    // 8.6a: the Bill View
    val itemsTotal: String = "0",
    val tax: String = "0",
    val received: String = "0",
    val settlements: List<Settlement> = emptyList(),
    // 8.6b: what Edit Bill keeps
    val cashName: String = "",
    val pricesInclTax: Boolean = true,
    val roundOff: Boolean = true,
)

/** Money that settled a bill: a payment (with the bill or later) or a credit note. */
@Serializable
data class Settlement(
    val amount: String = "0",
    val kind: String = "payment",
    val number: String = "",
    val date: String? = null,
    val mode: String = "",
    val atSale: Boolean = false,
    val cancelled: Boolean = false,
)

/** A sale bill in Sale Bills (GET /sales?kind=invoice). */
@Serializable
data class BillRow(
    val id: String,
    val number: String,
    val date: String,
    val dueDate: String? = null,
    val mode: String = "credit",
    val party: DocParty? = null,
    val partyName: String? = null,
    val total: String = "0",
    val received: String = "0",
    val balance: String = "0",
    val cancelled: Boolean = false,
    val items: Int = 0,
)

/** What a cancel answers: the money already received that became the party's advance. */
@Serializable
data class Cancelled(val id: String = "", val number: String = "", val movedToAdvance: String = "0")

@Serializable
data class LineCost(val cost: String = "0")

/** What the goods on a bill cost (POST /sales/cost), one per line. */
@Serializable
data class SaleCost(val lines: List<LineCost?> = emptyList())
