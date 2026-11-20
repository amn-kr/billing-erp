package billingo.app.ui.start

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.data.ApiError
import billingo.app.data.AppModel
import billingo.app.data.Me
import billingo.app.data.Membership
import billingo.app.ui.parts.Badge
import billingo.app.ui.parts.BadgeKind
import billingo.app.ui.parts.BoxCard
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.Format
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.LinkButton
import billingo.app.ui.parts.Logo
import billingo.app.ui.parts.Spinner
import billingo.app.ui.parts.SwitchRow
import billingo.app.ui.parts.T
import billingo.app.ui.parts.TopBar
import billingo.app.ui.parts.raised
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Colours.see
import billingo.app.ui.theme.Size

/** A refusal in words: the phone's own in English or Hindi, the server's as it sent them. */
@Composable
fun words(e: ApiError?): String? = when {
    e == null -> null
    e.status == 0 -> stringResource(R.string.no_internet)
    e.code == AppModel.NEED_EMAIL -> stringResource(R.string.need_email)
    e.code == AppModel.NEED_PASSWORD -> stringResource(R.string.need_password)
    e.code == AppModel.OWNER_ACCOUNT -> stringResource(R.string.owner_account)
    else -> e.message
}

@Composable
private fun hindi() = LocalConfiguration.current.locales[0].language == "hi"

/** Opening: the logo while the sign-in is renewed; if the server can't be reached, why, and Try Again. */
@Composable
fun StartingScreen(problem: ApiError?, onRetry: () -> Unit, onSignIn: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Colours.Page).systemBarsPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Logo(size = 72.dp, corner = 22.dp, letter = 32f)
        if (problem == null) {
            Spinner(Colours.Blue, 24.dp)
            T(stringResource(R.string.connecting), colour = Colours.Text2, size = 13.sp)
        } else {
            T(words(problem) ?: "", colour = Colours.Red, align = TextAlign.Center)
            Btn(stringResource(R.string.try_again), onRetry, Modifier.fillMaxWidth(), pill = true)
            LinkButton(stringResource(R.string.sign_in_password), onSignIn)
        }
    }
}

/** Choose Company (design 7.4a): only when the person has more than one shop. */
@Composable
fun ChooseCompanyScreen(me: Me, busy: Boolean, problem: String?, onChoose: (Membership) -> Unit, onBack: (() -> Unit)?) {
    Column(Modifier.fillMaxSize().background(Colours.Page).systemBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().background(Colours.Card).drawBehind { drawLine(Colours.Border, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }.padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (onBack != null) IconBtn(Icons.Back, stringResource(R.string.back), onBack) else Spacer(Modifier.size(8.dp))
            T(stringResource(R.string.choose_company), Modifier.weight(1f), weight = FontWeight.Bold, oneLine = true)
        }
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            T(stringResource(R.string.choose_sub, me.memberships.size), size = 13.sp, colour = Colours.Text2)
            if (problem != null) T(problem, colour = Colours.Red, size = 13.sp)
            me.memberships.forEach { m -> CompanyRow(m, current = m.businessId == me.business?.id, enabled = !busy) { onChoose(m) } }
        }
    }
}

@Composable
private fun CompanyRow(m: Membership, current: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .raised(shape)
            .background(if (current) Colours.LightBlue else Colours.Card, shape)
            .border(1.dp, if (current) Colours.Selected else Colours.Border, shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // .av: the shop's initials in a soft blue circle
        Box(
            Modifier.size(40.dp).background(Brush.linearGradient(listOf(Colours.LightBlue, Colours.Selected)), CircleShape).border(1.dp, Colours.Selected, CircleShape),
            contentAlignment = Alignment.Center,
        ) { T(initials(m.businessName), weight = FontWeight.Bold, size = 14.sp, colour = Colours.Blue) }
        Column(Modifier.weight(1f)) {
            T(m.businessName, weight = FontWeight.SemiBold, oneLine = true)
            T(if (m.gstin.isNullOrBlank()) stringResource(R.string.no_gst) else "GSTIN ${m.gstin}", size = 12.sp, colour = Colours.Text3)
        }
        Badge(role(m.role), BadgeKind.Info)
    }
}

/** "Sharma Electricals & Hardware" → "SE" */
fun initials(name: String): String =
    name.split(' ', '&').filter { it.isNotBlank() && it.first().isLetterOrDigit() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "B" }

@Composable
private fun role(key: String) = when (key) {
    "owner" -> stringResource(R.string.role_owner)
    "manager" -> stringResource(R.string.role_manager)
    "billing_staff" -> stringResource(R.string.role_billing_staff)
    "accountant" -> stringResource(R.string.role_accountant)
    else -> key
}

/** Welcome Back (design 7.4a, fingerprint lock): navy, the logo, the shop, a big fingerprint button. */
@Composable
fun LockScreen(company: String, onTouch: () -> Unit, onPasscode: () -> Unit, onPassword: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Colours.Navy)
            .drawBehind {
                // radial-gradient(120% 70% at 50% 0%, blue .9, transparent 70%)
                drawRect(Brush.radialGradient(listOf(see(Colours.Blue, 0.9f), see(Colours.Blue, 0f)), center = Offset(size.width / 2, 0f), radius = size.width * 0.95f))
            }
            .systemBarsPadding()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Logo()
        T(stringResource(R.string.welcome_back), size = 20.sp, weight = FontWeight.Bold, colour = Colours.OnColour)
        if (company.isNotEmpty()) T(company, size = 13.sp, colour = Colours.Selected, align = TextAlign.Center)
        Box(
            Modifier
                .padding(10.dp)
                .size(116.dp)
                .background(see(Colours.OnColour, 0.06f), CircleShape)
                .padding(10.dp)
                .background(see(Colours.OnColour, 0.10f), CircleShape)
                .clip(CircleShape)
                .clickable(role = Role.Button, onClickLabel = stringResource(R.string.touch_sensor), onClick = onTouch),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Fingerprint, contentDescription = stringResource(R.string.touch_sensor), tint = Colours.OnColour, modifier = Modifier.size(38.dp))
        }
        T(stringResource(R.string.touch_sensor), weight = FontWeight.SemiBold, colour = Colours.OnColour)
        Box(Modifier.heightIn(min = Size.Tap).clickable(role = Role.Button, onClick = onPasscode).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
            T(stringResource(R.string.use_passcode), weight = FontWeight.SemiBold, size = 14.sp, colour = Colours.OnColour)
        }
        Box(Modifier.heightIn(min = Size.Tap).clickable(role = Role.Button, onClick = onPassword).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
            T(stringResource(R.string.sign_in_password), size = 13.sp, colour = Colours.Selected)
        }
    }
}
