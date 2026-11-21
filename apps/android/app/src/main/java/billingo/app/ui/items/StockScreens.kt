package billingo.app.ui.items

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
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
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.AdjustmentRow
import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.Godown
import billingo.app.data.ItemFull
import billingo.app.data.PriceChange
import billingo.app.data.Transfer
import billingo.app.ui.home.unitWord
import billingo.app.ui.parties.Frame
import billingo.app.ui.parties.NewGroupSheet
import billingo.app.ui.parties.Seg2
import billingo.app.ui.parties.Waiting
import billingo.app.ui.parts.Badge
import billingo.app.ui.parts.BadgeKind
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.ChoiceField
import billingo.app.ui.parts.ChoiceSheet
import billingo.app.ui.parts.Dim
import billingo.app.ui.parts.EmptyState
import billingo.app.ui.parts.Field
import billingo.app.ui.parts.Format
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.ListRow
import billingo.app.ui.parts.SectionTitle
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.Spinner
import billingo.app.ui.parts.T
import billingo.app.ui.parts.Tabs
import billingo.app.ui.parts.load
import billingo.app.ui.parts.raised
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Size
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.math.BigDecimal

@Composable
private fun hindi() = LocalConfiguration.current.locales[0].language == "hi"

private fun say(ctx: android.content.Context, text: String) = Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show()

/** The server's reason, or "No internet connection." in the phone's language. */
private fun why(ctx: android.content.Context, e: ApiError) = if (e.status == 0) ctx.getString(R.string.no_internet) else e.message

/** A white box of tappable rows with lines between them (.grp + .srow). */
@Composable
private fun RowGroup(rows: List<Pair<ImageVector, String>>, onTap: (Int) -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Column(Modifier.fillMaxWidth().background(Colours.Card, shape).border(1.dp, Colours.Border, shape)) {
        rows.forEachIndexed { n, (icon, text) ->
            if (n > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
            Row(
                Modifier.fillMaxWidth().heightIn(min = Size.Tap).clickable(role = Role.Button) { onTap(n) }.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(icon, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(20.dp))
                T(text, Modifier.weight(1f))
            }
        }
    }
}

/** Items › More (design 7.4c): the other item screens. Importing from Excel stays on the computer (owner). */
@Composable
fun ItemsMoreSheet(onClose: () -> Unit, onPick: (Int) -> Unit) {
    Dim(onClose) {
        Sheet(stringResource(R.string.im_title)) {
            RowGroup(
                listOf(
                    Icons.Rupee to stringResource(R.string.im_prices),
                    Icons.Check to stringResource(R.string.im_bulk),
                    Icons.Box to stringResource(R.string.im_brands),
                    Icons.Filter to stringResource(R.string.im_adjs),
                    Icons.Cart to stringResource(R.string.im_godowns),
                    Icons.Share to stringResource(R.string.im_rate),
                ),
                onPick,
            )
            T(stringResource(R.string.im_excel), size = 12.sp, colour = Colours.Text3)
        }
    }
}

/** A list row with a tick box in front (.li.ck), for Price Setup and Bulk Active / Inactive. */
@Composable
private fun TickRow(name: String, sub: String, ticked: Boolean, onTick: (() -> Unit)?, end: @Composable () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    val tickLabel = stringResource(R.string.pm_select)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 60.dp).raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)
            .then(if (onTick != null) Modifier.clickable(role = Role.Checkbox, onClick = onTick).semantics { contentDescription = "$tickLabel $name" } else Modifier)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (onTick != null) {
            val box = RoundedCornerShape(5.dp)
            Box(Modifier.size(22.dp).background(if (ticked) Colours.Blue else Colours.Card, box).border(if (ticked) 0.dp else 2.dp, Colours.Text3, box), contentAlignment = Alignment.Center) {
                if (ticked) Icon(Icons.Check, contentDescription = null, tint = Colours.OnColour, modifier = Modifier.size(16.dp))
            }
        }
        Column(Modifier.weight(1f)) {
            T(name, weight = FontWeight.SemiBold, oneLine = true)
            if (sub.isNotBlank()) T(sub, size = 12.sp, colour = Colours.Text3)
        }
        Column(horizontalAlignment = Alignment.End) { end() }
    }
}

/* ───────── Price Manager ───────── */

/**
 * Price Manager (design 7.4c): Price View lists every product's sale price; Price Setup needs the
 * price PIN (the server checks it), then tick items and raise or lower one price by % or ₹ with a
 * preview. The PIN is kept only while this screen is open.
 */
@Composable
fun PriceManagerScreen(api: Api, onBack: () -> Unit, onLater: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val list = load { api.itemsFull() }
    var query by rememberSaveable { mutableStateOf("") }
    var brand by rememberSaveable { mutableStateOf("") }
    var sheet by rememberSaveable { mutableStateOf("") }
    // memory only: never saved on the phone
    var pin by remember { mutableStateOf<String?>(null) }
    var ticked by remember { mutableStateOf(setOf<String>()) }
    var pinSet by remember { mutableStateOf(true) }
    val setup = pin != null

    fun openSetup() {
        scope.launch {
            try { pinSet = api.pinState().set; sheet = "pin" } catch (e: ApiError) { say(ctx, why(ctx, e)) }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.pm_title), onBack = onBack, foot = {
            if (setup) {
                // the longer words get more room, so they stay on one line on a 320 px phone
                Btn(stringResource(R.string.pm_done), { pin = null; ticked = emptySet() }, Modifier.weight(0.7f), Kind.Soft)
                Btn(stringResource(R.string.pm_change_n, ticked.size), { if (ticked.isNotEmpty()) sheet = "change" }, Modifier.weight(1.3f), if (ticked.isEmpty()) Kind.Line else Kind.Blue)
            } else {
                Btn(stringResource(R.string.pm_rate), onLater, Modifier.weight(1f), Kind.Soft, Icons.Share)
                Btn(stringResource(R.string.pm_setup), ::openSetup, Modifier.weight(1f), Kind.Blue)
            }
        }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    Seg2(stringResource(R.string.pm_view) to null, stringResource(R.string.pm_setup_pin) to null, if (setup) 1 else 0) { i ->
                        if (i == 0) { pin = null; ticked = emptySet() } else if (!setup) openSetup()
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                        Field(null, query, { query = it }, Modifier.weight(1f), placeholder = stringResource(R.string.pm_search), leading = Icons.Search)
                        Box(Modifier.padding(bottom = 3.dp)) {
                            IconBtn(Icons.Filter, if (brand.isEmpty()) stringResource(R.string.pm_brand) else brand, { sheet = "brand" }, if (brand.isEmpty()) Kind.Line else Kind.Soft)
                        }
                    }
                }
                if (setup) item {
                    val shape = RoundedCornerShape(Size.Radius)
                    Row(Modifier.fillMaxWidth().background(Colours.LightBlue, shape).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Check, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(20.dp))
                        T(stringResource(R.string.pm_on_note), Modifier.weight(1f), size = 14.sp, colour = Colours.Blue)
                    }
                }
                val all = list.data
                if (all == null) { item { Waiting(list) }; return@LazyColumn }
                val shown = StockMaths.priced(all, query, brand)
                if (shown.isEmpty()) item { T(stringResource(R.string.i_none), Modifier.fillMaxWidth().padding(20.dp), weight = FontWeight.Bold, colour = Colours.Text3, align = androidx.compose.ui.text.style.TextAlign.Center) }
                items(shown, key = { it.id }) { i ->
                    val sub = if (i.mrp.signum() > 0) stringResource(R.string.pm_line_mrp, rupees(i.purchase), rupees(i.mrp)) else stringResource(R.string.pm_line, rupees(i.purchase))
                    TickRow(i.name, sub, i.id in ticked, if (setup) ({ ticked = if (i.id in ticked) ticked - i.id else ticked + i.id }) else null) {
                        T(rupees(i.sale), weight = FontWeight.Bold, numbers = true)
                        T(stringResource(R.string.pm_sale), size = 12.sp, colour = Colours.Text3)
                    }
                }
            }
        }
        if (sheet.isNotEmpty()) BackHandler { sheet = "" }
        when (sheet) {
            "brand" -> {
                val brands = listOf(stringResource(R.string.i_all_brands)) + list.data.orEmpty().map { it.brand }.filter { it.isNotBlank() }.distinctBy { it.lowercase() }.sortedBy { it.lowercase() }
                ChoiceSheet(stringResource(R.string.pm_brand), brands, if (brand.isEmpty()) 0 else brands.indexOfFirst { it.equals(brand, true) }, { sheet = "" }) { brand = if (it == 0) "" else brands[it]; sheet = "" }
            }
            "pin" -> PinSheet(api, pinSet, { sheet = "" }) { p, made ->
                pin = p; ticked = emptySet(); sheet = ""
                say(ctx, ctx.getString(if (made) R.string.pin_saved else R.string.pm_setup_on))
            }
            "change" -> {
                val chosen = list.data.orEmpty().filter { it.id in ticked }
                PriceChangeSheet(chosen, { sheet = "" }) { rows, how, w ->
                    val p = pin ?: return@PriceChangeSheet
                    try {
                        api.changePrices(buildJsonObject {
                            put("pin", p); put("how", how)
                            put("changes", JsonArray(rows.map { r -> buildJsonObject { put("itemId", r.item.id); put("field", w.field); put("value", r.new.toPlainString()) } }))
                        })
                        say(ctx, if (rows.size == 1) ctx.getString(R.string.pc_saved_1) else ctx.getString(R.string.pc_saved_n, rows.size))
                        ticked = emptySet(); sheet = ""; list.reload()
                    } catch (e: ApiError) {
                        // a PIN changed on another device, or the wait after wrong tries: lock again
                        if (e.field == "pin") { pin = null; ticked = emptySet(); sheet = "" }
                        say(ctx, why(ctx, e))
                    }
                }
            }
        }
    }
}

/**
 * The price PIN (design 7.4c): four dots and a number pad. With no PIN yet, the owner makes one
 * (typed twice). The server checks it; five wrong tries in a row wait 60 seconds.
 */
@Composable
private fun PinSheet(api: Api, isSet: Boolean, onClose: () -> Unit, onOpen: (pin: String, made: Boolean) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var digits by remember { mutableStateOf("") }
    var first by remember { mutableStateOf<String?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val mismatch = stringResource(R.string.pin_mismatch)

    fun full(p: String) {
        when {
            !isSet && first == null -> { first = p; digits = "" }
            !isSet && first != p -> { first = null; digits = ""; err = mismatch }
            else -> {
                busy = true
                scope.launch {
                    try {
                        if (isSet) api.unlockPrices(p) else api.setPin(p)
                        onOpen(p, !isSet)
                    } catch (e: ApiError) { err = why(ctx, e); digits = ""; if (!isSet) first = null } finally { busy = false }
                }
            }
        }
    }

    Dim(onClose) {
        Sheet(stringResource(when { isSet -> R.string.pin_title; first == null -> R.string.pin_set_title; else -> R.string.pin_again_title })) {
            T(stringResource(when { isSet -> R.string.pin_text; first == null -> R.string.pin_set_text; else -> R.string.pin_again_text }), size = 14.sp, colour = Colours.Text2)
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                repeat(4) { k ->
                    val on = k < digits.length
                    Box(Modifier.size(16.dp).background(if (on) Colours.Blue else Colours.Card, CircleShape).border(2.dp, if (on) Colours.Blue else Colours.Text3, CircleShape))
                }
                if (busy) Spinner(Colours.Blue)
            }
            if (err != null) T(err!!, Modifier.fillMaxWidth(), size = 13.sp, colour = Colours.Red, align = androidx.compose.ui.text.style.TextAlign.Center)
            val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "x", "0", "del")
            keys.chunked(3).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { k ->
                        val shape = RoundedCornerShape(Size.Radius)
                        val label = when (k) { "x" -> stringResource(R.string.cancel); "del" -> stringResource(R.string.pin_del); else -> k }
                        Box(
                            Modifier.weight(1f).heightIn(min = 52.dp).raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)
                                .clickable(role = Role.Button, enabled = !busy) {
                                    when (k) {
                                        "x" -> onClose()
                                        "del" -> digits = digits.dropLast(1)
                                        else -> if (digits.length < 4) { err = null; digits += k; if (digits.length == 4) full(digits) }
                                    }
                                }
                                .semantics { contentDescription = label },
                            contentAlignment = Alignment.Center,
                        ) {
                            when (k) {
                                "x" -> Icon(Icons.Close, contentDescription = null, tint = Colours.Text, modifier = Modifier.size(20.dp))
                                "del" -> Icon(Icons.Back, contentDescription = null, tint = Colours.Text, modifier = Modifier.size(20.dp))
                                else -> T(k, size = 22.sp, weight = FontWeight.SemiBold, numbers = true)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Change the prices of the ticked items: Increase / Decrease, By % / By ₹, which price, a preview, Save Prices. */
@Composable
private fun PriceChangeSheet(items: List<ItemFull>, onClose: () -> Unit, onSave: suspend (List<StockMaths.Change>, String, StockMaths.Which) -> Unit) {
    val scope = rememberCoroutineScope()
    var up by remember { mutableStateOf(true) }
    var pct by remember { mutableStateOf(true) }
    var howMuch by remember { mutableStateOf("5") }
    var which by remember { mutableIntStateOf(0) }
    var pickWhich by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val w = StockMaths.Which.entries[which]
    val names = listOf(stringResource(R.string.pm_sale), stringResource(R.string.pc_purchase), "MRP")
    val rows = StockMaths.changes(items, w, up, pct, howMuch)
    Dim(onClose) {
        Box(Modifier.imePadding()) {
            Sheet(if (items.size == 1) stringResource(R.string.pc_title_1) else stringResource(R.string.pc_title_n, items.size)) {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Seg2(stringResource(R.string.pc_up) to null, stringResource(R.string.pc_down) to null, if (up) 0 else 1) { up = it == 0 }
                    Seg2(stringResource(R.string.pc_pct) to null, stringResource(R.string.pc_rs) to null, if (pct) 0 else 1) { pct = it == 0 }
                    Field(stringResource(R.string.pc_how), howMuch, { howMuch = it }, prefix = if (pct) null else "₹", bold = true,
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        trailing = if (pct) ({ T("%", Modifier.padding(end = 10.dp), colour = Colours.Text2, weight = FontWeight.SemiBold) }) else null)
                    ChoiceField(stringResource(R.string.pc_which), names[which]) { pickWhich = true }
                    SectionTitle(stringResource(R.string.pc_preview))
                    val shape = RoundedCornerShape(Size.Radius)
                    Column(Modifier.fillMaxWidth().background(Colours.Card, shape).border(1.dp, Colours.Border, shape)) {
                        if (rows.isEmpty()) T(stringResource(R.string.pc_nothing), Modifier.fillMaxWidth().padding(16.dp), weight = FontWeight.Bold, colour = Colours.Text3, align = androidx.compose.ui.text.style.TextAlign.Center)
                        rows.forEachIndexed { n, r ->
                            if (n > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
                            Row(Modifier.fillMaxWidth().heightIn(min = Size.Tap).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                T(r.item.name, Modifier.weight(1f), weight = FontWeight.SemiBold, oneLine = true)
                                T(rupees(r.old), size = 13.sp, colour = Colours.Text3, struck = true, numbers = true)
                                T(rupees(r.new), weight = FontWeight.Bold, colour = Colours.Green, numbers = true)
                            }
                        }
                    }
                    T(stringResource(R.string.pc_round), size = 12.sp, colour = Colours.Text3)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Btn(stringResource(R.string.cancel), onClose, Modifier.weight(1f), Kind.Line)
                        Btn(stringResource(R.string.pc_save), {
                            if (rows.isEmpty() || busy) return@Btn
                            busy = true
                            // what the price history says, in English as on the web
                            val how = "Price Manager: " + (if (up) "+" else "−") + (if (pct) "$howMuch%" else "₹$howMuch") + " " + listOf("sale price", "purchase price", "MRP")[which]
                            scope.launch { try { onSave(rows, how, w) } finally { busy = false } }
                        }, Modifier.weight(1f), if (rows.isEmpty()) Kind.Line else Kind.Green, busy = busy)
                    }
                }
            }
        }
    }
    if (pickWhich) {
        BackHandler { pickWhich = false }
        ChoiceSheet(stringResource(R.string.pc_which), names, which, { pickWhich = false }) { which = it; pickWhich = false }
    }
}

/** Price History of one item (design 7.4c, the Prices button on the item page): old → new, how and when. */
@Composable
fun PriceHistorySheet(api: Api, itemId: String, onClose: () -> Unit) {
    val hi = hindi()
    val h = load(itemId) { api.priceHistory(itemId) }
    Dim(onClose) {
        Sheet(stringResource(R.string.ph_title), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
            val rows = h.data
            if (rows == null) { Waiting(h); return@Sheet }
            val shape = RoundedCornerShape(Size.Radius)
            Box(Modifier.fillMaxWidth().heightIn(max = 380.dp).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)) {
                if (rows.isEmpty()) T(stringResource(R.string.ph_none), Modifier.fillMaxWidth().padding(20.dp), weight = FontWeight.Bold, colour = Colours.Text3, align = androidx.compose.ui.text.style.TextAlign.Center)
                LazyColumn {
                    items(rows.size) { n -> PriceChangeRow(rows[n], n > 0, hi) }
                }
            }
        }
    }
}

@Composable
private fun PriceChangeRow(p: PriceChange, line: Boolean, hi: Boolean) {
    val field = when {
        p.field == "sale" -> stringResource(R.string.pm_sale)
        p.field == "purchase" -> stringResource(R.string.pc_purchase)
        p.field == "mrp" -> "MRP"
        p.field == "list" -> stringResource(R.string.ph_list)
        p.field == "wholesale" -> stringResource(R.string.ph_wholesale)
        else -> stringResource(R.string.ph_pl)
    }
    fun v(s: String?) = s?.toBigDecimalOrNull()?.let(::rupees) ?: "—"
    if (line) Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
    Column(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.Center) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            T(v(p.oldValue), size = 13.sp, colour = Colours.Text3, struck = true, numbers = true)
            T("→", colour = Colours.Text3)
            T(v(p.newValue), weight = FontWeight.Bold, colour = Colours.Green, numbers = true)
        }
        T(listOfNotNull(field, p.how?.takeIf { it.isNotBlank() }).joinToString(" · ") + " | " + Format.date(StockMaths.indiaDay(p.at), hi), size = 12.sp, colour = Colours.Text3)
    }
}

/* ───────── Brands And Series ───────── */

/** Brands And Series (design 7.4c): each brand with its items and stock value, and its series. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BrandsScreen(api: Api, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val brands = load { api.brands() }
    val series = load { api.series() }
    var sheet by rememberSaveable { mutableStateOf("") }
    var seriesBrand by rememberSaveable { mutableStateOf("") }

    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.br_title), onBack = onBack, foot = {
            Btn(stringResource(R.string.br_add_series), { sheet = "series" }, Modifier.weight(1f), Kind.Soft, Icons.Plus)
            Btn(stringResource(R.string.br_add_brand), { sheet = "brand" }, Modifier.weight(1f), Kind.Blue, Icons.Plus)
        }) {
            val b = brands.data
            if (b == null) { Waiting(brands); return@Frame }
            val active = b.filter { it.active }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (active.isEmpty()) item { EmptyState(Icons.Box, stringResource(R.string.br_none), stringResource(R.string.br_none_sub), stringResource(R.string.br_add_brand)) { sheet = "brand" } }
                items(active, key = { it.id }) { br ->
                    val mine = series.data.orEmpty().filter { it.brandId == br.id && it.active }.map { it.name }.distinctBy { it.lowercase() }
                    val shape = RoundedCornerShape(Size.Radius)
                    Column(Modifier.fillMaxWidth().raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            T(br.name, Modifier.weight(1f), weight = FontWeight.Bold, oneLine = true)
                            T(if (br.items == 1) stringResource(R.string.br_items_1, rupees(br.value)) else stringResource(R.string.br_items_n, br.items, rupees(br.value)), size = 12.sp, colour = Colours.Text3, numbers = true)
                        }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            (mine.ifEmpty { listOf(stringResource(R.string.br_no_series)) }).forEach { s ->
                                T(s, Modifier.background(Colours.LightSlate, RoundedCornerShape(999.dp)).padding(horizontal = 10.dp, vertical = 4.dp), size = 12.sp, weight = FontWeight.SemiBold, colour = Colours.Text2)
                            }
                        }
                    }
                }
            }
        }
        if (sheet.isNotEmpty()) BackHandler { sheet = if (sheet == "seriesBrand") "series" else "" }
        when (sheet) {
            "brand" -> NewGroupSheet({ sheet = "" }, stringResource(R.string.br_add_brand), stringResource(R.string.br_brand_name), "Polycab") { n ->
                scope.launch { try { api.newBrand(n); say(ctx, ctx.getString(R.string.added_x, n)); sheet = ""; brands.reload() } catch (e: ApiError) { say(ctx, why(ctx, e)) } }
            }
            "series", "seriesBrand" -> {
                val active = brands.data.orEmpty().filter { it.active }
                val chosen = active.firstOrNull { it.id == seriesBrand }
                var name by remember { mutableStateOf("") }
                var busy by remember { mutableStateOf(false) }
                var err by remember { mutableStateOf<String?>(null) }
                val needBrand = stringResource(R.string.br_choose)
                Dim({ sheet = "" }) {
                    Box(Modifier.imePadding()) {
                        Sheet(stringResource(R.string.br_add_series), close = { IconBtn(Icons.Close, stringResource(R.string.close), { sheet = "" }) }) {
                            ChoiceField(stringResource(R.string.br_brand), chosen?.name ?: needBrand) { sheet = "seriesBrand" }
                            Field(stringResource(R.string.br_series_name), name, { name = it; err = null }, placeholder = "Coral", error = err, keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
                            Btn(stringResource(R.string.pf_add), {
                                if (chosen == null) { err = needBrand; return@Btn }
                                if (name.isBlank() || busy) return@Btn
                                busy = true
                                scope.launch {
                                    try { api.newSeries(chosen.id, name.trim()); say(ctx, ctx.getString(R.string.added_x, "${chosen.name} ${name.trim()}")); sheet = ""; series.reload() }
                                    catch (e: ApiError) { err = why(ctx, e) } finally { busy = false }
                                }
                            }, Modifier.fillMaxWidth(), Kind.Blue, Icons.Plus, busy = busy)
                        }
                    }
                }
                if (sheet == "seriesBrand") ChoiceSheet(stringResource(R.string.br_choose), active.map { it.name }, active.indexOfFirst { it.id == seriesBrand }, { sheet = "series" }) { seriesBrand = active[it].id; sheet = "series" }
            }
        }
    }
}

/* ───────── Godowns and transfers ───────── */

/** Godowns (design 7.4c): where stock is kept, with Recent Transfers; Add Godown and Transfer Stock. */
@Composable
fun GodownsScreen(api: Api, onBack: () -> Unit, onTransfer: () -> Unit) {
    val ctx = LocalContext.current
    val hi = hindi()
    val godowns = load { api.godowns() }
    val transfers = load { api.transfers() }
    var adding by rememberSaveable { mutableStateOf(false) }
    val needTwo = stringResource(R.string.gd_need_two)

    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.gd_title), stringResource(R.string.gd_sub), onBack, foot = {
            Btn(stringResource(R.string.gd_add), { adding = true }, Modifier.weight(1f), Kind.Soft, Icons.Plus)
            Btn(stringResource(R.string.gd_transfer), { if (godowns.data.orEmpty().size < 2) say(ctx, needTwo) else onTransfer() }, Modifier.weight(1f), Kind.Blue, Icons.Next)
        }) {
            val g = godowns.data
            if (g == null) { Waiting(godowns); return@Frame }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(g, key = { it.id }) { d -> GodownRow(d) }
                item { SectionTitle(stringResource(R.string.gd_recent)) }
                val t = transfers.data
                if (t == null) item { Waiting(transfers) }
                else if (t.isEmpty()) item { T(stringResource(R.string.gd_no_tr), Modifier.fillMaxWidth().padding(16.dp), weight = FontWeight.Bold, colour = Colours.Text3, align = androidx.compose.ui.text.style.TextAlign.Center) }
                else items(t, key = { it.id }) { x -> TransferRow(x, hi) }
            }
        }
        if (adding) {
            BackHandler { adding = false }
            AddGodownSheet(api, { adding = false }) { n -> adding = false; say(ctx, ctx.getString(R.string.added_x, n)); godowns.reload() }
        }
    }
}

@Composable
private fun GodownRow(d: Godown) {
    ListRow(d.name, if (d.items == 1) stringResource(R.string.gd_line_1, rupees(d.value)) else stringResource(R.string.gd_line, d.items, rupees(d.value)), null) {
        if (d.isDefault) Badge(stringResource(R.string.gd_default), BadgeKind.Info)
    }
}

@Composable
private fun TransferRow(t: Transfer, hi: Boolean) {
    ListRow(t.item, "${t.number} | ${Format.date(t.date, hi)}\n${t.from} → ${t.to}", null) {
        T(qtyUnit(t.qty, t.unit), weight = FontWeight.Bold, numbers = true, oneLine = true)
    }
}

/** Add Godown: name, address, person in charge and mobile; the server's reason shows under its field. */
@Composable
private fun AddGodownSheet(api: Api, onClose: () -> Unit, onAdded: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var manager by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<ApiError?>(null) }
    var busy by remember { mutableStateOf(false) }
    fun errFor(f: String) = problem?.takeIf { it.field == f }?.let { why(ctx, it) }
    Dim(onClose) {
        Box(Modifier.imePadding()) {
            Sheet(stringResource(R.string.gd_add), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Field(stringResource(R.string.gd_name), name, { name = it; problem = null }, placeholder = "Back Store", error = errFor("name"), keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
                    Field(stringResource(R.string.gd_address), address, { address = it }, keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences))
                    Field(stringResource(R.string.gd_manager), manager, { manager = it }, keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
                    Field(stringResource(R.string.gd_phone), phone, { phone = it.filter { c -> c.isDigit() || c == ' ' }.take(12); problem = null }, prefix = "+91", error = errFor("phone"), keyboard = KeyboardOptions(keyboardType = KeyboardType.Phone))
                    val other = problem?.takeIf { it.field != "name" && it.field != "phone" }
                    if (other != null) T(why(ctx, other), size = 12.sp, colour = Colours.Red)
                    Btn(stringResource(R.string.gd_add), {
                        if (busy) return@Btn
                        busy = true
                        scope.launch {
                            try {
                                api.addGodown(buildJsonObject {
                                    put("name", name.trim()); if (address.isNotBlank()) put("address", address.trim())
                                    if (manager.isNotBlank()) put("manager", manager.trim()); if (phone.isNotBlank()) put("phone", phone.replace(" ", ""))
                                })
                                onAdded(name.trim())
                            } catch (e: ApiError) { problem = e } finally { busy = false }
                        }
                    }, Modifier.fillMaxWidth(), Kind.Blue, Icons.Plus, busy = busy)
                }
            }
        }
    }
}

/** Pick an item (search by name or code); products only, active ones. */
@Composable
fun ItemPickSheet(items: List<ItemFull>, onClose: () -> Unit, onPick: (ItemFull) -> Unit) {
    var q by remember { mutableStateOf("") }
    Dim(onClose) {
        Box(Modifier.imePadding()) {
            Sheet(stringResource(R.string.tr_choose_item), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
                Field(null, q, { q = it }, leading = Icons.Search, placeholder = stringResource(R.string.pm_search))
                val shown = StockMaths.priced(items, q, "")
                val shape = RoundedCornerShape(Size.Radius)
                Box(Modifier.fillMaxWidth().heightIn(max = 360.dp).border(1.dp, Colours.Border, shape)) {
                    if (shown.isEmpty()) T(stringResource(R.string.i_none), Modifier.padding(12.dp), weight = FontWeight.Bold)
                    LazyColumn {
                        items(shown, key = { it.id }) { i ->
                            Row(
                                Modifier.fillMaxWidth().heightIn(min = Size.Tap).clickable(role = Role.Button) { onPick(i) }.padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Column(Modifier.weight(1f)) {
                                    T(i.name, weight = FontWeight.SemiBold, oneLine = true)
                                    if (i.code.isNotBlank() || i.brand.isNotBlank()) T(listOf(i.brand, i.code).filter { it.isNotBlank() }.joinToString(" · "), size = 12.sp, colour = Colours.Text3, oneLine = true)
                                }
                                T(qtyUnit(i.stock, i.unit), weight = FontWeight.Bold, numbers = true)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Transfer Stock (design 7.4c): From, To, the item with what the From godown has, and the
 * quantity. Refused before sending when the godowns are the same or there isn't that much; the
 * server checks again.
 */
@Composable
fun TransferScreen(api: Api, onBack: () -> Unit, onDone: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val godowns = load { api.godowns() }
    val items = load { api.itemsFull() }
    var fromId by rememberSaveable { mutableStateOf("") }
    var toId by rememberSaveable { mutableStateOf("") }
    var itemId by rememberSaveable { mutableStateOf("") }
    var qty by rememberSaveable { mutableStateOf("") }
    var sheet by rememberSaveable { mutableStateOf("") }
    var err by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val detail = load(itemId) { if (itemId.isBlank()) null else api.item(itemId) }
    val g = godowns.data.orEmpty()
    val from = g.firstOrNull { it.id == fromId } ?: g.firstOrNull { it.isDefault } ?: g.firstOrNull()
    val to = g.firstOrNull { it.id == toId } ?: g.firstOrNull { it.id != from?.id }
    val item = items.data.orEmpty().firstOrNull { it.id == itemId }
    val have = detail.data?.takeIf { it.id == itemId }?.godowns?.firstOrNull { it.id == from?.id }?.stock ?: BigDecimal.ZERO
    val msgSame = stringResource(R.string.tr_same)
    val msgQty = stringResource(R.string.tr_qty_err)
    val msgItem = stringResource(R.string.tr_no_item)

    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.gd_transfer), onBack = onBack, foot = {
            Btn(stringResource(R.string.tr_go), go@{
                if (from == null || to == null || busy) return@go
                if (item == null) { err = msgItem; return@go }
                when (StockMaths.transferProblem(from.id, to.id, qty, have)) {
                    StockMaths.TransferProblem.SameGodown -> { err = msgSame; return@go }
                    StockMaths.TransferProblem.NoQuantity -> { err = msgQty; return@go }
                    StockMaths.TransferProblem.NotEnough -> { err = ctx.getString(R.string.tr_not_enough, qtyUnit(have, item.unit), from.name); return@go }
                    null -> {}
                }
                val q = qty.replace(",", "").trim().toBigDecimal()
                busy = true; err = null
                scope.launch {
                    try {
                        api.transfer(buildJsonObject {
                            put("itemId", item.id); put("fromGodownId", from.id); put("toGodownId", to.id); put("qty", q.toPlainString()); put("date", Format.todayIso())
                        })
                        say(ctx, ctx.getString(R.string.tr_sent, qtyUnit(q, item.unit), to.name))
                        onDone()
                    } catch (e: ApiError) { err = why(ctx, e) } finally { busy = false }
                }
            }, Modifier.weight(1f), Kind.Green, busy = busy)
        }) {
            if (godowns.data == null) { Waiting(godowns); return@Frame }
            Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ChoiceField(stringResource(R.string.tr_from), from?.name ?: "") { sheet = "from" }
                ChoiceField(stringResource(R.string.tr_to), to?.name ?: "") { sheet = "to" }
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    ChoiceField(stringResource(R.string.tr_item), item?.name ?: stringResource(R.string.tr_choose_item)) { sheet = "item" }
                    if (item != null && from != null) T(stringResource(R.string.tr_have, from.name, qtyUnit(have, item.unit)), size = 12.sp, colour = Colours.Text3)
                }
                Field(stringResource(R.string.tr_qty), qty, { qty = it; err = null }, placeholder = "0", bold = true, keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    trailing = if (item != null) ({ T(unitWord(item.unit), Modifier.padding(end = 10.dp), colour = Colours.Text2, weight = FontWeight.SemiBold) }) else null)
                if (err != null) T(err!!, size = 12.sp, colour = Colours.Red)
            }
        }
        if (sheet.isNotEmpty()) BackHandler { sheet = "" }
        when (sheet) {
            "from", "to" -> ChoiceSheet(stringResource(if (sheet == "from") R.string.tr_from else R.string.tr_to), g.map { it.name }, g.indexOfFirst { it.id == (if (sheet == "from") from?.id else to?.id) }, { sheet = "" }) { n ->
                // picking the other side's godown swaps them
                val picked = g[n].id
                if (sheet == "from") { if (picked == to?.id) toId = from?.id ?: ""; fromId = picked } else { if (picked == from?.id) fromId = to?.id ?: ""; toId = picked }
                err = null; sheet = ""
            }
            "item" -> ItemPickSheet(items.data.orEmpty(), { sheet = "" }) { i -> itemId = i.id; err = null; sheet = "" }
        }
    }
}

/* ───────── Bulk Active / Inactive ───────── */

/** Bulk Active / Inactive (design 7.4c): tick items and make them inactive or active again. Nothing is deleted. */
@Composable
fun BulkActiveScreen(api: Api, onBack: () -> Unit, onChanged: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val list = load { api.itemsAll() }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var ticked by remember { mutableStateOf(setOf<String>()) }
    var busy by remember { mutableStateOf(false) }
    val inactive = tab == 1
    Frame(stringResource(R.string.ba_title), onBack = onBack, foot = {
        val n = ticked.size
        Btn(
            if (inactive) stringResource(R.string.ba_make_active, n) else stringResource(R.string.ba_make_inactive, n),
            {
                if (n == 0 || busy) return@Btn
                busy = true
                scope.launch {
                    try {
                        val r = api.bulkActive(ticked.toList(), inactive)
                        val c = r.changed
                        say(ctx, when {
                            inactive && c == 1 -> ctx.getString(R.string.ba_done_a1)
                            inactive -> ctx.getString(R.string.ba_done_an, c)
                            c == 1 -> ctx.getString(R.string.ba_done_i1)
                            else -> ctx.getString(R.string.ba_done_in, c)
                        })
                        ticked = emptySet(); list.reload(); onChanged()
                    } catch (e: ApiError) { say(ctx, why(ctx, e)) } finally { busy = false }
                }
            },
            Modifier.weight(1f), if (n == 0) Kind.Line else Kind.Blue, busy = busy,
        )
    }) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Tabs(listOf(stringResource(R.string.ba_active), stringResource(R.string.ba_inactive)), tab) { tab = it; ticked = emptySet() } }
            item { T(stringResource(R.string.ba_note), size = 12.sp, colour = Colours.Text3) }
            val all = list.data
            if (all == null) { item { Waiting(list) }; return@LazyColumn }
            val shown = all.filter { it.archived == inactive }.sortedBy { it.name.lowercase() }
            if (shown.isEmpty()) item { T(stringResource(if (inactive) R.string.ba_none_i else R.string.ba_none_a), Modifier.fillMaxWidth().padding(20.dp), weight = FontWeight.Bold, colour = Colours.Text3, align = androidx.compose.ui.text.style.TextAlign.Center) }
            items(shown, key = { it.id }) { i ->
                TickRow(i.name, listOf(i.brand, i.category).filter { it.isNotBlank() }.joinToString(" · "), i.id in ticked, { ticked = if (i.id in ticked) ticked - i.id else ticked + i.id }) {
                    if (!ItemMaths.isService(i)) T(qtyUnit(i.stock, i.unit), weight = FontWeight.Bold, numbers = true)
                }
            }
        }
    }
}

/* ───────── Stock Adjustments ───────── */

/**
 * Stock Adjustments (design 7.4c): Stock Added, Stock Reduced and Net Effect, search, every
 * adjustment (tap to open its item), and New Adjustment.
 */
@Composable
fun AdjustmentsScreen(api: Api, onBack: () -> Unit, onItem: (id: String, name: String) -> Unit, onNew: (itemId: String) -> Unit) {
    val hi = hindi()
    val list = load { api.adjustments() }
    val items = load { api.itemsFull() }
    var query by rememberSaveable { mutableStateOf("") }
    var picking by rememberSaveable { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.as_title), onBack = onBack, foot = {
            Btn(stringResource(R.string.as_new), { picking = true }, Modifier.weight(1f), Kind.Blue, Icons.Plus)
        }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val all = list.data
                if (all == null) { item { Waiting(list) }; return@LazyColumn }
                item {
                    val t = StockMaths.adjTotals(all)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TotalCell(stringResource(R.string.as_added), rupees(t.added), Colours.Green, Modifier.weight(1f))
                        TotalCell(stringResource(R.string.as_reduced), rupees(t.reduced), Colours.Red, Modifier.weight(1f))
                        TotalCell(stringResource(R.string.as_net), (if (t.net.signum() < 0) "− " else "") + rupees(t.net.abs()), Colours.Text, Modifier.weight(1f))
                    }
                }
                item { Field(null, query, { query = it }, placeholder = stringResource(R.string.as_search), leading = Icons.Search) }
                val shown = all.filter { StockMaths.adjMatches(it, query) }
                if (shown.isEmpty()) item { T(stringResource(R.string.as_none), Modifier.fillMaxWidth().padding(20.dp), weight = FontWeight.Bold, colour = Colours.Text3, align = androidx.compose.ui.text.style.TextAlign.Center) }
                items(shown, key = { it.id }) { a -> AdjRow(a, hi) { onItem(a.itemId, a.item) } }
            }
        }
        if (picking) {
            BackHandler { picking = false }
            ItemPickSheet(items.data.orEmpty(), { picking = false }) { i -> picking = false; onNew(i.id) }
        }
    }
}

/** A small total (.ptot.three .box): a label, and the amount in its colour. */
@Composable
private fun TotalCell(label: String, amount: String, colour: androidx.compose.ui.graphics.Color, modifier: Modifier) {
    val shape = RoundedCornerShape(Size.Radius)
    Column(modifier.heightIn(min = Size.Tap).raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(horizontal = 10.dp, vertical = 8.dp)) {
        T(label, size = 12.sp, colour = Colours.Text3, oneLine = true)
        T(amount, size = 15.sp, weight = FontWeight.Bold, colour = colour, numbers = true, oneLine = true)
    }
}

@Composable
private fun AdjRow(a: AdjustmentRow, hi: Boolean, onClick: () -> Unit) {
    val reason = adjReason(a.reason)
    ListRow(a.item, "${a.number} | ${Format.date(a.date, hi)}" + (if (reason.isNotBlank()) "\n$reason" else ""), onClick) {
        if (a.cancelled) Badge(stringResource(R.string.b_cancelled), BadgeKind.Grey, struck = true)
        T((if (a.qty.signum() > 0) "+" else "") + qtyUnit(a.qty, a.unit), weight = FontWeight.Bold, colour = if (a.cancelled) Colours.Text3 else if (a.qty.signum() < 0) Colours.Red else Colours.Green, numbers = true, oneLine = true, struck = a.cancelled)
        T(rupees(a.value), size = 12.sp, colour = Colours.Text3, numbers = true)
    }
}

/** The reasons are saved in English (as on the web); shown in Hindi when the app is in Hindi. */
@Composable
private fun adjReason(saved: String?): String {
    val s = saved?.trim().orEmpty()
    val known = ADJUST_REASONS.firstOrNull { it.second.equals(s, ignoreCase = true) } ?: return s
    return stringResource(known.first)
}
