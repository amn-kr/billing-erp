package billingo.app.data

import kotlinx.serialization.Serializable
import java.math.BigDecimal

/** A godown with how many items have stock there and what that stock is worth (GET /godowns). */
@Serializable
data class Godown(
    val id: String,
    val name: String,
    val address: String? = null,
    val manager: String? = null,
    val phone: String? = null,
    val isDefault: Boolean = false,
    val items: Int = 0,
    @Serializable(with = Exact::class) val value: BigDecimal = BigDecimal.ZERO,
)

/** A stock transfer between two godowns (GET /stock-transfers, the latest 50). */
@Serializable
data class Transfer(
    val id: String,
    val number: String = "",
    val date: String,
    val itemId: String,
    val item: String = "",
    val unit: String = "",
    @Serializable(with = Exact::class) val qty: BigDecimal = BigDecimal.ZERO,
    val from: String = "",
    val to: String = "",
)

/** A brand with its items and their stock value (GET /brands). */
@Serializable
data class Brand(
    val id: String,
    val name: String,
    val items: Int = 0,
    @Serializable(with = Exact::class) val value: BigDecimal = BigDecimal.ZERO,
    val active: Boolean = true,
)

/** A series of a brand, saved or only typed on items (GET /brand-series). */
@Serializable
data class Series(val brandId: String, val name: String, val active: Boolean = true)

/** A saved stock adjustment (GET /stock-adjustments). [qty] is below zero when stock was reduced. */
@Serializable
data class AdjustmentRow(
    val id: String,
    val number: String = "",
    val date: String,
    val itemId: String,
    val item: String = "",
    val unit: String = "",
    @Serializable(with = Exact::class) val qty: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val value: BigDecimal = BigDecimal.ZERO,
    val reason: String? = null,
    val cancelled: Boolean = false,
)

/** One change of an item's price (GET /prices/history?itemId=). */
@Serializable
data class PriceChange(
    val at: String,
    val field: String,
    val oldValue: String? = null,
    val newValue: String? = null,
    val how: String? = null,
)

/** Is a price PIN set (GET /prices/pin)? */
@Serializable
data class PinState(val set: Boolean = false)

@Serializable
data class BulkDone(val changed: Int = 0, val skipped: Int = 0)
