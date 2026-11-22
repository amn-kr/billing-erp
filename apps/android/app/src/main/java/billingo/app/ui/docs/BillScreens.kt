@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package billingo.app.ui.docs

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.BillRow
import billingo.app.data.DocLine
import billingo.app.data.SaleDoc
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
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.Spinner
import billingo.app.ui.parts.T
import billingo.app.ui.parts.load
import billingo.app.ui.parts.raised
import billingo.app.ui.print.InvoicePdf
import billingo.app.ui.sale.BoxCol
import billingo.app.ui.sale.Grp
import billingo.app.ui.sale.Line
import billingo.app.ui.sale.MenuRow
import billingo.app.ui.sale.TL
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Size
import java.math.BigDecimal
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

@Composable
private fun hindi() = LocalConfiguration.current.locales[0].language == "hi"

private fun say(ctx: android.content.Context, text: String) = Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show()
private fun why(ctx: android.content.Context, e: ApiError) = if (e.status == 0) ctx.getString(R.string.no_internet) else e.message

/** "1,390" or "1,390.50" (design m2) and "1,390.00" (design inr) */
private fun m2(v: BigDecimal) = Format.inr(v, paise = false)
private fun inr(v: BigDecimal) = Format.inr(v)
private fun n(s: String?) = DocMaths.num(s)

/** A bill's badge (design invState): Paid, Part Paid, Overdue n Days, Unpaid; Cancelled struck through. */
@Composable
internal fun BillBadge(s: DocMaths.State) = when (s) {
    DocMaths.State.Cancelled -> Badge(stringResource(R.string.b_cancelled), BadgeKind.Grey, struck = true)
    DocMaths.State.Paid -> Badge(stringResource(R.string.pp_paid), BadgeKind.Paid, icon = Icons.Check)
    DocMaths.State.PartPaid -> Badge(stringResource(R.string.b_part_paid), BadgeKind.Credit)
    is DocMaths.State.Overdue -> Badge(if (s.days == 1) stringResource(R.string.b_overdue_1) else stringResource(R.string.b_overdue, s.days), BadgeKind.Due)
    DocMaths.State.Unpaid -> Badge(stringResource(R.string.pp_unpaid), BadgeKind.Credit)
}

/** The two boxes at the top of a list (.dsum): a small label over a bold figure. */
@Composable
internal fun DocSum(a: Pair<String, String>, b: Pair<String, String>, bColour: Color = Colours.Text) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(a to Colours.Text, b to bColour).forEach { (x, c) ->
            val shape = RoundedCornerShape(Size.Radius)
            Column(Modifier.weight(1f).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(horizontal = 10.dp, vertical = 8.dp)) {
                T(x.first, size = 12.sp, weight = FontWeight.SemiBold, colour = Colours.Text2, oneLine = true)
                T(x.second, size = 17.sp, weight = FontWeight.Bold, colour = c, numbers = true, oneLine = true)
            }
        }
    }
}

/**
 * Sale Bills (design 7.4e): This Month Sales and ↓ Still To Get, search by number or name, a status
 * choice (All, Due, Paid, Cancelled), and the bills, newest first. A bill opens its own page.
 */
@Composable
fun SaleBillsScreen(api: Api, onBack: () -> Unit, onOpen: (BillRow) -> Unit, onNew: () -> Unit) {
    val list = load { api.bills() }
    val hi = hindi()
    val today = Format.todayIso()
    var query by rememberSaveable { mutableStateOf("") }
    var f by rememberSaveable { mutableIntStateOf(0) }
    var pick by rememberSaveable { mutableStateOf(false) }
    val names = listOf(stringResource(R.string.p_all), stringResource(R.string.dl_due), stringResource(R.string.pp_paid), stringResource(R.string.b_cancelled))
    val counter = stringResource(R.string.sl_counter_name)
    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.m_sale_bills), onBack = onBack, foot = {
            Btn(stringResource(R.string.new_bill), onNew, Modifier.weight(1f), Kind.Blue, Icons.Plus)
        }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val all = list.data
                if (all == null) { item { Waiting(list) }; return@LazyColumn }
                item {
                    val (sales, dues) = DocMaths.summary(all, today)
                    DocSum(stringResource(R.string.dl_month_sales) to "₹" + m2(sales), stringResource(R.string.dl_to_get) to "₹" + m2(dues), Colours.Green)
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                        Field(null, query, { query = it }, Modifier.weight(1f), placeholder = stringResource(R.string.search), leading = Icons.Search, keyboard = KeyboardOptions(imeAction = ImeAction.Search))
                        Box(Modifier.weight(1f)) { ChoiceField(null, names[f]) { pick = true } }
                    }
                }
                val shown = all.filter { DocMaths.matches(it, DocMaths.Filter.entries[f], query, counter) }
                if (shown.isEmpty()) item { EmptyState(Icons.Search, stringResource(R.string.dl_none), stringResource(R.string.dl_none_sub), null, null) }
                items(shown, key = { it.id }) { b ->
                    ListRow(DocMaths.name(b, counter), b.number + " | " + Format.date(b.date, hi), { onOpen(b) }) {
                        T(m2(n(b.total)), weight = FontWeight.Bold, numbers = true, oneLine = true, struck = b.cancelled)
                        BillBadge(DocMaths.state(b, today))
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

/** The customer on a document (.pfield): a party opens its page; a walk-in shows "Counter Sale". */
@Composable
internal fun PartyCard(name: String, onTap: (() -> Unit)?) {
    val shape = RoundedCornerShape(Size.RadiusSmall)
    Row(
        Modifier.fillMaxWidth().heightIn(min = Size.Tap).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)
            .then(if (onTap != null) Modifier.clickable(role = Role.Button, onClick = onTap) else Modifier).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.User, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp))
        T(name, Modifier.weight(1f), oneLine = true)
        if (onTap != null) Icon(Icons.Next, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp))
        else T(stringResource(R.string.dv_counter_sale), size = 12.sp, weight = FontWeight.SemiBold, colour = Colours.Text2, oneLine = true)
    }
}

/** A tag under the customer (.tagb): "From QT-0030", "Referral: Raju". */
@Composable
private fun InfoTag(text: String) {
    val shape = RoundedCornerShape(999.dp)
    Box(Modifier.heightIn(min = Size.Tap).widthIn(max = 320.dp).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
        T(text, size = 13.sp, weight = FontWeight.SemiBold, colour = Colours.Text2, oneLine = true)
    }
}

/** The big figure at the top of a document (.vhd) with its badge. */
@Composable
internal fun ViewHead(label: String, amount: String, colour: Color = Colours.Text, badge: @Composable () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier.fillMaxWidth().background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            T(label, size = 12.sp, weight = FontWeight.SemiBold, colour = Colours.Text2)
            T(amount, size = 22.sp, weight = FontWeight.Bold, colour = colour, numbers = true, oneLine = true)
        }
        badge()
    }
}

/** The document's lines (.grp of .srow.vl): number, name, "10 Pcs × 850", amount. */
@Composable
internal fun LineRows(lines: List<DocLine>, money: Boolean) {
    Grp {
        lines.forEachIndexed { k, l ->
            if (k > 0) Line()
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                T((k + 1).toString(), Modifier.widthIn(min = 16.dp), size = 12.sp, weight = FontWeight.Bold, colour = Colours.Text3)
                Column(Modifier.weight(1f)) {
                    T(l.name, oneLine = true)
                    T(Format.qty(l.qty) + " " + l.unit + (if (money) " × " + m2(n(l.price)) else ""), size = 12.sp, colour = Colours.Text3)
                }
                if (money) T(m2(n(l.amount)), weight = FontWeight.Bold, numbers = true)
            }
        }
    }
}

@Composable
private fun SecTitle(text: String) = billingo.app.ui.parts.SectionTitle(text)

/**
 * A sale bill's page (design 7.4e bview): the total with its badge, the customer (opens the party),
 * where it came from and the referral, the items, the figures with Received and Dues, and the
 * payments. ⋮ has Edit Bill, Print and Cancel Bill; at the bottom Take Payment and Share.
 */
@Composable
fun BillScreen(
    api: Api, id: String, number: String, features: List<String>, itemOptions: JsonObject?,
    onBack: () -> Unit, onParty: (id: String, name: String) -> Unit, onChanged: () -> Unit, onLater: () -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val hi = hindi()
    val today = Format.todayIso()
    val doc = load { api.saleDoc(id) }
    // referral names; without access the bill still shows
    val refs = load { try { api.referrers() } catch (e: ApiError) { if (e.status == 0) throw e; emptyList() } }
    var menu by rememberSaveable { mutableStateOf(false) }
    var ask by rememberSaveable { mutableStateOf(false) }
    var pass by rememberSaveable { mutableStateOf(false) }
    var passErr by remember { mutableStateOf<String?>(null) }
    // each refused passcode empties the dots for the next try
    var tries by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf("") }
    var made by remember(id) { mutableStateOf<InvoicePdf.Made?>(null) }
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
                "wa" -> if (!InvoicePdf.whatsApp(ctx, m)) say(ctx, ctx.getString(R.string.pdf_no_app))
                else -> InvoicePdf.print(ctx, m)
            }
        }
    }

    /** Cancel: first without the passcode; when the shop asks for it, the passcode box opens and sends it along. */
    fun cancel(passcode: String?) {
        busy = "cancel"
        scope.launch {
            try {
                val r = api.cancelSale(id, passcode)
                pass = false; ask = false; made = null
                val adv = n(r.movedToAdvance)
                say(ctx, if (adv.signum() > 0) ctx.getString(R.string.dv_cancelled_adv, r.number, inr(adv)) else ctx.getString(R.string.dv_cancelled, r.number))
                doc.reload(); onChanged()
            } catch (e: ApiError) {
                if (e.code == Api.PASSCODE) { ask = false; passErr = if (passcode == null) null else e.message; if (passcode != null) tries++; pass = true }
                else { say(ctx, why(ctx, e)); ask = false; pass = false }
            } finally { busy = "" }
        }
    }

    val d = doc.data
    Box(Modifier.fillMaxSize()) {
        Frame(
            d?.number ?: number, d?.date?.takeIf { it.isNotBlank() }?.let { Format.date(it, hi) }, onBack,
            right = { if (d != null && !d.cancelled) IconBtn(Icons.Dots, stringResource(R.string.more_options), { menu = true }) },
            foot = if (d == null || d.cancelled) null else ({
                if (n(d.balance).signum() > 0 && d.party != null) Btn(stringResource(R.string.take_payment), onLater, Modifier.weight(1f), Kind.Soft, Icons.Rupee)
                Btn(stringResource(R.string.dv_share), { pdf("wa") }, Modifier.weight(1f), Kind.Green, Icons.Chat, busy = busy == "wa")
            }),
        ) {
            if (d == null) { Waiting(doc); return@Frame }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val total = n(d.total)
                val dues = n(d.balance)
                val rec = if (d.cancelled) BigDecimal.ZERO else total - dues
                ViewHead(stringResource(R.string.dv_bill_total), "₹" + m2(total)) { BillBadge(DocMaths.state(d.cancelled, total, dues, d.dueDate, today)) }
                if (d.cancelled) {
                    val shape = RoundedCornerShape(Size.RadiusSmall)
                    T(stringResource(R.string.dv_is_cancelled), Modifier.fillMaxWidth().background(Colours.LightRed, shape).padding(horizontal = 12.dp, vertical = 10.dp), size = 13.sp, colour = Colours.Red)
                }
                val p = d.party
                PartyCard(DocMaths.name(d, counter), p?.let { { onParty(it.id, it.name) } })
                val from = DocMaths.sources(d)
                val ref = d.referrerId?.let { r -> refs.data?.firstOrNull { it.id == r }?.name }
                if (from.isNotEmpty() || ref != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    from.forEach { InfoTag(stringResource(R.string.dv_from, it)) }
                    if (ref != null) InfoTag(stringResource(R.string.dv_referral, ref))
                }
                SecTitle(stringResource(R.string.dv_items, d.lines.size))
                LineRows(d.lines, true)
                BoxCol {
                    TL(stringResource(R.string.sl_items_total), "₹" + inr(n(d.itemsTotal)))
                    if (n(d.billDiscount).signum() > 0) TL(stringResource(R.string.sl_discount), "−₹" + inr(n(d.billDiscount)), Colours.Red)
                    if (n(d.tax).signum() > 0 || d.taxMode != "none") {
                        TL(stringResource(R.string.sl_taxable), "₹" + inr(n(d.taxable)))
                        if (n(d.igst).signum() > 0) TL("IGST", "₹" + inr(n(d.igst))) else { TL("CGST", "₹" + inr(n(d.cgst))); TL("SGST", "₹" + inr(n(d.sgst))) }
                    }
                    if (n(d.tcs).signum() > 0) TL("TCS", "+₹" + inr(n(d.tcs)))
                    val ch = DocMaths.charges(d)
                    if (ch.signum() > 0) TL(stringResource(R.string.dv_charges), "+₹" + inr(ch))
                    val ro = n(d.roundAmount)
                    if (ro.signum() != 0) TL(stringResource(R.string.sl_round), (if (ro.signum() < 0) "−" else "+") + "₹" + inr(ro.abs()))
                    TL(stringResource(R.string.sl_total), "₹" + inr(total), big = true)
                    TL(stringResource(R.string.dv_received), "₹" + inr(rec), Colours.Green)
                    if (dues.signum() > 0) TL(stringResource(R.string.dv_dues), "₹" + inr(dues), Colours.Red)
                }
                val pays = d.settlements.filter { !it.cancelled && n(it.amount).signum() > 0 }
                if (pays.isNotEmpty()) {
                    SecTitle(stringResource(R.string.dv_payments))
                    Grp {
                        pays.forEachIndexed { k, x ->
                            if (k > 0) Line()
                            Row(Modifier.fillMaxWidth().heightIn(min = Size.Tap).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Column(Modifier.weight(1f)) {
                                    T(stringResource(if (x.kind == "credit_note") R.string.dv_credit_note else R.string.dv_payment_in), oneLine = true)
                                    val sub = listOfNotNull(x.number.takeIf { it.isNotBlank() }, x.date?.takeIf { it.isNotBlank() }?.let { Format.date(it, hi) }).joinToString(" | ") + (if (x.mode.isNotBlank()) " · " + modeWord(x.mode) else "")
                                    T(sub, size = 12.sp, colour = Colours.Text3)
                                }
                                T("₹" + m2(n(x.amount)), weight = FontWeight.Bold, colour = Colours.Green, numbers = true)
                            }
                        }
                    }
                }
            }
        }
        if (menu && d != null) {
            BackHandler { menu = false }
            Dim({ menu = false }) {
                Sheet(stringResource(R.string.more_options)) {
                    Grp {
                        MenuRow(Icons.Edit, stringResource(R.string.dv_edit), null) { menu = false; onLater() }
                        Line()
                        MenuRow(Icons.Bill, stringResource(R.string.pdf_print), null) { menu = false; pdf("print") }
                        Line()
                        DangerRow(Icons.Close, stringResource(R.string.dv_cancel_bill)) { menu = false; ask = true }
                    }
                }
            }
        }
        if (ask && d != null) {
            BackHandler { ask = false }
            val c = DocMaths.cancelNote(d)
            var text = if (c.party != null) stringResource(R.string.dv_cancel_text_party, c.party, inr(c.dues)) else stringResource(R.string.dv_cancel_text)
            if (c.paid.signum() > 0) text += " " + stringResource(if (c.party != null) R.string.dv_cancel_adv else R.string.dv_cancel_refund, inr(c.paid))
            text += "\n\n" + stringResource(R.string.dv_never_deleted)
            Dim({ if (busy.isEmpty()) ask = false }, centre = true) {
                ConfirmBox(stringResource(R.string.dv_cancel_q, d.number), text, stringResource(R.string.go_back), stringResource(R.string.dv_yes_cancel), { ask = false }, { if (busy.isEmpty()) cancel(null) })
            }
        }
        if (pass && d != null) {
            BackHandler { pass = false }
            PasscodeSheet(stringResource(R.string.dv_cancel_q, d.number), stringResource(R.string.pc_cancel_text), passErr, tries, busy == "cancel", { pass = false; passErr = null }) { cancel(it) }
        }
    }
}

@Composable
private fun modeWord(mode: String) = stringResource(
    when (mode) { "UPI" -> R.string.pm_upi; "Bank transfer" -> R.string.pm_bank; "Cheque" -> R.string.pm_cheque; "Card" -> R.string.pm_card; else -> R.string.pm_cash },
)

/** A red menu row (design: Cancel in the ⋮ list). */
@Composable
private fun DangerRow(icon: ImageVector, text: String, onTap: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, onClick = onTap).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Colours.Red, modifier = Modifier.size(20.dp))
        T(text, Modifier.weight(1f), colour = Colours.Red)
    }
}

/**
 * The transaction passcode (Settings › Transactions, 4 to 6 digits), asked before a saved document
 * is changed or cancelled: the price PIN's dots and number pad, with OK. The server checks it;
 * a wrong one says how many tries are left. Asked every time, never kept.
 */
@Composable
internal fun PasscodeSheet(title: String, text: String, err: String?, tries: Int, busy: Boolean, onClose: () -> Unit, onOk: (String) -> Unit) {
    var digits by remember(tries) { mutableStateOf("") }
    var shownErr by remember(tries, err) { mutableStateOf(err) }
    Dim(onClose) {
        Sheet(title) {
            T(text, size = 14.sp, colour = Colours.Text2)
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                repeat(6) { k ->
                    val on = k < digits.length
                    Box(Modifier.size(16.dp).background(if (on) Colours.Blue else Colours.Card, CircleShape).border(2.dp, if (on) Colours.Blue else Colours.Text3, CircleShape))
                }
                if (busy) Spinner(Colours.Blue)
            }
            if (shownErr != null) T(shownErr!!, Modifier.fillMaxWidth(), size = 13.sp, colour = Colours.Red, align = TextAlign.Center)
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
                                        else -> if (digits.length < 6) { shownErr = null; digits += k }
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
            Btn(stringResource(R.string.pc_ok), { if (digits.length >= 4) onOk(digits) }, Modifier.fillMaxWidth(), Kind.Blue, busy = busy)
        }
    }
}
