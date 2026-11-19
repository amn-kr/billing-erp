package billingo.app.ui.items

import android.app.DatePickerDialog
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.ItemDetail
import billingo.app.data.ItemFull
import billingo.app.data.Movement
import billingo.app.ui.home.unitWord
import billingo.app.ui.parties.Frame
import billingo.app.ui.parties.Waiting
import billingo.app.ui.parts.AmountWithWord
import billingo.app.ui.parts.Badge
import billingo.app.ui.parts.BadgeKind
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.Chips
import billingo.app.ui.parts.ChoiceField
import billingo.app.ui.parts.ChoiceSheet
import billingo.app.ui.parts.Due
import billingo.app.ui.parts.EmptyState
import billingo.app.ui.parts.Field
import billingo.app.ui.parts.Format
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.ListRow
import billingo.app.ui.parts.SectionTitle
import billingo.app.ui.parts.T
import billingo.app.ui.parts.Tabs
import billingo.app.ui.parts.TotalBox
import billingo.app.ui.parts.load
import billingo.app.ui.parts.raised
import billingo.app.ui.start.words
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Size
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.math.BigDecimal

@Composable
private fun hindi() = LocalConfiguration.current.locales[0].language == "hi"

/** "120 Pcs", "−2 Pcs" */
fun qtyUnit(q: BigDecimal, unit: String): String = (if (q.signum() < 0) "−" else "") + Format.qty(q.abs().toPlainString()) + (if (unit.isNotBlank()) " " + unitWord(unit) else "")

/** "₹85", "₹1,390", "₹99.50" */
fun rupees(v: BigDecimal): String = "₹" + Format.inr(v, paise = false)

@Composable
private fun StockBadge(i: ItemFull) = when (ItemMaths.status(i)) {
    ItemMaths.Status.Out -> Badge(stringResource(R.string.i_out), BadgeKind.Due)
    ItemMaths.Status.Low -> Badge(stringResource(R.string.i_low), BadgeKind.Credit)
    else -> {}
}

/**
 * Items (design 7.4c): All / Products / Services, Stock Value / Low Stock / Out Of Stock (tap to
 * show only those), search, brand and stock filters; items of one group under one line.
 */
@Composable
fun ItemsScreen(api: Api, onBack: () -> Unit, onItem: (ItemFull) -> Unit, onLater: () -> Unit) {
    val list = load { api.itemsFull() }
    var kind by rememberSaveable { mutableIntStateOf(0) }
    var st by rememberSaveable { mutableIntStateOf(0) }
    var brand by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var sheet by rememberSaveable { mutableStateOf("") }
    var open by rememberSaveable { mutableStateOf(setOf<String>()) }
    val stNames = listOf(stringResource(R.string.i_all), stringResource(R.string.i_in), stringResource(R.string.i_low_s), stringResource(R.string.i_out_s))

    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.i_title), onBack = onBack, right = { IconBtn(Icons.Scan, stringResource(R.string.i_scan), onLater) }, foot = {
            Btn(stringResource(R.string.i_more), onLater, Modifier.weight(1f), Kind.Soft, Icons.Dots)
            Btn(stringResource(R.string.i_add), onLater, Modifier.weight(1f), Kind.Blue, Icons.Plus)
        }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Tabs(listOf(stringResource(R.string.i_all), stringResource(R.string.i_products), stringResource(R.string.i_services)), kind) { kind = it } }
                val all = list.data
                if (all == null) { item { Waiting(list) }; return@LazyColumn }
                item {
                    val t = ItemMaths.totals(all)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TotalBox(stringResource(R.string.i_value), rupees(t.value), Colours.Text, false, Modifier.weight(1f)) { st = 0 }
                        TotalBox(stringResource(R.string.i_low), t.low.toString(), Colours.Orange, st == 2, Modifier.weight(1f)) { st = if (st == 2) 0 else 2 }
                        TotalBox(stringResource(R.string.i_out), t.out.toString(), Colours.Red, st == 3, Modifier.weight(1f)) { st = if (st == 3) 0 else 3 }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                        Field(null, query, { query = it }, Modifier.weight(1.3f), placeholder = stringResource(R.string.p_search), leading = Icons.Search, keyboard = KeyboardOptions(imeAction = ImeAction.Search))
                        Box(Modifier.padding(bottom = 3.dp)) {
                            IconBtn(Icons.Filter, if (brand.isEmpty()) stringResource(R.string.i_brand) else brand, { sheet = "brand" }, if (brand.isEmpty()) Kind.Line else Kind.Soft)
                        }
                        Box(Modifier.weight(1f)) { ChoiceField(null, stNames[st]) { sheet = "status" } }
                    }
                }
                val k = ItemMaths.Kind.entries[kind]
                val s = ItemMaths.Status.entries[st]
                val shown = all.filter { ItemMaths.matches(it, k, s, brand, query) }.sortedBy { it.name.lowercase() }
                val entries = ItemMaths.entries(shown, all)
                if (entries.isEmpty()) item { EmptyState(Icons.Box, stringResource(R.string.i_none), stringResource(R.string.p_none_sub), stringResource(R.string.i_add), onLater) }
                // a group open by itself while searching or filtering
                val filtering = query.isNotBlank() || brand.isNotEmpty() || st != 0
                items(entries, key = { e -> if (e is ItemMaths.Entry.One) e.item.id else "g:" + (e as ItemMaths.Entry.Group).name }) { e ->
                    when (e) {
                        is ItemMaths.Entry.One -> ItemRow(e.item) { onItem(e.item) }
                        is ItemMaths.Entry.Group -> GroupRow(e, e.name in open || filtering, { open = if (e.name in open) open - e.name else open + e.name }, onItem)
                    }
                }
            }
        }
        if (sheet.isNotEmpty()) BackHandler { sheet = "" }
        when (sheet) {
            "status" -> ChoiceSheet(stringResource(R.string.i_status), stNames, st, { sheet = "" }) { st = it; sheet = "" }
            "brand" -> {
                val brands = listOf(stringResource(R.string.i_all_brands)) + (list.data.orEmpty().map { it.brand }.filter { it.isNotBlank() }.distinctBy { it.lowercase() }.sortedBy { it.lowercase() })
                ChoiceSheet(stringResource(R.string.i_brand), brands, if (brand.isEmpty()) 0 else brands.indexOfFirst { it.equals(brand, true) }, { sheet = "" }) { brand = if (it == 0) "" else brands[it]; sheet = "" }
            }
        }
    }
}

@Composable
private fun ItemRow(i: ItemFull, onClick: () -> Unit) {
    val unit = unitWord(i.unit)
    if (ItemMaths.isService(i)) {
        ListRow(i.name, stringResource(R.string.i_service), onClick) { AmountWithWord(rupees(i.sale), stringResource(R.string.i_per, unit), Due.Settled) }
        return
    }
    ListRow(i.name, stringResource(R.string.i_prices_line, rupees(i.purchase), rupees(i.sale), unit), onClick) {
        AmountWithWord(qtyUnit(i.stock, i.unit), "", Due.Plain)
        StockBadge(i)
    }
}

/** A group (one name, several brands or variants): tap to open; each opens its own item page. */
@Composable
private fun GroupRow(g: ItemMaths.Entry.Group, isOpen: Boolean, onToggle: () -> Unit, onItem: (ItemFull) -> Unit) {
    // the line counts every brand of the group, also those a filter hides
    val first = g.all.first()
    val total = g.all.fold(BigDecimal.ZERO) { a, i -> a + i.stock }
    val from = rupees(g.all.minOf { it.sale })
    val sub = if (g.byBrand) stringResource(R.string.i_brands_n, g.all.size, from) else stringResource(R.string.i_variants_n, g.all.size, from)
    val shape = RoundedCornerShape(Size.Radius)
    Column(Modifier.fillMaxWidth().raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 60.dp).clickable(role = Role.Button, onClick = onToggle).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(Modifier.weight(1f)) {
                T(g.name, weight = FontWeight.SemiBold, oneLine = true)
                T(sub, size = 12.sp, colour = Colours.Text3)
            }
            Column(horizontalAlignment = Alignment.End) {
                T(qtyUnit(total, first.unit), weight = FontWeight.Bold, numbers = true)
                Icon(Icons.Next, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp).rotate(if (isOpen) -90f else 90f))
            }
        }
        if (isOpen) g.members.forEach { i ->
            Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
            Row(
                Modifier.fillMaxWidth().heightIn(min = Size.Tap).clickable(role = Role.Button) { onItem(i) }.padding(start = 24.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    T(ItemMaths.variantName(i), weight = FontWeight.SemiBold, oneLine = true)
                    T(stringResource(R.string.i_sale_line, rupees(i.sale), unitWord(i.unit)), size = 12.sp, colour = Colours.Text3)
                }
                Column(horizontalAlignment = Alignment.End) {
                    T(qtyUnit(i.stock, i.unit), weight = FontWeight.Bold, numbers = true)
                    StockBadge(i)
                }
            }
        }
    }
}

/**
 * An item's page (design 7.4c): stock with its value, Adjust / Prices / Barcode, the prices with
 * margin, stock by batch and by godown, and every movement with All / Sale / Buy / Adjust.
 */
@Composable
fun ItemScreen(api: Api, id: String, name: String, onBack: () -> Unit, onAdjust: () -> Unit, onLater: () -> Unit) {
    val hi = hindi()
    val it = load(id) { api.item(id) }
    var filter by rememberSaveable { mutableIntStateOf(0) }
    val d = it.data
    val goods = d?.kind != "service"
    Frame(
        d?.name ?: name,
        d?.let { listOf("${it.brand} ${it.series}".trim(), it.category, it.code).filter { s -> s.isNotBlank() }.joinToString(" · ") },
        onBack,
        right = { IconBtn(Icons.Edit, stringResource(R.string.later_step), onLater) },
        foot = if (d == null || !goods) null else ({
            Btn(stringResource(R.string.ip_adjust_stock), onAdjust, Modifier.weight(1f), Kind.Soft)
            Btn(stringResource(R.string.ip_sell), onLater, Modifier.weight(1f), Kind.Blue, Icons.Plus)
        }),
    ) {
        if (d == null) { Waiting(it); return@Frame }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (goods) item { StockCard(d, onAdjust, onLater) }
            item { SectionTitle(stringResource(R.string.ip_prices)) }
            item { PriceTable(d) }
            val batches = d.batches?.rows.orEmpty()
            if (goods && batches.isNotEmpty()) {
                item { SectionTitle(stringResource(R.string.ip_by_batch)) }
                item {
                    Group(batches.map { b ->
                        Triple(
                            if (b.no.isBlank()) stringResource(R.string.ip_no_batch) else stringResource(R.string.ip_batch, b.no),
                            listOfNotNull(stringResource(R.string.ip_rate, rupees(b.rate)), b.expiry?.takeIf { e -> e.isNotBlank() }?.let { e -> stringResource(R.string.ip_expiry, e) }).joinToString(" · "),
                            qtyUnit(b.qty, d.unit),
                        )
                    })
                }
            }
            if (goods) {
                item { SectionTitle(stringResource(R.string.ip_by_godown)) }
                item { Group(d.godowns.map { g -> Triple(g.name, "", qtyUnit(g.stock, d.unit)) }) }
                item { SectionTitle(stringResource(R.string.ip_tx)) }
                item { Chips(listOf(stringResource(R.string.i_all), stringResource(R.string.ip_f_sale), stringResource(R.string.ip_f_buy), stringResource(R.string.ip_f_adj)), filter) { filter = it } }
                val rows = d.movements.filter { m -> ItemMaths.inFilter(m, ItemMaths.Filter.entries[filter]) }
                if (rows.isEmpty()) item { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { T(stringResource(R.string.ip_none), weight = FontWeight.Bold, colour = Colours.Text3) } }
                items(rows, key = { m -> m.id }) { m -> MoveRow(m, d.unit, hi) }
            }
        }
    }
}

@Composable
private fun StockCard(d: ItemDetail, onAdjust: () -> Unit, onLater: () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    val c = when { d.stock.signum() <= 0 || d.level == "out" -> Colours.Red; d.level == "low" -> Colours.Orange; else -> Colours.Text }
    Column(
        Modifier.fillMaxWidth().raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                T(stringResource(R.string.ip_stock), size = 12.sp, colour = Colours.Text3)
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    T(Format.qty(d.stock.toPlainString()), size = 26.sp, weight = FontWeight.Bold, colour = c, numbers = true)
                    T(unitWord(d.unit), Modifier.padding(bottom = 4.dp), size = 14.sp, weight = FontWeight.SemiBold, colour = Colours.Text2)
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                T(stringResource(R.string.i_value), size = 12.sp, colour = Colours.Text3)
                T("₹" + Format.inr(d.rateTable?.value ?: d.value), size = 14.sp, weight = FontWeight.Bold, numbers = true)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Btn(stringResource(R.string.ip_adjust), onAdjust, Modifier.weight(1f), Kind.Soft, small = true)
            Btn(stringResource(R.string.ip_prices_btn), onLater, Modifier.weight(1f), Kind.Soft, small = true)
            Btn(stringResource(R.string.ip_barcode), onLater, Modifier.weight(1f), Kind.Soft, small = true)
        }
    }
}

/** The prices as label and value lines (.kv). */
@Composable
private fun PriceTable(d: ItemDetail) {
    val unit = unitWord(d.unit)
    val rows = mutableListOf(stringResource(R.string.ip_sale) to rupees(d.sale))
    if (d.kind != "service") {
        rows += stringResource(R.string.ip_purchase) to rupees(d.purchase)
        if (d.mrp.signum() > 0) rows += "MRP" to rupees(d.mrp)
        val (m, pct) = ItemMaths.margin(d.sale, d.purchase)
        rows += stringResource(R.string.ip_margin) to "${rupees(m)} (${pct.toPlainString()}%)"
        if (d.wholesale.signum() > 0) rows += stringResource(R.string.ip_wholesale) to "${rupees(d.wholesale)} · ${Format.qty(d.wholesaleMinQty.toPlainString())}+ $unit"
    }
    rows += "GST" to ("${d.gstRate.removeSuffix(".00").removeSuffix(".0")}%" + if (d.hsn.isNotBlank()) " · HSN ${d.hsn}" else "")
    Group(rows.map { (k, v) -> Triple(k, "", v) }, quiet = true)
}

/** A white box of rows: name (and a small line) on the left, a value on the right. */
@Composable
private fun Group(rows: List<Triple<String, String, String>>, quiet: Boolean = false) {
    val shape = RoundedCornerShape(Size.Radius)
    Column(Modifier.fillMaxWidth().raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)) {
        rows.forEachIndexed { n, (k, sub, v) ->
            if (n > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
            Row(Modifier.fillMaxWidth().heightIn(min = Size.Tap).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    T(k, size = if (quiet) 14.sp else 15.sp, colour = if (quiet) Colours.Text2 else Colours.Text, weight = if (quiet) FontWeight.Normal else FontWeight.SemiBold)
                    if (sub.isNotBlank()) T(sub, size = 12.sp, colour = Colours.Text3)
                }
                T(v, weight = FontWeight.Bold, numbers = true)
            }
        }
    }
}

@Composable
private fun MoveRow(m: Movement, unit: String, hi: Boolean) {
    val word = stringResource(
        when (ItemMaths.word(m)) {
            ItemMaths.Word.Sale -> R.string.mv_sale
            ItemMaths.Word.Return -> R.string.mv_return
            ItemMaths.Word.Purchase -> R.string.mv_purchase
            ItemMaths.Word.PurchaseReturn -> R.string.mv_debit
            ItemMaths.Word.Cancelled -> R.string.mv_cancel
            ItemMaths.Word.Adjustment -> R.string.mv_adj
            ItemMaths.Word.Transfer -> R.string.mv_transfer
            ItemMaths.Word.Opening -> R.string.mv_opening
            ItemMaths.Word.Challan -> R.string.mv_challan
        },
    )
    val sub = listOfNotNull(m.ref.takeIf { it.isNotBlank() }, Format.date(m.date, hi), m.party.takeIf { it.isNotBlank() }).joinToString(" | ")
    val c: Color = if (m.qty.signum() < 0) Colours.Red else Colours.Green
    ListRow(word, sub, null) {
        T((if (m.qty.signum() > 0) "+" else "") + qtyUnit(m.qty, unit), weight = FontWeight.Bold, colour = c, numbers = true, oneLine = true)
    }
}

/** The reasons for adjusting stock (design 7.4c); saved in English, as on the web. */
private val REASONS = listOf(
    R.string.r_count to "Physical count correction", R.string.r_damaged to "Damaged", R.string.r_expired to "Expired",
    R.string.r_lost to "Lost or stolen", R.string.r_free to "Free sample / gift", R.string.r_own to "Own use", R.string.r_other to "Other",
)

/**
 * Adjust Stock (design 7.4c): Add or Reduce, the quantity with "Stock After", price per unit,
 * reason, batch no. and date.
 */
@Composable
fun AdjustScreen(api: Api, id: String, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val hi = hindi()
    val scope = rememberCoroutineScope()
    val it = load(id) { api.item(id) }
    var add by rememberSaveable { mutableStateOf(true) }
    var qty by rememberSaveable { mutableStateOf("") }
    var rate by rememberSaveable { mutableStateOf<String?>(null) }
    var reason by rememberSaveable { mutableIntStateOf(0) }
    var batch by rememberSaveable { mutableStateOf("") }
    var date by rememberSaveable { mutableStateOf(Format.todayIso()) }
    var sheet by rememberSaveable { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val d = it.data
    val needQty = stringResource(R.string.aj_err)
    val reasons = REASONS.map { r -> stringResource(r.first) }

    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.aj_title), d?.name, onBack, foot = if (d == null) null else ({
            Btn(stringResource(R.string.aj_save), {
                val q = qty.replace(",", "").trim().toBigDecimalOrNull()
                if (q == null || q.signum() <= 0) { err = needQty; return@Btn }
                busy = true; err = null
                scope.launch {
                    try {
                        api.adjustStock(buildJsonObject {
                            put("itemId", d.id); put("mode", if (add) "add" else "reduce"); put("qty", q.toPlainString())
                            put("rate", (rate ?: d.purchase.toPlainString()).replace(",", "").ifBlank { "0" }); put("date", date)
                            put("reason", REASONS[reason].second); if (batch.isNotBlank()) put("batchNo", batch.trim())
                        })
                        Toast.makeText(ctx, ctx.getString(R.string.aj_saved, (if (add) "+" else "−") + qtyUnit(q, d.unit)), Toast.LENGTH_SHORT).show()
                        onBack()
                    } catch (e: ApiError) { err = if (e.status == 0) ctx.getString(R.string.no_internet) else e.message } finally { busy = false }
                }
            }, Modifier.weight(1f), Kind.Green, Icons.Check, busy = busy)
        })) {
            if (d == null) { Waiting(it); return@Frame }
            Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(stringResource(R.string.aj_add) to true, stringResource(R.string.aj_reduce) to false).forEach { (t, v) ->
                        val on = add == v
                        val shape = RoundedCornerShape(Size.RadiusSmall)
                        Box(
                            Modifier.weight(1f).heightIn(min = Size.Tap).background(if (on) Colours.LightBlue else Colours.Card, shape).border(1.dp, if (on) Colours.Blue else Colours.Border, shape)
                                .clickable(role = Role.RadioButton) { add = v },
                            contentAlignment = Alignment.Center,
                        ) { T(t, size = 14.sp, weight = FontWeight.SemiBold, colour = if (on) Colours.Blue else Colours.Text2) }
                    }
                }
                Field(stringResource(R.string.aj_qty), qty, { qty = it; err = null }, placeholder = "0", bold = true, error = err,
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    trailing = { T(unitWord(d.unit), Modifier.padding(end = 10.dp), colour = Colours.Text2, weight = FontWeight.SemiBold) })
                val after = ItemMaths.after(d.stock, qty, add)
                val shape = RoundedCornerShape(Size.Radius)
                Row(Modifier.fillMaxWidth().background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    T(stringResource(R.string.aj_after), Modifier.weight(1f), size = 13.sp, colour = Colours.Text2)
                    T(qtyUnit(d.stock, d.unit) + " → " + qtyUnit(after, d.unit), weight = FontWeight.Bold, colour = if (after.signum() < 0) Colours.Red else Colours.Text, numbers = true)
                }
                Field(stringResource(R.string.aj_price), rate ?: d.purchase.stripTrailingZeros().toPlainString(), { rate = it }, prefix = "₹", bold = true, keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                ChoiceField(stringResource(R.string.aj_reason), reasons[reason]) { sheet = true }
                Field(stringResource(R.string.aj_batch), batch, { batch = it }, placeholder = stringResource(R.string.aj_batch_ph))
                Box {
                    Field(stringResource(R.string.aj_date), Format.date(date, hi), {}, leading = Icons.Calendar, readOnly = true)
                    Box(Modifier.matchParentSize().clickable(role = Role.Button) {
                        val (y, mo, dd) = date.split("-").map { n -> n.toInt() }
                        DatePickerDialog(ctx, { _, yy, mm, d2 -> date = "%04d-%02d-%02d".format(yy, mm + 1, d2) }, y, mo - 1, dd).show()
                    })
                }
            }
        }
        if (sheet) {
            BackHandler { sheet = false }
            ChoiceSheet(stringResource(R.string.aj_reason), reasons, reason, { sheet = false }) { reason = it; sheet = false }
        }
    }
}
