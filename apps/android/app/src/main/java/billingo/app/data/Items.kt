package billingo.app.data

import kotlinx.serialization.Serializable
import java.math.BigDecimal

/** An item as the item list and page show it (GET /items, /items/:id). Quantities are exact decimals too. */
@Serializable
data class ItemFull(
    val id: String,
    val name: String,
    val kind: String = "goods",
    val code: String = "",
    val hsn: String = "",
    val unit: String = "",
    val category: String = "",
    val brand: String = "",
    val group: String = "",
    val series: String = "",
    val gstRate: String = "0",
    @Serializable(with = Exact::class) val sale: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val purchase: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val mrp: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val wholesale: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val wholesaleMinQty: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val minStock: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val stock: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val value: BigDecimal = BigDecimal.ZERO,
    val level: String = "ok",
    val trackBatch: Boolean = false,
    /** made inactive (only in GET /items?archived=all) */
    val archived: Boolean = false,
    /** Settings › Items › MRP and Pack: sold by the pack (e.g. BOX of 10) */
    val packUnit: String? = null,
    val packSize: String? = null,
)

@Serializable
data class GodownStock(val id: String, val name: String, @Serializable(with = Exact::class) val stock: BigDecimal = BigDecimal.ZERO)

@Serializable
data class Movement(
    val id: String,
    val date: String,
    val kind: String = "",
    @Serializable(with = Exact::class) val qty: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val rate: BigDecimal = BigDecimal.ZERO,
    val godown: String = "",
    val note: String = "",
    val sourceType: String? = null,
    val ref: String = "",
    val party: String = "",
    val status: String = "",
)

@Serializable
data class BatchRow(
    val id: String? = null,
    val no: String = "",
    val expiry: String? = null,
    @Serializable(with = Exact::class) val qty: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val rate: BigDecimal = BigDecimal.ZERO,
)

/** What is left in stock by the rate it was bought at (first in, first out), and its value. */
@Serializable
data class RateTable(@Serializable(with = Exact::class) val value: BigDecimal = BigDecimal.ZERO)

@Serializable
data class Batches(val rows: List<BatchRow> = emptyList())

/** One item's page: the item, its stock by godown and batch, and every stock movement. */
@Serializable
data class ItemDetail(
    val id: String,
    val name: String,
    val kind: String = "goods",
    val code: String = "",
    val hsn: String = "",
    val unit: String = "",
    val category: String = "",
    val brand: String = "",
    val group: String = "",
    val series: String = "",
    val gstRate: String = "0",
    @Serializable(with = Exact::class) val sale: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val purchase: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val mrp: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val wholesale: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val wholesaleMinQty: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val minStock: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val stock: BigDecimal = BigDecimal.ZERO,
    @Serializable(with = Exact::class) val value: BigDecimal = BigDecimal.ZERO,
    val level: String = "ok",
    val trackBatch: Boolean = false,
    val godowns: List<GodownStock> = emptyList(),
    val movements: List<Movement> = emptyList(),
    val batches: Batches? = null,
    val rateTable: RateTable? = null,
    val packUnit: String = "",
    @Serializable(with = Exact::class) val packSize: BigDecimal = BigDecimal.ZERO,
    val location: String = "",
)

@Serializable
data class Named(val id: String, val name: String)

@Serializable
data class UnitRow(val id: String, val code: String, val name: String = "")

/** The shop's lists for the item form (GET /catalogue). */
@Serializable
data class Catalogue(
    val units: List<UnitRow> = emptyList(),
    val categories: List<Named> = emptyList(),
    val brands: List<Named> = emptyList(),
    val groups: List<Named> = emptyList(),
)

@Serializable
data class NextCode(val code: String)
