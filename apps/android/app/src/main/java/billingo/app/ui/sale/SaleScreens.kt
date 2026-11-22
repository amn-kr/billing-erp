package billingo.app.ui.sale

import android.app.DatePickerDialog
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.ApiError
import kotlinx.serialization.json.JsonObject
import billingo.app.ui.print.InvoicePdf
import androidx.compose.runtime.LaunchedEffect
import billingo.app.data.ItemFull
import billingo.app.data.PartyFull
import billingo.app.ui.home.unitWord
import billingo.app.ui.items.ItemMaths
import billingo.app.ui.items.ScanScreen
import billingo.app.ui.items.qtyUnit
import billingo.app.ui.parties.Waiting
import billingo.app.ui.parts.Badge
import billingo.app.ui.parts.BadgeKind
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.ChoiceField
import billingo.app.ui.parts.ChoiceSheet
import billingo.app.ui.parts.ConfirmBox
import billingo.app.ui.parts.Dim
import billingo.app.ui.parts.Field
import billingo.app.ui.parts.FootBar
import billingo.app.ui.parts.Format
import billingo.app.ui.parts.Header
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.LinkButton
import billingo.app.ui.parts.Loading
import billingo.app.ui.parts.SectionTitle
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.SwitchRow
import billingo.app.ui.parts.T
import billingo.app.ui.parts.raised
import billingo.app.ui.theme.LocalFont
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size as GSize
import billingo.app.ui.start.words
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Size
import kotlinx.coroutines.launch
import java.math.BigDecimal

@Composable
private fun hindi() = LocalConfiguration.current.locales[0].language == "hi"

private fun say(ctx: android.content.Context, text: String) = Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show()

/** "1,390" or "1,390.50": rupees without needless paise (design m2) */
private fun m2(v: BigDecimal) = Format.inr(v, paise = false)
/** "1,390.00" (design inr) */
private fun inr(v: BigDecimal) = Format.inr(v)
private fun qtyText(q: BigDecimal) = Format.qty(q.toPlainString())

@Composable
private fun payWord(mode: String) = stringResource(
    when (mode) { "UPI" -> R.string.pm_upi; "Bank transfer" -> R.string.pm_bank; "Cheque" -> R.string.pm_cheque; "Card" -> R.string.pm_card; else -> R.string.pm_cash },
)

/** A line of figures (.tl): words on the left, the amount on the right; [big] for the total (.tl.tt). */
@Composable
internal fun TL(k: String, v: String, colour: Color = Colours.Text, big: Boolean = false) {
    Column {
        if (big) Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
        Row(Modifier.fillMaxWidth().padding(top = if (big) 8.dp else 0.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            T(k, Modifier.weight(1f), size = if (big) 17.sp else 14.sp, weight = if (big) FontWeight.Bold else FontWeight.Normal)
            T(v, size = if (big) 19.sp else 14.sp, weight = FontWeight.Bold, colour = colour, numbers = true)
        }
    }
}

@Composable
internal fun BoxCol(modifier: Modifier = Modifier, gap: Int = 6, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Column(modifier.fillMaxWidth().background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(12.dp), verticalArrangement = Arrangement.spacedBy(gap.dp), content = content)
}

/** Credit / Cash at the top of Sale (.cap): a grey pill with the chosen one in blue; each half is a full tap target. */
@Composable
private fun Capsule(cash: Boolean, onPick: (Boolean) -> Unit) {
    Row(
        Modifier.drawBehind {
            val inset = 5.dp.toPx()
            val r = CornerRadius(size.height, size.height)
            drawRoundRect(Colours.LightSlate, Offset(0f, inset), GSize(size.width, size.height - 2 * inset), r)
            drawRoundRect(Colours.Border, Offset(0f, inset), GSize(size.width, size.height - 2 * inset), r, style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()))
        },
    ) {
        listOf(stringResource(R.string.sl_credit) to false, stringResource(R.string.sl_cash) to true).forEach { (t, v) ->
            val on = cash == v
            Box(Modifier.heightIn(min = Size.Tap).clickable(role = Role.RadioButton) { onPick(v) }.padding(horizontal = 3.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.background(if (on) Colours.Blue else Color.Transparent, RoundedCornerShape(999.dp)).padding(horizontal = 10.dp, vertical = 4.dp)) {
                    T(t, size = 13.sp, weight = FontWeight.SemiBold, colour = if (on) Colours.OnColour else Colours.Text2)
                }
            }
        }
    }
}

/**
 * Sale (design 7.4d): Credit / Cash, the invoice number (from the server) and date, the customer,
 * the billed items as cards, Add Item and scan, Discount And Charges and Received, the bill total,
 * and Save & New, Save. Discount And Charges must be seen once before the first save (as on the web).
 */
@Composable
fun SaleScreen(
    s: SaleSession,
    onClose: () -> Unit,
    onCustomer: () -> Unit,
    onLine: (index: Int, itemId: String?) -> Unit,
    onSaved: () -> Unit,
    onNew: () -> Unit,
    onTryAgain: () -> Unit,
    onLater: () -> Unit,
) {
    val ctx = LocalContext.current
    val hi = hindi()
    val scope = rememberCoroutineScope()
    var sheet by rememberSaveable { mutableStateOf("") }
    /** what Save waits for while Discount And Charges is shown first: "save" or "new" */
    var pending by rememberSaveable { mutableStateOf("") }
    var discard by rememberSaveable { mutableStateOf(false) }
    val c = s.ctx
    val d = s.draft
    // Convert To Bill (8.6c): how many items came from the quotation, said once
    LaunchedEffect(s.imported, d?.quotes?.firstOrNull()?.no, d?.fromChallan?.second) {
        val q = d?.quotes?.firstOrNull()
        val ch = d?.fromChallan
        if (s.imported > 0 && ch != null) { say(ctx, ctx.getString(R.string.ch_from, s.imported, ch.second)); s.imported = 0 }
        else if (s.imported > 0 && q != null) { say(ctx, ctx.getString(R.string.qt_from, s.imported, q.no)); s.imported = 0 }
    }
    // closing a bill with items asks first, so it isn't lost by a stray tap (as on the web)
    val close = { if (d != null && d.lines.isNotEmpty()) discard = true else onClose() }

    fun doSave(after: String, passcode: String? = null) {
        if (c == null) return
        val dd = s.draft ?: return
        when (SaleMaths.problem(dd)) {
            SaleMaths.Problem.NoItems -> { say(ctx, ctx.getString(R.string.sl_need_item)); return }
            SaleMaths.Problem.NoParty -> { say(ctx, ctx.getString(R.string.sl_need_party)); onCustomer(); return }
            SaleMaths.Problem.NoQty -> { say(ctx, ctx.getString(R.string.sl_need_qty)); return }
            null -> {}
        }
        if (!dd.chgOk) { pending = after; sheet = "chg"; return }
        pending = after
        scope.launch {
            val e = s.save(passcode)
            when {
                e != null -> say(ctx, if (e.status == 0) ctx.getString(R.string.no_internet) else e.message)
                s.ask != null || s.pass != null -> {}
                else -> {
                    val no = s.saved?.first?.number.orEmpty()
                    if (after == "new") { say(ctx, ctx.getString(if (dd.quote) R.string.qt_saved_new else R.string.sl_saved_new, no)); onNew() } else {
                        // Share / Print from the bottom ⋮: Bill Saved makes the PDF and opens it
                        s.after = if (after == "share" || after == "print") after else ""
                        onSaved()
                    }
                    pending = ""
                }
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().background(Colours.Page)) {
            Box(Modifier.background(Colours.Card).statusBarsPadding()) {
                Header(
                    // Edit Bill (8.6b): the same screen, titled so, without Credit / Cash (design 7.4e)
                    // a quotation (8.6c) uses the same screen: "Quotation", no payments (design 7.4e)
                    stringResource(when { d?.quote == true && d.edit != null -> R.string.qt_edit; d?.quote == true -> R.string.t_quotation; d?.edit != null -> R.string.dv_edit; else -> R.string.sl_title }), null,
                    left = { IconBtn(Icons.Close, stringResource(R.string.close), close) },
                ) {
                    if (d != null && d.edit == null && !d.quote) Capsule(d.cash) { v -> s.change { x -> if (v) SaleMaths.withParty(c ?: return@change x, x.copy(cash = true), null) else x.copy(cash = false) } }
                    IconBtn(Icons.Dots, stringResource(R.string.sl_more), { if (c != null && d != null) sheet = "menu" })
                }
            }
            if (c == null || d == null) {
                Box(Modifier.weight(1f)) {
                    val p = s.problem
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (p != null) {
                            T(words(p) ?: "", colour = Colours.Red)
                            Btn(stringResource(R.string.try_again), onTryAgain, Modifier.fillMaxWidth(), Kind.Line)
                        } else Loading()
                    }
                }
                return@Column
            }
            val t = SaleMaths.totals(c, d)
            val party = SaleMaths.party(c, d)
            // the number and date strip (.invs)
            Row(
                Modifier.fillMaxWidth().background(Colours.Card).padding(horizontal = 10.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f).heightIn(min = Size.Tap).padding(2.dp), verticalArrangement = Arrangement.Center) {
                    T(stringResource(if (d.quote) R.string.qt_no else R.string.sl_no), size = 11.5.sp, weight = FontWeight.SemiBold, colour = Colours.Text3, oneLine = true)
                    T(s.number.ifBlank { "…" }, size = 14.sp, weight = FontWeight.Bold, oneLine = true)
                }
                Box(Modifier.padding(vertical = 8.dp).width(1.dp).height(28.dp).background(Colours.Border))
                Column(
                    Modifier.weight(1f).heightIn(min = Size.Tap).clickable(role = Role.Button) {
                        val (y, mo, dd) = d.date.split("-").map { it.toInt() }
                        DatePickerDialog(ctx, { _, yy, mm, d2 -> s.change { x -> x.copy(date = "%04d-%02d-%02d".format(yy, mm + 1, d2)) }; s.refreshNumber(scope) }, y, mo - 1, dd).show()
                    }.padding(start = 10.dp, top = 2.dp, bottom = 2.dp),
                    verticalArrangement = Arrangement.Center,
                ) {
                    T(stringResource(R.string.sl_date), size = 11.5.sp, weight = FontWeight.SemiBold, colour = Colours.Text3, oneLine = true)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        T(Format.date(d.date, hi), size = 14.sp, weight = FontWeight.Bold, oneLine = true)
                        Icon(Icons.Next, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(16.dp).rotate(90f))
                    }
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { CustomerField(party, party?.let { SaleMaths.before(d, it) } ?: BigDecimal.ZERO, d.cash, onCustomer) }
                item {
                    SaleTags(d, c, { sheet = "ref" }) { id ->
                        s.change { x -> if (id.startsWith("dc:")) x.copy(fromChallan = null) else x.copy(quotes = x.quotes.filter { it.id != id }) }
                        say(ctx, ctx.getString(R.string.sx_unlinked))
                    }
                }
                if (d.lines.isNotEmpty()) item { SectionTitle(stringResource(R.string.sl_billed, d.lines.size)) }
                if (d.lines.isEmpty()) item {
                    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.size(56.dp).background(Colours.LightBlue, CircleShape), contentAlignment = Alignment.Center) { Icon(Icons.Cart, contentDescription = null, tint = Colours.Blue) }
                        T(stringResource(R.string.sl_no_items), weight = FontWeight.Bold)
                        T(stringResource(R.string.sl_no_items_sub), size = 14.sp, colour = Colours.Text2, align = TextAlign.Center)
                    }
                }
                items(d.lines.size) { k -> LineCard(k, d.lines[k], t.rows.getOrNull(k)) { onLine(k, null) } }
                if (d.lines.isNotEmpty()) item {
                    val qty = d.lines.fold(BigDecimal.ZERO) { a, l -> a + SaleMaths.num(l.qty) }
                    val ldisc = t.rows.fold(BigDecimal.ZERO) { a, r -> a + (BillMaths.round2(r.gross) - r.amount) }
                    Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row { T(stringResource(R.string.sl_tot_disc, m2(ldisc)), Modifier.weight(1f), size = 12.sp, colour = Colours.Text2, numbers = true); T(stringResource(R.string.sl_tot_tax, m2(t.tax)), size = 12.sp, colour = Colours.Text2, numbers = true) }
                        Row { T(stringResource(R.string.sl_tot_qty, qtyText(qty)), Modifier.weight(1f), size = 12.sp, colour = Colours.Text2, numbers = true); T(stringResource(R.string.sl_subtotal, m2(t.items)), size = 12.sp, colour = Colours.Text2, numbers = true) }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        val shape = RoundedCornerShape(Size.Radius)
                        Row(
                            Modifier.weight(1f).heightIn(min = 52.dp).background(Colours.LightBlue, shape).border(1.5.dp, Colours.Blue, shape)
                                .clickable(role = Role.Button) { onLine(-1, null) }.padding(horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(Icons.Plus, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(20.dp))
                            T(stringResource(R.string.sl_add_item), weight = FontWeight.SemiBold, colour = Colours.Blue)
                        }
                        Box(Modifier.heightIn(min = 52.dp), contentAlignment = Alignment.Center) { IconBtn(Icons.Scan, stringResource(R.string.i_scan), { sheet = "scan" }, Kind.Soft) }
                    }
                }
                item {
                    BoxCol(gap = 10) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val ch = t.chTr + t.chLab + t.chBank
                            val chv = listOfNotNull(
                                if (t.billDiscount.signum() > 0) "−₹" + m2(t.billDiscount) else null,
                                if (ch.signum() > 0) "+₹" + m2(ch) else null,
                            ).joinToString(" ").ifBlank { stringResource(R.string.sl_none) }
                            SumButton(stringResource(R.string.sl_chg), chv, Colours.Text, !d.chgOk, Modifier.weight(1f)) { pending = ""; sheet = "chg" }
                            if (!d.quote) SumButton(stringResource(R.string.sl_received), "₹" + inr(SaleMaths.received(d, t.total)), Colours.Green, false, Modifier.weight(1f)) { sheet = "pay" }
                        }
                        if (d.lines.isNotEmpty()) {
                            Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
                            TL(stringResource(if (d.quote) R.string.qt_total else R.string.sl_bill_total), "₹" + inr(t.total))
                            val dues = SaleMaths.dues(d, t.total)
                            if (!d.cash && !d.quote && dues.signum() > 0) TL(stringResource(R.string.sl_bill_dues), "₹" + inr(dues), Colours.Red)
                        }
                    }
                }
            }
            FootBar {
                Btn(stringResource(R.string.sl_save_new), { doSave("new") }, Modifier.weight(1f), Kind.Soft, busy = s.busy && pending == "new")
                Btn(stringResource(R.string.sl_save), { doSave("save") }, Modifier.weight(1f), Kind.Green, Icons.Check, busy = s.busy && pending == "save")
                IconBtn(Icons.Dots, stringResource(R.string.sl_share_print), { sheet = "smore" }, Kind.Soft)
            }
        }
        if (c == null || d == null) return@Box
        if (d.lines.isNotEmpty()) BackHandler { discard = true }
        if (sheet.isNotEmpty()) BackHandler { sheet = ""; pending = "" }
        if (discard) {
            BackHandler { discard = false }
            Dim({ discard = false }, centre = true) {
                // a saved bill stays as it was: leaving only drops the changes
                if (d.edit != null) ConfirmBox(stringResource(R.string.eb_leave_q), stringResource(R.string.eb_leave_t, d.edit.number), stringResource(R.string.keep), stringResource(R.string.eb_leave), { discard = false }, { discard = false; onClose() })
                else ConfirmBox(stringResource(if (d.quote) R.string.qt_discard_q else R.string.sl_discard_q), stringResource(R.string.sl_discard_t), stringResource(R.string.keep), stringResource(R.string.sl_discard), { discard = false }, { discard = false; onClose() })
            }
        }
        // Edit Bill with the transaction passcode on (Settings › Transactions): asked after editing, every time
        val pass = s.pass
        if (pass != null) {
            BackHandler { s.pass = null }
            billingo.app.ui.docs.PasscodeSheet(
                stringResource(R.string.eb_pass_t, d.edit?.number.orEmpty()), stringResource(R.string.eb_pass_text), pass.ifBlank { null }, s.passTries, s.busy,
                { s.pass = null; pending = "" },
            ) { code -> doSave(pending.ifBlank { "save" }, code) }
        }
        when (sheet) {
            "chg" -> ChargesSheet(s, c, pending.isNotEmpty(), { sheet = ""; pending = "" }) {
                s.change { it.copy(chgOk = true) }
                sheet = ""
                val p = pending
                if (p.isNotEmpty()) doSave(p)
            }
            "pay" -> PaySheet(s, c) { sheet = "" }
            "smore" -> ShareMoreSheet({ sheet = "" }) { sheet = ""; doSave(it) }
            "menu" -> SaleMenuSheet(c.referrers.firstOrNull { it.id == d.referrerId }?.name, { sheet = "" }, import = !d.quote) { sheet = it }
            "quote" -> QuoteSheet(s) { sheet = "" }
            "ref" -> ReferralSheet(s, { sheet = "" }) { sheet = "elec" }
            "elec" -> AddElectricianSheet(s) { sheet = "ref" }
            "extras" -> DetailsSheet(s, { sheet = "" }, onLater)
            "scan" -> ScanScreen({ sheet = "" }) { code ->
                val hit = c.items.firstOrNull { it.code.equals(code, ignoreCase = true) }
                sheet = ""
                if (hit != null) onLine(-1, hit.id) else say(ctx, ctx.getString(R.string.sc_not_found_sale, code))
            }
        }
        // the server's "Save anyway?" (over the credit limit, an expired batch, a rate above MRP)
        val ask = s.ask
        if (ask != null) {
            BackHandler { s.ask = null }
            Dim({ s.ask = null }, centre = true) {
                ConfirmBox(
                    stringResource(when (ask.code) { "over_credit_limit" -> R.string.sl_over_limit; "expired_batch" -> R.string.sl_expired; else -> R.string.sl_above_mrp }),
                    ask.message, stringResource(R.string.cancel), stringResource(if (ask.code == "expired_batch") R.string.sl_sell_anyway else R.string.sl_save_anyway),
                    { s.ask = null }, { s.confirm(ask.code ?: ""); doSave(pending.ifBlank { "save" }) }, danger = false,
                )
            }
        }
    }
}

/** The customer on the bill (.pfield): their name and dues, or Choose Customer (required on credit). */
@Composable
private fun CustomerField(p: PartyFull?, b: BigDecimal, cash: Boolean, onTap: () -> Unit) {
    val shape = RoundedCornerShape(Size.RadiusSmall)
    Row(
        Modifier.fillMaxWidth().heightIn(min = Size.Tap).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)
            .clickable(role = Role.Button, onClick = onTap).padding(horizontal = 10.dp)
            .semantics { contentDescription = "Customer" },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.User, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp))
        if (p != null) {
            T(p.name, Modifier.weight(1f), oneLine = true)
            T(
                when { b.signum() > 0 -> stringResource(R.string.sl_dues, m2(b)); b.signum() < 0 -> stringResource(R.string.sl_advance, m2(b.negate())); else -> stringResource(R.string.sl_no_dues) },
                size = 12.sp, weight = FontWeight.SemiBold, colour = Colours.Text2, numbers = true,
            )
        } else {
            T(stringResource(if (cash) R.string.sl_counter else R.string.sl_choose_customer), Modifier.weight(1f), colour = Colours.Text3, oneLine = true)
            T(stringResource(if (cash) R.string.sl_optional else R.string.sl_required), size = 12.sp, weight = FontWeight.SemiBold, colour = if (cash) Colours.Text3 else Colours.Red)
        }
        Icon(Icons.Next, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp).rotate(90f))
    }
}

/** One billed item (.slc): #1, name and amount, then quantity × rate = subtotal, and the discount in orange. */
@Composable
private fun LineCard(k: Int, l: SaleMaths.Line, row: BillMaths.Row?, onTap: () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    val gross = BillMaths.round2(row?.gross ?: BigDecimal.ZERO)
    val amt = row?.amount ?: BigDecimal.ZERO
    val q = SaleMaths.num(l.qty)
    Column(
        Modifier.fillMaxWidth().heightIn(min = Size.Tap).raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)
            .clickable(role = Role.Button, onClick = onTap).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            T("#${k + 1}", Modifier.background(Colours.LightSlate, RoundedCornerShape(5.dp)).border(1.dp, Colours.Border, RoundedCornerShape(5.dp)).padding(horizontal = 5.dp), size = 11.sp, weight = FontWeight.Bold, colour = Colours.Text2)
            T(l.name, Modifier.weight(1f), oneLine = true)
            T(m2(amt), weight = FontWeight.Bold, numbers = true)
        }
        Row(Modifier.padding(start = 30.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            T(stringResource(R.string.sl_item_sub), Modifier.weight(1f), size = 12.sp, colour = Colours.Text3, oneLine = true)
            T("${qtyText(q)} ${unitWord(l.unit)} × ${m2(l.price)} = ${m2(gross)}", size = 12.sp, colour = Colours.Text2, numbers = true)
        }
        if (l.disc.signum() > 0) Row(Modifier.padding(start = 30.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            T(stringResource(R.string.sl_disc_pct, l.disc.setScale(2, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()), Modifier.weight(1f), size = 12.sp, colour = Colours.Orange, oneLine = true)
            T("−" + m2(gross - amt), size = 12.sp, colour = Colours.Orange, numbers = true)
        }
    }
}

/** Discount & Charges or Received (.sumb); [todo] = not checked yet (orange, with "!"). */
@Composable
private fun SumButton(label: String, value: String, colour: Color, todo: Boolean, modifier: Modifier, onTap: () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Box(
        modifier.heightIn(min = Size.Tap).background(if (todo) Colours.LightOrange else Colours.Page, shape).border(1.dp, if (todo) Colours.Orange else Colours.Border, shape)
            .clickable(role = Role.Button, onClick = onTap).padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Column(Modifier.padding(end = if (todo) 24.dp else 0.dp)) {
            T(label, size = 12.sp, weight = FontWeight.SemiBold, colour = Colours.Text2, oneLine = true)
            T(value, weight = FontWeight.Bold, colour = colour, numbers = true, oneLine = true)
        }
        if (todo) Box(Modifier.align(Alignment.TopEnd).size(20.dp).background(Colours.Orange, CircleShape), contentAlignment = Alignment.Center) {
            T("!", size = 12.sp, weight = FontWeight.Bold, colour = Colours.OnColour)
        }
    }
}

/** A small money input that keeps only digits and one point. */
private fun money(s: String) = s.filter { it.isDigit() || it == '.' }.let { v -> val i = v.indexOf('.'); if (i < 0) v else v.substring(0, i + 1) + v.substring(i + 1).replace(".", "") }

/**
 * Discount And Charges (design 7.4d): bill discount by % or ₹, transport, labour and bank
 * commission, the totals with Round Off, and a warning above the credit limit. "Done And Save"
 * when Save opened it.
 */
@Composable
private fun ChargesSheet(s: SaleSession, c: SaleMaths.Ctx, saving: Boolean, onClose: () -> Unit, onDone: () -> Unit) {
    val d = s.draft ?: return
    val t = SaleMaths.totals(c, d)
    val p = SaleMaths.party(c, d)
    Dim(onClose) {
        Box(Modifier.imePadding()) {
            Sheet(stringResource(R.string.sl_chg_title)) {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    T(stringResource(R.string.sl_chg_sub), size = 12.sp, colour = Colours.Text3)
                    val dec = KeyboardOptions(keyboardType = KeyboardType.Decimal)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Field(stringResource(R.string.sl_disc_p), d.bdiscP, { v -> s.change { it.copy(bdiscP = money(v), bdisc = "") } }, Modifier.weight(1f), dec, "0", trailing = { T("%", Modifier.padding(end = 10.dp), colour = Colours.Text2) })
                        Field(stringResource(R.string.sl_or_rs), d.bdisc, { v -> s.change { it.copy(bdisc = money(v), bdiscP = "") } }, Modifier.weight(1f), dec, "0", prefix = "₹")
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Field(stringResource(R.string.sl_transport), d.chTr, { v -> s.change { it.copy(chTr = money(v)) } }, Modifier.weight(1f), dec, "0", prefix = "₹")
                        Field(stringResource(R.string.sl_labour), d.chLab, { v -> s.change { it.copy(chLab = money(v)) } }, Modifier.weight(1f), dec, "0", prefix = "₹")
                    }
                    Field(stringResource(R.string.sl_bank), d.chBank, { v -> s.change { it.copy(chBank = money(v)) } }, keyboard = dec, placeholder = "0", prefix = "₹")
                    BoxCol {
                        TL(stringResource(R.string.sl_items_total), "₹" + inr(t.items))
                        if (t.billDiscount.signum() > 0) TL(stringResource(R.string.sl_discount) + (if (d.bdiscP.isNotBlank()) " (${d.bdiscP}%)" else ""), "−₹" + inr(t.billDiscount), Colours.Red)
                        if (c.mode == BillMaths.Mode.Gst) {
                            TL(stringResource(R.string.sl_taxable), "₹" + inr(t.taxable))
                            if (t.inter) TL("IGST", "₹" + inr(t.igst)) else { TL("CGST", "₹" + inr(t.cgst)); TL("SGST", "₹" + inr(t.sgst)) }
                            if (t.tcs.signum() > 0) TL("TCS", "+₹" + inr(t.tcs))
                        }
                        if (t.chTr.signum() > 0) TL(stringResource(R.string.sl_transport), "+₹" + inr(t.chTr))
                        if (t.chLab.signum() > 0) TL(stringResource(R.string.sl_labour), "+₹" + inr(t.chLab))
                        if (t.chBank.signum() > 0) TL(stringResource(R.string.sl_bank), "+₹" + inr(t.chBank))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.weight(1f)) { SwitchRow(stringResource(R.string.sl_round), d.roundOff) { v -> s.change { it.copy(roundOff = v) } } }
                            T((if (t.roundOff.signum() < 0) "−" else "+") + "₹" + inr(t.roundOff.abs()), Modifier.padding(start = 10.dp), size = 14.sp, weight = FontWeight.Bold, numbers = true)
                        }
                        TL(stringResource(R.string.sl_total), "₹" + inr(t.total), big = true)
                        T(BillMaths.amountInWords(t.total), size = 12.sp, colour = Colours.Text2)
                    }
                    if (!d.cash && !d.quote && p != null) {
                        val limit = p.creditLimit?.toBigDecimalOrNull() ?: BigDecimal.ZERO
                        val after = SaleMaths.before(d, p) + SaleMaths.dues(d, t.total)
                        if (limit.signum() > 0 && after > limit) {
                            Row(Modifier.fillMaxWidth().background(Colours.LightRed, RoundedCornerShape(Size.RadiusSmall)).padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Clock, contentDescription = null, tint = Colours.Red, modifier = Modifier.size(18.dp))
                                T(stringResource(R.string.sl_limit_warn, p.name, inr(after), m2(limit)), Modifier.weight(1f), size = 13.sp, colour = Colours.Red)
                            }
                        }
                    }
                    Btn(stringResource(if (saving) R.string.sl_done_save else R.string.pm_done), onDone, Modifier.fillMaxWidth(), Kind.Blue)
                }
            }
        }
    }
}

/**
 * Payment Received (design 7.4d): Fully Received, one or more payment types with amounts (and a
 * reference when it isn't cash), Bill Amount, Received, Bill Dues, and for a customer the previous
 * and total dues. A cash bill is always fully received.
 */
@Composable
private fun PaySheet(s: SaleSession, c: SaleMaths.Ctx, onClose: () -> Unit) {
    val d = s.draft ?: return
    val t = SaleMaths.totals(c, d)
    val p = SaleMaths.party(c, d)
    var pick by remember { mutableStateOf(-1) }
    val pays = SaleMaths.payments(d, t.total)
    val rec = SaleMaths.received(d, t.total)
    val full = d.cash || (t.total.signum() > 0 && rec.compareTo(t.total) == 0)
    Dim(onClose) {
        Box(Modifier.imePadding()) {
            Sheet(stringResource(R.string.sl_pay_title)) {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SwitchRow(stringResource(R.string.sl_full), full) { on ->
                        if (d.cash) return@SwitchRow
                        s.change { x ->
                            val others = x.pays.drop(1).fold(BigDecimal.ZERO) { a, q -> a + SaleMaths.num(q.amount) }
                            val first = x.pays.first().copy(amount = if (on) (t.total - others).max(BigDecimal.ZERO).toPlainString() else "")
                            x.copy(payTouched = true, pays = if (on) listOf(first) + x.pays.drop(1) else x.pays.map { it.copy(amount = "") })
                        }
                    }
                    if (d.cash) {
                        Box(Modifier.fillMaxWidth().background(Colours.LightGreen, RoundedCornerShape(Size.RadiusSmall)).padding(horizontal = 12.dp, vertical = 10.dp)) {
                            T(stringResource(R.string.sl_full_in, inr(t.total), payWord(pays.first().mode)), size = 13.sp, colour = Colours.Green)
                        }
                        ChoiceField(stringResource(R.string.sl_pay_type), payWord(pays.first().mode)) { pick = 0 }
                    } else d.pays.forEachIndexed { k, x ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                            Box(Modifier.weight(1f)) { ChoiceField(null, payWord(x.mode)) { pick = k } }
                            Field(null, if (d.payTouched) x.amount else "", { v -> s.change { y -> y.copy(payTouched = true, pays = y.pays.mapIndexed { i, q -> if (i == k) q.copy(amount = money(v)) else q }) } },
                                Modifier.weight(1f), KeyboardOptions(keyboardType = KeyboardType.Decimal), "0", prefix = "₹")
                            Box(Modifier.padding(bottom = 3.dp)) {
                                IconBtn(Icons.Close, stringResource(R.string.sl_pay_remove), { if (d.pays.size > 1) s.change { y -> y.copy(payTouched = true, pays = y.pays.filterIndexed { i, _ -> i != k }) } else s.change { y -> y.copy(payTouched = true, pays = listOf(SaleMaths.Pay())) } })
                            }
                        }
                        if (x.mode != "Cash") Field(null, x.ref, { v -> s.change { y -> y.copy(pays = y.pays.mapIndexed { i, q -> if (i == k) q.copy(ref = v.take(80)) else q }) } }, placeholder = stringResource(R.string.sl_pay_ref))
                    }
                    if (!d.cash && d.pays.size < SaleMaths.PAY_MODES.size) LinkButton(stringResource(R.string.sl_pay_add), {
                        s.change { y ->
                            val used = y.pays.map { it.mode }
                            val m = SaleMaths.PAY_MODES.firstOrNull { it !in used } ?: "Cash"
                            val left = (t.total - SaleMaths.received(y, t.total)).max(BigDecimal.ZERO)
                            y.copy(payTouched = true, pays = (if (y.payTouched) y.pays else listOf(y.pays.first().copy(amount = ""))) + SaleMaths.Pay(m, if (left.signum() > 0) left.toPlainString() else ""))
                        }
                    })
                    BoxCol {
                        TL(stringResource(R.string.sl_bill_amount), "₹" + inr(t.total))
                        TL(stringResource(R.string.sl_received), "₹" + inr(rec), Colours.Green)
                        val dues = SaleMaths.dues(d, t.total)
                        TL(stringResource(R.string.sl_bill_dues), "₹" + inr(dues), if (dues.signum() > 0) Colours.Red else Colours.Text)
                        if (!d.cash && p != null) {
                            val prev = SaleMaths.before(d, p)
                            TL(stringResource(R.string.sl_prev_dues), "₹" + inr(prev), if (prev.signum() > 0) Colours.Red else Colours.Text)
                            val total = prev + t.total - rec
                            TL(stringResource(R.string.sl_total_dues), (if (total.signum() < 0) "−" else "") + "₹" + inr(total.abs()), if (total.signum() > 0) Colours.Red else Colours.Green, big = true)
                        }
                    }
                    val extra = rec - t.total
                    if (extra.signum() > 0 && !d.cash) {
                        Box(Modifier.fillMaxWidth().background(Colours.LightGreen, RoundedCornerShape(Size.RadiusSmall)).padding(horizontal = 12.dp, vertical = 10.dp)) {
                            T(stringResource(if (p != null && SaleMaths.before(d, p).signum() > 0) R.string.sl_clears_old else R.string.sl_advance_note, inr(extra)), size = 13.sp, colour = Colours.Green)
                        }
                    }
                    Btn(stringResource(R.string.pm_done), onClose, Modifier.fillMaxWidth(), Kind.Blue)
                }
            }
        }
    }
    if (pick >= 0) {
        BackHandler { pick = -1 }
        val names = SaleMaths.PAY_MODES.map { payWord(it) }
        ChoiceSheet(stringResource(R.string.sl_pay_type), names, SaleMaths.PAY_MODES.indexOf(d.pays.getOrNull(pick)?.mode ?: "Cash"), { pick = -1 }) { n ->
            val k = pick
            s.change { y -> y.copy(pays = y.pays.mapIndexed { i, q -> if (i == k) q.copy(mode = SaleMaths.PAY_MODES[n], ref = if (SaleMaths.PAY_MODES[n] == "Cash") "" else q.ref) else q }) }
            pick = -1
        }
    }
}

/**
 * Choose Customer (design 7.4d): search by name or mobile, every active party with what they owe,
 * Add New Party, and on a cash bill "No Customer (Counter Sale)".
 */
@Composable
fun CustomerScreen(s: SaleSession, onBack: () -> Unit, onNewParty: () -> Unit) {
    val c = s.ctx
    val d = s.draft
    var q by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(Colours.Page)) {
        Box(Modifier.background(Colours.Card).statusBarsPadding()) {
            Header(stringResource(R.string.sl_choose_customer), left = { IconBtn(Icons.Back, stringResource(R.string.back), onBack) })
        }
        if (c == null || d == null) { Loading(); return@Column }
        val key = q.lowercase().replace(" ", "")
        val shown = c.parties.filter { p -> key.isEmpty() || p.name.lowercase().replace(" ", "").contains(key) || p.phone.replace(" ", "").contains(key) }.sortedBy { it.name.lowercase() }
        LazyColumn(Modifier.weight(1f).imePadding(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Field(null, q, { q = it }, placeholder = stringResource(R.string.sl_name_mobile), leading = Icons.Search) }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    T(if (shown.size == 1) stringResource(R.string.sl_showing_1) else stringResource(R.string.sl_showing_n, shown.size), Modifier.weight(1f), size = 14.sp, colour = Colours.Text2, oneLine = true)
                    LinkButton(stringResource(R.string.sl_add_party), onNewParty)
                }
            }
            item {
                val shape = RoundedCornerShape(Size.Radius)
                Column(Modifier.fillMaxWidth().background(Colours.Card, shape).border(1.dp, Colours.Border, shape)) {
                    var first = true
                    @Composable fun line() { if (!first) Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border)); first = false }
                    if (d.cash) {
                        line()
                        PartyPick(stringResource(R.string.sl_counter), stringResource(R.string.sl_counter_sub), d.partyId == null, null) { s.change { x -> SaleMaths.withParty(c, x, null) }; onBack() }
                    }
                    shown.forEach { p ->
                        line()
                        PartyPick(p.name, if (p.phone.isNotBlank()) "+91 " + p.phone else stringResource(R.string.sl_no_mobile), p.id == d.partyId, p.balance) {
                            s.change { x -> SaleMaths.withParty(c, x, p) }
                            onBack()
                        }
                    }
                    if (shown.isEmpty() && !d.cash) T(stringResource(R.string.sl_no_parties), Modifier.fillMaxWidth().padding(20.dp), weight = FontWeight.Bold, colour = Colours.Text3, align = TextAlign.Center)
                }
            }
        }
    }
}

@Composable
private fun PartyPick(name: String, sub: String, on: Boolean, bal: BigDecimal?, onTap: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onTap).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f)) {
            T(name, weight = FontWeight.SemiBold, oneLine = true)
            T(sub, size = 12.sp, colour = Colours.Text3, oneLine = true)
        }
        if (bal != null) Column(horizontalAlignment = Alignment.End) {
            when {
                bal.signum() > 0 -> { T("↓ ₹" + m2(bal), size = 14.sp, weight = FontWeight.Bold, colour = Colours.Green, numbers = true); T(stringResource(R.string.sl_to_receive), size = 11.5.sp, weight = FontWeight.SemiBold, colour = Colours.Green) }
                bal.signum() < 0 -> { T("↑ ₹" + m2(bal.negate()), size = 14.sp, weight = FontWeight.Bold, colour = Colours.Red, numbers = true); T(stringResource(R.string.sl_to_pay), size = 11.5.sp, weight = FontWeight.SemiBold, colour = Colours.Red) }
                else -> T(stringResource(R.string.settled), size = 11.5.sp, weight = FontWeight.SemiBold, colour = Colours.Text3)
            }
        }
        if (on) Icon(Icons.Check, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(20.dp))
    }
}

/**
 * Add Item / Edit Item (design 7.4d): one item on its own page. Search or scan the item, then
 * quantity (− and +), unit, the rate, discount % or final rate (each fills the other), and the
 * line's amount, Last Prices and the batch (8.5c). Edit has Delete; Add has Save & New.
 */
@Composable
fun SaleLineScreen(s: SaleSession, index: Int, startItem: String?, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val c = s.ctx
    val d = s.draft
    val editing = index >= 0 && d != null && index < d.lines.size
    // the line being edited lives here until Save; the bill changes only then
    var line by remember { mutableStateOf(if (editing) d!!.lines[index] else if (c != null && d != null && startItem != null) SaleMaths.item(c, startItem)?.let { SaleMaths.newLine(c, d, it) } else null) }
    var searching by remember { mutableStateOf(line == null) }
    var q by remember { mutableStateOf("") }
    var rateText by remember { mutableStateOf<String?>(null) }
    var discText by remember { mutableStateOf<String?>(null) }
    var finalText by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf("") }
    val hi = hindi()

    fun pick(i: ItemFull) {
        if (c == null || d == null) return
        val keepQty = line?.qty
        line = SaleMaths.newLine(c, d, i).let { if (keepQty != null && SaleMaths.num(keepQty).signum() > 0) it.copy(qty = keepQty) else it }
        searching = false; q = ""; rateText = null; discText = null; finalText = null
    }

    fun save(again: Boolean) {
        val l = line
        if (l == null) { say(ctx, ctx.getString(R.string.sl_pick_first)); return }
        if (SaleMaths.num(l.qty).signum() <= 0) { say(ctx, ctx.getString(R.string.sl_need_qty_1)); return }
        s.change { x -> x.copy(lines = if (editing) x.lines.mapIndexed { i, o -> if (i == index) l else o } else x.lines + l) }
        if (again) {
            line = null; searching = true; rateText = null; discText = null; finalText = null
            say(ctx, ctx.getString(R.string.sl_added_next))
            return
        }
        say(ctx, ctx.getString(if (editing) R.string.sl_updated else R.string.sl_added))
        onBack()
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().background(Colours.Page)) {
            Box(Modifier.background(Colours.Card).statusBarsPadding()) {
                Header(stringResource(if (editing) R.string.sl_edit_item else R.string.sl_add_item), left = { IconBtn(Icons.Back, stringResource(R.string.back), onBack) })
            }
            if (c == null || d == null) { Loading(); return@Column }
            val l = line
            val item = l?.let { SaleMaths.item(c, it.itemId) }
            Column(Modifier.weight(1f).imePadding().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // the item: a search with its list, or the chosen item (tap to change)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    T(stringResource(R.string.sl_item_name), colour = Colours.Text2, weight = FontWeight.SemiBold, size = 13.sp)
                    if (searching || item == null) {
                        Field(null, q, { q = it }, placeholder = stringResource(R.string.sl_search_item), leading = Icons.Search,
                            trailing = { IconBtn(Icons.Scan, stringResource(R.string.i_scan), { sheet = "scan" }) })
                    } else {
                        val shape = RoundedCornerShape(Size.RadiusSmall)
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = Size.Tap).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)
                                .clickable(role = Role.Button) { searching = true }.padding(horizontal = 10.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(Icons.Search, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp))
                            T(item.name, Modifier.weight(1f), oneLine = true)
                            Icon(Icons.Next, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp).rotate(90f))
                        }
                    }
                    if (item != null && !searching) T(
                        listOfNotNull(
                            if (ItemMaths.isService(item)) stringResource(R.string.i_service) else stringResource(R.string.sl_in_stock, qtyUnit(item.stock, item.unit)),
                            item.code.takeIf { it.isNotBlank() },
                            if (c.mode == BillMaths.Mode.Gst) "GST ${item.gstRate.toBigDecimalOrNull()?.stripTrailingZeros()?.toPlainString() ?: item.gstRate}%" else null,
                        ).joinToString(" · "),
                        size = 12.sp, colour = Colours.Text3,
                    )
                }
                if (searching || item == null) {
                    val key = q.trim().lowercase()
                    val found = c.items.filter { key.isEmpty() || "${it.name} ${it.code} ${it.brand}".lowercase().contains(key) }.sortedBy { it.name.lowercase() }
                    T(if (found.size == 1) stringResource(R.string.sl_showing_item_1) else stringResource(R.string.sl_showing_items, found.size), size = 12.sp, colour = Colours.Text3)
                    val shape = RoundedCornerShape(Size.Radius)
                    Column(Modifier.fillMaxWidth().background(Colours.Card, shape).border(1.dp, Colours.Border, shape)) {
                        if (found.isEmpty()) T(stringResource(R.string.i_none), Modifier.fillMaxWidth().padding(20.dp), weight = FontWeight.Bold, colour = Colours.Text3, align = TextAlign.Center)
                        found.take(100).forEachIndexed { n, i ->
                            if (n > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
                            Row(
                                Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button) { pick(i) }.padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Column(Modifier.weight(1f)) {
                                    T(i.name, weight = FontWeight.SemiBold, oneLine = true)
                                    T(listOfNotNull(if (d.challan) null else "₹" + m2(SaleMaths.priceFor(c, i, SaleMaths.party(c, d), i.unit)),
                                        if (ItemMaths.isService(i)) stringResource(R.string.i_service) else stringResource(R.string.sl_stock, qtyUnit(i.stock, i.unit)),
                                        i.code.takeIf { it.isNotBlank() }).joinToString(" · "), size = 12.sp, colour = Colours.Text3)
                                }
                                if (i.id == l?.itemId) Icon(Icons.Check, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(20.dp))
                                else if (!ItemMaths.isService(i) && i.stock.signum() <= 0) Badge(stringResource(R.string.sl_out), BadgeKind.Due)
                            }
                        }
                    }
                    return@Column
                }
                val units = SaleMaths.units(c, item)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        T(stringResource(R.string.sl_qty), colour = Colours.Text2, weight = FontWeight.SemiBold, size = 13.sp)
                        Stepper(l.qty, { v -> line = l.copy(qty = v) })
                    }
                    Box(Modifier.weight(1f)) {
                        ChoiceField(stringResource(R.string.sl_unit), unitWord(l.unit)) { if (units.size > 1) sheet = "unit" }
                    }
                }
                // a challan (8.6d) has no money: only the item, quantity and unit (design 7.4e)
                if (d.challan) { Spacer(Modifier.height(4.dp)); return@Column }
                val dec = KeyboardOptions(keyboardType = KeyboardType.Decimal)
                Field(stringResource(R.string.sl_rate_per, unitWord(l.unit)), rateText ?: plain(l.price), { v ->
                    rateText = money(v); finalText = null
                    line = l.copy(price = SaleMaths.num(money(v)))
                }, keyboard = dec, prefix = "₹", bold = true)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Field(stringResource(R.string.sl_disc_p), discText ?: (if (l.disc.signum() > 0) l.disc.setScale(2, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString() else ""), { v ->
                        discText = money(v); finalText = null
                        line = l.copy(disc = SaleMaths.num(money(v)).min(BigDecimal(100)))
                    }, Modifier.weight(1f), dec, "0", trailing = { T("%", Modifier.padding(end = 10.dp), colour = Colours.Text2) })
                    Field(stringResource(R.string.sl_final), finalText ?: plain(SaleMaths.finalRate(l)), { v ->
                        finalText = money(v); discText = null; rateText = null
                        line = SaleMaths.withFinal(l, SaleMaths.num(money(v)))
                    }, Modifier.weight(1f), dec, prefix = "₹", bold = true)
                }
                LinkButton(stringResource(R.string.sx_last), { sheet = "lhist" })
                // Settings › Items › Batch No.: the batch this line uses (automatic: earliest expiry first)
                if (c.batches[item.id].orEmpty().isNotEmpty()) {
                    val today = Format.todayIso()
                    val chosen = c.batches[item.id].orEmpty().firstOrNull { it.id == l.batchId && l.batchId != null }
                    val shown = chosen ?: SaleMaths.autoBatch(c, item.id, today)
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        T(stringResource(R.string.sx_batch_sel), colour = Colours.Text2, weight = FontWeight.SemiBold, size = 13.sp)
                        val shape = RoundedCornerShape(Size.Radius)
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 56.dp).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)
                                .clickable(role = Role.Button) { sheet = "batch" }.padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                T(if (shown == null) stringResource(R.string.sx_batch_choose) else batchName(shown) + (if (chosen == null) " · " + stringResource(R.string.sx_auto) else ""), weight = FontWeight.SemiBold, oneLine = true)
                                if (shown != null) {
                                    val ex = SaleMaths.expired(shown, today)
                                    T(listOf(batchSub(shown, today, hindi()), "${Format.qty(shown.qty)} ${unitWord(item.unit)}").filter { it.isNotBlank() }.joinToString(" · "), size = 12.sp, colour = if (ex) Colours.Red else Colours.Text3)
                                }
                            }
                            T(stringResource(R.string.sx_change), weight = FontWeight.SemiBold, colour = Colours.Blue)
                        }
                    }
                }
                // the line's amount (.box): quantity × rate, the discount, and the amount
                val one = BillMaths.sale(BillMaths.Bill(c.mode, true, false, listOf(BillMaths.Line(SaleMaths.num(l.qty), l.price, l.disc, l.gst)), false)).rows.first()
                val gross = BillMaths.round2(one.gross)
                BoxCol {
                    TL("${qtyText(SaleMaths.num(l.qty))} ${unitWord(l.unit)} × ₹${m2(l.price)}", "₹" + inr(gross))
                    if (l.disc.signum() > 0) TL(stringResource(R.string.sl_disc_pct, l.disc.setScale(2, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()), "−₹" + inr(gross - one.amount), Colours.Red)
                    TL(stringResource(R.string.sl_amount), "₹" + inr(one.amount), big = true)
                    if (c.mode == BillMaths.Mode.Gst) T(stringResource(R.string.sl_gst_incl, l.gst.stripTrailingZeros().toPlainString()), size = 12.sp, colour = Colours.Text3)
                    val bp = l.bp
                    if (bp != null && l.price > bp) T(stringResource(R.string.sx_incl_comm, inr(l.price - bp), unitWord(l.unit)), size = 12.sp, colour = Colours.Text3)
                }
                Spacer(Modifier.height(4.dp))
            }
            FootBar {
                if (editing) Btn(stringResource(R.string.sl_delete), {
                    s.change { x -> x.copy(lines = x.lines.filterIndexed { i, _ -> i != index }) }
                    say(ctx, ctx.getString(R.string.sl_removed)); onBack()
                }, Modifier.weight(1f), Kind.Delete, Icons.Trash)
                else Btn(stringResource(R.string.sl_save_new), { save(true) }, Modifier.weight(1f), Kind.Soft)
                Btn(stringResource(R.string.sl_save), { save(false) }, Modifier.weight(1f), Kind.Blue, Icons.Check)
            }
        }
        if (sheet.isNotEmpty()) BackHandler { sheet = "" }
        val l = line
        val item = if (c != null && l != null) SaleMaths.item(c, l.itemId) else null
        when (sheet) {
            "scan" -> ScanScreen({ sheet = "" }) { code ->
                val hit = c?.items?.firstOrNull { it.code.equals(code, ignoreCase = true) }
                sheet = ""
                if (hit != null) pick(hit) else say(ctx, ctx.getString(R.string.sc_not_found_sale, code))
            }
            "batch" -> if (c != null && l != null && item != null) BatchSheet(c, item.id, item.unit, l.batchId, { sheet = "" }) { id -> line = l.copy(batchId = id); sheet = "" }
            "lhist" -> if (c != null && d != null && l != null && item != null) {
                val p = SaleMaths.party(c, d)
                LastPricesSheet(s, item.id, item.name, l.unit, p?.id, p?.name, { sheet = "" }) { v ->
                    line = SaleMaths.withFinal(l, v); finalText = null; discText = null; rateText = null; sheet = ""
                    say(ctx, ctx.getString(R.string.sx_used, inr(v)))
                }
            }
            "unit" -> if (c != null && d != null && l != null && item != null) {
                val units = SaleMaths.units(c, item)
                ChoiceSheet(stringResource(R.string.sl_unit), units.map(::unitWord), units.indexOf(l.unit), { sheet = "" }) { n ->
                    line = SaleMaths.withCommission(c, d, l.copy(unit = units[n], price = SaleMaths.priceFor(c, item, SaleMaths.party(c, d), units[n]), bp = null, batchId = null))
                    rateText = null; finalText = null; sheet = ""
                }
            }
        }
    }
}

private fun plain(v: BigDecimal): String = v.stripTrailingZeros().let { if (it.scale() < 0) it.setScale(0) else it }.toPlainString()

/** Quantity with − and + (.stp): + adds one, − takes one away but not below one. */
@Composable
internal fun Stepper(value: String, onChange: (String) -> Unit) {
    val shape = RoundedCornerShape(Size.RadiusSmall)
    Row(Modifier.fillMaxWidth().heightIn(min = Size.Tap).background(Colours.Card, shape).border(1.dp, Colours.Border, shape), verticalAlignment = Alignment.CenterVertically) {
        val q = SaleMaths.num(value)
        Box(Modifier.width(38.dp).heightIn(min = Size.Tap).background(Colours.Page).clickable(role = Role.Button) { if (q > BigDecimal.ONE) onChange(plain(q - BigDecimal.ONE)) }.semantics { contentDescription = "Less" }, contentAlignment = Alignment.Center) {
            T("−", size = 20.sp, weight = FontWeight.SemiBold, colour = Colours.Blue)
        }
        BasicTextField(
            value, { v -> onChange(money(v)) }, Modifier.weight(1f).semantics { contentDescription = "Quantity" }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            textStyle = TextStyle(fontFamily = LocalFont.current, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Colours.Text, textAlign = TextAlign.Center),
            cursorBrush = SolidColor(Colours.Blue),
        )
        Box(Modifier.width(38.dp).heightIn(min = Size.Tap).background(Colours.Page).clickable(role = Role.Button) { onChange(plain(q + BigDecimal.ONE)) }.semantics { contentDescription = "More" }, contentAlignment = Alignment.Center) {
            T("+", size = 20.sp, weight = FontWeight.SemiBold, colour = Colours.Blue)
        }
    }
}

/**
 * Bill Saved (design 7.4d): the number, the customer, Bill Total, Received, Bill Dues and (on
 * credit) Total Dues; Share On WhatsApp and Share Or Print PDF come with the PDF (8.5d); New Bill, Done.
 */
@Composable
fun SavedScreen(s: SaleSession, features: List<String>, itemOptions: JsonObject?, onNew: () -> Unit, onDone: () -> Unit) {
    val (r, d) = s.saved ?: return
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    // the PDF is made once, the first time it is needed, and kept for the other button
    var made by remember(r.id) { mutableStateOf<InvoicePdf.Made?>(null) }
    var busy by remember { mutableStateOf("") }
    fun pdf(what: String) {
        if (busy.isNotEmpty()) return
        busy = what
        scope.launch {
            val m = made ?: try {
                InvoicePdf.make(ctx, s.server, r.id, features, itemOptions).also { made = it }
            } catch (e: ApiError) {
                say(ctx, if (e.status == 0) ctx.getString(R.string.no_internet) else e.message); null
            } catch (e: Exception) {
                say(ctx, ctx.getString(R.string.pdf_failed)); null
            }
            busy = ""
            if (m != null) when (what) {
                "wa" -> if (!InvoicePdf.whatsApp(ctx, m)) say(ctx, ctx.getString(R.string.pdf_no_app))
                "print" -> InvoicePdf.print(ctx, m)
                else -> if (!InvoicePdf.share(ctx, m)) say(ctx, ctx.getString(R.string.pdf_no_app))
            }
        }
    }
    // Share or Print chosen before saving: done as soon as the bill is saved
    LaunchedEffect(r.id) { val a = s.after; if (a.isNotEmpty()) { s.after = ""; pdf(a) } }
    val c = s.ctx
    val party = c?.let { SaleMaths.party(it, d) }
    val total = r.total.toBigDecimalOrNull() ?: BigDecimal.ZERO
    val paid = d.let { SaleMaths.received(it, total) }
    val due = r.balance.toBigDecimalOrNull() ?: BigDecimal.ZERO
    Box(Modifier.fillMaxSize().background(Colours.Page).statusBarsPadding().padding(16.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(64.dp).background(Colours.Green, CircleShape), contentAlignment = Alignment.Center) { Icon(Icons.Check, contentDescription = null, tint = Colours.OnColour, modifier = Modifier.size(32.dp)) }
            T(stringResource(R.string.sl_saved_t, r.number), size = 20.sp, weight = FontWeight.Bold, align = TextAlign.Center)
            T(party?.name ?: stringResource(R.string.sl_counter_name), size = 14.sp, colour = Colours.Text2, align = TextAlign.Center)
            BoxCol(Modifier.padding(vertical = 4.dp)) {
                TL(stringResource(R.string.sl_bill_total2), "₹" + inr(total))
                TL(stringResource(R.string.sl_received), "₹" + inr(paid.min(total)), Colours.Green)
                TL(stringResource(R.string.sl_bill_dues), "₹" + inr(due), if (due.signum() > 0) Colours.Red else Colours.Text)
                if (!d.cash && party != null) {
                    // what the customer owes now: before + this bill − everything received
                    val now = SaleMaths.before(d, party) + total - paid
                    TL(stringResource(R.string.sl_total_dues), (if (now.signum() < 0) "−" else "") + "₹" + inr(now.abs()), if (now.signum() > 0) Colours.Red else Colours.Text)
                }
            }
            Btn(stringResource(R.string.sl_share_wa), { pdf("wa") }, Modifier.fillMaxWidth(), Kind.Green, Icons.Chat, busy = busy == "wa")
            Btn(stringResource(R.string.sl_share_pdf), { pdf("share") }, Modifier.fillMaxWidth(), Kind.Soft, Icons.Share, busy = busy == "share" || busy == "print")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Btn(stringResource(R.string.new_bill), onNew, Modifier.weight(1f), Kind.Line, Icons.Plus)
                Btn(stringResource(R.string.sl_done), onDone, Modifier.weight(1f), Kind.Line)
            }
        }
    }
}

