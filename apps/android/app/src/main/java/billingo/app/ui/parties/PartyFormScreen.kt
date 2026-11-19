package billingo.app.ui.parties

import android.Manifest
import android.app.DatePickerDialog
import android.content.Context
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import billingo.app.R
import billingo.app.data.Api
import billingo.app.data.ApiError
import billingo.app.data.Contacts
import billingo.app.data.PartyFull
import billingo.app.data.PhoneContact
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.CheckRow
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
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.SwitchRow
import billingo.app.ui.parts.T
import billingo.app.ui.parts.load
import billingo.app.ui.parts.raised
import billingo.app.ui.start.words
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Size
import kotlinx.coroutines.launch

/** The states of India for a party's GST (the same list as the web). */
val STATES = listOf(
    "01" to "Jammu & Kashmir", "02" to "Himachal Pradesh", "03" to "Punjab", "04" to "Chandigarh", "05" to "Uttarakhand",
    "06" to "Haryana", "07" to "Delhi", "08" to "Rajasthan", "09" to "Uttar Pradesh", "10" to "Bihar", "11" to "Sikkim",
    "12" to "Arunachal Pradesh", "13" to "Nagaland", "14" to "Manipur", "15" to "Mizoram", "16" to "Tripura", "17" to "Meghalaya",
    "18" to "Assam", "19" to "West Bengal", "20" to "Jharkhand", "21" to "Odisha", "22" to "Chhattisgarh", "23" to "Madhya Pradesh",
    "24" to "Gujarat", "26" to "Dadra & Nagar Haveli and Daman & Diu", "27" to "Maharashtra", "29" to "Karnataka", "30" to "Goa",
    "31" to "Lakshadweep", "32" to "Kerala", "33" to "Tamil Nadu", "34" to "Puducherry", "35" to "Andaman & Nicobar",
    "36" to "Telangana", "37" to "Andhra Pradesh", "38" to "Ladakh",
)

private fun toast(ctx: Context, text: String) = Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show()

/** Asks once for the Contacts permission, then runs [then]; if refused, says how to allow it. */
@Composable
fun rememberContactsAccess(then: () -> Unit): () -> Unit {
    val ctx = LocalContext.current
    val denied = stringResource(R.string.ct_denied)
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) then() else toast(ctx, denied) }
    return {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) then()
        else ask.launch(Manifest.permission.READ_CONTACTS)
    }
}

/**
 * New Party / Edit Party (design 7.4b): name (with Pick From Contacts), phone, group; then three
 * sections that open: GST And Address, Credit And Balance, More Details. New: Save & New and Save.
 * Edit: Delete (or Make Inactive when the party has bills) and Save Changes.
 */
@Composable
fun PartyFormScreen(api: Api, id: String?, onBack: () -> Unit, onSaved: (id: String, name: String) -> Unit, onGone: () -> Unit) {
    val ctx = LocalContext.current
    val hi = LocalConfiguration.current.locales[0].language == "hi"
    val scope = rememberCoroutineScope()
    val today = Format.todayIso()
    val before = if (id != null) load(id) { api.party(id) } else null
    val groups = load { api.partyGroups() }
    var f by rememberSaveable(stateSaver = PartyForm.saver) { mutableStateOf(PartyForm(asOf = today)) }
    var filled by rememberSaveable { mutableStateOf(id == null) }
    LaunchedEffect(before?.data) { val p = before?.data; if (p != null && !filled) { f = PartyForm.of(p); filled = true } }

    var open by rememberSaveable { mutableStateOf(setOf<Int>()) }
    var nameErr by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<ApiError?>(null) }
    var busy by remember { mutableStateOf(false) }
    var sheet by rememberSaveable { mutableStateOf("") } // "group", "newGroup", "state", "type", "contacts", "delete"
    var usage by remember { mutableStateOf<billingo.app.data.Usage?>(null) }

    val savedWord = stringResource(R.string.pf_saved, f.name.trim())
    val changed = stringResource(R.string.pf_changes_saved)
    val nameMissing = stringResource(R.string.pf_name_err)

    /** which section holds a server-named field, so it can be opened to show the problem */
    fun sectionOf(field: String?) = when {
        field == null -> -1
        field.startsWith("gst") || field == "state" || field.startsWith("billing") || field == "shipping" -> 0
        field.startsWith("opening") || field.startsWith("credit") -> 1
        field == "email" || field == "contacts" -> 2
        else -> -1
    }

    fun save(again: Boolean) {
        if (f.nameMissing) { nameErr = true; return }
        busy = true; problem = null
        scope.launch {
            try {
                val body = f.toJson(before?.data, today)
                val r = if (id == null) api.createParty(body) else api.updateParty(id, body)
                if (id != null) { toast(ctx, changed); onBack() }
                else if (again) { toast(ctx, savedWord); f = PartyForm(group = f.group, asOf = today); open = emptySet() }
                else { toast(ctx, savedWord); onSaved(r.id, r.name) }
            } catch (e: ApiError) {
                problem = e
                sectionOf(e.field).takeIf { it >= 0 }?.let { open = open + it }
            } finally { busy = false }
        }
    }

    fun errorFor(field: String) = problem?.takeIf { it.field == field }?.message

    val pickContact = rememberContactsAccess { sheet = "contacts" }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().background(Colours.Page)) {
            Box(Modifier.background(Colours.Card).statusBarsPadding()) {
                Header(stringResource(if (id == null) R.string.pf_new else R.string.pf_edit), left = { IconBtn(Icons.Close, stringResource(R.string.close), onBack) })
            }
            if (id != null && !filled) { Box(Modifier.padding(12.dp)) { Loading() }; return@Column }
            Column(
                Modifier.weight(1f).imePadding().verticalScroll(rememberScrollState()).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Field(
                    stringResource(R.string.pf_name), f.name, { f = f.copy(name = it); nameErr = false },
                    placeholder = stringResource(R.string.pf_name_ph),
                    keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                    error = if (nameErr) nameMissing else errorFor("name"),
                    trailing = { IconTap(Icons.Book, stringResource(R.string.ct_pick), pickContact, tint = Colours.Blue) },
                )
                Field(
                    stringResource(R.string.pf_phone), f.phone, { f = f.copy(phone = it) }, prefix = "+91", placeholder = "98765 43210",
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Phone), error = errorFor("phone"),
                    trailing = { IconTap(Icons.Book, stringResource(R.string.ct_pick), pickContact, tint = Colours.Blue) },
                )
                Column {
                    ChoiceField(stringResource(R.string.pf_group), f.group) { sheet = "group" }
                    LinkButton(stringResource(R.string.pf_new_group), { sheet = "newGroup" })
                }

                Section(stringResource(R.string.pf_sec_gst), 0 in open, { open = if (0 in open) open - 0 else open + 0 }) {
                    Field("GSTIN", f.gstin, { f = f.copy(gstin = it.uppercase().take(15)) }, placeholder = "09AAJPM7745Q1Z2", error = errorFor("gstin"),
                        keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Characters))
                    ChoiceField(stringResource(R.string.pf_gst_type), PartyForm.GST_TYPE_WORDS[f.gstType]) { sheet = "type" }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        ChoiceField(stringResource(R.string.pf_state), STATES.firstOrNull { it.first == f.state }?.let { "${it.first} · ${it.second}" } ?: stringResource(R.string.pf_no_state)) { sheet = "state" }
                        T(stringResource(R.string.pf_state_hint), size = 12.sp, colour = Colours.Text3)
                        errorFor("state")?.let { T(it, size = 12.sp, colour = Colours.Red) }
                    }
                    Field(stringResource(R.string.pf_address), f.address, { f = f.copy(address = it) }, placeholder = stringResource(R.string.pf_address_ph))
                    Field(stringResource(R.string.pf_city), f.city, { f = f.copy(city = it) }, keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
                    Field(stringResource(R.string.pf_pin), f.pin, { f = f.copy(pin = it.filter(Char::isDigit).take(6)) }, placeholder = "208001",
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Number), error = errorFor("billing.pin"))
                    SwitchRow(stringResource(R.string.pf_same), f.sameShipping) { f = f.copy(sameShipping = it) }
                    if (!f.sameShipping) Field(stringResource(R.string.pf_ship), f.shipping, { f = f.copy(shipping = it) }, placeholder = stringResource(R.string.pf_ship_ph))
                }

                Section(stringResource(R.string.pf_sec_credit), 1 in open, { open = if (1 in open) open - 1 else open + 1 }) {
                    Field(stringResource(R.string.pf_opening), f.opening, { f = f.copy(opening = it) }, prefix = "₹", placeholder = "0", bold = true,
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), error = errorFor("openingBalance"))
                    Seg2(
                        stringResource(R.string.pf_receive) to stringResource(R.string.pf_receive_sub),
                        stringResource(R.string.pf_pay) to stringResource(R.string.pf_pay_sub),
                        if (f.pay) 1 else 0,
                    ) { f = f.copy(pay = it == 1) }
                    DateField(stringResource(R.string.pf_asof), f.asOf, hi, "") { f = f.copy(asOf = it) }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        T(stringResource(R.string.pf_limit), colour = Colours.Text2, weight = FontWeight.SemiBold, size = 13.sp)
                        Seg2(stringResource(R.string.pf_no_limit) to null, stringResource(R.string.pf_custom_limit) to null, if (f.customLimit) 1 else 0) { f = f.copy(customLimit = it == 1) }
                    }
                    if (f.customLimit) Field(stringResource(R.string.pf_limit_amt), f.limit, { f = f.copy(limit = it) }, prefix = "₹", placeholder = "50,000", bold = true,
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal), error = errorFor("creditLimit"))
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Field(stringResource(R.string.pf_days), f.days, { f = f.copy(days = it.filter(Char::isDigit).take(3)) },
                            keyboard = KeyboardOptions(keyboardType = KeyboardType.Number), error = errorFor("creditDays"),
                            trailing = { T(stringResource(R.string.pf_days_unit), Modifier.padding(end = 10.dp), colour = Colours.Text2, weight = FontWeight.SemiBold) })
                        T(stringResource(R.string.pf_days_hint), size = 12.sp, colour = Colours.Text3)
                    }
                }

                Section(stringResource(R.string.pf_sec_more), 2 in open, { open = if (2 in open) open - 2 else open + 2 }) {
                    Field(stringResource(R.string.pf_contact), f.contactPerson, { f = f.copy(contactPerson = it) }, keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
                    Field(stringResource(R.string.pf_email), f.email, { f = f.copy(email = it.trim()) }, placeholder = "name@business.com",
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Email), error = errorFor("email"))
                    DateField(stringResource(R.string.pf_dob), f.dob, hi, stringResource(R.string.pf_choose_date)) { f = f.copy(dob = it) }
                    DateField(stringResource(R.string.pf_ann), f.anniversary, hi, stringResource(R.string.pf_choose_date)) { f = f.copy(anniversary = it) }
                    Field(stringResource(R.string.pf_transport), f.transport, { f = f.copy(transport = it) }, keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Characters))
                }
                // a refusal not tied to one field (or tied to one the form doesn't show)
                val shown = setOf("name", "phone", "gstin", "state", "billing.pin", "openingBalance", "creditLimit", "creditDays", "email")
                problem?.takeIf { it.field == null || it.field !in shown }?.let { T(words(it) ?: "", colour = Colours.Red, size = 13.sp) }
            }
            FootBar {
                if (id == null) {
                    Btn(stringResource(R.string.pf_save_new), { save(true) }, Modifier.weight(1f), Kind.Soft, busy = busy)
                    Btn(stringResource(R.string.pf_save), { save(false) }, Modifier.weight(1f), Kind.Green, Icons.Check, busy = busy)
                } else {
                    IconBtn(Icons.Trash, stringResource(R.string.pf_delete), {
                        scope.launch { try { usage = api.partyUsage(id); sheet = "delete" } catch (e: ApiError) { problem = e } }
                    }, Kind.Delete)
                    Btn(stringResource(R.string.pf_save_changes), { save(false) }, Modifier.weight(1f), Kind.Green, Icons.Check, busy = busy)
                }
            }
        }

        if (sheet.isNotEmpty()) BackHandler { sheet = "" }
        when (sheet) {
            "group" -> {
                val names = (groups.data?.map { it.name } ?: listOf("General")).let { if (f.group in it) it else it + f.group }
                ChoiceSheet(stringResource(R.string.pf_group), names, names.indexOf(f.group), { sheet = "" }) { f = f.copy(group = names[it]); sheet = "" }
            }
            "newGroup" -> NewGroupSheet({ sheet = "" }) { name: String ->
                scope.launch {
                    try { val g = api.addPartyGroup(name); groups.reload(); f = f.copy(group = g.name); sheet = "" } catch (e: ApiError) { toast(ctx, if (e.status == 0) ctx.getString(R.string.no_internet) else e.message) }
                }
            }
            "type" -> ChoiceSheet(stringResource(R.string.pf_gst_type), PartyForm.GST_TYPE_WORDS, f.gstType, { sheet = "" }) { f = f.copy(gstType = it); sheet = "" }
            "state" -> ChoiceSheet(stringResource(R.string.pf_state), STATES.map { "${it.first} · ${it.second}" }, STATES.indexOfFirst { it.first == f.state }, { sheet = "" }) { f = f.copy(state = STATES[it].first); sheet = "" }
            "contacts" -> ContactsSheet(multi = false, onClose = { sheet = "" }) { picked ->
                val c = picked.first()
                f = f.copy(name = f.name.ifBlank { c.name }, phone = c.mobile); nameErr = false; sheet = ""
            }
            "delete" -> {
                val p = before?.data
                val u = usage
                if (p != null && u != null) Dim({ sheet = "" }, centre = true) {
                    if (u.canDelete) ConfirmBox(
                        stringResource(R.string.del_q, p.name), stringResource(R.string.del_undo),
                        stringResource(R.string.keep), stringResource(R.string.pf_delete), { sheet = "" },
                        { scope.launch { try { api.deleteParty(p.id); toast(ctx, ctx.getString(R.string.deleted, p.name)); onGone() } catch (e: ApiError) { sheet = ""; problem = e } } },
                    ) else ConfirmBox(
                        stringResource(R.string.del_cant, p.name), stringResource(R.string.del_cant_text),
                        stringResource(R.string.close), stringResource(R.string.del_make_inactive), { sheet = "" },
                        { scope.launch { try { api.archiveParty(p.id, true); toast(ctx, ctx.getString(R.string.inactive_done, p.name)); onGone() } catch (e: ApiError) { sheet = ""; problem = e } } },
                        danger = false,
                    )
                }
            }
        }
    }
}

/** A section that opens and closes (.acc + .accb). */
@Composable
internal fun Section(title: String, isOpen: Boolean, onToggle: () -> Unit, content: @Composable () -> Unit) {
    val top = if (isOpen) RoundedCornerShape(topStart = Size.Radius, topEnd = Size.Radius) else RoundedCornerShape(Size.Radius)
    Column(Modifier.fillMaxWidth().raised(RoundedCornerShape(Size.Radius))) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).background(Colours.Card, top).border(1.dp, Colours.Border, top)
                .clickable(role = Role.Button, onClick = onToggle).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            T(title, Modifier.weight(1f), weight = FontWeight.Bold)
            Icon(Icons.Next, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(20.dp).rotate(if (isOpen) 90f else 0f))
        }
        if (isOpen) {
            val bottom = RoundedCornerShape(bottomStart = Size.Radius, bottomEnd = Size.Radius)
            Column(
                Modifier.fillMaxWidth().background(Colours.Card, bottom).border(1.dp, Colours.Border, bottom).padding(start = 10.dp, end = 10.dp, top = 4.dp, bottom = 14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) { content() }
        }
    }
}

/** Two choices side by side (.seg2), each with an optional small line under it. */
@Composable
internal fun Seg2(a: Pair<String, String?>, b: Pair<String, String?>, selected: Int, onSelect: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf(a, b).forEachIndexed { i, (title, sub) ->
            val on = i == selected
            val shape = RoundedCornerShape(Size.RadiusSmall)
            Column(
                Modifier.weight(1f).heightIn(min = if (sub != null) 52.dp else Size.Tap)
                    .background(if (on) Colours.LightBlue else Colours.Card, shape).border(1.dp, if (on) Colours.Blue else Colours.Border, shape)
                    .clickable(role = Role.RadioButton) { onSelect(i) }.padding(2.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                T(title, size = 14.sp, weight = FontWeight.SemiBold, colour = if (on) Colours.Blue else Colours.Text2, align = TextAlign.Center)
                if (sub != null) T(sub, size = 11.sp, colour = Colours.Text3, align = TextAlign.Center)
            }
        }
    }
}

/** A date chosen with Android's calendar; shown as "16 Nov 2026". */
@Composable
internal fun DateField(label: String, iso: String, hindi: Boolean, empty: String, onPick: (String) -> Unit) {
    val ctx = LocalContext.current
    val today = Format.todayIso()
    Box {
        Field(label, if (iso.isBlank()) "" else Format.date(iso, hindi), {}, placeholder = empty, leading = Icons.Calendar, readOnly = true)
        Box(Modifier.matchParentSize().clickable(role = Role.Button) {
            val (y, m, d) = (iso.ifBlank { today }).split("-").map { it.toInt() }
            DatePickerDialog(ctx, { _, yy, mm, dd -> onPick("%04d-%02d-%02d".format(yy, mm + 1, dd)) }, y, m - 1, d).show()
        })
    }
}

@Composable
internal fun NewGroupSheet(onClose: () -> Unit, title: String? = null, label: String? = null, placeholder: String = "Plumbers", onAdd: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    Dim(onClose) {
        Sheet(title ?: stringResource(R.string.pf_new_group).removePrefix("+ "), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
            Field(label ?: stringResource(R.string.pf_group_name), name, { name = it }, placeholder = placeholder, keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
            Btn(stringResource(R.string.pf_add), { if (name.isNotBlank()) onAdd(name.trim()) }, Modifier.fillMaxWidth(), Kind.Blue, Icons.Plus)
        }
    }
}

/**
 * Pick From Contacts (one) or Import From Contacts (tick several): the phone's contacts with a
 * mobile number, searchable by name or number.
 */
@Composable
fun ContactsSheet(multi: Boolean, busy: Boolean = false, onClose: () -> Unit, onDone: (List<PhoneContact>) -> Unit) {
    val ctx = LocalContext.current
    val all = remember { Contacts.read(ctx) }
    var q by remember { mutableStateOf("") }
    var ticked by remember { mutableStateOf(setOf<String>()) }
    Dim(onClose) {
        Sheet(stringResource(if (multi) R.string.ct_import else R.string.ct_pick), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
            T(stringResource(R.string.ct_note), size = 12.sp, colour = Colours.Text3)
            Field(null, q, { q = it }, leading = Icons.Search, placeholder = stringResource(R.string.ct_search))
            val d = q.filter(Char::isDigit)
            val shown = all.filter { q.isBlank() || it.name.contains(q.trim(), ignoreCase = true) || (d.isNotEmpty() && it.mobile.contains(d)) }
            Box(Modifier.fillMaxWidth().heightIn(max = 340.dp).border(1.dp, Colours.Border, RoundedCornerShape(Size.Radius))) {
                if (all.isEmpty()) T(stringResource(R.string.ct_empty), Modifier.padding(12.dp), size = 13.sp, colour = Colours.Text3)
                else if (shown.isEmpty()) T(stringResource(R.string.ct_none), Modifier.padding(12.dp), weight = FontWeight.Bold)
                LazyColumn {
                    items(shown, key = { it.mobile }) { c ->
                        if (multi) Box(Modifier.padding(horizontal = 12.dp)) {
                            CheckRow("${c.name}\n+91 ${PartyMaths.showPhone(c.mobile)}", c.mobile in ticked) { on -> ticked = if (on) ticked + c.mobile else ticked - c.mobile }
                        } else Column(
                            Modifier.fillMaxWidth().heightIn(min = Size.Tap).clickable(role = Role.Button) { onDone(listOf(c)) }.padding(horizontal = 12.dp, vertical = 8.dp),
                        ) {
                            T(c.name, weight = FontWeight.SemiBold, oneLine = true)
                            T("+91 " + PartyMaths.showPhone(c.mobile), size = 12.sp, colour = Colours.Text3)
                        }
                    }
                }
            }
            if (multi) {
                val n = ticked.size
                Btn(
                    if (n == 1) stringResource(R.string.ct_add_1) else stringResource(R.string.ct_add_n, n),
                    { if (n > 0) onDone(all.filter { it.mobile in ticked }) },
                    Modifier.fillMaxWidth(), if (n > 0) Kind.Blue else Kind.Line, Icons.Plus, busy = busy,
                )
            }
        }
    }
}
