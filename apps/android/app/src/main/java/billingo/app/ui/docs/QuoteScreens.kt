package billingo.app.ui.docs

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
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.QuoteRow
import billingo.app.ui.parties.Frame
import billingo.app.ui.parties.Waiting
import billingo.app.ui.parts.Badge
import billingo.app.ui.parts.BadgeKind
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.ChoiceField
import billingo.app.ui.parts.ChoiceSheet
import billingo.app.ui.parts.ConfirmBox
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
import billingo.app.ui.parts.T
import billingo.app.ui.parts.load
import billingo.app.ui.print.InvoicePdf
import billingo.app.ui.sale.Grp
import billingo.app.ui.sale.Line
import billingo.app.ui.sale.MenuRow
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Size
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

@Composable
private fun hindi() = LocalConfiguration.current.locales[0].language == "hi"

private fun say(ctx: android.content.Context, text: String) = Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show()
private fun why(ctx: android.content.Context, e: ApiError) = if (e.status == 0) ctx.getString(R.string.no_internet) else e.message
private fun m2(s: String) = Format.inr(DocMaths.num(s), paise = false)

/** A quotation's badge (design 7.4e): Open (blue), Converted (green), Cancelled (struck through). */
@Composable
internal fun QuoteBadge(s: DocMaths.QState) = when (s) {
    DocMaths.QState.Open -> Badge(stringResource(R.string.qt_open), BadgeKind.Info)
    DocMaths.QState.Converted -> Badge(stringResource(R.string.qt_converted), BadgeKind.Paid, icon = Icons.Check)
    DocMaths.QState.Cancelled -> Badge(stringResource(R.string.b_cancelled), BadgeKind.Grey, struck = true)
}

/** One choice in a sheet (.opt with a line under it): Brand-Wise / Item-Wise. */
@Composable
private fun Opt(icon: ImageVector, title: String, sub: String, onTap: () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)
            .clickable(role = Role.Button, onClick = onTap).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f)) {
            T(title, weight = FontWeight.SemiBold)
            T(sub, size = 12.sp, colour = Colours.Text3)
        }
    }
}

/** New Quotation: Choose Type (design 7.4e qtype). */
@Composable
fun QuoteTypeSheet(onClose: () -> Unit, onBrand: () -> Unit, onItems: () -> Unit) {
    Dim(onClose) {
        Sheet(stringResource(R.string.qt_new)) {
            Opt(Icons.Box, stringResource(R.string.qt_brand), stringResource(R.string.qt_brand_sub), onBrand)
            Opt(Icons.Bill, stringResource(R.string.qt_items), stringResource(R.string.qt_items_sub), onItems)
        }
    }
}

/**
 * Quotations (design 7.4e qlist): Open Quotations and Turned Into Bills, search, All / Open /
 * Converted / Cancelled, each with "QT-0033 | 14 Nov 2026 · Item-Wise", its total (a brand-wise one:
 * its lowest brand) and badge; New Quotation asks which kind.
 */
@Composable
fun QuotesScreen(api: Api, pickFirst: Boolean, onBack: () -> Unit, onOpen: (QuoteRow) -> Unit, onItems: () -> Unit, onBrand: () -> Unit) {
    val list = load { api.quotations() }
    val hi = hindi()
    var query by rememberSaveable { mutableStateOf("") }
    var f by rememberSaveable { mutableIntStateOf(0) }
    var pick by rememberSaveable { mutableStateOf(false) }
    var type by rememberSaveable { mutableStateOf(pickFirst) }
    val names = listOf(stringResource(R.string.p_all), stringResource(R.string.qt_open), stringResource(R.string.qt_converted), stringResource(R.string.b_cancelled))
    val counter = stringResource(R.string.sl_counter_name)
    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.m_quotations), onBack = onBack, foot = {
            Btn(stringResource(R.string.qt_new), { type = true }, Modifier.weight(1f), Kind.Blue, Icons.Plus)
        }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val all = list.data
                if (all == null) { item { Waiting(list) }; return@LazyColumn }
                item {
                    val (open, conv) = DocMaths.qSummary(all)
                    DocSum(stringResource(R.string.qt_sum_open) to open.toString(), stringResource(R.string.qt_sum_conv) to conv.toString())
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                        Field(null, query, { query = it }, Modifier.weight(1f), placeholder = stringResource(R.string.search), leading = Icons.Search, keyboard = KeyboardOptions(imeAction = ImeAction.Search))
                        Box(Modifier.weight(1f)) { ChoiceField(null, names[f]) { pick = true } }
                    }
                }
                val shown = all.filter { DocMaths.qMatches(it, f, query, counter) }
                if (shown.isEmpty()) item { EmptyState(Icons.Search, stringResource(R.string.dl_none), stringResource(R.string.dl_none_sub), null, null) }
                items(shown, key = { it.id }) { q ->
                    val name = q.party?.name?.takeIf { it.isNotBlank() } ?: q.partyName.ifBlank { counter }
                    val kind = stringResource(if (q.qtype == "brand") R.string.qt_brand else R.string.qt_items)
                    ListRow(name, q.number + " | " + Format.date(q.date, hi) + " · " + kind, { onOpen(q) }) {
                        T(m2(q.total), weight = FontWeight.Bold, numbers = true, oneLine = true, struck = q.cancelled)
                        QuoteBadge(DocMaths.qState(q))
                    }
                }
            }
        }
        if (pick) {
            BackHandler { pick = false }
            ChoiceSheet(stringResource(R.string.dl_status), names, f, { pick = false }) { f = it; pick = false }
        }
        if (type) {
            BackHandler { type = false }
            QuoteTypeSheet({ type = false }, { type = false; onBrand() }) { type = false; onItems() }
        }
    }
}

/**
 * A quotation's page (design 7.4e qview): the total with its badge, "Turned into bill INV-0108"
 * (opens it), the customer, the items; Share and Convert To Bill while it is open; ⋮ has Edit
 * Quotation, Copy As New Quotation and Cancel Quotation (a converted one: only Copy).
 * A brand-wise quotation shows its lowest total here; its own screen comes in the next part.
 */
@Composable
fun QuoteScreen(
    api: Api, id: String, number: String, after: String, features: List<String>, itemOptions: JsonObject?, version: Int,
    onBack: () -> Unit, onParty: (id: String, name: String) -> Unit, onBill: (id: String, number: String) -> Unit,
    onEdit: () -> Unit, onCopy: () -> Unit, onConvert: () -> Unit, onChanged: () -> Unit, onLater: () -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val hi = hindi()
    val doc = load(version) { api.saleDoc(id) }
    var menu by rememberSaveable { mutableStateOf(false) }
    var ask by rememberSaveable { mutableStateOf(false) }
    var pass by rememberSaveable { mutableStateOf(false) }
    var passErr by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf("") }
    var made by remember(id, version) { mutableStateOf<InvoicePdf.Made?>(null) }
    val counter = stringResource(R.string.sl_counter_name)

    fun pdf(what: String) {
        if (busy.isNotEmpty()) return
        busy = what
        scope.launch {
            val m = made ?: try { InvoicePdf.make(ctx, api, id, features, itemOptions).also { made = it } }
            catch (e: ApiError) { say(ctx, why(ctx, e)); null }
            catch (e: Exception) { say(ctx, ctx.getString(R.string.pdf_failed)); null }
            busy = ""
            if (m != null) when (what) {
                "print" -> InvoicePdf.print(ctx, m)
                "share" -> if (!InvoicePdf.share(ctx, m)) say(ctx, ctx.getString(R.string.pdf_no_app))
                else -> if (!InvoicePdf.whatsApp(ctx, m)) say(ctx, ctx.getString(R.string.pdf_no_app))
            }
        }
    }
    // Share or Print chosen before saving (the ⋮ on the quotation screen): done once it opens
    var done by rememberSaveable(id) { mutableStateOf(false) }
    LaunchedEffect(id) { if (after.isNotEmpty() && !done) { done = true; pdf(after) } }

    fun cancel(passcode: String?) {
        busy = "cancel"
        scope.launch {
            try {
                val r = api.cancelSale(id, passcode)
                pass = false; ask = false; made = null
                say(ctx, ctx.getString(R.string.dv_cancelled, r.number))
                doc.reload(); onChanged()
            } catch (e: ApiError) {
                if (e.code == Api.PASSCODE) { ask = false; passErr = if (passcode == null) null else e.message; if (passcode != null) tries++; pass = true }
                else { say(ctx, why(ctx, e)); ask = false; pass = false }
            } finally { busy = "" }
        }
    }

    /** "Turned into bill INV-0108": the bill is found by its number. */
    fun openBill(no: String) {
        scope.launch {
            try { api.bills().firstOrNull { it.number == no }?.let { onBill(it.id, it.number) } }
            catch (e: ApiError) { say(ctx, why(ctx, e)) }
        }
    }

    val d = doc.data
    val st = d?.let { DocMaths.qState(it.cancelled, it.status) }
    val brand = d != null && DocMaths.isBrandWise(d)
    Box(Modifier.fillMaxSize()) {
        Frame(
            d?.number ?: number, d?.date?.takeIf { it.isNotBlank() }?.let { Format.date(it, hi) }, onBack,
            right = { if (d != null && !brand) IconBtn(Icons.Dots, stringResource(R.string.more_options), { menu = true }) },
            foot = if (d == null || st != DocMaths.QState.Open || brand) null else ({
                Btn(stringResource(R.string.dv_share), { pdf("wa") }, Modifier.weight(1f), Kind.Soft, Icons.Chat, busy = busy == "wa")
                Btn(stringResource(R.string.qt_convert), onConvert, Modifier.weight(1f), Kind.Blue)
            }),
        ) {
            if (d == null || st == null) { Waiting(doc); return@Frame }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ViewHead(stringResource(if (brand) R.string.qt_lowest else R.string.qt_view_total), "₹" + m2(d.total)) { QuoteBadge(st) }
                val inv = DocMaths.invoiceOf(d)
                if (st == DocMaths.QState.Converted && inv.isNotBlank()) {
                    val shape = RoundedCornerShape(Size.RadiusSmall)
                    T(
                        stringResource(R.string.qt_turned, inv),
                        Modifier.fillMaxWidth().heightIn(min = Size.Tap).background(Colours.LightGreen, shape).clickable(role = Role.Button) { openBill(inv) }.padding(horizontal = 12.dp, vertical = 10.dp),
                        size = 13.sp, colour = Colours.Green,
                    )
                }
                val p = d.party
                PartyCard(d.party?.name?.takeIf { it.isNotBlank() } ?: d.partyName.ifBlank { counter }, p?.let { { onParty(it.id, it.name) } })
                if (brand) {
                    T(stringResource(R.string.qt_brand_later), size = 13.sp, colour = Colours.Text2)
                } else {
                    SectionTitle(stringResource(R.string.dv_items, d.lines.size))
                    LineRows(d.lines, true)
                }
            }
        }
        if (menu && d != null && st != null) {
            BackHandler { menu = false }
            Dim({ menu = false }) {
                Sheet(stringResource(R.string.more_options)) {
                    Grp {
                        if (st == DocMaths.QState.Open) { MenuRow(Icons.Edit, stringResource(R.string.qt_edit), null) { menu = false; onEdit() }; Line() }
                        MenuRow(Icons.Plus, stringResource(R.string.qt_copy), null) { menu = false; onCopy() }
                        if (st == DocMaths.QState.Open) {
                            Line()
                            DangerRow(Icons.Close, stringResource(R.string.qt_cancel)) { menu = false; ask = true }
                        }
                    }
                }
            }
        }
        if (ask && d != null) {
            BackHandler { ask = false }
            Dim({ if (busy.isEmpty()) ask = false }, centre = true) {
                ConfirmBox(
                    stringResource(R.string.dv_cancel_q, d.number), stringResource(R.string.qt_cancel_text) + "\n\n" + stringResource(R.string.dv_never_deleted),
                    stringResource(R.string.go_back), stringResource(R.string.dv_yes_cancel), { ask = false }, { if (busy.isEmpty()) cancel(null) },
                )
            }
        }
        if (pass && d != null) {
            BackHandler { pass = false }
            PasscodeSheet(stringResource(R.string.dv_cancel_q, d.number), stringResource(R.string.pc_cancel_text), passErr, tries, busy == "cancel", { pass = false; passErr = null }) { cancel(it) }
        }
    }
}
