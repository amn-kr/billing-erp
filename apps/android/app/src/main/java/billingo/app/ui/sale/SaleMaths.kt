package billingo.app.ui.sale

import billingo.app.data.ItemFull
import billingo.app.data.PartyFull
import billingo.app.data.PriceList
import billingo.app.data.Prices
import billingo.app.data.ShopSettings
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.UUID

/**
 * The New Sale rules (step 8.5b), as the web's sale editor has them
 * (apps/web/src/features/sales/editor/state.ts): the price for a customer from their group's price
 * list, CGST + SGST or IGST from the customer's state, final rate ↔ discount %, what is received,
 * and what is sent to the server. The totals come from [BillMaths]; the server works them out again.
 */
object SaleMaths {
    /** The server's payment types; [PAY_MODES] index = the words shown. */
    val PAY_MODES = listOf("Cash", "UPI", "Bank transfer", "Cheque", "Card")

    /** What the shop's settings and lists say, loaded once when New Sale opens. */
    data class Ctx(
        val mode: BillMaths.Mode,
        /** the shop's state code ("09"): another state means IGST */
        val state: String,
        val tcsRate: BigDecimal?,
        val defaultList: String?,
        /** party group name → its active price list */
        val listForGroup: Map<String, String>,
        /** item id → list id → price */
        val listPrice: Map<String, Map<String, BigDecimal>>,
        /** Settings › Items › MRP and Pack: lines of an item with a pack start in packs */
        val packOn: Boolean,
        /** Settings › Transactions: new bills start as Cash */
        val cashDefault: Boolean,
        val items: List<ItemFull>,
        val parties: List<PartyFull>,
    )

    fun ctx(settings: ShopSettings, stateCode: String?, lists: List<PriceList>, prices: Prices, features: List<String>, items: List<ItemFull>, parties: List<PartyFull>): Ctx {
        val d = settings.data
        fun str(k: String) = (d[k] as? JsonPrimitive)?.contentOrNull
        fun flag(k: String) = (d[k] as? JsonPrimitive)?.booleanOrNull == true
        val mode = when { !settings.gstEnabled -> BillMaths.Mode.None; str("reg") == "composition" -> BillMaths.Mode.Bos; else -> BillMaths.Mode.Gst }
        val tcs = if (mode == BillMaths.Mode.Gst && flag("tcs") && str("tcsRate") != null) settings.taxes.firstOrNull { it.id == str("tcsRate") }?.rate?.toBigDecimalOrNull() else null
        val forGroup = linkedMapOf<String, String>()
        for (l in lists) if (l.active && !l.isDefault) for (g in l.groups) forGroup.putIfAbsent(g, l.id)
        return Ctx(
            mode = mode, state = stateCode?.takeIf { it.isNotBlank() } ?: "09", tcsRate = tcs,
            defaultList = lists.firstOrNull { it.isDefault }?.id, listForGroup = forGroup,
            listPrice = prices.items.associate { p -> p.id to p.lists.mapValues { (_, v) -> v.price.toBigDecimalOrNull() ?: BigDecimal.ZERO } },
            packOn = "pack_loose" in features, cashDefault = flag("txnCash"),
            items = items.filter { !it.archived }, parties = parties.filter { !it.archived },
        )
    }

    data class Line(
        val itemId: String,
        val name: String,
        val hsn: String,
        val unit: String,
        /** typed quantity, kept as typed */
        val qty: String,
        /** the price-list rate for this unit */
        val price: BigDecimal,
        /** discount %; minus when the final rate is above the price-list rate (never shown) */
        val disc: BigDecimal,
        val gst: BigDecimal,
    )

    data class Pay(val mode: String = "Cash", val amount: String = "", val ref: String = "")

    data class Draft(
        /** one-time key: the same for every try of this bill, so it is saved once */
        val key: String = UUID.randomUUID().toString(),
        val cash: Boolean = false,
        val number: String = "",
        val date: String,
        val partyId: String? = null,
        val lines: List<Line> = emptyList(),
        val bdiscP: String = "",
        val bdisc: String = "",
        val chTr: String = "",
        val chLab: String = "",
        val chBank: String = "",
        val roundOff: Boolean = true,
        /** Discount And Charges seen once (the web asks before the first save) */
        val chgOk: Boolean = false,
        val pays: List<Pay> = listOf(Pay()),
        /** Payment Received changed by hand; until then a cash bill is fully received and a credit bill not at all */
        val payTouched: Boolean = false,
        /** the server's "Save anyway" answers given for this bill */
        val confirmed: Set<String> = emptySet(),
    )

    fun party(c: Ctx, d: Draft): PartyFull? = d.partyId?.let { id -> c.parties.firstOrNull { it.id == id } }
    fun item(c: Ctx, id: String): ItemFull? = c.items.firstOrNull { it.id == id }

    /** The place of supply: the GSTIN's first two digits, else the party's state, else the shop's. */
    fun partyState(c: Ctx, p: PartyFull?): String = when {
        p == null -> c.state
        p.gstin.length >= 2 && p.gstin.take(2).all(Char::isDigit) -> p.gstin.take(2)
        p.state.isNotBlank() -> p.state
        else -> c.state
    }

    private fun pack(i: ItemFull): Pair<String, BigDecimal>? {
        val u = i.packUnit?.takeIf { it.isNotBlank() } ?: return null
        val s = i.packSize?.toBigDecimalOrNull()?.takeIf { it.signum() > 0 } ?: return null
        return u to s
    }

    /** The units a line can use: the item's own, and its pack unit when packs are on. */
    fun units(c: Ctx, i: ItemFull): List<String> = listOfNotNull(pack(i)?.first?.takeIf { c.packOn }, i.unit.takeIf { it.isNotBlank() }).distinct()

    /** The list price of an item for this customer, in this unit (a loose unit: the pack's ÷ its size). */
    fun priceFor(c: Ctx, i: ItemFull, p: PartyFull?, unit: String): BigDecimal {
        val list = (p?.let { c.listForGroup[it.group] }) ?: c.defaultList
        val v = list?.let { c.listPrice[i.id]?.get(it) } ?: i.sale
        val pk = pack(i)
        return if (pk != null && unit != pk.first) v.divide(pk.second, 2, RoundingMode.HALF_UP) else v
    }

    fun newLine(c: Ctx, d: Draft, i: ItemFull): Line {
        val pk = pack(i)
        val unit = if (pk != null && c.packOn) pk.first else i.unit
        return Line(i.id, i.name, i.hsn, unit, "1", priceFor(c, i, party(c, d), unit), BigDecimal.ZERO, if (c.mode == BillMaths.Mode.Gst) i.gstRate.toBigDecimalOrNull() ?: BigDecimal.ZERO else BigDecimal.ZERO)
    }

    /** Another customer: every line gets that customer's list price again (as on the web). */
    fun withParty(c: Ctx, d: Draft, p: PartyFull?): Draft {
        val nd = d.copy(partyId = p?.id, confirmed = emptySet())
        return nd.copy(lines = nd.lines.map { l -> item(c, l.itemId)?.let { l.copy(price = priceFor(c, it, p, l.unit)) } ?: l })
    }

    fun num(s: String): BigDecimal = s.replace(",", "").trim().toBigDecimalOrNull() ?: BigDecimal.ZERO

    /** The rate after the discount, to paise. */
    fun finalRate(l: Line): BigDecimal = BillMaths.round2(l.price.multiply(BigDecimal.ONE - l.disc.movePointLeft(2)))

    /**
     * A typed final rate → the discount % from the list rate (web frSet). Any final rate is allowed
     * (owner, 21 Nov 2026): above the list rate it becomes a minus discount; over 100 × the list
     * rate, or with no list rate, it becomes the price itself.
     */
    fun withFinal(l: Line, typed: BigDecimal): Line {
        val v = typed.max(BigDecimal.ZERO)
        val p = l.price
        if (p.signum() <= 0) return l.copy(price = v, disc = BigDecimal.ZERO)
        val d = (p - v).divide(p, 20, RoundingMode.HALF_UP).movePointRight(2).setScale(8, RoundingMode.HALF_UP).stripTrailingZeros()
        if (d < BigDecimal(-9900)) return l.copy(price = v, disc = BigDecimal.ZERO)
        return l.copy(disc = d)
    }

    fun bill(c: Ctx, d: Draft): BillMaths.Bill = BillMaths.Bill(
        mode = c.mode, incl = true, inter = partyState(c, party(c, d)) != c.state, roundOff = d.roundOff,
        lines = d.lines.map { BillMaths.Line(num(it.qty), it.price, it.disc, if (c.mode == BillMaths.Mode.Gst) it.gst else BigDecimal.ZERO) },
        bdiscP = d.bdiscP.takeIf { it.isNotBlank() && num(it).signum() != 0 }?.let(::num),
        bdisc = d.bdisc.takeIf { it.isNotBlank() }?.let(::num),
        tcsRate = c.tcsRate, chTr = num(d.chTr), chLab = num(d.chLab), chBank = num(d.chBank),
    )

    fun totals(c: Ctx, d: Draft): BillMaths.Totals = BillMaths.sale(bill(c, d))

    /** The payments as they will be saved: untouched, a cash bill is fully received and a credit bill not at all. */
    fun payments(d: Draft, total: BigDecimal): List<Pay> {
        val first = d.pays.firstOrNull() ?: Pay()
        return when {
            d.cash -> listOf(first.copy(amount = total.toPlainString()))
            !d.payTouched -> listOf(first.copy(amount = "0"))
            else -> d.pays
        }
    }

    fun received(d: Draft, total: BigDecimal): BigDecimal = payments(d, total).fold(BigDecimal.ZERO) { a, p -> a + num(p.amount) }

    /** What this bill leaves unpaid (more received than the bill: nothing). */
    fun dues(d: Draft, total: BigDecimal): BigDecimal = (total - received(d, total)).max(BigDecimal.ZERO)

    enum class Problem { NoParty, NoItems, NoQty }

    fun problem(d: Draft): Problem? = when {
        !d.cash && d.partyId == null -> Problem.NoParty
        d.lines.isEmpty() -> Problem.NoItems
        d.lines.any { num(it.qty).signum() <= 0 } -> Problem.NoQty
        else -> null
    }

    private fun plain(v: BigDecimal) = v.stripTrailingZeros().let { if (it.scale() < 0) it.setScale(0) else it }.toPlainString()

    /** The body of POST /sales, as the web sends it. */
    fun body(c: Ctx, d: Draft): JsonObject {
        val t = totals(c, d)
        val p = party(c, d)
        return buildJsonObject {
            put("kind", "invoice"); put("number", ""); put("date", d.date); put("dueDate", if (d.cash) d.date else addDays(d.date, p?.creditDays ?: 0))
            put("mode", if (d.cash) "cash" else "credit"); put("partyId", p?.id?.let(::JsonPrimitive) ?: JsonNull)
            put("cashName", ""); put("cashPhone", ""); put("billName", ""); put("placeOfSupply", partyState(c, p))
            put("pricesInclTax", true); put("roundOff", d.roundOff)
            val bp = d.bdiscP.takeIf { it.isNotBlank() && num(it).signum() != 0 }
            put("billDiscPct", bp?.let { JsonPrimitive(plain(num(it))) } ?: JsonNull)
            put("billDiscAmt", if (bp == null && num(d.bdisc).signum() != 0) JsonPrimitive(plain(num(d.bdisc))) else JsonNull)
            put("transport", plain(num(d.chTr))); put("labour", plain(num(d.chLab))); put("bankCharge", plain(num(d.chBank)))
            put("lines", JsonArray(d.lines.map { l ->
                buildJsonObject {
                    put("itemId", l.itemId); put("name", l.name); put("hsn", l.hsn); put("qty", plain(num(l.qty))); put("unit", l.unit)
                    put("price", plain(l.price)); put("discPct", plain(l.disc)); put("gstRate", plain(if (c.mode == BillMaths.Mode.Gst) l.gst else BigDecimal.ZERO))
                    put("basePrice", JsonNull); put("commOverride", JsonNull)
                }
            }))
            put("payments", JsonArray(payments(d, t.total).filter { num(it.amount).signum() > 0 }.map { x ->
                buildJsonObject { put("mode", x.mode); put("amount", plain(num(x.amount))); put("ref", x.ref); put("accountId", JsonNull) }
            }))
            put("notes", NOTES)
            put("extra", buildJsonObject {})
            put("referrerId", JsonNull); put("fromQuotationIds", JsonArray(emptyList())); put("fromChallanId", JsonNull)
            put("confirmOverLimit", "over_credit_limit" in d.confirmed)
            if ("expired_batch" in d.confirmed) put("confirmExpired", true)
            if ("above_mrp" in d.confirmed) put("confirmAboveMrp", true)
        }
    }

    /** "2026-11-21" + 15 → "2026-12-06" */
    fun addDays(iso: String, n: Int): String {
        if (n == 0) return iso
        val (y, m, d) = iso.split("-").map { it.toInt() }
        val c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")).apply { clear(); set(y, m - 1, d); add(java.util.Calendar.DAY_OF_MONTH, n) }
        return "%04d-%02d-%02d".format(c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH) + 1, c.get(java.util.Calendar.DAY_OF_MONTH))
    }

    /** The bill's terms, the same words the web starts a bill with (state.ts SI_TT.sale). */
    const val NOTES = "Thank you for your business.\nGoods once sold will not be taken back or exchanged.\nSubject to Lucknow jurisdiction."

    /** The server's "Save anyway" questions, by their code. */
    val ASK_AGAIN = setOf("over_credit_limit", "expired_batch", "above_mrp")
}
