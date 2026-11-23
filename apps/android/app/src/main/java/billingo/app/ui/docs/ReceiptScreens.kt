package billingo.app.ui.docs

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.Due
import billingo.app.data.ReceiptRow
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
import billingo.app.ui.print.PFmt
import billingo.app.ui.sale.BoxCol
import billingo.app.ui.sale.Grp
import billingo.app.ui.sale.Line
import billingo.app.ui.sale.MenuRow
import billingo.app.ui.sale.TL
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Size
import java.math.BigDecimal
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
private fun hindi() = LocalConfiguration.current.locales[0].language == "hi"

private fun say(ctx: android.content.Context, text: String) = Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show()
private fun why(ctx: android.content.Context, e: ApiError) = if (e.status == 0) ctx.getString(R.string.no_internet) else e.message
private fun n(s: String?) = DocMaths.num(s)
private fun m2(v: BigDecimal) = Format.inr(v, paise = false)
private fun inr(v: BigDecimal) = Format.inr(v)
private fun plain(v: BigDecimal) = v.stripTrailingZeros().let { if (it.scale() < 0) it.setScale(0) else it }.toPlainString()

/** The server's payment types and their words (the same as Payment Received on a bill). */
private val MODES = listOf("Cash", "UPI", "Bank transfer", "Cheque", "Card")

@Composable
internal fun modeName(mode: String) = stringResource(
    when (mode) { "UPI" -> R.string.pm_upi; "Bank transfer" -> R.string.pm_bank; "Cheque" -> R.string.pm_cheque; "Card" -> R.string.pm_card; else -> R.string.pm_cash },
)

/**
 * Payments Received (design 7.4e prlist): ↓ Received This Month and Still To Collect, search, the
 * payment type choice, each payment with "PR-0035 | 14 Nov 2026", its amount and ↓ Received.
 */
@Composable
fun PaymentsScreen(api: Api, onBack: () -> Unit, onOpen: (ReceiptRow) -> Unit, onNew: () -> Unit) {
    val list = load { api.receipts() }
    val bills = load { api.bills() }
    val hi = hindi()
    val today = Format.todayIso()
    var query by rememberSaveable { mutableStateOf("") }
    var f by rememberSaveable { mutableIntStateOf(0) }
    var pick by rememberSaveable { mutableStateOf(false) }
    val names = listOf(stringResource(R.string.pr_all_modes), stringResource(R.string.pm_cash), stringResource(R.string.pm_upi), stringResource(R.string.pm_bank), stringResource(R.string.pm_cheque))
    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.m_paid_in), onBack = onBack, foot = {
            Btn(stringResource(R.string.pr_receive), onNew, Modifier.weight(1f), Kind.Blue, Icons.Plus)
        }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val all = list.data
                if (all == null) { item { Waiting(list) }; return@LazyColumn }
                item {
                    val (month, collect) = DocMaths.prSummary(all, bills.data.orEmpty(), today)
                    DocSum(stringResource(R.string.pr_sum_month) to "₹" + m2(month), stringResource(R.string.pr_sum_collect) to (if (bills.data == null) "…" else "₹" + m2(collect)), Colours.Text)
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                        Field(null, query, { query = it }, Modifier.weight(1f), placeholder = stringResource(R.string.search), leading = Icons.Search, keyboard = KeyboardOptions(imeAction = ImeAction.Search))
                        Box(Modifier.weight(1f)) { ChoiceField(null, names[f]) { pick = true } }
                    }
                }
                val shown = all.filter { DocMaths.prMatches(it, f, query) }
                if (shown.isEmpty()) item { EmptyState(Icons.Search, stringResource(R.string.dl_none), stringResource(R.string.dl_none_sub), null, null) }
                items(shown, key = { it.id }) { r ->
                    ListRow(r.partyName, r.number + " | " + Format.date(r.date, hi), { onOpen(r) }) {
                        T(m2(n(r.amount)), weight = FontWeight.Bold, colour = Colours.Green, numbers = true, oneLine = true)
                        Badge(stringResource(R.string.pr_received_b), BadgeKind.Paid)
                    }
                }
            }
        }
        if (pick) {
            BackHandler { pick = false }
            ChoiceSheet(stringResource(R.string.pr_mode), names, f, { pick = false }) { f = it; pick = false }
        }
    }
}

/** The web's WhatsApp receipt, to the customer's number (wa.me), else WhatsApp's own chooser. */
private fun sendReceipt(ctx: android.content.Context, phone: String?, text: String) {
    val digits = phone.orEmpty().filter(Char::isDigit).let { if (it.length == 10) "91$it" else it }
    val uri = Uri.parse("https://wa.me/" + digits + "?text=" + Uri.encode(text))
    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: ActivityNotFoundException) { say(ctx, ctx.getString(R.string.rm_no_whatsapp)) }
}

/**
 * A payment's page (design 7.4e prview): ↓ Amount Received, the customer, how it was received, its
 * reference, the bill it was taken with, the bills it settled (each opens) and any advance; Send
 * Receipt On WhatsApp; ⋮ has Edit Payment and Delete Payment (as on the computer).
 */
@Composable
fun ReceiptScreen(
    api: Api, id: String, number: String, version: Int,
    onBack: () -> Unit, onParty: (id: String, name: String) -> Unit, onBill: (id: String, number: String) -> Unit, onEdit: () -> Unit, onGone: () -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val hi = hindi()
    val row = load(version) { api.receipts().firstOrNull { it.id == id } }
    val doc = load(version) { api.receipt(id) }
    val bills = load(version) { api.bills() }
    var menu by rememberSaveable { mutableStateOf(false) }
    var ask by rememberSaveable { mutableStateOf(false) }
    var pass by rememberSaveable { mutableStateOf(false) }
    var passErr by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }

    fun delete(passcode: String?) {
        busy = true
        scope.launch {
            try {
                api.deleteReceipt(id, passcode)
                pass = false; ask = false
                say(ctx, ctx.getString(R.string.pr_deleted, number))
                onGone()
            } catch (e: ApiError) {
                if (e.code == Api.PASSCODE) { ask = false; passErr = if (passcode == null) null else e.message; if (passcode != null) tries++; pass = true }
                else { say(ctx, why(ctx, e)); ask = false; pass = false }
            } finally { busy = false }
        }
    }

    val r = row.data
    val d = doc.data
    Box(Modifier.fillMaxSize()) {
        Frame(
            number, r?.date?.let { Format.date(it, hi) }, onBack,
            right = { if (r != null && d != null) IconBtn(Icons.Dots, stringResource(R.string.more_options), { menu = true }) },
            foot = if (r == null) null else ({
                Btn(stringResource(R.string.pr_send_wa), {
                    sendReceipt(ctx, r.party?.phone, DocMaths.receiptMessage(r, { Format.inr(n(it)) }, { PFmt.dmy(it) }))
                }, Modifier.weight(1f), Kind.Green, Icons.Chat)
            }),
        ) {
            if (r == null || d == null) { if (row.loading || doc.loading) Waiting(if (doc.problem != null) doc else row) else T(stringResource(R.string.pr_gone), Modifier.padding(12.dp), colour = Colours.Text2); return@Frame }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ViewHead(stringResource(R.string.pr_amount_recv), "₹" + m2(n(r.amount)), Colours.Green) { Badge(stringResource(R.string.pr_received), BadgeKind.Paid) }
                PartyCard(r.partyName, r.party?.let { p -> { onParty(p.id, p.name) } })
                BoxCol {
                    TL(stringResource(R.string.pr_recv_in), modeName(r.mode))
                    if (r.reference.isNotBlank()) TL(stringResource(R.string.pr_ref), r.reference)
                    if (r.atSale && r.against.isNotBlank()) TL(stringResource(R.string.pr_with_bill), r.against)
                }
                SectionTitle(stringResource(R.string.pr_settled))
                val inv = d.allocations.filter { it.to != "opening" }
                val all = bills.data.orEmpty()
                if (d.allocations.isNotEmpty()) Grp {
                    d.allocations.forEachIndexed { k, a ->
                        if (k > 0) Line()
                        val b = all.firstOrNull { it.id == a.to }
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = Size.Tap).then(if (b != null) Modifier.clickable(role = Role.Button) { onBill(b.id, b.number) } else Modifier).padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                T(if (a.to == "opening") stringResource(R.string.pr_opening) else b?.number ?: "…", oneLine = true)
                                if (b != null) T(Format.date(b.date, hi) + " · " + stringResource(R.string.pr_bill_of, m2(n(b.total))), size = 12.sp, colour = Colours.Text3)
                            }
                            T("₹" + m2(n(a.amount)), weight = FontWeight.Bold, numbers = true)
                        }
                    }
                }
                if (inv.isEmpty() && d.allocations.isEmpty() && n(r.unused).signum() == 0) T(stringResource(R.string.pr_on_account), size = 12.sp, colour = Colours.Text3)
                val adv = n(r.unused)
                if (adv.signum() > 0) {
                    val shape = RoundedCornerShape(Size.RadiusSmall)
                    T(stringResource(R.string.pr_kept_adv, inr(adv)), Modifier.fillMaxWidth().background(Colours.LightGreen, shape).padding(horizontal = 12.dp, vertical = 10.dp), size = 13.sp, colour = Colours.Green)
                }
            }
        }
        if (menu && d != null) {
            BackHandler { menu = false }
            Dim({ menu = false }) {
                Sheet(stringResource(R.string.more_options)) {
                    Grp {
                        // a payment taken with a bill, or from a commission payout, is changed there (the server says why)
                        MenuRow(Icons.Edit, stringResource(R.string.pr_edit), null) { menu = false; if (d.locked.isNotBlank()) say(ctx, d.locked) else onEdit() }
                        Line()
                        DangerRow(Icons.Trash, stringResource(R.string.pr_delete)) { menu = false; ask = true }
                    }
                }
            }
        }
        if (ask && r != null) {
            BackHandler { ask = false }
            val text = (if (r.against.isNotBlank() && !r.atSale) stringResource(R.string.pr_delete_owed, r.against, r.partyName) else stringResource(R.string.pr_delete_adv, r.partyName)) +
                (if (r.mode == "Cheque") " " + stringResource(R.string.pr_delete_cheque) else "") + "\n\n" + stringResource(R.string.pr_delete_kept)
            Dim({ if (!busy) ask = false }, centre = true) {
                ConfirmBox(stringResource(R.string.pr_delete_q, number), text, stringResource(R.string.go_back), stringResource(R.string.pr_yes_delete), { ask = false }, { if (!busy) delete(null) })
            }
        }
        if (pass) {
            BackHandler { pass = false }
            PasscodeSheet(stringResource(R.string.pr_delete_q, number), stringResource(R.string.pr_pass_delete), passErr, tries, busy, { pass = false; passErr = null }) { delete(it) }
        }
    }
}

/** A customer to receive from: search, each with what they owe. */
@Composable
private fun CustomerPick(api: Api, onClose: () -> Unit, onPick: (id: String, name: String) -> Unit) {
    val list = load { api.partiesFull() }
    var q by remember { mutableStateOf("") }
    Dim(onClose) {
        Sheet(stringResource(R.string.sl_choose_customer)) {
            Field(null, q, { q = it }, Modifier.fillMaxWidth(), placeholder = stringResource(R.string.p_search), leading = Icons.Search)
            val all = list.data
            if (all == null) { Waiting(list); return@Sheet }
            val t = q.trim().lowercase()
            val shown = all.filter { it.kind != "supplier" && (t.isEmpty() || it.name.lowercase().contains(t) || it.phone.contains(t)) }
                .sortedWith(compareByDescending<billingo.app.data.PartyFull> { it.balance.signum() > 0 }.thenBy { it.name.lowercase() }).take(30)
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                Grp {
                    shown.forEachIndexed { k, p ->
                        if (k > 0) Line()
                        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button) { onPick(p.id, p.name) }.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            T(p.name, Modifier.weight(1f), oneLine = true)
                            if (p.balance.signum() > 0) T(stringResource(R.string.sl_dues, m2(p.balance)), size = 12.sp, weight = FontWeight.SemiBold, colour = Colours.Red, numbers = true)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Receive Payment / Edit Payment (design 7.4e prform): the number and date, the customer, ↓ Amount
 * Received, Received In and its reference, and Settle Against Bills: the customer's unpaid bills,
 * oldest first, all ticked; the amount settles them in that order and the rest is kept as advance.
 * Choosing a customer fills in everything they owe.
 */
@Composable
fun ReceiveScreen(api: Api, startParty: String?, editId: String?, onBack: () -> Unit, onSaved: (id: String, number: String) -> Unit) {
    val ctx = LocalContext.current
    val hi = hindi()
    val scope = rememberCoroutineScope()
    val today = Format.todayIso()
    var partyId by rememberSaveable { mutableStateOf(startParty) }
    var partyName by rememberSaveable { mutableStateOf("") }
    var amount by rememberSaveable { mutableStateOf("") }
    var mode by rememberSaveable { mutableStateOf("Cash") }
    var ref by rememberSaveable { mutableStateOf("") }
    var ticked by remember { mutableStateOf<Set<String>?>(null) }
    var date by rememberSaveable { mutableStateOf(today) }
    var notes by rememberSaveable { mutableStateOf("") }
    var no by rememberSaveable { mutableStateOf("") }
    var pickCust by remember { mutableStateOf(startParty == null && editId == null) }
    var pickMode by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var leave by remember { mutableStateOf(false) }
    var pass by remember { mutableStateOf(false) }
    var passErr by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    var filled by rememberSaveable { mutableStateOf(false) }

    // a saved payment: as it was
    val saved = load(editId) { editId?.let { api.receipt(it) } }
    LaunchedEffect(saved.data) {
        val s = saved.data ?: return@LaunchedEffect
        if (filled) return@LaunchedEffect
        partyId = s.partyId; amount = plain(n(s.amount)); mode = s.mode; ref = s.ref; date = s.date; notes = s.notes; no = s.number
        ticked = s.allocations.map { it.to }.toSet(); filled = true
    }
    // the next number (shown, never typed)
    LaunchedEffect(editId) { if (editId == null) try { no = api.nextSaleNumber(today, "receipt").number } catch (_: ApiError) {} }
    val parties = load { api.partiesFull() }
    LaunchedEffect(partyId, parties.data) { parties.data?.firstOrNull { it.id == partyId }?.let { partyName = it.name } }
    val dues = load(partyId, editId) { partyId?.let { api.dues(it, editId) } }
    // a new customer: everything they owe, all ticked
    LaunchedEffect(dues.data) {
        val list = dues.data ?: return@LaunchedEffect
        if (editId != null && ticked != null) return@LaunchedEffect
        ticked = list.map { it.to }.toSet()
        amount = plain(list.fold(BigDecimal.ZERO) { a, x -> a + n(x.balance) })
    }

    fun save(passcode: String? = null) {
        val p = partyId
        if (p == null) { say(ctx, ctx.getString(R.string.pr_need_cust)); pickCust = true; return }
        val amt = n(amount)
        if (amt.signum() <= 0) { say(ctx, ctx.getString(R.string.pr_need_amt)); return }
        if (mode == "Cheque" && ref.isBlank()) { say(ctx, ctx.getString(R.string.pr_need_cheque)); return }
        val split = DocMaths.allocate(dues.data.orEmpty(), ticked.orEmpty(), amt)
        val body = buildJsonObject {
            put("partyId", p); put("date", date); put("amount", plain(amt)); put("mode", mode); put("accountId", JsonNull)
            put("ref", ref.trim()); put("notes", notes)
            put("allocations", JsonArray(split.to.filter { it.second.signum() > 0 }.map { (to, a) -> buildJsonObject { put("to", to); put("amount", plain(a)) } }))
        }
        busy = true
        scope.launch {
            try {
                val r = api.saveReceipt(body, editId, passcode)
                pass = false
                onSaved(r.id, r.number)
            } catch (e: ApiError) {
                if (e.code == Api.PASSCODE && editId != null) { passErr = if (passcode == null) null else e.message; if (passcode != null) tries++; pass = true }
                else say(ctx, why(ctx, e))
            } finally { busy = false }
        }
    }

    // leaving with an amount entered asks first, so it isn't lost by a stray tap
    val close = { if (partyId != null && n(amount).signum() > 0) leave = true else onBack() }
    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(if (editId != null) R.string.pr_edit else R.string.pr_receive), onBack = close, foot = {
            Btn(stringResource(R.string.pr_save), { save() }, Modifier.weight(1f), Kind.Green, Icons.Check, busy = busy)
        }) {
            if (editId != null && saved.data == null) { Waiting(saved); return@Frame }
            Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val shape = RoundedCornerShape(Size.Radius)
                Row(Modifier.fillMaxWidth().background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(horizontal = 12.dp, vertical = 6.dp)) {
                    Column(Modifier.weight(1f)) {
                        T(stringResource(R.string.pr_no), size = 11.5.sp, weight = FontWeight.SemiBold, colour = Colours.Text3, oneLine = true)
                        T(no.ifBlank { "…" }, size = 14.sp, weight = FontWeight.Bold, oneLine = true)
                    }
                    Column(Modifier.weight(1f)) {
                        T(stringResource(R.string.sl_date), size = 11.5.sp, weight = FontWeight.SemiBold, colour = Colours.Text3, oneLine = true)
                        T(Format.date(date, hi), size = 14.sp, weight = FontWeight.Bold, oneLine = true)
                    }
                }
                val small = RoundedCornerShape(Size.RadiusSmall)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = Size.Tap).background(Colours.Card, small).border(1.dp, Colours.Border, small)
                        .clickable(role = Role.Button, enabled = editId == null) { pickCust = true }.padding(horizontal = 10.dp).semantics { contentDescription = "Customer" },
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.User, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp))
                    if (partyId != null) T(partyName.ifBlank { "…" }, Modifier.weight(1f), oneLine = true) else T(stringResource(R.string.sl_choose_customer), Modifier.weight(1f), colour = Colours.Text3, oneLine = true)
                    if (editId == null) Icon(Icons.Next, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp).rotate(90f))
                }
                Field(stringResource(R.string.pr_amount_recv), amount, { v -> amount = v.filter { it.isDigit() || it == '.' }.take(12) }, keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), placeholder = "0", prefix = "₹", bold = true)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                    Box(Modifier.weight(1f)) { ChoiceField(stringResource(R.string.pr_recv_in), modeName(mode)) { pickMode = true } }
                    if (mode != "Cash") Field(stringResource(R.string.pr_ref), ref, { ref = it.take(80) }, Modifier.weight(1f), placeholder = stringResource(R.string.pr_ref_ph))
                    else Box(Modifier.weight(1f))
                }
                SectionTitle(stringResource(R.string.pr_settle))
                val list = dues.data
                when {
                    partyId == null -> T(stringResource(R.string.pr_choose_first), size = 12.sp, colour = Colours.Text3)
                    list == null -> Waiting(dues)
                    list.isEmpty() -> T(stringResource(R.string.pr_no_bills), size = 12.sp, colour = Colours.Text3)
                    else -> {
                        val split = DocMaths.allocate(list, ticked.orEmpty(), n(amount))
                        Grp {
                            list.forEachIndexed { k, x -> if (k > 0) Line(); DueRow(x, x.to in ticked.orEmpty(), split.to.firstOrNull { it.first == x.to }?.second, hi) { ticked = ticked.orEmpty().let { s -> if (x.to in s) s - x.to else s + x.to } } }
                        }
                        T(stringResource(R.string.pr_oldest), size = 12.sp, colour = Colours.Text3)
                    }
                }
                val adv = if (partyId != null && list != null) DocMaths.allocate(list, ticked.orEmpty(), n(amount)).advance else BigDecimal.ZERO
                if (adv.signum() > 0) {
                    T(stringResource(R.string.pr_adv_note, inr(adv)), Modifier.fillMaxWidth().background(Colours.LightGreen, RoundedCornerShape(Size.RadiusSmall)).padding(horizontal = 12.dp, vertical = 10.dp), size = 13.sp, colour = Colours.Green)
                }
            }
        }
        if (pickCust) {
            BackHandler { pickCust = false }
            CustomerPick(api, { pickCust = false }) { id, name -> partyId = id; partyName = name; ticked = null; pickCust = false }
        }
        if (pickMode) {
            BackHandler { pickMode = false }
            val words = MODES.map { modeName(it) }
            ChoiceSheet(stringResource(R.string.pr_recv_in), words, MODES.indexOf(mode).coerceAtLeast(0), { pickMode = false }) { mode = MODES[it]; pickMode = false }
        }
        if (leave) {
            BackHandler { leave = false }
            Dim({ leave = false }, centre = true) {
                ConfirmBox(stringResource(R.string.eb_leave_q), stringResource(R.string.pr_leave_t), stringResource(R.string.keep), stringResource(R.string.eb_leave), { leave = false }, { leave = false; onBack() })
            }
        }
        if (pass) {
            BackHandler { pass = false }
            PasscodeSheet(stringResource(R.string.eb_pass_t, no), stringResource(R.string.pr_pass_edit), passErr, tries, busy, { pass = false; passErr = null }) { save(it) }
        }
    }
}

/** One unpaid bill to settle (.srow.cpr with a tick): its number, date and dues, and what this payment puts on it. */
@Composable
private fun DueRow(x: Due, on: Boolean, put: BigDecimal?, hi: Boolean, onTap: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Checkbox, onClick = onTap).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val box = RoundedCornerShape(6.dp)
        Box(Modifier.size(22.dp).background(if (on) Colours.Blue else Colours.Card, box).border(2.dp, if (on) Colours.Blue else Colours.Text3, box), contentAlignment = Alignment.Center) {
            if (on) Icon(Icons.Check, contentDescription = null, tint = Colours.OnColour, modifier = Modifier.size(14.dp))
        }
        Column(Modifier.weight(1f)) {
            T(if (x.kind == "opening") stringResource(R.string.pr_opening) else x.number, oneLine = true)
            T(listOfNotNull(x.date.takeIf { it.isNotBlank() }?.let { Format.date(it, hi) }, stringResource(R.string.pr_due_amt, m2(n(x.balance)))).joinToString(" · "), size = 12.sp, colour = Colours.Text3)
        }
        T(if (put != null && put.signum() > 0) "₹" + m2(put) else "—", weight = FontWeight.Bold, colour = if (put != null && put.signum() > 0) Colours.Green else Colours.Text3, numbers = true)
    }
}
