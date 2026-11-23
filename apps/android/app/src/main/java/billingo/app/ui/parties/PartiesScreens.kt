package billingo.app.ui.parties

import android.app.DatePickerDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.Api
import billingo.app.data.PartyFull
import billingo.app.data.PartyTx
import billingo.app.data.Statement
import billingo.app.ui.parts.AmountWithWord
import billingo.app.ui.parts.Badge
import billingo.app.ui.parts.BadgeKind
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.Chips
import billingo.app.ui.parts.ChoiceField
import billingo.app.ui.parts.ChoiceSheet
import billingo.app.ui.parts.Dim
import billingo.app.ui.parts.Due
import billingo.app.ui.parts.EmptyState
import billingo.app.ui.parts.Field
import billingo.app.ui.parts.FootBar
import billingo.app.ui.parts.Format
import billingo.app.ui.parts.Header
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.LinkButton
import billingo.app.ui.parts.ListRow
import billingo.app.ui.parts.Loaded
import billingo.app.ui.parts.Loading
import billingo.app.ui.parts.SectionTitle
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.T
import billingo.app.ui.parts.Tabs
import billingo.app.ui.parts.TotalBox
import billingo.app.ui.parts.load
import billingo.app.ui.parts.raised
import billingo.app.ui.start.words
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Size
import java.math.BigDecimal
import kotlinx.coroutines.launch
import kotlinx.serialization.json.put

@Composable
private fun hindi() = LocalConfiguration.current.locales[0].language == "hi"

/** A screen's frame: header with Back, the body, and an optional bar at the bottom. */
@Composable
internal fun Frame(title: String, sub: String? = null, onBack: () -> Unit, right: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {}, foot: (@Composable androidx.compose.foundation.layout.RowScope.() -> Unit)? = null, body: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().background(Colours.Page)) {
        Box(Modifier.background(Colours.Card).statusBarsPadding()) {
            Header(title, sub, left = { IconBtn(Icons.Back, stringResource(R.string.back), onBack) }, right = right)
        }
        Box(Modifier.weight(1f)) { body() }
        if (foot != null) FootBar(foot)
    }
}

/** While loading: grey bars; refused: why, with Try Again. */
@Composable
internal fun <T> Waiting(l: Loaded<T>) {
    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (l.problem != null) {
            T(words(l.problem) ?: "", colour = Colours.Red)
            Btn(stringResource(R.string.try_again), l::reload, Modifier.fillMaxWidth(), Kind.Line)
        } else Loading()
    }
}

/** The balance on a row: "21,749.40 ↓ To Get" in green, "↑ To Give" in red, or "0 Settled". */
@Composable
private fun BalanceEnd(b: BigDecimal) = when {
    b.signum() > 0 -> AmountWithWord(Format.inr(b), stringResource(R.string.to_get), Due.ToGet)
    b.signum() < 0 -> AmountWithWord(Format.inr(b.negate()), stringResource(R.string.to_give), Due.ToGive)
    else -> AmountWithWord("0", stringResource(R.string.settled), Due.Settled)
}

/**
 * Parties (design 7.4b): All / Customers / Suppliers, the To Receive and To Pay boxes (tap one to
 * show only those), search by name or phone, a balance filter, and Show Inactive at the end.
 */
@Composable
fun PartiesScreen(api: Api, startBal: String, onBack: () -> Unit, onParty: (PartyFull) -> Unit, onAdd: () -> Unit) {
    val ctx = LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var importOpen by rememberSaveable { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }
    val askContacts = rememberContactsAccess { importOpen = true }
    val list = load { api.partiesFull() }
    var inactiveOpen by rememberSaveable { mutableStateOf(false) }
    val inactive = load { api.partiesFull(archived = true) }
    var kind by rememberSaveable { mutableIntStateOf(0) }
    var bal by rememberSaveable { mutableIntStateOf(when (startBal) { "rec" -> 1; "pay" -> 2; else -> 0 }) }
    var query by rememberSaveable { mutableStateOf("") }
    var balSheet by rememberSaveable { mutableStateOf(false) }
    val balNames = listOf(stringResource(R.string.p_all_bal), stringResource(R.string.p_rec), stringResource(R.string.p_pay), stringResource(R.string.settled))

    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.m_parties), onBack = onBack, foot = {
            Btn(stringResource(R.string.p_import), askContacts, Modifier.weight(1f), Kind.Soft, Icons.Book)
            Btn(stringResource(R.string.p_add), onAdd, Modifier.weight(1f), Kind.Blue, Icons.Plus)
        }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Tabs(listOf(stringResource(R.string.p_all), stringResource(R.string.p_customers), stringResource(R.string.p_suppliers)), kind) { kind = it } }
                val all = list.data
                if (all == null) { item { Waiting(list) }; return@LazyColumn }
                item {
                    val (rec, pay) = PartyMaths.totals(all)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TotalBox(stringResource(R.string.p_to_receive), "₹" + Format.inr(rec), Colours.Green, bal == 1, Modifier.weight(1f)) { bal = if (bal == 1) 0 else 1 }
                        TotalBox(stringResource(R.string.p_to_pay), "₹" + Format.inr(pay), Colours.Red, bal == 2, Modifier.weight(1f)) { bal = if (bal == 2) 0 else 2 }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                        Field(null, query, { query = it }, Modifier.weight(1f), placeholder = stringResource(R.string.p_search), leading = Icons.Search, keyboard = KeyboardOptions(imeAction = ImeAction.Search))
                        Box(Modifier.weight(1f)) { ChoiceField(null, balNames[bal]) { balSheet = true } }
                    }
                }
                val k = PartyMaths.Kind.entries[kind]
                val b = PartyMaths.Bal.entries[bal]
                val shown = all.filter { PartyMaths.matches(it, k, b, query) }.sortedBy { it.name.lowercase() }
                if (shown.isEmpty()) item { EmptyState(Icons.Search, stringResource(R.string.p_none), stringResource(R.string.p_none_sub), stringResource(R.string.p_add), onAdd) }
                items(shown, key = { it.id }) { p -> ListRow(p.name, PartyMaths.detail(p), { onParty(p) }) { BalanceEnd(p.balance) } }
                // Show Inactive (n): only when some parties were made inactive
                val gone = inactive.data.orEmpty()
                if (gone.isNotEmpty()) item {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        LinkButton(if (inactiveOpen) stringResource(R.string.p_hide_inactive) else stringResource(R.string.p_show_inactive, gone.size), { inactiveOpen = !inactiveOpen })
                    }
                }
                if (inactiveOpen) items(inactive.data ?: emptyList(), key = { "x" + it.id }) { p ->
                    ListRow(p.name, PartyMaths.detail(p), null) {
                        Badge(stringResource(R.string.p_inactive), BadgeKind.Grey)
                        LinkButton(stringResource(R.string.p_make_active), {
                            scope.launch {
                                try { api.archiveParty(p.id, false); Toast.makeText(ctx, ctx.getString(R.string.active_done, p.name), Toast.LENGTH_SHORT).show(); list.reload(); inactive.reload() }
                                catch (e: billingo.app.data.ApiError) { Toast.makeText(ctx, e.message, Toast.LENGTH_SHORT).show() }
                            }
                        })
                    }
                }
            }
        }
        if (importOpen) {
            BackHandler { importOpen = false }
            ContactsSheet(multi = true, busy = importing, onClose = { importOpen = false }) { picked ->
                importing = true
                scope.launch {
                    // each contact becomes a customer in General; ones the server refuses are named
                    val failed = mutableListOf<String>()
                    var added = 0
                    for (c in picked) {
                        try { api.createParty(kotlinx.serialization.json.buildJsonObject { put("name", c.name); put("phone", c.mobile); put("kind", "customer"); put("group", "General") }); added++ }
                        catch (e: billingo.app.data.ApiError) { failed += c.name }
                    }
                    importing = false; importOpen = false; list.reload()
                    var msg = if (added == 1) ctx.getString(R.string.ct_added_1) else ctx.getString(R.string.ct_added, added)
                    if (failed.isNotEmpty()) msg += " " + ctx.getString(R.string.ct_not_added, failed.joinToString(", "))
                    Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
                }
            }
        }
        if (balSheet) BackHandler { balSheet = false }
        if (balSheet) ChoiceSheet(stringResource(R.string.p_balance), balNames, bal, { balSheet = false }) { bal = it; balSheet = false }
    }
}

/**
 * A party's page (design 7.4b): the balance (↓ to get, ↑ to give or settled) with the credit limit,
 * Reminder (WhatsApp), Call and Statement, then the transactions with All / Unpaid / Overdue / Paid.
 */
@Composable
fun PartyScreen(
    api: Api, id: String, name: String, shop: String, onBack: () -> Unit, onStatement: () -> Unit, onEdit: () -> Unit, onLater: () -> Unit,
    onBill: (id: String, number: String) -> Unit = { _, _ -> onLater() }, onNewBill: () -> Unit = onLater, onTakePayment: () -> Unit = onLater,
) {
    val ctx = LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    /** A sale opens its page (8.6a): the transactions name it by number, so its id is looked up first. */
    fun open(t: PartyTx) {
        if (t.type != "Sale") { onLater(); return }
        scope.launch {
            try { api.bills().firstOrNull { it.number == t.no }?.let { onBill(it.id, it.number) } ?: onLater() }
            catch (e: billingo.app.data.ApiError) { Toast.makeText(ctx, if (e.status == 0) ctx.getString(R.string.no_internet) else e.message, Toast.LENGTH_SHORT).show() }
        }
    }
    val hi = hindi()
    val party = load(id) { api.party(id) }
    val tx = load(id) { api.partyTx(id) }
    var filter by rememberSaveable { mutableIntStateOf(0) }
    var remind by rememberSaveable { mutableStateOf(false) }
    val today = Format.todayIso()
    val p = party.data
    val sup = p?.kind == "supplier"
    val kindWord = if (sup) stringResource(R.string.supplier) else stringResource(R.string.customer)

    Box(Modifier.fillMaxSize()) {
        Frame(
            p?.name ?: name,
            if (p != null) kindWord + (if (p.group.isNotBlank()) " · ${p.group}" else "") else null,
            onBack,
            right = { IconBtn(Icons.Edit, stringResource(R.string.pf_edit), onEdit) },
            foot = if (p == null) null else ({
                if (sup) {
                    Btn(stringResource(R.string.pp_pay_supplier), onLater, Modifier.weight(1f), Kind.Soft, Icons.Rupee)
                    Btn(stringResource(R.string.t_purchase_bill), onLater, Modifier.weight(1f), Kind.Blue, Icons.Plus)
                } else {
                    Btn(stringResource(R.string.take_payment), onTakePayment, Modifier.weight(1f), Kind.Soft, Icons.Rupee)
                    Btn(stringResource(R.string.new_bill), onNewBill, Modifier.weight(1f), Kind.Blue, Icons.Plus)
                }
            }),
        ) {
            if (p == null) { Waiting(party); return@Frame }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { BalanceCard(p, onRemind = { remind = true }, onCall = { call(ctx, p.phone) }, onStatement = onStatement) }
                item { SectionTitle(stringResource(R.string.pp_tx)) }
                item {
                    Chips(listOf(stringResource(R.string.p_all), stringResource(R.string.pp_unpaid), stringResource(R.string.pp_overdue), stringResource(R.string.pp_paid)), filter) { filter = it }
                }
                val rows = tx.data
                if (rows == null) { item { Waiting(tx) }; return@LazyColumn }
                val shown = PartyMaths.filtered(rows, PartyMaths.Filter.entries[filter], today)
                if (shown.isEmpty()) item { EmptyState(Icons.Bill, stringResource(R.string.pp_none), stringResource(R.string.pp_none_sub), stringResource(R.string.new_bill), if (sup) onLater else onNewBill) }
                items(shown, key = { it.type + it.no + it.date }) { t -> TxRow(t, today, hi) { open(t) } }
            }
        }
        if (remind && p != null) {
            BackHandler { remind = false }
            ReminderSheet(PartyMaths.reminder(p.name, shop, p.balance), p.phone) { remind = false }
        }
    }
}

@Composable
private fun BalanceCard(p: PartyFull, onRemind: () -> Unit, onCall: () -> Unit, onStatement: () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    val b = p.balance
    Column(
        Modifier.fillMaxWidth().raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                T(stringResource(if (b.signum() > 0) R.string.you_get else if (b.signum() < 0) R.string.you_give else R.string.pp_settled), size = 12.sp, colour = Colours.Text3)
                val c = if (b.signum() > 0) Colours.Green else if (b.signum() < 0) Colours.Red else Colours.Text3
                val arrow = if (b.signum() > 0) "↓ " else if (b.signum() < 0) "↑ " else ""
                T(arrow + "₹" + Format.inr(b.abs()), size = 24.sp, weight = FontWeight.Bold, colour = c, numbers = true, oneLine = true)
            }
            Column(horizontalAlignment = Alignment.End) {
                T(stringResource(R.string.pp_limit), size = 12.sp, colour = Colours.Text3)
                val lim = p.creditLimit?.let { runCatching { BigDecimal(it) }.getOrNull() }
                if (lim != null && lim.signum() > 0) T("₹" + Format.inr(lim, paise = false), size = 14.sp, weight = FontWeight.Bold, numbers = true)
                else T(stringResource(R.string.pp_no_limit), size = 14.sp, weight = FontWeight.Bold, colour = Colours.Text3)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (b.signum() > 0 && p.phone.isNotBlank()) Btn(stringResource(R.string.pp_reminder), onRemind, Modifier.weight(1f), Kind.Soft, Icons.Chat, small = true)
            if (p.phone.isNotBlank()) Btn(stringResource(R.string.pp_call), onCall, Modifier.weight(1f), Kind.Soft, Icons.Phone, small = true)
            Btn(stringResource(R.string.pp_statement), onStatement, Modifier.weight(1f), Kind.Soft, Icons.Bill, small = true)
        }
    }
}

@Composable
private fun typeWord(type: String) = stringResource(
    when (type) {
        "Sale" -> R.string.tx_sale
        "Payment-In" -> R.string.tx_pay_in
        "Purchase" -> R.string.tx_purchase
        "Payment-Out" -> R.string.tx_pay_out
        "Credit note" -> R.string.tx_credit_note
        "Debit note" -> R.string.tx_debit_note
        "Opening balance" -> R.string.tx_opening
        "Cheque bounce" -> R.string.tx_bounce
        "Refund" -> R.string.tx_refund
        else -> R.string.tx_sale
    },
)

@Composable
private fun TxRow(t: PartyTx, today: String, hi: Boolean, onTap: () -> Unit) {
    val sub = (if (t.no.isNotBlank() && t.no != "—") t.no + " | " else "") + (if (t.date.isNotBlank()) Format.date(t.date, hi) else "")
    ListRow(typeWord(t.type), sub, onTap) {
        AmountWithWord(Format.inr(t.total), "", Due.Plain)
        when (val s = PartyMaths.state(t, today)) {
            PartyMaths.State.Received -> Badge(stringResource(R.string.pp_received), BadgeKind.Info)
            PartyMaths.State.Given -> Badge(stringResource(R.string.pp_given), BadgeKind.Info)
            PartyMaths.State.Paid -> Badge(stringResource(R.string.pp_paid), BadgeKind.Paid, icon = Icons.Check)
            PartyMaths.State.PartPaid -> Badge(stringResource(R.string.b_part_paid), BadgeKind.Credit)
            is PartyMaths.State.Overdue -> Badge(if (s.days == 1) stringResource(R.string.b_overdue_1) else stringResource(R.string.b_overdue, s.days), BadgeKind.Due)
            PartyMaths.State.Unpaid -> Badge(stringResource(R.string.pp_unpaid), BadgeKind.Credit)
        }
    }
}

/** Payment Reminder (design 7.4b): the web's message, Copy, or Send On WhatsApp with it typed in. */
@Composable
private fun ReminderSheet(message: String, phone: String, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val copied = stringResource(R.string.rm_copied)
    val noApp = stringResource(R.string.rm_no_whatsapp)
    Dim(onClose) {
        Sheet(stringResource(R.string.rm_title)) {
            Box(Modifier.fillMaxWidth().background(Colours.LightGreen, RoundedCornerShape(Size.Radius)).border(1.dp, Colours.Border, RoundedCornerShape(Size.Radius)).padding(12.dp)) {
                T(message, size = 14.sp)
            }
            T(stringResource(R.string.rm_note), size = 12.sp, colour = Colours.Text3)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Btn(stringResource(R.string.rm_copy), {
                    (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("reminder", message))
                    Toast.makeText(ctx, copied, Toast.LENGTH_SHORT).show()
                }, Modifier.weight(1f), Kind.Soft)
                Btn(stringResource(R.string.rm_whatsapp), {
                    val uri = Uri.parse("https://wa.me/${PartyMaths.phoneForLink(phone)}?text=" + Uri.encode(message))
                    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, uri)); onClose() } catch (_: Exception) { Toast.makeText(ctx, noApp, Toast.LENGTH_SHORT).show() }
                }, Modifier.weight(1f), Kind.Green, Icons.Chat)
            }
        }
    }
}

/** Opens the phone's dialler with the number (the person presses Call there). */
private fun call(ctx: Context, phone: String) {
    ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:+" + PartyMaths.phoneForLink(phone))))
}

/**
 * Statement (design 7.4b): This Month / Last Month / This Year (FY) / Custom; Opening, Bills,
 * Received, Closing; then every entry with its running balance. Share PDF and Excel come with the
 * invoice PDF step.
 */
@Composable
fun StatementScreen(api: Api, id: String, name: String, onBack: () -> Unit, onLater: () -> Unit) {
    val ctx = LocalContext.current
    val hi = hindi()
    val today = Format.todayIso()
    var per by rememberSaveable { mutableIntStateOf(2) }
    var from by rememberSaveable { mutableStateOf(PartyMaths.period(PartyMaths.Period.Year, today).first) }
    var to by rememberSaveable { mutableStateOf(today) }
    val st = load(from, to) { api.statement(id, from, to) }

    fun pick(p: Int) {
        per = p
        if (p < 3) { val r = PartyMaths.period(PartyMaths.Period.entries[p], today); from = r.first; to = r.second; return }
        // Custom: the start date, then the end date (Android's own calendar)
        val (y, m, d) = from.split("-").map { it.toInt() }
        DatePickerDialog(ctx, { _, fy, fm, fd ->
            val f = "%04d-%02d-%02d".format(fy, fm + 1, fd)
            val (ty, tm, td) = to.split("-").map { it.toInt() }
            DatePickerDialog(ctx, { _, yy, mm, dd -> from = f; to = maxOf(f, "%04d-%02d-%02d".format(yy, mm + 1, dd)) }, ty, tm - 1, td).show()
        }, y, m - 1, d).show()
    }

    Frame(stringResource(R.string.st_title), name, onBack, foot = {
        Btn(stringResource(R.string.st_excel), onLater, Modifier.weight(1f), Kind.Soft)
        Btn(stringResource(R.string.st_pdf), onLater, Modifier.weight(1f), Kind.Blue, Icons.Share)
    }) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Chips(listOf(stringResource(R.string.st_month), stringResource(R.string.st_last), stringResource(R.string.st_fy), stringResource(R.string.st_custom)), per, ::pick) }
            item { T(Format.date(from, hi) + " – " + Format.date(to, hi), size = 12.sp, colour = Colours.Text3) }
            val s = st.data
            if (s == null) { item { Waiting(st) }; return@LazyColumn }
            item { Summary(s) }
            item { Rows(s, hi) }
        }
    }
}

@Composable
private fun Summary(s: Statement) {
    @Composable
    fun cell(label: String, v: BigDecimal, colour: androidx.compose.ui.graphics.Color = Colours.Text, m: Modifier) {
        val shape = RoundedCornerShape(Size.RadiusSmall)
        Column(m.background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(horizontal = 10.dp, vertical = 8.dp)) {
            T(label, size = 12.sp, colour = Colours.Text2, oneLine = true)
            T("₹" + Format.inr(v.abs()), size = 15.sp, weight = FontWeight.Bold, colour = colour, numbers = true, oneLine = true)
        }
    }
    val close = s.close
    val word = stringResource(if (close.signum() > 0) R.string.st_to_get else if (close.signum() < 0) R.string.st_to_give else R.string.st_settled)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            cell(stringResource(R.string.st_opening), s.open, m = Modifier.weight(1f))
            cell(stringResource(if (s.party.sup) R.string.st_pbills else R.string.st_bills), if (s.party.sup) s.cr else s.dr, m = Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            cell(stringResource(if (s.party.sup) R.string.st_paid else R.string.st_received), if (s.party.sup) s.dr else s.cr, Colours.Green, Modifier.weight(1f))
            cell(stringResource(R.string.st_closing, word), close, if (close.signum() > 0) Colours.Green else if (close.signum() < 0) Colours.Red else Colours.Text, Modifier.weight(1f))
        }
    }
}

@Composable
private fun Rows(s: Statement, hi: Boolean) {
    val shape = RoundedCornerShape(Size.Radius)
    Column(Modifier.fillMaxWidth().raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)) {
        StRow(stringResource(R.string.st_opening_bal), Format.date(s.from, hi), Format.inr(s.open), null, false)
        if (s.rows.isEmpty()) Box(Modifier.fillMaxWidth().padding(12.dp)) { T(stringResource(R.string.st_empty), size = 13.sp, colour = Colours.Text3) }
        s.rows.forEach { r ->
            // as in the design: a payment is "− amount" in green, everything else "+ amount"
            val pay = r.type.startsWith("Payment")
            val amt = (if (pay) "− " else "+ ") + Format.inr(r.dr + r.cr)
            StRow(typeWord(r.type), (if (r.no.isNotBlank() && r.no != "—") r.no + " | " else "") + Format.date(r.date, hi), amt, stringResource(R.string.st_balance, Format.inr(r.run)), pay)
        }
    }
}

@Composable
private fun StRow(title: String, sub: String, amount: String, running: String?, green: Boolean) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f)) {
            T(title, weight = FontWeight.SemiBold, oneLine = true)
            T(sub, size = 12.sp, colour = Colours.Text3)
        }
        Column(horizontalAlignment = Alignment.End) {
            T(amount, weight = FontWeight.Bold, colour = if (green) Colours.Green else Colours.Text, numbers = true)
            if (running != null) T(running, size = 12.sp, colour = Colours.Text3, numbers = true)
        }
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
}
