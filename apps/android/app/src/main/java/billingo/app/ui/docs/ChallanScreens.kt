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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.ChallanRow
import billingo.app.ui.items.ItemMaths
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
import billingo.app.ui.parts.Header
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.ListRow
import billingo.app.ui.parts.Loading
import billingo.app.ui.parts.SectionTitle
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.T
import billingo.app.ui.parts.FootBar
import billingo.app.ui.parts.load
import billingo.app.ui.sale.BoxCol
import billingo.app.ui.sale.Grp
import billingo.app.ui.sale.Line
import billingo.app.ui.sale.MenuRow
import billingo.app.ui.sale.SaleMaths
import billingo.app.ui.sale.SaleSession
import billingo.app.ui.sale.TL
import billingo.app.ui.start.words
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Size
import java.math.BigDecimal
import kotlinx.coroutines.launch

@Composable
private fun hindi() = LocalConfiguration.current.locales[0].language == "hi"

private fun say(ctx: android.content.Context, text: String) = Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show()
private fun why(ctx: android.content.Context, e: ApiError) = if (e.status == 0) ctx.getString(R.string.no_internet) else e.message
private fun q3(s: String) = Format.qty(s)

/** A challan's badge (design 7.4e): Not Billed (orange), Invoiced (green), Cancelled (struck through). */
@Composable
internal fun ChallanBadge(status: String, cancelled: Boolean) = when {
    cancelled || status == "cancelled" -> Badge(stringResource(R.string.b_cancelled), BadgeKind.Grey, struck = true)
    status == "invoiced" -> Badge(stringResource(R.string.ch_invoiced), BadgeKind.Paid, icon = Icons.Check)
    else -> Badge(stringResource(R.string.ch_open), BadgeKind.Credit)
}

/**
 * Delivery Challans (design 7.4e chlist): Open Challans and Qty Out (Not Billed), search by number,
 * name or item, All / Not Billed / Invoiced / Cancelled, each with its quantity and badge; New Challan.
 */
@Composable
fun ChallansScreen(api: Api, onBack: () -> Unit, onOpen: (ChallanRow) -> Unit, onNew: () -> Unit) {
    val list = load { api.challans() }
    val hi = hindi()
    var query by rememberSaveable { mutableStateOf("") }
    var f by rememberSaveable { mutableIntStateOf(0) }
    var pick by rememberSaveable { mutableStateOf(false) }
    val names = listOf(stringResource(R.string.p_all), stringResource(R.string.ch_open), stringResource(R.string.ch_invoiced), stringResource(R.string.b_cancelled))
    val counter = stringResource(R.string.sl_counter_name)
    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.m_challans), onBack = onBack, foot = {
            Btn(stringResource(R.string.ch_new), onNew, Modifier.weight(1f), Kind.Blue, Icons.Plus)
        }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val all = list.data
                if (all == null) { item { Waiting(list) }; return@LazyColumn }
                item {
                    val (open, out) = DocMaths.chSummary(all)
                    DocSum(stringResource(R.string.ch_sum_open) to open.toString(), stringResource(R.string.ch_sum_out) to q3(out.toPlainString()))
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                        Field(null, query, { query = it }, Modifier.weight(1f), placeholder = stringResource(R.string.search), leading = Icons.Search, keyboard = KeyboardOptions(imeAction = ImeAction.Search))
                        Box(Modifier.weight(1f)) { ChoiceField(null, names[f]) { pick = true } }
                    }
                }
                val shown = all.filter { DocMaths.chMatches(it, f, query, counter) }
                if (shown.isEmpty()) item { EmptyState(Icons.Search, stringResource(R.string.dl_none), stringResource(R.string.dl_none_sub), null, null) }
                items(shown, key = { it.id }) { c ->
                    ListRow(DocMaths.chName(c, counter), c.number + " | " + Format.date(c.date, hi), { onOpen(c) }) {
                        T(stringResource(R.string.ch_qty, q3(c.qty)), weight = FontWeight.Bold, numbers = true, oneLine = true, struck = c.cancelled)
                        ChallanBadge(c.status, c.cancelled)
                    }
                }
            }
        }
        if (pick) {
            BackHandler { pick = false }
            ChoiceSheet(stringResource(R.string.dl_status), names, f, { pick = false }) { f = it; pick = false }
        }
    }
}

/**
 * A challan's page (design 7.4e chview): Goods Sent (quantity and items) with its badge, "Billed in
 * INV-…" (opens the bill), the customer, the items, transport, vehicle and note; Convert To Bill while
 * it is open (Share: its PDF); ⋮ has Edit Challan and Cancel Challan.
 */
@Composable
fun ChallanScreen(
    api: Api, id: String, number: String, version: Int, features: List<String>, itemOptions: kotlinx.serialization.json.JsonObject?,
    onBack: () -> Unit, onParty: (id: String, name: String) -> Unit, onBill: (id: String, number: String) -> Unit,
    onEdit: () -> Unit, onConvert: () -> Unit, onChanged: () -> Unit, onLater: () -> Unit,
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
    var busy by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    var made by remember(id, version) { mutableStateOf<billingo.app.ui.print.InvoicePdf.Made?>(null) }
    val counter = stringResource(R.string.sl_counter_name)

    /** Share (8.6d-2): the challan's PDF, laid out as the web prints it, to Android's Share. */
    fun share() {
        if (sharing) return
        sharing = true
        scope.launch {
            val m = made ?: try { billingo.app.ui.print.InvoicePdf.make(ctx, api, id, features, itemOptions).also { made = it } }
            catch (e: ApiError) { say(ctx, why(ctx, e)); null }
            catch (e: Exception) { say(ctx, ctx.getString(R.string.pdf_failed)); null }
            sharing = false
            if (m != null && !billingo.app.ui.print.InvoicePdf.share(ctx, m)) say(ctx, ctx.getString(R.string.pdf_no_app))
        }
    }

    fun cancel(passcode: String?) {
        busy = true
        scope.launch {
            try {
                val r = api.cancelSale(id, passcode)
                pass = false; ask = false
                say(ctx, ctx.getString(R.string.dv_cancelled, r.number))
                doc.reload(); onChanged()
            } catch (e: ApiError) {
                if (e.code == Api.PASSCODE) { ask = false; passErr = if (passcode == null) null else e.message; if (passcode != null) tries++; pass = true }
                else { say(ctx, why(ctx, e)); ask = false; pass = false }
            } finally { busy = false }
        }
    }

    fun openBill(no: String) {
        scope.launch {
            try { api.bills().firstOrNull { it.number == no }?.let { onBill(it.id, it.number) } }
            catch (e: ApiError) { say(ctx, why(ctx, e)) }
        }
    }

    val d = doc.data
    val open = d != null && !d.cancelled && d.status != "invoiced" && d.status != "cancelled"
    Box(Modifier.fillMaxSize()) {
        Frame(
            d?.number ?: number, d?.date?.takeIf { it.isNotBlank() }?.let { Format.date(it, hi) }, onBack,
            right = { if (open) IconBtn(Icons.Dots, stringResource(R.string.more_options), { menu = true }) },
            foot = if (!open) null else ({
                Btn(stringResource(R.string.dv_share), { share() }, Modifier.weight(1f), Kind.Soft, Icons.Share, busy = sharing)
                Btn(stringResource(R.string.qt_convert), onConvert, Modifier.weight(1f), Kind.Blue)
            }),
        ) {
            if (d == null) { Waiting(doc); return@Frame }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val tq = d.lines.fold(BigDecimal.ZERO) { a, l -> a + DocMaths.num(l.qty) }
                val n = d.lines.size
                ViewHead(stringResource(R.string.ch_sent), stringResource(if (n == 1) R.string.ch_sent_v1 else R.string.ch_sent_v, q3(tq.toPlainString()), n)) { ChallanBadge(d.status, d.cancelled) }
                val inv = DocMaths.invoiceOf(d)
                if (d.status == "invoiced" && inv.isNotBlank()) {
                    val shape = RoundedCornerShape(Size.RadiusSmall)
                    T(
                        stringResource(R.string.ch_billed_in, inv),
                        Modifier.fillMaxWidth().heightIn(min = Size.Tap).background(Colours.LightGreen, shape).clickable(role = Role.Button) { openBill(inv) }.padding(horizontal = 12.dp, vertical = 10.dp),
                        size = 13.sp, colour = Colours.Green,
                    )
                }
                val p = d.party
                PartyCard(d.party?.name?.takeIf { it.isNotBlank() } ?: d.partyName.ifBlank { counter }, p?.let { { onParty(it.id, it.name) } })
                SectionTitle(stringResource(R.string.ch_items))
                LineRows(d.lines, false)
                val x = d.extra
                fun str(k: String) = (x?.get(k) as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
                val tr = str("transport"); val veh = str("vehicle"); val note = d.notes
                if (tr.isNotBlank() || veh.isNotBlank() || note.isNotBlank()) BoxCol {
                    if (tr.isNotBlank()) TL(stringResource(R.string.sl_transport), tr)
                    if (veh.isNotBlank()) TL(stringResource(R.string.ch_vehicle), veh)
                    if (note.isNotBlank()) TL(stringResource(R.string.ch_note), note)
                }
            }
        }
        if (menu && d != null) {
            BackHandler { menu = false }
            Dim({ menu = false }) {
                Sheet(stringResource(R.string.more_options)) {
                    Grp {
                        MenuRow(Icons.Edit, stringResource(R.string.ch_edit), null) { menu = false; onEdit() }
                        Line()
                        DangerRow(Icons.Close, stringResource(R.string.ch_cancel)) { menu = false; ask = true }
                    }
                }
            }
        }
        if (ask && d != null) {
            BackHandler { ask = false }
            Dim({ if (!busy) ask = false }, centre = true) {
                ConfirmBox(
                    stringResource(R.string.dv_cancel_q, d.number), stringResource(R.string.ch_cancel_text) + "\n\n" + stringResource(R.string.dv_never_deleted),
                    stringResource(R.string.go_back), stringResource(R.string.dv_yes_cancel), { ask = false }, { if (!busy) cancel(null) },
                )
            }
        }
        if (pass && d != null) {
            BackHandler { pass = false }
            PasscodeSheet(stringResource(R.string.dv_cancel_q, d.number), stringResource(R.string.pc_cancel_text), passErr, tries, busy, { pass = false; passErr = null }) { cancel(it) }
        }
    }
}

/**
 * New Delivery Challan / Edit Challan (design 7.4e chform): the number and date, the customer (a
 * party, or a name for a counter customer), the items with their quantities (no prices: the item page
 * shows only the quantity), transport, vehicle and note; Save Challan.
 */
@Composable
fun ChallanFormScreen(s: SaleSession, onClose: () -> Unit, onCustomer: () -> Unit, onLine: (index: Int, itemId: String?) -> Unit, onSaved: (id: String, number: String) -> Unit, onTryAgain: () -> Unit) {
    val ctx = LocalContext.current
    val hi = hindi()
    val scope = rememberCoroutineScope()
    var leave by rememberSaveable { mutableStateOf(false) }
    val c = s.ctx
    val d = s.draft
    val close = { if (d != null && d.lines.isNotEmpty()) leave = true else onClose() }

    fun save(passcode: String? = null) {
        val dd = s.draft ?: return
        when (SaleMaths.chProblem(dd)) {
            SaleMaths.ChProblem.NoCustomer -> { say(ctx, ctx.getString(R.string.ch_need_cust)); return }
            SaleMaths.ChProblem.NoItems -> { say(ctx, ctx.getString(R.string.sl_need_item)); return }
            SaleMaths.ChProblem.NoQty -> { say(ctx, ctx.getString(R.string.sl_need_qty)); return }
            null -> {}
        }
        scope.launch {
            val e = s.save(passcode)
            val r = s.saved?.first
            when {
                e != null -> say(ctx, why(ctx, e))
                s.pass != null -> {}
                r != null -> onSaved(r.id, r.number)
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().background(Colours.Page)) {
            Box(Modifier.background(Colours.Card).statusBarsPadding()) {
                Header(stringResource(if (d?.edit != null) R.string.ch_edit else R.string.ch_new_title), left = { IconBtn(Icons.Close, stringResource(R.string.close), close) })
            }
            if (c == null || d == null) {
                Column(Modifier.weight(1f).fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    val p = s.problem
                    if (p != null) {
                        T(words(p) ?: "", colour = Colours.Red)
                        Btn(stringResource(R.string.try_again), onTryAgain, Modifier.fillMaxWidth(), Kind.Line)
                    } else Loading()
                }
                return@Column
            }
            Column(Modifier.weight(1f).imePadding().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                // the number and date (.invs): shown, never typed (owner, 18 Nov 2026)
                val shape = RoundedCornerShape(Size.Radius)
                Row(Modifier.fillMaxWidth().background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(horizontal = 12.dp, vertical = 6.dp)) {
                    Column(Modifier.weight(1f)) {
                        T(stringResource(R.string.ch_no), size = 11.5.sp, weight = FontWeight.SemiBold, colour = Colours.Text3, oneLine = true)
                        T(s.number.ifBlank { "…" }, size = 14.sp, weight = FontWeight.Bold, oneLine = true)
                    }
                    Column(Modifier.weight(1f)) {
                        T(stringResource(R.string.sl_date), size = 11.5.sp, weight = FontWeight.SemiBold, colour = Colours.Text3, oneLine = true)
                        T(Format.date(d.date, hi), size = 14.sp, weight = FontWeight.Bold, oneLine = true)
                    }
                }
                // the customer: a party, or a counter customer's name
                val party = SaleMaths.party(c, d)
                val small = RoundedCornerShape(Size.RadiusSmall)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = Size.Tap).background(Colours.Card, small).border(1.dp, Colours.Border, small).clickable(role = Role.Button, onClick = onCustomer).padding(horizontal = 10.dp)
                        .semantics { contentDescription = "Customer" },
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.User, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp))
                    if (party != null) T(party.name, Modifier.weight(1f), oneLine = true)
                    else T(stringResource(if (d.cash) R.string.sl_counter else R.string.sl_choose_customer), Modifier.weight(1f), colour = Colours.Text3, oneLine = true)
                    Icon(Icons.Next, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp).rotate(90f))
                }
                if (party == null) Field(stringResource(R.string.ch_name), d.cashName, { v -> s.change { it.copy(cashName = v.take(160)) } }, placeholder = stringResource(R.string.bq_cust_ph))
                T(stringResource(R.string.ch_hint), size = 12.sp, colour = Colours.Text3)
                if (d.lines.isNotEmpty()) SectionTitle(stringResource(R.string.dv_items, d.lines.size))
                d.lines.forEachIndexed { k, l ->
                    val item = SaleMaths.item(c, l.itemId)
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 60.dp).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).clickable(role = Role.Button) { onLine(k, null) }.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        T("#${k + 1}", size = 12.sp, weight = FontWeight.Bold, colour = Colours.Text3)
                        Column(Modifier.weight(1f)) {
                            T(l.name, weight = FontWeight.SemiBold, oneLine = true)
                            if (item != null) T(if (ItemMaths.isService(item)) stringResource(R.string.i_service) else stringResource(R.string.sl_in_stock, q3(item.stock.toPlainString()) + " " + item.unit), size = 12.sp, colour = Colours.Text3)
                        }
                        T(q3(l.qty) + " " + l.unit, weight = FontWeight.Bold, numbers = true, oneLine = true)
                    }
                }
                Btn(stringResource(R.string.sl_add_item), { onLine(-1, null) }, Modifier.fillMaxWidth(), Kind.Soft, Icons.Plus)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Field(stringResource(R.string.sl_transport), d.transport, { v -> s.change { it.copy(transport = v.take(120)) } }, Modifier.weight(1f), placeholder = stringResource(R.string.ch_tr_ph))
                    Field(stringResource(R.string.ch_vehicle), d.vehicle, { v -> s.change { it.copy(vehicle = v.take(60)) } }, Modifier.weight(1f), placeholder = "UP78 AB 1234")
                }
                Field(stringResource(R.string.ch_note), d.notes.orEmpty(), { v -> s.change { it.copy(notes = v.take(500)) } }, placeholder = stringResource(R.string.ch_note_ph))
            }
            FootBar { Btn(stringResource(R.string.ch_save), { save() }, Modifier.weight(1f), Kind.Green, Icons.Check, busy = s.busy) }
        }
        if (leave && d != null) {
            BackHandler { leave = false }
            Dim({ leave = false }, centre = true) {
                if (d.edit != null) ConfirmBox(stringResource(R.string.eb_leave_q), stringResource(R.string.eb_leave_t, d.edit.number), stringResource(R.string.keep), stringResource(R.string.eb_leave), { leave = false }, { leave = false; onClose() })
                else ConfirmBox(stringResource(R.string.ch_discard_q), stringResource(R.string.sl_discard_t), stringResource(R.string.keep), stringResource(R.string.sl_discard), { leave = false }, { leave = false; onClose() })
            }
        }
        val pass = s.pass
        if (pass != null && d != null) {
            BackHandler { s.pass = null }
            PasscodeSheet(stringResource(R.string.eb_pass_t, d.edit?.number.orEmpty()), stringResource(R.string.ch_pass_text), pass.ifBlank { null }, s.passTries, s.busy, { s.pass = null }) { save(it) }
        }
    }
}
