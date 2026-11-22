package billingo.app.ui.items

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.Usage
import billingo.app.ui.home.unitWord
import billingo.app.ui.parties.DateField
import billingo.app.ui.parties.NewGroupSheet
import billingo.app.ui.parties.Section
import billingo.app.ui.parties.Seg2
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
import billingo.app.ui.parts.IconTap
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.LinkButton
import billingo.app.ui.parts.Loading
import billingo.app.ui.parts.SwitchRow
import billingo.app.ui.parts.T
import billingo.app.ui.parts.load
import billingo.app.ui.start.words
import billingo.app.ui.theme.Colours
import kotlinx.coroutines.launch

/**
 * New Item / Edit Item (design 7.4c): Product or Service, Single or Variant (parent item and
 * series), name, brand, category, code (scan or Assign Code), unit, pack and loose; then Pricing,
 * Tax and Stock sections. New: Save & New and Save. Edit: Delete (or Make Inactive) and Save Changes.
 * [features]: the shop's Settings › Items switches (pack_loose, batch_no).
 */
@Composable
fun ItemFormScreen(api: Api, id: String?, startCode: String, features: List<String>, onBack: () -> Unit, onSaved: (id: String, name: String) -> Unit, onGone: () -> Unit) {
    val ctx = LocalContext.current
    val hi = LocalConfiguration.current.locales[0].language == "hi"
    val scope = rememberCoroutineScope()
    val today = Format.todayIso()
    val packOn = "pack_loose" in features
    val batchOn = "batch_no" in features
    val before = if (id != null) load(id) { api.item(id) } else null
    val cat = load { api.catalogue() }
    val nextCode = if (id == null) load { api.nextItemCode() } else null
    var f by rememberSaveable(stateSaver = ItemForm.saver) { mutableStateOf(ItemForm(code = startCode)) }
    var filled by rememberSaveable { mutableStateOf(id == null) }
    LaunchedEffect(before?.data) { val d = before?.data; if (d != null && !filled) { f = ItemForm.of(d); filled = true } }

    var open by rememberSaveable { mutableStateOf(setOf(0)) }
    val scroll = rememberScrollState()
    var missing by remember { mutableStateOf<ItemForm.Missing?>(null) }
    var problem by remember { mutableStateOf<ApiError?>(null) }
    var busy by remember { mutableStateOf(false) }
    var sheet by rememberSaveable { mutableStateOf("") }
    var usage by remember { mutableStateOf<Usage?>(null) }

    fun errorFor(field: String) = problem?.takeIf { it.field == field }?.message
    fun sectionOf(field: String?) = when (field) {
        "sale", "purchase", "mrp", "wholesale", "wholesaleMinQty" -> 0
        "gstRate", "hsn" -> 1
        "openingQty", "openingRate", "minStock", "location", "openingBatchNo", "openingExpiry" -> 2
        else -> -1
    }

    fun save(again: Boolean) {
        missing = f.missing
        // a refused save shows its reason where the eye is: the top fields, or the note at the end
        if (missing != null) { scope.launch { scroll.animateScrollTo(0) }; return }
        busy = true; problem = null
        scope.launch {
            try {
                val body = f.toJson(editing = id != null, packOn = packOn, batchOn = batchOn, today = today)
                val r = if (id == null) api.createItem(body) else api.updateItem(id, body)
                Toast.makeText(ctx, ctx.getString(R.string.if_saved, r.name), Toast.LENGTH_SHORT).show()
                when {
                    id != null -> onBack()
                    again -> {
                        // a new variant keeps its parent, brand and shared details for the next one
                        f = if (f.variant) f.copy(series = "", code = "", openingQty = "", batchNo = "", expiry = "") else ItemForm(service = f.service, unit = f.unit, gst = f.gst)
                        nextCode?.reload()
                    }
                    else -> onSaved(r.id, r.name)
                }
            } catch (e: ApiError) {
                problem = e
                sectionOf(e.field).takeIf { it >= 0 }?.let { open = open + it }
                when (e.field) {
                    "name", "code", "packSize" -> scroll.animateScrollTo(0)
                    null -> scroll.animateScrollTo(scroll.maxValue)
                    else -> {}
                }
            } finally { busy = false }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().background(Colours.Page)) {
            Box(Modifier.background(Colours.Card).statusBarsPadding()) {
                Header(stringResource(if (id == null) R.string.if_new else R.string.if_edit), left = { IconBtn(Icons.Close, stringResource(R.string.close), onBack) })
            }
            if (id != null && !filled) { Box(Modifier.padding(12.dp)) { Loading() }; return@Column }
            Column(Modifier.weight(1f).imePadding().verticalScroll(scroll).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) { Seg2(stringResource(R.string.if_product) to null, stringResource(R.string.if_service) to null, if (f.service) 1 else 0) { f = f.copy(service = it == 1, variant = if (it == 1) false else f.variant) } }
                    if (!f.service) Box(Modifier.weight(1f)) { Seg2(stringResource(R.string.if_single) to null, stringResource(R.string.if_variant) to null, if (f.variant) 1 else 0) { f = f.copy(variant = it == 1) } }
                }
                if (f.variant) {
                    Column {
                        ChoiceField(stringResource(R.string.if_parent), f.parent.ifBlank { stringResource(R.string.if_choose_parent) }) { sheet = "parent" }
                        if (missing == ItemForm.Missing.Parent) T(stringResource(R.string.if_parent_err), size = 12.sp, colour = Colours.Red)
                        LinkButton(stringResource(R.string.if_new_parent), { sheet = "newParent" })
                    }
                    Field(stringResource(R.string.if_series), f.series, { f = f.copy(series = it); missing = null }, placeholder = stringResource(R.string.if_series_ph),
                        keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words), error = if (missing == ItemForm.Missing.Series) stringResource(R.string.if_series_err) else null)
                } else {
                    Field(stringResource(R.string.if_name), f.name, { f = f.copy(name = it); missing = null }, placeholder = stringResource(R.string.if_name_ph),
                        keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                        error = if (missing == ItemForm.Missing.Name) stringResource(R.string.if_name_err) else errorFor("name"))
                }
                if (!f.service) Column {
                    ChoiceField(stringResource(R.string.if_brand), f.brand.ifBlank { stringResource(R.string.if_none) }) { sheet = "brand" }
                    LinkButton(stringResource(R.string.if_add_brand), { sheet = "newBrand" })
                }
                if (f.variant && f.parent.isNotBlank()) {
                    T(stringResource(R.string.if_will_be, f.fullName), size = 12.sp, colour = Colours.Text3)
                    errorFor("name")?.let { T(it, size = 12.sp, colour = Colours.Red) }
                }
                Column {
                    ChoiceField(stringResource(R.string.if_category), f.category.ifBlank { stringResource(R.string.if_no_category) }) { sheet = "category" }
                    LinkButton(stringResource(R.string.if_add_category), { sheet = "newCategory" })
                }
                Column {
                    Field(stringResource(R.string.if_code), f.code, { f = f.copy(code = it) }, placeholder = stringResource(R.string.if_code_ph), error = errorFor("code"),
                        trailing = { IconTap(Icons.Scan, stringResource(R.string.sc_title), { sheet = "scan" }, tint = Colours.Blue) })
                    nextCode?.data?.code?.let { c -> if (f.code.isBlank()) LinkButton(stringResource(R.string.if_assign, c), { f = f.copy(code = c) }) }
                }
                ChoiceField(stringResource(R.string.if_unit), unitWord(f.unit)) { sheet = "unit" }
                if (packOn && !f.service) {
                    SwitchRow(stringResource(R.string.if_pack), f.pack) { f = f.copy(pack = it) }
                    if (f.pack) {
                        ChoiceField(stringResource(R.string.if_pack_unit), unitWord(f.packUnit)) { sheet = "packUnit" }
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Field(stringResource(R.string.if_pack_size), f.packSize, { f = f.copy(packSize = it) }, placeholder = "10", keyboard = KeyboardOptions(keyboardType = KeyboardType.Number), error = errorFor("packSize"))
                            T(stringResource(R.string.if_pack_hint), size = 12.sp, colour = Colours.Text3)
                        }
                    }
                }

                Section(stringResource(R.string.if_sec_price), 0 in open, { open = if (0 in open) open - 0 else open + 0 }) {
                    Field(stringResource(R.string.if_sale), f.sale, { f = f.copy(sale = it) }, prefix = "₹", placeholder = "0.00", bold = true, keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), error = errorFor("sale"))
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Field(stringResource(R.string.if_purchase), f.purchase, { f = f.copy(purchase = it) }, prefix = "₹", placeholder = "0.00", bold = true, keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), error = errorFor("purchase"))
                        f.margin()?.let { (m, pct) -> T(stringResource(R.string.if_margin, rupees(m), pct.toPlainString()), size = 12.sp, colour = if (m.signum() < 0) Colours.Red else Colours.Text3) }
                    }
                    Field("MRP", f.mrp, { f = f.copy(mrp = it) }, prefix = "₹", placeholder = stringResource(R.string.if_optional), keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), error = errorFor("mrp"))
                    if (!f.service) {
                        Field(stringResource(R.string.if_wholesale), f.wholesale, { f = f.copy(wholesale = it) }, prefix = "₹", placeholder = stringResource(R.string.if_optional), keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), error = errorFor("wholesale"))
                        Field(stringResource(R.string.if_wholesale_qty), f.wholesaleQty, { f = f.copy(wholesaleQty = it) }, placeholder = "10", keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), error = errorFor("wholesaleMinQty"))
                    }
                }
                Section(stringResource(R.string.if_sec_tax), 1 in open, { open = if (1 in open) open - 1 else open + 1 }) {
                    ChoiceField(stringResource(R.string.if_gst), if (f.gst == 0) stringResource(R.string.if_gst_none) else "GST ${f.gst}%") { sheet = "gst" }
                    Field("HSN / SAC", f.hsn, { f = f.copy(hsn = it.filter(Char::isDigit).take(8)) }, placeholder = stringResource(R.string.if_hsn_ph), keyboard = KeyboardOptions(keyboardType = KeyboardType.Number), error = errorFor("hsn"))
                }
                if (!f.service) Section(stringResource(R.string.if_sec_stock), 2 in open, { open = if (2 in open) open - 2 else open + 2 }) {
                    if (id == null) {
                        Field(stringResource(R.string.if_opening), f.openingQty, { f = f.copy(openingQty = it) }, placeholder = "0", bold = true, keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), error = errorFor("openingQty"),
                            trailing = { T(unitWord(f.unit), Modifier.padding(end = 10.dp), colour = Colours.Text2, weight = FontWeight.SemiBold) })
                        Field(stringResource(R.string.if_at_price), f.openingRate, { f = f.copy(openingRate = it) }, prefix = "₹", placeholder = stringResource(R.string.if_purchase), keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), error = errorFor("openingRate"))
                    } else T(stringResource(R.string.if_opening_note), size = 12.sp, colour = Colours.Text3)
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Field(stringResource(R.string.if_min), f.minStock, { f = f.copy(minStock = it) }, placeholder = "20", keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), error = errorFor("minStock"))
                        T(stringResource(R.string.if_min_hint), size = 12.sp, colour = Colours.Text3)
                    }
                    if (batchOn && id == null) {
                        Field(stringResource(R.string.aj_batch), f.batchNo, { f = f.copy(batchNo = it) }, placeholder = stringResource(R.string.aj_batch_ph), error = errorFor("openingBatchNo"))
                        DateField(stringResource(R.string.if_expiry), f.expiry, hi, stringResource(R.string.pf_choose_date)) { f = f.copy(expiry = it) }
                    }
                    Field(stringResource(R.string.if_location), f.location, { f = f.copy(location = it) }, placeholder = stringResource(R.string.if_location_ph))
                }
                val shown = setOf("name", "code", "sale", "purchase", "mrp", "wholesale", "wholesaleMinQty", "hsn", "openingQty", "openingRate", "minStock", "packSize", "openingBatchNo")
                problem?.takeIf { it.field == null || it.field !in shown }?.let { T(words(it) ?: "", colour = Colours.Red, size = 13.sp) }
            }
            FootBar {
                if (id == null) {
                    Btn(stringResource(R.string.pf_save_new), { save(true) }, Modifier.weight(1f), Kind.Soft, busy = busy)
                    Btn(stringResource(R.string.pf_save), { save(false) }, Modifier.weight(1f), Kind.Green, Icons.Check, busy = busy)
                } else {
                    IconBtn(Icons.Trash, stringResource(R.string.if_delete), {
                        scope.launch { try { usage = api.itemUsage(id); sheet = "delete" } catch (e: ApiError) { problem = e } }
                    }, Kind.Delete)
                    Btn(stringResource(R.string.pf_save_changes), { save(false) }, Modifier.weight(1f), Kind.Green, Icons.Check, busy = busy)
                }
            }
        }

        if (sheet.isNotEmpty()) BackHandler { sheet = "" }
        val c = cat.data
        fun toast(e: ApiError) = Toast.makeText(ctx, if (e.status == 0) ctx.getString(R.string.no_internet) else e.message, Toast.LENGTH_SHORT).show()
        when (sheet) {
            "parent" -> {
                val names = c?.groups?.map { it.name }.orEmpty()
                ChoiceSheet(stringResource(R.string.if_parent).removeSuffix(" *"), names, names.indexOf(f.parent), { sheet = "" }) { f = f.copy(parent = names[it]); missing = null; sheet = "" }
            }
            "newParent" -> NewGroupSheet({ sheet = "" }, stringResource(R.string.if_new_parent).removePrefix("+ "), stringResource(R.string.if_parent_name), "Steel Bottle") { n -> f = f.copy(parent = n); missing = null; sheet = "" }
            "brand" -> {
                val names = listOf(stringResource(R.string.if_none)) + c?.brands?.map { it.name }.orEmpty()
                ChoiceSheet(stringResource(R.string.if_brand), names, if (f.brand.isBlank()) 0 else names.indexOf(f.brand), { sheet = "" }) { f = f.copy(brand = if (it == 0) "" else names[it]); sheet = "" }
            }
            "newBrand" -> NewGroupSheet({ sheet = "" }, stringResource(R.string.if_add_brand).removePrefix("+ "), stringResource(R.string.if_brand_name), "Tata") { n ->
                scope.launch { try { val b = api.addBrand(n); cat.reload(); f = f.copy(brand = b.name); sheet = "" } catch (e: ApiError) { toast(e) } }
            }
            "category" -> {
                val names = listOf(stringResource(R.string.if_no_category)) + c?.categories?.map { it.name }.orEmpty()
                ChoiceSheet(stringResource(R.string.if_category), names, if (f.category.isBlank()) 0 else names.indexOf(f.category), { sheet = "" }) { f = f.copy(category = if (it == 0) "" else names[it]); sheet = "" }
            }
            "newCategory" -> NewGroupSheet({ sheet = "" }, stringResource(R.string.if_add_category).removePrefix("+ "), stringResource(R.string.if_category_name), "Grocery") { n ->
                scope.launch { try { val g = api.addCategory(n); cat.reload(); f = f.copy(category = g.name); sheet = "" } catch (e: ApiError) { toast(e) } }
            }
            "unit", "packUnit" -> {
                val codes = (c?.units?.map { it.code }.orEmpty().ifEmpty { listOf("PCS", "BOX", "ROLL", "MTR", "KG") })
                val cur = if (sheet == "unit") f.unit else f.packUnit
                ChoiceSheet(stringResource(if (sheet == "unit") R.string.if_unit else R.string.if_pack_unit), codes.map(::unitWord), codes.indexOfFirst { it.equals(cur, true) }, { sheet = "" }) {
                    f = if (sheet == "unit") f.copy(unit = codes[it]) else f.copy(packUnit = codes[it]); sheet = ""
                }
            }
            "gst" -> ChoiceSheet(stringResource(R.string.if_gst), ItemForm.GST_RATES.map { if (it == 0) ctx.getString(R.string.if_gst_none) else "GST $it%" }, ItemForm.GST_RATES.indexOf(f.gst), { sheet = "" }) { f = f.copy(gst = ItemForm.GST_RATES[it]); sheet = "" }
            "scan" -> ScanScreen({ sheet = "" }) { code -> f = f.copy(code = code); sheet = "" }
            "delete" -> {
                val d = before?.data
                val u = usage
                if (d != null && u != null) Dim({ sheet = "" }, centre = true) {
                    if (u.canDelete) ConfirmBox(
                        stringResource(R.string.del_q, d.name), stringResource(R.string.del_undo), stringResource(R.string.keep), stringResource(R.string.if_delete), { sheet = "" },
                        { scope.launch { try { api.deleteItem(d.id); Toast.makeText(ctx, ctx.getString(R.string.deleted, d.name), Toast.LENGTH_SHORT).show(); onGone() } catch (e: ApiError) { sheet = ""; problem = e } } },
                    ) else ConfirmBox(
                        stringResource(R.string.del_cant, d.name), stringResource(R.string.idel_cant_text), stringResource(R.string.close), stringResource(R.string.del_make_inactive), { sheet = "" },
                        { scope.launch { try { api.archiveItem(d.id); Toast.makeText(ctx, ctx.getString(R.string.inactive_done, d.name), Toast.LENGTH_SHORT).show(); onGone() } catch (e: ApiError) { sheet = ""; problem = e } } },
                        danger = false,
                    )
                }
            }
        }
    }
}
