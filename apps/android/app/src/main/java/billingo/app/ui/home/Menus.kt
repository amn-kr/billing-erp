package billingo.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.Update
import billingo.app.ui.parts.Badge
import billingo.app.ui.parts.BadgeKind
import billingo.app.ui.parts.ConfirmBox
import billingo.app.ui.parts.Dim
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.Spinner
import billingo.app.ui.parts.SwitchRow
import billingo.app.ui.parts.T
import billingo.app.ui.parts.TileGrid
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Colours.see
import billingo.app.ui.theme.Size

/** One menu line (.mi): icon, words on one line, an optional badge or arrow; [on] = the open screen. */
@Composable
private fun MenuLine(icon: ImageVector?, text: String, onClick: () -> Unit, on: Boolean = false, sub: Boolean = false, faint: Boolean = false, end: @Composable () -> Unit = {}) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Size.Tap)
            .background(if (on) Colours.Selected else Colours.Card)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(start = if (sub) 44.dp else 12.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = if (on) Colours.Blue else Colours.Text2, modifier = Modifier.size(20.dp))
        T(
            text,
            Modifier.weight(1f),
            size = 14.sp,
            weight = if (sub) FontWeight.Medium else FontWeight.SemiBold,
            colour = when { on -> Colours.Blue; faint -> Colours.Text3; sub -> Colours.Text2; else -> Colours.Text },
            oneLine = true,
        )
        end()
    }
}

/** A menu group that opens to show its lines (Items & Stock, Sales, Purchases, Banking & Cash). */
@Composable
private fun MenuGroup(icon: ImageVector, text: String, lines: List<String>, onLine: () -> Unit, actions: Map<Int, () -> Unit> = emptyMap()) {
    var open by rememberSaveable(text) { mutableStateOf(false) }
    MenuLine(icon, text, { open = !open }) {
        Icon(Icons.Next, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(20.dp).rotate(if (open) 90f else 0f))
    }
    if (open) lines.forEachIndexed { i, l -> MenuLine(null, l, actions[i] ?: onLine, sub = true) }
}

/**
 * The side menu (design 7.4a): the shop on navy with Change Company, then every part of the app
 * as on the web. Tapping outside closes it (owner, 17 Nov 2026). At the foot, for now: the version
 * and Check For Update (they move to Settings in 8.10).
 */
@Composable
fun SideMenu(
    company: String,
    canChange: Boolean,
    version: String,
    update: Update,
    onClose: () -> Unit,
    onChangeCompany: () -> Unit,
    onLater: () -> Unit,
    onParties: () -> Unit,
    onItems: () -> Unit,
    onGst: () -> Unit,
    onSignOut: () -> Unit,
    onCheckUpdate: () -> Unit,
    onDownload: (String) -> Unit,
    fingerprintAvailable: Boolean,
    fingerprintOn: Boolean,
    onFingerprint: (Boolean) -> Unit,
) {
    val width = (LocalConfiguration.current.screenWidthDp * 0.86f).dp
    Dim(onClose, left = true) {
        Column(
            Modifier
                .fillMaxHeight()
                .width(width)
                .widthIn(max = 330.dp)
                .background(Colours.Card)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .verticalScroll(rememberScrollState()),
        ) {
            // .smh: navy head with the shop and Change Company
            Column(Modifier.fillMaxWidth().background(Colours.Navy).statusBarsPadding().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                T(company, weight = FontWeight.Bold, colour = Colours.OnColour, oneLine = true)
                if (canChange) Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = Size.Tap)
                        .border(1.dp, see(Colours.OnColour, 0.25f), RoundedCornerShape(10.dp))
                        .clickable(role = Role.Button, onClick = onChangeCompany)
                        .padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    T(stringResource(R.string.change_company), Modifier.weight(1f), size = 13.sp, weight = FontWeight.SemiBold, colour = Colours.OnColour, oneLine = true)
                    Icon(Icons.Next, contentDescription = null, tint = Colours.OnColour, modifier = Modifier.size(20.dp))
                }
            }
            MenuLine(Icons.Bill, stringResource(R.string.m_home), onClose, on = true)
            MenuLine(Icons.User, stringResource(R.string.m_parties), onParties)
            MenuGroup(Icons.Box, stringResource(R.string.m_items_stock), listOf(stringResource(R.string.m_items), stringResource(R.string.m_prices), stringResource(R.string.m_adjust), stringResource(R.string.m_godowns)), onLater, mapOf(0 to onItems))
            MenuGroup(Icons.Bill, stringResource(R.string.m_sales), listOf(stringResource(R.string.m_quotations), stringResource(R.string.m_sale_bills), stringResource(R.string.m_challans), stringResource(R.string.m_paid_in), stringResource(R.string.m_credit_notes), stringResource(R.string.m_commission)), onLater)
            MenuGroup(Icons.Cart, stringResource(R.string.m_purchases), listOf(stringResource(R.string.m_orders), stringResource(R.string.m_purchase_bills), stringResource(R.string.m_paid_out), stringResource(R.string.m_debit_notes)), onLater)
            MenuLine(Icons.Wallet, stringResource(R.string.m_expenses), onLater)
            MenuGroup(Icons.Rupee, stringResource(R.string.m_banking), listOf(stringResource(R.string.m_banks), stringResource(R.string.m_cash), stringResource(R.string.m_cheques)), onLater)
            MenuLine(Icons.Filter, stringResource(R.string.m_reports), onLater)
            MenuLine(Icons.Bill, stringResource(R.string.m_gst), onGst, faint = true) { Badge(stringResource(R.string.soon), BadgeKind.Grey) }
            Box(Modifier.padding(horizontal = 12.dp, vertical = 6.dp).fillMaxWidth().height(1.dp).background(Colours.Border))
            MenuLine(Icons.Gear, stringResource(R.string.m_settings), onLater)
            MenuLine(Icons.Back, stringResource(R.string.sign_out), onSignOut)
            // for now here; it moves to Settings › Safety in 8.10 (design 7.4i)
            if (fingerprintAvailable) Box(Modifier.padding(horizontal = 12.dp)) {
                SwitchRow(stringResource(R.string.fingerprint_unlock), fingerprintOn, onFingerprint)
            }
            Spacer(Modifier.height(12.dp))
            VersionFoot(version, update, onCheckUpdate, onDownload)
        }
    }
}

/** "BillinGo v1.0.0" and a half-size Check For Update pill (design 7.4i, owner 18 Nov 2026). */
@Composable
private fun VersionFoot(version: String, update: Update, onCheck: () -> Unit, onDownload: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        T(stringResource(R.string.version_line, version), size = 12.sp, colour = Colours.Text3, numbers = true)
        when (update) {
            is Update.Available -> {
                T(stringResource(R.string.update_available, update.version), size = 12.sp, weight = FontWeight.SemiBold, colour = Colours.Green)
                SmallPill(stringResource(R.string.download_update), Colours.Green) { onDownload(update.download) }
            }
            Update.Checking -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Spinner(Colours.Blue, 12.dp)
                T(stringResource(R.string.checking), size = 12.sp, colour = Colours.Text3)
            }
            else -> {
                if (update == Update.Latest) T(stringResource(R.string.latest_version), size = 12.sp, colour = Colours.Text3)
                if (update is Update.Failed) T(stringResource(R.string.no_internet), size = 12.sp, colour = Colours.Red)
                SmallPill(stringResource(R.string.check_update), Colours.Blue, onCheck)
            }
        }
    }
}

/** The half-size pill of the version box: 32 dp tall, with a 44 dp tap area around it. */
@Composable
private fun SmallPill(text: String, colour: androidx.compose.ui.graphics.Color, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = Size.Tap).clickable(role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
        Box(Modifier.background(see(colour, 0.08f), RoundedCornerShape(999.dp)).border(1.dp, see(colour, 0.35f), RoundedCornerShape(999.dp)).padding(horizontal = 12.dp, vertical = 6.dp)) {
            T(text, size = 12.sp, weight = FontWeight.SemiBold, colour = colour)
        }
    }
}

/** Create New (+): twelve tiles (design 7.4a). */
@Composable
fun CreateNewSheet(onClose: () -> Unit, onTile: (Int) -> Unit) {
    Dim(onClose) {
        Sheet(stringResource(R.string.create_new), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
            TileGrid(
                listOf(
                    Icons.Bill to stringResource(R.string.t_sale_bill),
                    Icons.Bill to stringResource(R.string.t_quotation),
                    Icons.Box to stringResource(R.string.t_challan),
                    Icons.Rupee to stringResource(R.string.t_payment_in),
                    Icons.Back to stringResource(R.string.t_credit_note),
                    Icons.Cart to stringResource(R.string.t_purchase_bill),
                    Icons.Cart to stringResource(R.string.t_purchase_order),
                    Icons.Rupee to stringResource(R.string.t_payment_out),
                    Icons.Wallet to stringResource(R.string.t_expense),
                    Icons.User to stringResource(R.string.t_new_party),
                    Icons.Box to stringResource(R.string.t_new_item),
                    Icons.Next to stringResource(R.string.t_debit_note),
                ),
            ) { onTile(it) }
        }
    }
}

/** Choose Language: English or हिंदी (radio choices, design .opt). */
@Composable
fun LanguageSheet(hindi: Boolean, onClose: () -> Unit, onPick: (String) -> Unit) {
    Dim(onClose) {
        Sheet(stringResource(R.string.choose_language)) {
            listOf("en" to "English", "hi" to "हिंदी").forEach { (code, name) ->
                val on = (code == "hi") == hindi
                val shape = RoundedCornerShape(Size.Radius)
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp)
                        .background(if (on) Colours.LightBlue else Colours.Card, shape)
                        .border(1.dp, if (on) Colours.Blue else Colours.Border, shape)
                        .clickable(role = Role.RadioButton) { onPick(code) }
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(Modifier.size(20.dp).border(2.dp, if (on) Colours.Blue else Colours.Text3, CircleShape).padding(4.dp).background(if (on) Colours.Blue else Colours.Card, CircleShape))
                    T(name, weight = FontWeight.SemiBold)
                }
            }
        }
    }
}

/** Sign Out? (design 7.4a): Keep, or Sign Out in blue (signing out is not a deletion). */
@Composable
fun SignOutBox(onKeep: () -> Unit, onSignOut: () -> Unit) {
    Dim(onKeep, centre = true) {
        ConfirmBox(
            stringResource(R.string.sign_out_q),
            stringResource(R.string.sign_out_text),
            stringResource(R.string.keep),
            stringResource(R.string.sign_out),
            onKeep,
            onSignOut,
            danger = false,
        )
    }
}
