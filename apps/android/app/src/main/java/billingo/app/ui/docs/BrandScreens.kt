package billingo.app.ui.docs

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.QuoteGrid
import billingo.app.ui.parties.Frame
import billingo.app.ui.parties.Waiting
import billingo.app.ui.parts.Badge
import billingo.app.ui.parts.BadgeKind
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.Dim
import billingo.app.ui.parts.Field
import billingo.app.ui.parts.Format
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.theme.LocalFont
import billingo.app.ui.parts.SectionTitle
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.T
import billingo.app.ui.parts.load
import billingo.app.ui.sale.Grp
import billingo.app.ui.sale.Line
import billingo.app.ui.sale.SaleMaths
import billingo.app.ui.sale.shopLists
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Size
import java.math.BigDecimal
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

@Composable
private fun hindi() = LocalConfiguration.current.locales[0].language == "hi"

private fun say(ctx: Context, text: String) = Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show()
private fun why(ctx: Context, e: ApiError) = if (e.status == 0) ctx.getString(R.string.no_internet) else e.message
private fun m2(v: BigDecimal) = Format.inr(v, paise = false)
private fun plain(v: BigDecimal) = v.stripTrailingZeros().let { if (it.scale() < 0) it.setScale(0) else it }.toPlainString()

/** What a brand-wise quotation needs from the server: the shop's lists, the grid, and the shop's name. */
class BrandData(val c: SaleMaths.Ctx, val g: QuoteGrid, val shop: String)

suspend fun brandData(api: Api, features: List<String>): BrandData = coroutineScope {
    val c = async { shopLists(api, features) }; val g = async { api.quoteGrid() }; val s = async { api.shop() }
    BrandData(c.await(), g.await(), s.await().name.ifBlank { "My Business" })
}

/** The brand totals as a message on WhatsApp (the web's quoteWhatsApp); Share when WhatsApp isn't there. */
fun shareText(ctx: Context, text: String) {
    val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
    for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
        try { ctx.startActivity(Intent(send).setPackage(pkg)); return } catch (_: ActivityNotFoundException) {}
    }
    try { ctx.startActivity(Intent.createChooser(send, ctx.getString(R.string.pdf_no_wa))) } catch (_: ActivityNotFoundException) { say(ctx, ctx.getString(R.string.pdf_no_app)) }
}

/** One brand's total (.bqt): its name, all available or how many aren't, the discount, the amount; the first is Lowest (green). */
@Composable
internal fun BrandTotalRow(t: BrandMaths.Total, lowest: Boolean) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier.fillMaxWidth().background(if (lowest) Colours.LightGreen else Colours.Card, shape).border(1.dp, if (lowest) Colours.Green else Colours.Border, shape).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f)) {
            T(BrandMaths.serName(t.s), weight = FontWeight.SemiBold, oneLine = true)
            Row {
                if (t.miss > 0) T(stringResource(R.string.bq_missing, t.miss), size = 12.sp, colour = Colours.Red)
                else T(stringResource(R.string.bq_all), size = 12.sp, colour = Colours.Text3)
                if (t.dis.signum() > 0) T(" · " + stringResource(R.string.bq_disc_amt, m2(t.dis)), size = 12.sp, colour = Colours.Text3)
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            T(m2(t.total), weight = FontWeight.Bold, numbers = true, oneLine = true)
            if (lowest) Badge(stringResource(R.string.bq_lowest), BadgeKind.Paid)
        }
    }
}

/** The quantity of a row (.stp): − typed number +; − at 1 empties it. */
@Composable
private fun QtyStepper(value: BigDecimal?, onChange: (BigDecimal?) -> Unit) {
    val shape = RoundedCornerShape(Size.RadiusSmall)
    var text by remember(value) { mutableStateOf(value?.let(::plain).orEmpty()) }
    Row(Modifier.width(118.dp).heightIn(min = Size.Tap).background(Colours.Card, shape).border(1.dp, Colours.Border, shape), verticalAlignment = Alignment.CenterVertically) {
        val q = value ?: BigDecimal.ZERO
        Box(Modifier.width(38.dp).heightIn(min = Size.Tap).background(Colours.Page).clickable(role = Role.Button) { onChange((q - BigDecimal.ONE).takeIf { it.signum() > 0 }) }.semantics { contentDescription = "Less" }, contentAlignment = Alignment.Center) {
            T("−", size = 20.sp, weight = FontWeight.SemiBold, colour = Colours.Blue)
        }
        BasicTextField(
            text, { v -> val t = v.filter { it.isDigit() || it == '.' }.take(8); text = t; onChange(t.toBigDecimalOrNull()?.takeIf { it.signum() > 0 }) },
            Modifier.weight(1f).semantics { contentDescription = "Quantity" }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            textStyle = TextStyle(fontFamily = LocalFont.current, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Colours.Text, textAlign = TextAlign.Center),
            cursorBrush = SolidColor(Colours.Blue),
            decorationBox = { inner -> Box(contentAlignment = Alignment.Center) { if (text.isEmpty()) T("0", size = 16.sp, weight = FontWeight.Bold, colour = Colours.Text3); inner() } },
        )
        Box(Modifier.width(38.dp).heightIn(min = Size.Tap).background(Colours.Page).clickable(role = Role.Button) { onChange(q + BigDecimal.ONE) }.semantics { contentDescription = "More" }, contentAlignment = Alignment.Center) {
            T("+", size = 20.sp, weight = FontWeight.SemiBold, colour = Colours.Blue)
        }
    }
}

/** A brand range to tick (.tagb, .on when chosen). */
@Composable
private fun RangeTag(text: String, on: Boolean, onTap: () -> Unit) {
    val shape = RoundedCornerShape(999.dp)
    Box(
        Modifier.heightIn(min = Size.Tap).widthIn(max = 320.dp).background(if (on) Colours.LightBlue else Colours.Card, shape).border(1.dp, if (on) Colours.Selected else Colours.Border, shape)
            .clickable(role = Role.Checkbox, onClick = onTap).padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { T((if (on) "✓ " else "") + text, size = 13.sp, weight = FontWeight.SemiBold, colour = if (on) Colours.Blue else Colours.Text2, oneLine = true) }
}

/** The customer of a brand-wise quotation: type a name, or pick a party (its name is used, as on the web). */
@Composable
private fun CustomerSheet(c: SaleMaths.Ctx, start: String, onClose: () -> Unit, onPick: (String) -> Unit) {
    var q by remember { mutableStateOf(start) }
    Dim(onClose) {
        Sheet(stringResource(R.string.sl_choose_customer)) {
            Field(null, q, { q = it.take(120) }, Modifier.fillMaxWidth(), placeholder = stringResource(R.string.bq_cust_ph), leading = Icons.User)
            val t = q.trim().lowercase()
            val hits = c.parties.filter { t.isEmpty() || it.name.lowercase().contains(t) }.sortedBy { it.name.lowercase() }.take(8)
            Grp {
                hits.forEachIndexed { k, p ->
                    if (k > 0) Line()
                    Row(Modifier.fillMaxWidth().heightIn(min = Size.Tap).clickable(role = Role.Button) { onPick(p.name) }.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        T(p.name, Modifier.weight(1f), oneLine = true)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Btn(stringResource(R.string.bq_no_cust), { onPick("") }, Modifier.weight(1f), Kind.Line)
                Btn(stringResource(R.string.bq_use_name), { onPick(q.trim()) }, Modifier.weight(1f), Kind.Blue)
            }
        }
    }
}

/**
 * Brand-Wise Quotation (design 7.4e qbrand): the number and date, the customer, the brand ranges to
 * compare, a quantity for each item row (with the brands that have it), a discount %, and every
 * range's total, best first (all items, then cheapest; the first is Lowest). Share sends the totals on
 * WhatsApp; Save keeps it (a saved one asks for the passcode when the shop has it on).
 * [id] opens a saved one to change; [copyOf] starts a new one from a saved one.
 */
@Composable
fun BrandQuoteScreen(api: Api, features: List<String>, id: String?, copyOf: String?, onBack: () -> Unit, onSaved: (id: String, number: String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val hi = hindi()
    val today = Format.todayIso()
    val data = load(id, copyOf) { brandData(api, features) }
    val start = load(id, copyOf) {
        val src = id ?: copyOf
        if (src == null) null else api.saleDoc(src)
    }
    val next = load { api.nextSaleNumber(today, "quotation").number }
    var draft by remember(id, copyOf) { mutableStateOf<BrandMaths.Draft?>(null) }
    var discText by remember(id, copyOf) { mutableStateOf("") }
    var cust by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var pass by remember { mutableStateOf(false) }
    var passErr by remember { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    var leave by remember { mutableStateOf(false) }

    val b = data.data
    val loaded = start.data
    if (b != null && draft == null && !start.loading && start.problem == null) {
        val src = id ?: copyOf
        draft = when {
            src == null -> BrandMaths.Draft(date = today, sel = b.g.ser.map { it.id })
            loaded == null -> null
            id != null -> BrandMaths.fromSaved(b.g, loaded)
            else -> BrandMaths.fromSaved(b.g, loaded).copy(id = null, no = "", date = today)
        }
        draft?.let { discText = if (it.disc.signum() > 0) plain(it.disc) else "" }
    }
    val d = draft
    val no = d?.no?.takeIf { it.isNotBlank() } ?: next.data.orEmpty()

    fun save(passcode: String?) {
        val dd = draft ?: return
        val bb = data.data ?: return
        if (dd.qty.none { it.value.signum() > 0 }) { say(ctx, ctx.getString(R.string.bq_need_qty)); return }
        busy = true
        scope.launch {
            try {
                val r = api.saveBrandQuote(BrandMaths.body(bb.c, bb.g, dd.copy(date = if (dd.id == null) today else dd.date)), dd.id, passcode)
                pass = false
                onSaved(r.id, r.number)
            } catch (e: ApiError) {
                if (e.code == Api.PASSCODE && dd.id != null) { passErr = if (passcode == null) null else e.message; if (passcode != null) tries++; pass = true }
                else say(ctx, why(ctx, e))
            } finally { busy = false }
        }
    }

    val close = { if (d != null && d.qty.isNotEmpty()) leave = true else onBack() }
    Box(Modifier.fillMaxSize()) {
        Frame(stringResource(R.string.bq_title), onBack = close, foot = if (d == null || b == null) null else ({
            Btn(stringResource(R.string.dv_share), {
                val m = BrandMaths.message(b.c, b.g, d.copy(no = no), b.shop, BrandMaths.gstOn(b.c)) { Format.inr(it) }
                if (m == null) say(ctx, ctx.getString(R.string.bq_need_qty)) else shareText(ctx, m)
            }, Modifier.weight(1f), Kind.Soft, Icons.Chat)
            Btn(stringResource(R.string.sl_save), { save(null) }, Modifier.weight(1f), Kind.Green, Icons.Check, busy = busy)
        })) {
            if (b == null || d == null) { Waiting(if (data.problem != null) data else start); return@Frame }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                // the number strip (.invs): shown, never typed (owner, 18 Nov 2026)
                Column(Modifier.fillMaxWidth().background(Colours.Card, RoundedCornerShape(Size.Radius)).border(1.dp, Colours.Border, RoundedCornerShape(Size.Radius)).padding(horizontal = 12.dp, vertical = 6.dp)) {
                    T(stringResource(R.string.qt_no), size = 11.5.sp, weight = FontWeight.SemiBold, colour = Colours.Text3, oneLine = true)
                    T(no.ifBlank { "…" } + " · " + Format.date(d.date, hi), size = 14.sp, weight = FontWeight.Bold, oneLine = true)
                }
                // the customer (.pfield)
                val shape = RoundedCornerShape(Size.RadiusSmall)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = Size.Tap).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).clickable(role = Role.Button) { cust = true }.padding(horizontal = 10.dp)
                        .semantics { contentDescription = "Customer" },
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.User, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(18.dp))
                    if (d.cust.isNotBlank()) T(d.cust, Modifier.weight(1f), oneLine = true)
                    else T(stringResource(R.string.sl_choose_customer), Modifier.weight(1f), colour = Colours.Text3, oneLine = true)
                }
                SectionTitle(stringResource(R.string.bq_ranges))
                @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    b.g.ser.forEach { s ->
                        val on = s.id in d.sel
                        RangeTag(BrandMaths.serName(s), on) { draft = d.copy(sel = if (on) d.sel - s.id else b.g.ser.map { it.id }.filter { it in d.sel || it == s.id }) }
                    }
                }
                SectionTitle(stringResource(R.string.bq_qty))
                Grp {
                    b.g.rows.forEachIndexed { k, r ->
                        if (k > 0) Line()
                        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Column(Modifier.weight(1f)) {
                                T(r.n, oneLine = true)
                                val in_ = BrandMaths.brandsFor(b.c, b.g, r)
                                T(if (in_.isEmpty()) stringResource(R.string.bq_in_none) else stringResource(R.string.bq_in, in_.joinToString(", ")), size = 12.sp, colour = Colours.Text3)
                            }
                            QtyStepper(d.qty[r.id]) { v -> draft = d.copy(qty = if (v == null) d.qty - r.id else d.qty + (r.id to v)) }
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Field(stringResource(R.string.bq_disc), discText, { v ->
                        val t = v.filter { it.isDigit() || it == '.' }.take(5)
                        discText = t
                        draft = d.copy(disc = (t.toBigDecimalOrNull() ?: BigDecimal.ZERO).min(BigDecimal(100)))
                    }, Modifier.weight(1f), keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), placeholder = "0", trailing = { T("%", colour = Colours.Text3, modifier = Modifier.padding(end = 12.dp)) })
                    Box(Modifier.weight(1f))
                }
                SectionTitle(stringResource(R.string.bq_totals))
                if (d.qty.none { it.value.signum() > 0 }) T(stringResource(R.string.bq_enter_qty), size = 12.sp, colour = Colours.Text3)
                else BrandMaths.ranked(BrandMaths.totals(b.c, b.g, d)).forEachIndexed { i, t -> BrandTotalRow(t, i == 0) }
            }
        }
        if (cust && b != null && d != null) {
            BackHandler { cust = false }
            CustomerSheet(b.c, d.cust, { cust = false }) { name -> draft = d.copy(cust = name); cust = false }
        }
        if (leave) {
            BackHandler { leave = false }
            Dim({ leave = false }, centre = true) {
                billingo.app.ui.parts.ConfirmBox(
                    stringResource(if (d?.id != null) R.string.eb_leave_q else R.string.qt_discard_q), stringResource(R.string.bq_leave_t),
                    stringResource(R.string.keep), stringResource(if (d?.id != null) R.string.eb_leave else R.string.sl_discard), { leave = false }, { leave = false; onBack() },
                )
            }
        }
        if (pass && d != null) {
            BackHandler { pass = false }
            PasscodeSheet(stringResource(R.string.eb_pass_t, d.no), stringResource(R.string.bq_pass_text), passErr, tries, busy, { pass = false; passErr = null }) { save(it) }
        }
    }
}

/** Convert To Bill (design 7.4e qconv): choose the brand the customer wants; best first, Lowest marked, items not available said. */
@Composable
fun BrandConvertSheet(ranked: List<BrandMaths.Total>, onClose: () -> Unit, onPick: (BrandMaths.Total) -> Unit) {
    Dim(onClose) {
        Sheet(stringResource(R.string.qt_convert)) {
            T(stringResource(R.string.bq_conv_text), size = 13.sp, colour = Colours.Text2)
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                ranked.forEachIndexed { i, t ->
                    val shape = RoundedCornerShape(Size.Radius)
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 60.dp).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).clickable(role = Role.Button) { onPick(t) }.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            T(BrandMaths.serName(t.s), weight = FontWeight.SemiBold, oneLine = true)
                            when {
                                t.miss == 1 -> T(stringResource(R.string.bq_left_1), size = 12.sp, colour = Colours.Red)
                                t.miss > 1 -> T(stringResource(R.string.bq_left_n, t.miss), size = 12.sp, colour = Colours.Red)
                                else -> T(stringResource(R.string.bq_all), size = 12.sp, colour = Colours.Text3)
                            }
                        }
                        T(m2(t.total), weight = FontWeight.Bold, numbers = true, oneLine = true)
                        if (i == 0) Badge(stringResource(R.string.bq_lowest), BadgeKind.Paid)
                    }
                }
            }
        }
    }
}

/** A saved brand-wise quotation's own part of its page: its rows and quantities, then every brand's total (design qview). */
@Composable
internal fun BrandBody(b: BrandData, d: BrandMaths.Draft) {
    SectionTitle(stringResource(R.string.bq_items_qty))
    Grp {
        b.g.rows.filter { (d.qty[it.id] ?: BigDecimal.ZERO).signum() > 0 }.forEachIndexed { k, r ->
            if (k > 0) Line()
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                T(r.n, Modifier.weight(1f), oneLine = true)
                T(stringResource(R.string.bq_pcs, plain(d.qty.getValue(r.id))), weight = FontWeight.Bold, numbers = true)
            }
        }
    }
    SectionTitle(stringResource(R.string.bq_totals) + if (d.disc.signum() > 0) " · " + stringResource(R.string.bq_disc_pct, plain(d.disc)) else "")
    BrandMaths.ranked(BrandMaths.totals(b.c, b.g, d)).forEachIndexed { i, t -> BrandTotalRow(t, i == 0) }
}
