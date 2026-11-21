package billingo.app.ui.sale

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.ApiError
import billingo.app.data.PastPrice
import billingo.app.data.QuoteRow
import billingo.app.data.StockBatch
import billingo.app.ui.home.unitWord
import billingo.app.ui.parties.Seg2
import billingo.app.ui.parties.Waiting
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.ChoiceField
import billingo.app.ui.parts.ChoiceSheet
import billingo.app.ui.parts.Dim
import billingo.app.ui.parts.Field
import billingo.app.ui.parts.Format
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.LinkButton
import billingo.app.ui.parts.Loading
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.T
import billingo.app.ui.parts.load
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
private fun why(ctx: android.content.Context, e: ApiError) = if (e.status == 0) ctx.getString(R.string.no_internet) else e.message
private fun m2(v: BigDecimal) = Format.inr(v, paise = false)
private fun plain(v: BigDecimal) = v.stripTrailingZeros().let { if (it.scale() < 0) it.setScale(0) else it }.toPlainString()

/** A white box of rows with lines between them (.grp). */
@Composable
private fun Grp(content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Column(Modifier.fillMaxWidth().background(Colours.Card, shape).border(1.dp, Colours.Border, shape)) { content() }
}

@Composable
private fun Line() = Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))

/** A row of a menu sheet (.srow.mrow): icon, words, a small line under them. */
@Composable
private fun MenuRow(icon: ImageVector, text: String, sub: String?, onTap: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, onClick = onTap).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f)) {
            T(text)
            if (!sub.isNullOrBlank()) T(sub, size = 12.sp, colour = Colours.Text3, oneLine = true)
        }
    }
}

/** The top ⋮ of Sale (design 7.4d): Import From Quotation, Add Referral, Bill Details. */
@Composable
fun SaleMenuSheet(referrer: String?, onClose: () -> Unit, onPick: (String) -> Unit) {
    Dim(onClose) {
        Sheet(stringResource(R.string.sl_more)) {
            Grp {
                MenuRow(Icons.Import, stringResource(R.string.sx_import), null) { onPick("quote") }
                Line()
                MenuRow(Icons.User, stringResource(R.string.sx_add_ref), referrer) { onPick("ref") }
                Line()
                MenuRow(Icons.Bill, stringResource(R.string.sx_details), null) { onPick("extras") }
            }
        }
    }
}

/** Under the customer: the referral and the quotations this bill came from (.tagrow); a quotation's × removes the link, the items stay. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SaleTags(d: SaleMaths.Draft, c: SaleMaths.Ctx, onReferral: () -> Unit, onUnlink: (String) -> Unit) {
    val ref = d.referrerId?.let { id -> c.referrers.firstOrNull { it.id == id }?.name }
    if (ref == null && d.quotes.isEmpty()) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (ref != null) Tag(stringResource(R.string.sx_ref_tag, ref), Icons.User, null, onReferral)
        d.quotes.forEach { q -> Tag(stringResource(R.string.sx_from, q.no), null, Icons.Close) { onUnlink(q.id) } }
    }
}

@Composable
private fun Tag(text: String, lead: ImageVector?, trail: ImageVector?, onTap: () -> Unit) {
    val shape = RoundedCornerShape(999.dp)
    Row(
        Modifier.heightIn(min = Size.Tap).widthIn(max = 320.dp).background(Colours.LightBlue, shape).border(1.dp, Colours.Selected, shape)
            .clickable(role = Role.Button, onClick = onTap).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (lead != null) Icon(lead, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(16.dp))
        T(text, size = 13.sp, weight = FontWeight.SemiBold, colour = Colours.Blue, oneLine = true)
        if (trail != null) Icon(trail, contentDescription = stringResource(R.string.sx_unlink), tint = Colours.Blue, modifier = Modifier.size(16.dp))
    }
}

/**
 * Import From Quotation (design 7.4d): the customer's saved item-wise quotations that are still open
 * (all of them when no customer is chosen); tapping one brings its items in at the quoted rates.
 */
@Composable
fun QuoteSheet(s: SaleSession, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val hi = hindi()
    val scope = rememberCoroutineScope()
    val list = load { s.server.quotations() }
    var busy by remember { mutableStateOf("") }
    val c = s.ctx ?: return
    val d = s.draft ?: return
    Dim(onClose) {
        Sheet(stringResource(R.string.sx_import), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
            T(stringResource(R.string.sx_import_sub), size = 12.sp, colour = Colours.Text3)
            val all = list.data
            if (all == null) { Waiting(list); return@Sheet }
            val p = SaleMaths.party(c, d)
            val open = all.filter { q ->
                !q.cancelled && q.status != "converted" && q.qtype != "brand" && q.items > 0 &&
                    (p == null || q.party?.id == p.id || q.partyName.trim().equals(p.name.trim(), ignoreCase = true)) && d.quotes.none { it.id == q.id }
            }.sortedByDescending { it.date }
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (open.isEmpty()) T(stringResource(R.string.sx_no_quotes), Modifier.fillMaxWidth().padding(20.dp), weight = FontWeight.Bold, colour = Colours.Text3, align = TextAlign.Center)
                open.forEach { q -> QuoteRowView(q, hi, busy == q.id) {
                    if (busy.isNotEmpty()) return@QuoteRowView
                    busy = q.id
                    scope.launch {
                        try {
                            val doc = s.server.saleDoc(q.id)
                            val cur = s.draft ?: return@launch
                            val (nd, n) = SaleMaths.withQuote(c, cur, doc)
                            s.draft = nd
                            say(ctx, ctx.getString(R.string.sx_imported, n, q.number))
                            onClose()
                        } catch (e: ApiError) { say(ctx, why(ctx, e)) } finally { busy = "" }
                    }
                } }
            }
        }
    }
}

@Composable
private fun QuoteRowView(q: QuoteRow, hi: Boolean, busy: Boolean, onTap: () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 60.dp).background(Colours.Card, shape).border(1.dp, Colours.Border, shape)
            .clickable(role = Role.Button, onClick = onTap).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f)) {
            T(q.partyName.ifBlank { q.party?.name ?: "" }, weight = FontWeight.SemiBold, oneLine = true)
            T("${q.number} | ${Format.date(q.date, hi)}", size = 12.sp, colour = Colours.Text3)
        }
        Column(horizontalAlignment = Alignment.End) {
            T("₹" + m2(q.total.toBigDecimalOrNull() ?: BigDecimal.ZERO), weight = FontWeight.Bold, numbers = true)
            T(if (busy) "…" else if (q.items == 1) stringResource(R.string.sx_items_1) else stringResource(R.string.sx_items_n, q.items), size = 12.sp, colour = Colours.Text3)
        }
    }
}

/**
 * Referral (design 7.4d): who sent the customer (an electrician), the rule for this bill (% of the sale
 * price or ₹ per unit; until it is changed, each item category's saved rule), what each item
 * carries and the commission. Added to the rates; not printed on the bill.
 */
@Composable
fun ReferralSheet(s: SaleSession, onClose: () -> Unit, onAddElectrician: () -> Unit) {
    val c = s.ctx ?: return
    val d = s.draft ?: return
    var pick by remember { mutableStateOf(false) }
    // what is typed in the box; the rule changes as it is typed
    var typed by remember { mutableStateOf<String?>(null) }
    val names = listOf(stringResource(R.string.sx_no_elec)) + c.referrers.map { it.name }
    Dim(onClose) {
        Box(Modifier.imePadding()) {
            Sheet(stringResource(R.string.sx_ref_title)) {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    T(stringResource(R.string.sx_ref_sub), size = 12.sp, colour = Colours.Text3)
                    val cur = c.referrers.firstOrNull { it.id == d.referrerId }
                    ChoiceField(stringResource(R.string.sx_ref_by), cur?.name ?: names[0]) { pick = true }
                    LinkButton(stringResource(R.string.sx_add_elec), onAddElectrician)
                    if (cur == null) {
                        T(stringResource(R.string.sx_no_comm), size = 14.sp, colour = Colours.Text2)
                    } else {
                        // the rule shown: this bill's, else the first item's saved rule
                        val shown = d.billRule ?: d.lines.firstOrNull()?.let { SaleMaths.ruleFor(c, d, it) }?.takeIf { it.t != 'n' } ?: SaleMaths.Rule('p', BigDecimal.ZERO)
                        T(stringResource(R.string.sx_rule), colour = Colours.Text2, weight = FontWeight.SemiBold, size = 13.sp)
                        Seg2(stringResource(R.string.sx_pct) to null, stringResource(R.string.sx_per_unit) to null, if (shown.t == 'f') 1 else 0) { i ->
                            s.change { SaleMaths.withBillRule(c, it, SaleMaths.Rule(if (i == 0) 'p' else 'f', shown.v)) }
                        }
                        Field(null, typed ?: plain(shown.v), { v ->
                            val clean = v.filter { ch -> ch.isDigit() || ch == '.' }
                            typed = clean
                            s.change { SaleMaths.withBillRule(c, it, SaleMaths.Rule(if (shown.t == 'f') 'f' else 'p', SaleMaths.num(clean))) }
                        }, keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), placeholder = "0", bold = true,
                            prefix = if (shown.t == 'f') "₹" else null,
                            trailing = if (shown.t != 'f') ({ T("%", Modifier.padding(end = 10.dp), colour = Colours.Text2) }) else null)
                        if (d.billRule == null && d.lines.map { it.category }.distinct().size > 1) T(stringResource(R.string.sx_usual), size = 12.sp, colour = Colours.Text3)
                        if (d.lines.isEmpty()) T(stringResource(R.string.sx_add_items), size = 14.sp, colour = Colours.Text2)
                        else {
                            var total = BigDecimal.ZERO
                            Grp {
                                d.lines.forEachIndexed { k, l ->
                                    val cm = SaleMaths.lineCommission(c, l)
                                    total += cm
                                    if (k > 0) Line()
                                    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                                        Row { T(l.name, Modifier.weight(1f), oneLine = true); T("₹" + Format.inr(cm), weight = FontWeight.Bold, numbers = true) }
                                        T(stringResource(R.string.sx_comm_line, "${Format.qty(SaleMaths.num(l.qty).toPlainString())} ${unitWord(l.unit)}", Format.inr(l.bp ?: l.price), Format.inr(l.price)), size = 12.sp, colour = Colours.Text3)
                                    }
                                }
                            }
                            Column {
                                Box(Modifier.fillMaxWidth().height(1.dp).background(Colours.Border))
                                Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                                    T(stringResource(R.string.sx_comm_for, cur.name), Modifier.weight(1f), size = 17.sp, weight = FontWeight.Bold)
                                    T("₹" + Format.inr(total), size = 19.sp, weight = FontWeight.Bold, numbers = true)
                                }
                            }
                        }
                    }
                    Btn(stringResource(R.string.pm_done), onClose, Modifier.fillMaxWidth(), Kind.Blue)
                }
            }
        }
    }
    if (pick) {
        androidx.activity.compose.BackHandler { pick = false }
        ChoiceSheet(stringResource(R.string.sx_ref_by), names, c.referrers.indexOfFirst { it.id == d.referrerId } + 1, { pick = false }) { n ->
            s.change { SaleMaths.withReferrer(c, it, if (n == 0) null else c.referrers[n - 1].id) }
            typed = null; pick = false
        }
    }
}

/** + Add Electrician: name, mobile, city. The new one is chosen for this bill. */
@Composable
fun AddElectricianSheet(s: SaleSession, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<ApiError?>(null) }
    var busy by remember { mutableStateOf(false) }
    fun err(f: String) = problem?.takeIf { it.field == f || (f == "name" && it.field == null) }?.let { why(ctx, it) }
    Dim(onClose) {
        Box(Modifier.imePadding()) {
            Sheet(stringResource(R.string.sx_add_elec).removePrefix("+ "), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
                Field(stringResource(R.string.sx_elec_name), name, { name = it; problem = null }, placeholder = "Raju Electrician", error = err("name"), keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Field(stringResource(R.string.gd_phone), phone, { phone = it.filter { ch -> ch.isDigit() }.take(10); problem = null }, Modifier.weight(1f), KeyboardOptions(keyboardType = KeyboardType.Phone), error = err("phone"))
                    Field(stringResource(R.string.sx_city), city, { city = it }, Modifier.weight(1f), KeyboardOptions(capitalization = KeyboardCapitalization.Words))
                }
                Btn(stringResource(R.string.pf_add), {
                    if (busy) return@Btn
                    busy = true
                    scope.launch {
                        try {
                            val r = s.server.addReferrer(buildJsonObject { put("name", name.trim()); put("phone", phone); put("city", city.trim()) })
                            say(ctx, ctx.getString(R.string.added_x, r.name))
                            s.addReferrer(scope, r.id)
                            onClose()
                        } catch (e: ApiError) { problem = e } finally { busy = false }
                    }
                }, Modifier.fillMaxWidth(), Kind.Blue, Icons.Plus, busy = busy)
            }
        }
    }
}

/** A part of Bill Details that opens and closes (.acc). */
@Composable
private fun Acc(icon: ImageVector, tint: Color, title: String, content: @Composable () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column {
        Row(
            Modifier.fillMaxWidth().heightIn(min = Size.Tap).clickable(role = Role.Button) { open = !open }.padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
            T(title, Modifier.weight(1f), weight = FontWeight.SemiBold)
            Icon(Icons.Next, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(20.dp).rotate(if (open) 90f else 0f))
        }
        if (open) Column(Modifier.padding(start = 4.dp, end = 4.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

/**
 * Bill Details (design 7.4d): transport and vehicle, a description under the items, the terms,
 * attachments (on the computer for now), and the profit on this bill (only you see it).
 */
@Composable
fun DetailsSheet(s: SaleSession, onClose: () -> Unit, onLater: () -> Unit) {
    val c = s.ctx ?: return
    val d = s.draft ?: return
    Dim(onClose) {
        Box(Modifier.imePadding()) {
            Sheet(stringResource(R.string.sx_details), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Acc(Icons.Cart, Colours.Blue, stringResource(R.string.sx_transport)) {
                        Field(stringResource(R.string.sl_transport), d.transport, { v -> s.change { it.copy(transport = v.take(120)) } }, keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
                        Field(stringResource(R.string.sx_vehicle), d.vehicle, { v -> s.change { it.copy(vehicle = v.take(60).uppercase()) } }, placeholder = "UP78 AB 1234")
                    }
                    Acc(Icons.Bill, Colours.Blue, stringResource(R.string.sx_desc)) {
                        Field(null, d.description, { v -> s.change { it.copy(description = v.take(2000)) } }, placeholder = stringResource(R.string.sx_desc_ph), keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences))
                    }
                    Acc(Icons.Book, Colours.Blue, stringResource(R.string.sx_terms)) {
                        T(SaleMaths.NOTES, size = 14.sp, colour = Colours.Text2)
                        T(stringResource(R.string.sx_terms_note), size = 12.sp, colour = Colours.Text3)
                    }
                    Acc(Icons.Plus, Colours.Blue, stringResource(R.string.sx_attach)) {
                        Btn(stringResource(R.string.sx_attach_add), onLater, Modifier.fillMaxWidth(), Kind.Line, Icons.Plus)
                    }
                    Acc(Icons.Rupee, Colours.Green, stringResource(R.string.sx_profit)) { Profit(s, c, d) }
                }
            }
        }
    }
}

/** Profit On This Bill: the server works out what the goods cost (first in, first out); GST excluded. */
@Composable
private fun Profit(s: SaleSession, c: SaleMaths.Ctx, d: SaleMaths.Draft) {
    if (d.lines.isEmpty()) { T(stringResource(R.string.sx_add_items), size = 14.sp, colour = Colours.Text2); return }
    val key = d.lines.map { "${it.itemId}:${it.qty}:${it.unit}:${it.batchId}" } + d.date
    val cost = load(key) {
        s.server.saleCost(buildJsonObject {
            put("date", d.date)
            put("lines", JsonArray(d.lines.map { l ->
                buildJsonObject {
                    put("itemId", l.itemId); put("qty", plain(SaleMaths.stockQty(c, l)))
                    if (l.batchId != null) put("batches", JsonArray(listOf(buildJsonObject { put("batchId", l.batchId); put("qty", plain(SaleMaths.stockQty(c, l))) })))
                }
            }))
        })
    }
    val x = cost.data
    if (x == null) { if (cost.problem != null) Waiting(cost) else Loading(); return }
    val t = SaleMaths.totals(c, d)
    val spent = x.lines.fold(BigDecimal.ZERO) { a, l -> a + (l?.cost?.toBigDecimalOrNull() ?: BigDecimal.ZERO) }
    val profit = t.taxable - spent
    val rows = listOf(
        stringResource(R.string.sx_sale_value) to ("₹" + Format.inr(t.taxable) to Colours.Text),
        stringResource(R.string.sx_cost) to ("₹" + Format.inr(spent) to Colours.Text),
        stringResource(R.string.sx_profit_w) to ((if (profit.signum() < 0) "−" else "") + "₹" + Format.inr(profit.abs()) to if (profit.signum() < 0) Colours.Red else Colours.Green),
        stringResource(R.string.sx_margin) to ((if (t.taxable.signum() > 0) profit.movePointRight(2).divide(t.taxable, 1, java.math.RoundingMode.HALF_UP).toPlainString() else "0") + "%" to Colours.Text),
    )
    rows.forEach { (k, v) ->
        Row(Modifier.fillMaxWidth()) { T(k, Modifier.weight(1f), size = 14.sp, colour = Colours.Text2); T(v.first, size = 14.sp, weight = FontWeight.Bold, colour = v.second, numbers = true) }
    }
    T(stringResource(R.string.sx_profit_note), size = 12.sp, colour = Colours.Text3)
}

/** Choose Batch (design 7.4d): every batch with its expiry and stock; expired ones in red. Automatic = earliest expiry first. */
@Composable
fun BatchSheet(c: SaleMaths.Ctx, itemId: String, unit: String, chosen: String?, onClose: () -> Unit, onPick: (String?) -> Unit) {
    val hi = hindi()
    val today = Format.todayIso()
    val rows = SaleMaths.sortedBatches(c, itemId, today)
    val auto = SaleMaths.autoBatch(c, itemId, today)
    Dim(onClose) {
        Sheet(stringResource(R.string.sx_batch_title)) {
            T(stringResource(R.string.sx_batch_sub), size = 12.sp, colour = Colours.Text3)
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                BatchOpt(stringResource(R.string.sx_batch_auto), auto?.let { batchSub(it, today, hi) } ?: "", null, chosen == null, Colours.Text3) { onPick(null) }
                rows.forEach { b ->
                    val ex = SaleMaths.expired(b, today)
                    BatchOpt(batchName(b), batchSub(b, today, hi), "${Format.qty(b.qty)} ${unitWord(unit)}", chosen != null && chosen == b.id, if (ex) Colours.Red else Colours.Text3) { onPick(b.id) }
                }
            }
        }
    }
}

@Composable
fun batchName(b: StockBatch): String = if (b.id == null || b.no.isBlank()) stringResource(R.string.ip_no_batch) else stringResource(R.string.ip_batch, b.no)

@Composable
fun batchSub(b: StockBatch, today: String, hi: Boolean): String = when {
    b.expiry == null -> ""
    SaleMaths.expired(b, today) -> stringResource(R.string.sx_expired_on, Format.date(b.expiry, hi))
    else -> stringResource(R.string.sx_expiry, Format.date(b.expiry, hi))
}

@Composable
private fun BatchOpt(name: String, sub: String, qty: String?, on: Boolean, subColour: Color, onTap: () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 60.dp).background(if (on) Colours.LightBlue else Colours.Card, shape).border(1.dp, if (on) Colours.Blue else Colours.Border, shape)
            .clickable(role = Role.RadioButton, onClick = onTap).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(20.dp).border(2.dp, if (on) Colours.Blue else Colours.Text3, CircleShape).padding(4.dp).background(if (on) Colours.Blue else Colours.Card, CircleShape))
        Column(Modifier.weight(1f)) {
            T(name, weight = FontWeight.SemiBold, oneLine = true)
            if (sub.isNotBlank()) T(sub, size = 12.sp, colour = subColour)
        }
        if (qty != null) T(qty, size = 14.sp, colour = Colours.Text2, numbers = true)
    }
}

/** Last Prices (design 7.4d): what this customer paid for this item before; Use sets that final rate. */
@Composable
fun LastPricesSheet(s: SaleSession, itemId: String, itemName: String, unit: String, partyId: String?, partyName: String?, onClose: () -> Unit, onUse: (BigDecimal) -> Unit) {
    val hi = hindi()
    Dim(onClose) {
        Sheet(stringResource(R.string.sx_last), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
            if (partyId == null) {
                T(stringResource(R.string.sx_last_need), size = 14.sp, colour = Colours.Text2)
                return@Sheet
            }
            T(stringResource(R.string.sx_last_sub, partyName ?: "", itemName), size = 12.sp, colour = Colours.Text3)
            val h = load(itemId, partyId) { s.server.pastPrices(itemId, partyId) }
            val rows = h.data
            if (rows == null) { Waiting(h); return@Sheet }
            if (rows.isEmpty()) { T(stringResource(R.string.sx_last_none), Modifier.fillMaxWidth().padding(20.dp), weight = FontWeight.Bold, colour = Colours.Text3, align = TextAlign.Center); return@Sheet }
            Box(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                Grp {
                    rows.forEachIndexed { k, p ->
                        if (k > 0) Line()
                        PastRow(p, unit, hi) { onUse(finalOf(p)) }
                    }
                }
            }
        }
    }
}

/** The rate a past bill charged after its discount, to paise (web PriceHistory). */
fun finalOf(p: PastPrice): BigDecimal = BillMaths.round2(SaleMaths.num(p.price).multiply(BigDecimal.ONE - SaleMaths.num(p.discPct).movePointLeft(2)))

@Composable
private fun PastRow(p: PastPrice, unit: String, hi: Boolean, onUse: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(role = Role.Button, onClick = onUse).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f)) {
            T(stringResource(R.string.sx_per, "₹" + m2(finalOf(p)), unitWord(unit)), weight = FontWeight.SemiBold, numbers = true)
            T("${p.number} | ${Format.date(p.date, hi)}", size = 12.sp, colour = Colours.Text3)
        }
        T(stringResource(R.string.sx_use), weight = FontWeight.SemiBold, colour = Colours.Blue)
    }
}
