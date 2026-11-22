package billingo.app.ui.sale

import billingo.app.data.ItemFull
import billingo.app.data.PartyFull
import billingo.app.data.PriceList
import billingo.app.data.Prices
import billingo.app.data.CommissionRule
import billingo.app.data.Referrer
import billingo.app.data.SaleDoc
import billingo.app.data.ShopSettings
import billingo.app.data.StockBatch
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
        /** saved commission rules: item category → rule */
        val rules: Map<String, Rule> = emptyMap(),
        val referrers: List<Referrer> = emptyList(),
        /** Settings › Items › Batch No.: item id → its batches (empty with the feature off) */
        val batches: Map<String, List<StockBatch>> = emptyMap(),
    )

    /** A commission rule: n = none, p = % of the sale price, f = ₹ per unit (the server's commRule). */
    data class Rule(val t: Char, val v: BigDecimal) { companion object { val NONE = Rule('n', BigDecimal.ZERO) } }

    fun rule(r: CommissionRule): Rule = Rule(when (r.kind) { "percent" -> 'p'; "fixed" -> 'f'; else -> 'n' }, r.value.toBigDecimalOrNull() ?: BigDecimal.ZERO)

    fun ctx(
        settings: ShopSettings, stateCode: String?, lists: List<PriceList>, prices: Prices, features: List<String>, items: List<ItemFull>, parties: List<PartyFull>,
        rules: List<CommissionRule> = emptyList(), referrers: List<Referrer> = emptyList(), batches: Map<String, List<StockBatch>> = emptyMap(),
    ): Ctx {
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
            rules = rules.associate { it.category to rule(it) }, referrers = referrers, batches = batches,
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
        /** the item's category, for its commission rule */
        val category: String = "",
        /** referral: the rate before the commission was loaded on it */
        val bp: BigDecimal? = null,
        /** the batch chosen by hand; none = the server picks, earliest expiry first */
        val batchId: String? = null,
        /** brought in from this quotation: its rate stays as quoted */
        val fromQ: String? = null,
        /** 8.6b, a saved line: the batches it took stock from (kept while its stock quantity is the same) */
        val alloc: List<Pair<String?, BigDecimal>> = emptyList(),
        /** 8.6b, a saved line: its own commission rule from the web (sent back unchanged) */
        val commOv: kotlinx.serialization.json.JsonElement? = null,
    )

    data class QuoteRef(val id: String, val no: String, val date: String, val cust: String)

    data class Pay(val mode: String = "Cash", val amount: String = "", val ref: String = "", val acct: String? = null)

    /**
     * Edit Bill (8.6b): the saved bill and what the phone doesn't change on it, sent back as it was
     * (the web's fillFrom 'edit'). The bill keeps its number; [bal] is what it still owed, so the
     * customer's dues are counted without it while it is changed.
     */
    data class Edit(
        val id: String,
        val number: String,
        val partyId: String?,
        val dueDate: String?,
        val cashName: String,
        val cashPhone: String,
        val billName: String,
        val pos: String,
        val incl: Boolean,
        val notes: String,
        val extra: JsonObject,
        val bal: BigDecimal,
    )

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
        /** referral: who sent the customer, and a rule for this bill only (null = the saved rules) */
        val referrerId: String? = null,
        val billRule: Rule? = null,
        /** quotations brought into this bill */
        val quotes: List<QuoteRef> = emptyList(),
        /** Bill Details */
        val transport: String = "",
        val vehicle: String = "",
        val description: String = "",
        /** 8.6b: the saved bill being changed (null = a new bill) */
        val edit: Edit? = null,
        /** 8.6b: rules set on the saved bill for some categories only (the web's commByCategory) */
        val catRules: Map<String, Rule> = emptyMap(),
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
        val l = Line(i.id, i.name, i.hsn, unit, "1", priceFor(c, i, party(c, d), unit), BigDecimal.ZERO, if (c.mode == BillMaths.Mode.Gst) i.gstRate.toBigDecimalOrNull() ?: BigDecimal.ZERO else BigDecimal.ZERO, i.category)
        return withCommission(c, d, l)
    }

    /** Another customer: every line gets that customer's list price again (as on the web). */
    fun withParty(c: Ctx, d: Draft, p: PartyFull?): Draft {
        val nd = d.copy(partyId = p?.id, confirmed = emptySet())
        return nd.copy(lines = nd.lines.map { l ->
            val i = item(c, l.itemId)
            if (i == null || l.fromQ != null) l
            else withCommission(c, nd, if (l.bp != null) l.copy(bp = priceFor(c, i, p, l.unit)) else l.copy(price = priceFor(c, i, p, l.unit)))
        })
    }

    fun num(s: String): BigDecimal = s.replace(",", "").trim().toBigDecimalOrNull() ?: BigDecimal.ZERO

    /** The rate after the discount, to paise. */
    fun finalRate(l: Line): BigDecimal = BillMaths.round2(l.price.multiply(BigDecimal.ONE - l.disc.movePointLeft(2)))

    /**
     * A typed final rate → the discount % from the list rate (web frSet). Any final rate is allowed,
     * and however large it is the sale price is never changed (owner, 21 Nov 2026): above the list
     * rate it is a minus discount. Only with no list rate does the typed rate become the price.
     */
    fun withFinal(l: Line, typed: BigDecimal): Line {
        val v = typed.max(BigDecimal.ZERO)
        val p = l.price
        if (p.signum() <= 0) return l.copy(price = v, disc = BigDecimal.ZERO)
        return l.copy(disc = (p - v).divide(p, 20, RoundingMode.HALF_UP).movePointRight(2).setScale(8, RoundingMode.HALF_UP).stripTrailingZeros())
    }

    /** The place of supply: a saved bill keeps its own while its customer is the same. */
    fun pos(c: Ctx, d: Draft): String {
        val e = d.edit
        return if (e != null && e.pos.isNotBlank() && e.partyId == d.partyId && !d.cash == (e.partyId != null)) e.pos else partyState(c, party(c, d))
    }

    /** What the customer owed before this bill: a saved bill's own dues are taken out while it is changed (web editBal). */
    fun before(d: Draft, p: PartyFull): BigDecimal {
        val e = d.edit ?: return p.balance
        return if (e.partyId == p.id) p.balance - e.bal else p.balance
    }

    fun bill(c: Ctx, d: Draft): BillMaths.Bill = BillMaths.Bill(
        mode = c.mode, incl = d.edit?.incl ?: true, inter = pos(c, d) != c.state, roundOff = d.roundOff,
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
        val e = d.edit
        // a saved bill keeps its due date while its customer and date are the same
        val due = if (d.cash) d.date else if (e?.dueDate != null && e.partyId == p?.id && e.dueDate >= d.date) e.dueDate else addDays(d.date, p?.creditDays ?: 0)
        return buildJsonObject {
            // a saved bill is sent without a number: the server keeps its own (it can never change)
            put("kind", "invoice"); put("number", ""); put("date", d.date); put("dueDate", due)
            put("mode", if (d.cash) "cash" else "credit"); put("partyId", p?.id?.let(::JsonPrimitive) ?: JsonNull)
            put("cashName", if (d.cash) e?.cashName.orEmpty() else ""); put("cashPhone", if (d.cash) e?.cashPhone.orEmpty() else ""); put("billName", e?.billName.orEmpty()); put("placeOfSupply", pos(c, d))
            put("pricesInclTax", e?.incl ?: true); put("roundOff", d.roundOff)
            val bp = d.bdiscP.takeIf { it.isNotBlank() && num(it).signum() != 0 }
            put("billDiscPct", bp?.let { JsonPrimitive(plain(num(it))) } ?: JsonNull)
            put("billDiscAmt", if (bp == null && num(d.bdisc).signum() != 0) JsonPrimitive(plain(num(d.bdisc))) else JsonNull)
            put("transport", plain(num(d.chTr))); put("labour", plain(num(d.chLab))); put("bankCharge", plain(num(d.chBank)))
            put("lines", JsonArray(d.lines.map { l ->
                buildJsonObject {
                    put("itemId", l.itemId); put("name", l.name); put("hsn", l.hsn); put("qty", plain(num(l.qty))); put("unit", l.unit)
                    put("price", plain(l.price)); put("discPct", plain(l.disc)); put("gstRate", plain(if (c.mode == BillMaths.Mode.Gst) l.gst else BigDecimal.ZERO))
                    put("basePrice", l.bp?.let { JsonPrimitive(plain(it)) } ?: JsonNull); put("commOverride", l.commOv ?: JsonNull)
                    val allocs = allocOf(c, l)
                    if (allocs.isNotEmpty()) put("batches", JsonArray(allocs.map { (b, q) -> buildJsonObject { put("batchId", b?.let(::JsonPrimitive) ?: JsonNull); put("qty", plain(q)) } }))
                }
            }))
            put("payments", JsonArray(payments(d, t.total).filter { num(it.amount).signum() > 0 }.map { x ->
                buildJsonObject { put("mode", x.mode); put("amount", plain(num(x.amount))); put("ref", x.ref); put("accountId", x.acct?.let(::JsonPrimitive) ?: JsonNull) }
            }))
            put("notes", e?.notes ?: NOTES)
            put("extra", buildJsonObject {
                // a saved bill's other details (challan no., PO, e-way bill, attachments …) go back as they were
                e?.extra?.forEach { (k, v) -> put(k, v) }
                put("transport", d.transport.trim()); put("vehicle", d.vehicle.trim()); put("description", d.description.trim())
                put("quoteRefs", JsonArray(d.quotes.map { q -> buildJsonObject { put("no", q.no); put("date", q.date); put("cust", q.cust); put("brand", "Item-wise") } }))
                // a rule set for this bill: for every category on it (the web keeps it per category)
                put("commByCategory", buildJsonObject {
                    val r = d.billRule
                    if (d.referrerId != null && r != null) d.lines.map { it.category }.distinct().forEach { cat ->
                        put(cat, buildJsonObject { put("t", r.t.toString()); put("v", plain(r.v)) })
                    } else if (d.referrerId != null) d.catRules.forEach { (cat, x) -> put(cat, buildJsonObject { put("t", x.t.toString()); put("v", plain(x.v)) }) }
                })
            })
            put("referrerId", d.referrerId?.let(::JsonPrimitive) ?: JsonNull)
            put("fromQuotationIds", JsonArray(d.quotes.filter { it.id.isNotBlank() }.map { JsonPrimitive(it.id) })); put("fromChallanId", JsonNull)
            put("confirmOverLimit", "over_credit_limit" in d.confirmed)
            if ("expired_batch" in d.confirmed) put("confirmExpired", true)
            if ("above_mrp" in d.confirmed) put("confirmAboveMrp", true)
        }
    }

    /* ───────── referral (8.5c), as the web's cmApply / lineCommission ───────── */

    /** The rule for a line: this bill's rule, else its category's saved rule. */
    fun ruleFor(c: Ctx, d: Draft, l: Line): Rule = d.billRule ?: d.catRules[l.category] ?: c.rules[l.category] ?: Rule.NONE

    /**
     * Loads the referral commission on top of the rate, or takes it off: % of the sale price, or ₹ per
     * unit (a fixed amount is per pack, so a loose unit carries its share).
     */
    fun withCommission(c: Ctx, d: Draft, l: Line): Line {
        val base = l.bp ?: l.price
        val r = if (d.referrerId != null) ruleFor(c, d, l) else Rule.NONE
        if (d.referrerId != null && r.t != 'n' && r.v.signum() > 0) {
            val i = item(c, l.itemId)
            val pk = i?.let { pack(it) }
            val fixed = if (r.t == 'f' && pk != null && l.unit != pk.first) r.v.divide(pk.second, 20, RoundingMode.HALF_UP) else r.v
            val price = BillMaths.round2(if (r.t == 'p') base.multiply(BigDecimal.ONE + r.v.movePointLeft(2)) else base + fixed)
            return l.copy(bp = base, price = price)
        }
        return if (l.bp != null) l.copy(price = base, bp = null) else l
    }

    fun withReferrer(c: Ctx, d: Draft, id: String?): Draft {
        val nd = d.copy(referrerId = id, billRule = if (id == null) null else d.billRule)
        return nd.copy(lines = nd.lines.map { withCommission(c, nd, it) })
    }

    fun withBillRule(c: Ctx, d: Draft, r: Rule?): Draft {
        val nd = d.copy(billRule = r)
        return nd.copy(lines = nd.lines.map { withCommission(c, nd, it) })
    }

    /** One line's commission: qty × (1 − disc%) × (rate − base), without GST since rates include it (server lineCommission). */
    fun lineCommission(c: Ctx, l: Line): BigDecimal {
        val bp = l.bp ?: return BigDecimal.ZERO
        val net = num(l.qty).multiply(BigDecimal.ONE - l.disc.movePointLeft(2)).multiply(l.price - bp)
        val g = if (c.mode == BillMaths.Mode.Gst) l.gst else BigDecimal.ZERO
        return BillMaths.round2(if (g.signum() != 0) net.divide(BigDecimal.ONE + g.movePointLeft(2), 20, RoundingMode.HALF_UP) else net)
    }

    /* ───────── batches (8.5c) ───────── */

    /** How much stock a line moves: in packs, the pack size × the quantity. */
    fun stockQty(c: Ctx, l: Line): BigDecimal {
        val pk = item(c, l.itemId)?.let { pack(it) }
        return if (pk != null && l.unit == pk.first) num(l.qty).multiply(pk.second) else num(l.qty)
    }

    fun expired(b: StockBatch, today: String) = b.expiry != null && b.expiry.take(10) < today

    /** The order batches are shown in (shared sortBatches): expired first so they are seen, then No batch, then earliest expiry. */
    fun sortedBatches(c: Ctx, itemId: String, today: String): List<StockBatch> {
        fun rank(b: StockBatch) = when { expired(b, today) -> 0; b.id == null -> 1; b.expiry != null -> 2; else -> 3 }
        return c.batches[itemId].orEmpty().sortedWith(compareBy<StockBatch>({ rank(it) }, { it.expiry ?: "" }, { it.no }))
    }

    /** The batch the server will use when none is chosen: the first one in order that isn't expired and has stock. */
    fun autoBatch(c: Ctx, itemId: String, today: String): StockBatch? =
        sortedBatches(c, itemId, today).firstOrNull { !expired(it, today) && (it.qty.toBigDecimalOrNull() ?: BigDecimal.ZERO).signum() > 0 }

    /* ───────── quotations (8.5c) ───────── */

    /**
     * An item-wise quotation into the bill (web ImportQuote): its items at the quoted rates (they stay
     * as quoted), the quotation remembered on the bill, its customer when the bill has none, and its
     * referral when the bill has none.
     */
    fun withQuote(c: Ctx, d: Draft, q: SaleDoc): Pair<Draft, Int> {
        val lines = q.lines.mapNotNull { dl ->
            val i = dl.itemId?.let { item(c, it) } ?: return@mapNotNull null
            val base = newLine(c, d.copy(referrerId = null), i)
            base.copy(
                unit = if (dl.unit == i.unit || dl.unit == pack(i)?.first) dl.unit else base.unit,
                qty = num(dl.qty).let { plain(it) }, price = num(dl.price), disc = num(dl.discPct),
                gst = if (c.mode == BillMaths.Mode.Gst) num(dl.gstRate) else BigDecimal.ZERO, fromQ = q.number,
            )
        }
        var nd = d.copy(lines = d.lines + lines, quotes = d.quotes.filter { it.id != q.id } + QuoteRef(q.id, q.number, q.date, q.partyName))
        if (q.referrerId != null && nd.referrerId == null) nd = nd.copy(referrerId = q.referrerId)
        if (nd.partyId == null) {
            val p = q.party?.let { qp -> c.parties.firstOrNull { it.id == qp.id } } ?: c.parties.firstOrNull { q.partyName.isNotBlank() && it.name.trim().equals(q.partyName.trim(), ignoreCase = true) }
            if (p != null) nd = withParty(c, nd.copy(cash = false), p)
        }
        return nd to lines.size
    }

    /**
     * The batches a line is sent with: the one chosen by hand; else, on a saved bill, the batches it
     * already took while its stock quantity is unchanged; else none (the server picks, earliest expiry first).
     */
    fun allocOf(c: Ctx, l: Line): List<Pair<String?, BigDecimal>> {
        if (l.batchId != null) return listOf(l.batchId to stockQty(c, l))
        if (l.alloc.isNotEmpty() && l.alloc.fold(BigDecimal.ZERO) { a, x -> a + x.second }.compareTo(stockQty(c, l)) == 0) return l.alloc
        return emptyList()
    }

    /* ───────── Edit Bill (8.6b) ───────── */

    /** A rule as the server keeps it ({"t": "p", "v": 5}). */
    private fun ruleOf(o: kotlinx.serialization.json.JsonElement?): Rule? {
        val j = o as? JsonObject ?: return null
        val t = (j["t"] as? JsonPrimitive)?.contentOrNull?.firstOrNull() ?: return null
        return Rule(t, (j["v"] as? JsonPrimitive)?.contentOrNull?.toBigDecimalOrNull() ?: BigDecimal.ZERO)
    }

    /** A saved bill as a draft (the web's fillFrom 'edit'), or the names of its items that are no longer in the shop's list. */
    fun fromSaved(c: Ctx, v: SaleDoc): Pair<Draft?, List<String>> {
        val missing = v.lines.filter { l -> l.itemId == null || item(c, l.itemId) == null }.map { it.name }
        if (missing.isNotEmpty()) return null to missing
        val pId = v.party?.id?.takeIf { id -> c.parties.any { it.id == id } }
        val cash = v.mode == "cash" || v.party == null
        val x = v.extra ?: JsonObject(emptyMap())
        fun str(k: String) = (x[k] as? JsonPrimitive)?.contentOrNull.orEmpty()
        val cats = (x["commByCategory"] as? JsonObject).orEmpty().mapNotNull { (k, r) -> ruleOf(r)?.let { k to it } }.toMap()
        val ref = v.referrerId
        val lines = v.lines.map { dl ->
            val i = item(c, dl.itemId!!)!!
            Line(
                itemId = i.id, name = dl.name.ifBlank { i.name }, hsn = dl.hsn.ifBlank { i.hsn },
                unit = dl.unit.ifBlank { i.unit }, qty = plain(num(dl.qty)), price = num(dl.price), disc = num(dl.discPct),
                gst = if (c.mode == BillMaths.Mode.Gst) num(dl.gstRate) else BigDecimal.ZERO, category = i.category,
                bp = if (ref != null) dl.basePrice?.toBigDecimalOrNull() else null,
                alloc = dl.batches.map { it.batchId to num(it.qty) }, commOv = dl.commOverride?.takeIf { it !is JsonNull },
            )
        }
        val splits = v.payment?.splits.orEmpty().filter { num(it.amount).signum() > 0 }
        val pays = if (splits.isEmpty()) listOf(Pay()) else splits.map { Pay(it.mode, plain(num(it.amount)), it.ref, it.accountId) }
        val rest = JsonObject(x.filterKeys { it !in setOf("transport", "vehicle", "description", "quoteRefs", "commByCategory") })
        val quotes = (x["quoteRefs"] as? JsonArray).orEmpty().mapNotNull { r ->
            val o = r as? JsonObject ?: return@mapNotNull null
            fun f(k: String) = (o[k] as? JsonPrimitive)?.contentOrNull.orEmpty()
            // already joined to this bill on the server: kept on the bill, nothing to convert again
            f("no").takeIf { it.isNotBlank() }?.let { QuoteRef(id = "", no = it, date = f("date"), cust = f("cust")) }
        }
        val draft = Draft(
            cash = cash, number = v.number, date = v.date, partyId = if (cash) null else pId, lines = lines,
            bdisc = num(v.billDiscount).takeIf { it.signum() != 0 }?.let(::plain).orEmpty(),
            chTr = num(v.transport).takeIf { it.signum() != 0 }?.let(::plain).orEmpty(),
            chLab = num(v.labour).takeIf { it.signum() != 0 }?.let(::plain).orEmpty(),
            chBank = num(v.bankCharge).takeIf { it.signum() != 0 }?.let(::plain).orEmpty(),
            roundOff = v.roundOff, chgOk = true, pays = pays, payTouched = true,
            referrerId = ref, catRules = cats, quotes = quotes,
            transport = str("transport"), vehicle = str("vehicle"), description = str("description"),
            edit = Edit(
                id = v.id, number = v.number, partyId = if (cash) null else pId, dueDate = v.dueDate, cashName = v.cashName, cashPhone = v.cashPhone,
                billName = v.billName, pos = v.placeOfSupply, incl = v.pricesInclTax, notes = v.notes, extra = rest, bal = num(v.balance),
            ),
        )
        return draft to emptyList()
    }

    /** While a saved bill is changed, the stock it took counts as back in its batches (web batchWas). */
    fun withSavedStock(c: Ctx, d: Draft): Ctx {
        if (d.edit == null || d.lines.none { it.alloc.isNotEmpty() }) return c
        val back = mutableMapOf<String, MutableMap<String?, BigDecimal>>()
        for (l in d.lines) for ((b, q) in l.alloc) back.getOrPut(l.itemId) { mutableMapOf() }.merge(b, q, BigDecimal::add)
        val batches = c.batches.toMutableMap()
        for ((itemId, m) in back) {
            val have = batches[itemId].orEmpty().toMutableList()
            for ((b, q) in m) {
                val k = have.indexOfFirst { it.id == b }
                if (k >= 0) have[k] = have[k].copy(qty = plain((have[k].qty.toBigDecimalOrNull() ?: BigDecimal.ZERO) + q))
            }
            batches[itemId] = have
        }
        return c.copy(batches = batches)
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
