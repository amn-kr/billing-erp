package billingo.app.ui.parts

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.clickable
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Colours.see
import billingo.app.ui.theme.LocalFont
import billingo.app.ui.theme.Size

/*
 * The first building blocks (design step 7.2), the ones Sign In needs. Step 8.2b adds the rest.
 * Each follows the design's CSS (reference/design/mobile.html): sizes, corners, shine and shadows.
 */

/** The design's --shine: a soft light top and a slightly darker bottom, over a solid colour. */
fun shine() = Brush.verticalGradient(
    0f to see(Colours.OnColour, 0.16f),
    0.55f to see(Colours.OnColour, 0f),
    1f to see(Colours.Text, 0.10f),
)

/** The round "B" logo (.logo, .logo.big). */
@Composable
fun Logo(size: Dp = 56.dp, corner: Dp = 16.dp, letter: Float = 24f) {
    val shape = RoundedCornerShape(corner)
    Box(
        Modifier
            .size(size)
            .shadow(14.dp, shape, ambientColor = see(Colours.Blue, 0.55f), spotColor = see(Colours.Blue, 0.55f))
            .background(Colours.Blue, shape)
            .background(shine(), shape),
        contentAlignment = Alignment.Center,
    ) {
        Text("B", color = Colours.OnColour, fontWeight = FontWeight.Bold, fontSize = letter.sp, fontFamily = LocalFont.current)
    }
}

/** A main button (.btn.blue / .btn.green), pill-shaped when [pill]; presses down when tapped. */
@Composable
fun MainButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, pill: Boolean = false, green: Boolean = false) {
    val colour = if (green) Colours.Green else Colours.Blue
    val shape = if (pill) RoundedCornerShape(999.dp) else RoundedCornerShape(Size.Radius)
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    Box(
        modifier
            .scale(if (pressed) 0.98f else 1f)
            .heightIn(min = if (pill) 52.dp else Size.Tap)
            .shadow(if (pressed) 2.dp else 8.dp, shape, ambientColor = see(colour, 0.45f), spotColor = see(colour, 0.45f))
            .background(colour, shape)
            .background(shine(), shape)
            .clickable(interactionSource = press, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Colours.OnColour, fontWeight = if (pill) FontWeight.Bold else FontWeight.SemiBold, fontSize = if (pill) 16.sp else 15.sp, fontFamily = LocalFont.current, maxLines = 1)
    }
}

/** A text link (.lnk): blue, semibold, at least 44 dp tall to tap. */
@Composable
fun LinkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .heightIn(min = Size.Tap)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Colours.Blue, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, fontFamily = LocalFont.current)
    }
}

/** A labelled input (.fld + .inp); [password] adds the show/hide eye. */
@Composable
fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    keyboard: KeyboardOptions = KeyboardOptions.Default,
    password: Boolean = false,
    shown: Boolean = false,
    onToggleShown: () -> Unit = {},
    showLabel: String = "",
    hideLabel: String = "",
) {
    val focus = remember { MutableInteractionSource() }
    val focused by focus.collectIsFocusedAsState()
    val shape = RoundedCornerShape(Size.RadiusSmall)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = Colours.Text2, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, fontFamily = LocalFont.current)
        Row(
            Modifier
                .fillMaxWidth()
                .then(if (focused) Modifier.border(3.dp, Colours.Selected, RoundedCornerShape(Size.RadiusSmall + 3.dp)).padding(3.dp) else Modifier.padding(3.dp))
                .heightIn(min = Size.Tap)
                .background(Colours.Card, shape)
                .border(1.dp, if (focused) Colours.Blue else Colours.Border, shape)
                .padding(start = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                interactionSource = focus,
                keyboardOptions = keyboard,
                visualTransformation = if (password && !shown) PasswordVisualTransformation() else VisualTransformation.None,
                textStyle = TextStyle(fontFamily = LocalFont.current, fontSize = 15.sp, color = Colours.Text),
                cursorBrush = SolidColor(Colours.Blue),
                modifier = Modifier.weight(1f).padding(end = if (password) 0.dp else 10.dp),
            )
            if (password) {
                IconTap(if (shown) Icons.EyeOff else Icons.Eye, if (shown) hideLabel else showLabel, onToggleShown, tint = Colours.Text3)
            }
        }
    }
}

/** A 44 dp square tap area with an icon (.eye, .btn.ico). */
@Composable
fun IconTap(icon: ImageVector, label: String, onClick: () -> Unit, tint: androidx.compose.ui.graphics.Color = Colours.Text2, iconSize: Dp = 20.dp) {
    Box(
        Modifier.sizeIn(minWidth = Size.Tap, minHeight = Size.Tap).clickable(role = Role.Button, onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(iconSize))
    }
}

/** The white raised card (.si2-cd, .card). */
@Composable
fun RaisedCard(modifier: Modifier = Modifier, corner: Dp = 20.dp, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(corner)
    Box(
        modifier
            .shadow(10.dp, shape, ambientColor = see(Colours.Text, 0.16f), spotColor = see(Colours.Text, 0.16f))
            .background(Colours.Card, shape),
    ) { content() }
}
