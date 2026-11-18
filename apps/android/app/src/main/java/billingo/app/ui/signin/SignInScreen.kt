package billingo.app.ui.signin

import android.widget.Toast
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.R
import billingo.app.ui.parts.Field
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.LinkButton
import billingo.app.ui.parts.Logo
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.T
import billingo.app.ui.parts.RaisedCard
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Colours.see
import billingo.app.ui.theme.LocalFont
import billingo.app.ui.theme.Size

/**
 * Sign In (design 7.4a, approved 16 Nov 2026), with its "Create Account" mode. Forgot Password
 * opens in a later step (the web has it today).
 */
@Composable
fun SignInScreen(
    version: String,
    busy: Boolean,
    problem: String?,
    onSignIn: (email: String, password: String) -> Unit,
    onRegister: (name: String, email: String, password: String) -> Unit,
    onLanguage: () -> Unit,
    onSecret: (() -> Unit)? = null,
) {
    val ctx = LocalContext.current
    val later = stringResource(R.string.coming_next)
    val soon = { Toast.makeText(ctx, later, Toast.LENGTH_SHORT).show() }
    var up by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var shown by rememberSaveable { mutableStateOf(false) }
    val font = LocalFont.current

    Box(
        Modifier
            .fillMaxSize()
            .background(Colours.Page)
            // the design's soft blue glow at the top: radial-gradient(70% 40% at 50% 0%, selected, transparent)
            .drawBehind {
                val rx = size.width * 0.7f
                val ry = size.height * 0.4f
                scale(scaleX = 1f, scaleY = ry / rx, pivot = Offset(size.width / 2, 0f)) {
                    drawCircle(
                        Brush.radialGradient(listOf(Colours.Selected, see(Colours.Selected, 0f)), center = Offset(size.width / 2, 0f), radius = rx),
                        radius = rx,
                        center = Offset(size.width / 2, 0f),
                    )
                }
            },
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        ) {
            Logo(size = 72.dp, corner = 22.dp, letter = 32f)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(R.string.app_name), fontSize = 26.sp, fontWeight = FontWeight.Bold, lineHeight = 31.sp, color = Colours.Text, fontFamily = font)
                Text(stringResource(if (up) R.string.signup_sub else R.string.signin_sub), fontSize = 13.sp, color = Colours.Text2, fontFamily = font, textAlign = TextAlign.Center)
            }
            RaisedCard(Modifier.fillMaxWidth().widthIn(max = 480.dp)) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (up) Field(
                        label = stringResource(R.string.your_name),
                        value = name,
                        onChange = { name = it },
                        keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                    )
                    Field(
                        label = stringResource(R.string.email),
                        value = email,
                        onChange = { email = it },
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    )
                    Field(
                        label = stringResource(R.string.password),
                        value = password,
                        onChange = { password = it },
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        password = true,
                        shown = shown,
                        onToggleShown = { shown = !shown },
                        showLabel = stringResource(R.string.show_password),
                        hideLabel = stringResource(R.string.hide_password),
                    )
                    if (!up) LinkButton(stringResource(R.string.forgot_password), soon)
                    if (problem != null) T(problem, colour = Colours.Red, size = 13.sp)
                    Btn(
                        stringResource(if (busy) R.string.signing_in else if (up) R.string.create_account else R.string.sign_in),
                        { if (up) onRegister(name, email, password) else onSignIn(email, password) },
                        Modifier.fillMaxWidth(),
                        pill = true,
                        busy = busy,
                    )
                }
            }
            OrLine(stringResource(R.string.or))
            LinkButton(stringResource(if (up) R.string.have_account else R.string.new_here), { up = !up })
            LanguageChip(stringResource(R.string.language_name), onLanguage)
            Text(stringResource(R.string.fingerprint_next_time), fontSize = 12.sp, color = Colours.Text3, fontFamily = font, textAlign = TextAlign.Center)
            // test builds: five taps on the version line open the Building Blocks page
            var taps by rememberSaveable { mutableStateOf(0) }
            Text(
                stringResource(R.string.version_line, version),
                fontSize = 12.sp,
                color = Colours.Text3,
                fontFamily = font,
                textAlign = TextAlign.Center,
                modifier = if (onSecret == null) Modifier else Modifier.clickable(interactionSource = null, indication = null) { if (++taps >= 5) { taps = 0; onSecret() } },
            )
        }
    }
}

/** "—— or ——" (.si2-or) */
@Composable
private fun OrLine(text: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Spacer(Modifier.weight(1f).height(1.dp).background(Colours.Border))
        Text(text, fontSize = 13.sp, color = Colours.Text3, fontFamily = LocalFont.current)
        Spacer(Modifier.weight(1f).height(1.dp).background(Colours.Border))
    }
}

/** The language button under the card (.si2-lang). Choosing the language arrives in 8.2d. */
@Composable
private fun LanguageChip(text: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(999.dp)
    Row(
        Modifier
            .heightIn(min = Size.Tap)
            .background(Colours.Card, shape)
            .border(1.dp, Colours.Border, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(Icons.Globe, contentDescription = null, tint = Colours.Text2, modifier = Modifier.size(16.dp))
        Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Colours.Text2, fontFamily = LocalFont.current)
    }
}
