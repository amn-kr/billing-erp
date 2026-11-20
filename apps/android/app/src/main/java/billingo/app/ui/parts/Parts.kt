package billingo.app.ui.parts

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Colours.see
import billingo.app.ui.theme.LocalFont
import billingo.app.ui.theme.Size

/*
 * The basic building blocks (design step 7.2, approved). Each follows the design's CSS in
 * reference/design/mobile.html, including its "not flat" look (owner, 16 Nov 2026): shine on main
 * buttons, soft shadows on cards and rows, a raised white pill for the selected tab.
 * Kit.kt holds the larger blocks made from these.
 */

/** Text in the language's font. Names stay on one line and end with "…" when they don't fit. */
@Composable
fun T(
    text: String,
    modifier: Modifier = Modifier,
    size: TextUnit = 15.sp,
    weight: FontWeight = FontWeight.Normal,
    colour: Color = Colours.Text,
    oneLine: Boolean = false,
    align: TextAlign? = null,
    struck: Boolean = false,
    numbers: Boolean = false,
) {
    Text(
        text,
        modifier,
        color = colour,
        fontSize = size,
        fontWeight = weight,
        fontFamily = LocalFont.current,
        maxLines = if (oneLine) 1 else Int.MAX_VALUE,
        overflow = if (oneLine) TextOverflow.Ellipsis else TextOverflow.Clip,
        softWrap = !oneLine,
        textAlign = align,
        textDecoration = if (struck) TextDecoration.LineThrough else null,
        // tabular figures so amounts line up (font-variant-numeric: tabular-nums)
        style = if (numbers) TextStyle(fontFeatureSettings = "tnum") else TextStyle.Default,
    )
}

/** The design's --shine: a soft light top and a slightly darker bottom, over a solid colour. */
fun shine() = Brush.verticalGradient(
    0f to see(Colours.OnColour, 0.16f),
    0.55f to see(Colours.OnColour, 0f),
    1f to see(Colours.Text, 0.10f),
)

/** Raised a little (--sh1) or more (--sh2), with a shadow made from the Text colour. */
fun Modifier.raised(shape: Shape, more: Boolean = false): Modifier =
    if (more) shadow(10.dp, shape, ambientColor = see(Colours.Text, 0.16f), spotColor = see(Colours.Text, 0.16f))
    else shadow(3.dp, shape, ambientColor = see(Colours.Text, 0.10f), spotColor = see(Colours.Text, 0.10f))

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
        T("B", colour = Colours.OnColour, weight = FontWeight.Bold, size = letter.sp)
    }
}

/**
 * Button kinds (design: "Blue = Start · Green = Finish · Light Blue = Second Actions ·
 * White = Small Actions · Light Red = Delete"). Delete is never solid red.
 */
enum class Kind { Blue, Green, Soft, Line, Delete }

internal fun Kind.fill() = when (this) {
    Kind.Blue -> Colours.Blue
    Kind.Green -> Colours.Green
    Kind.Soft -> Colours.LightBlue
    Kind.Line -> Colours.Card
    Kind.Delete -> Colours.LightRed
}

internal fun Kind.ink() = when (this) {
    Kind.Blue, Kind.Green -> Colours.OnColour
    Kind.Soft -> Colours.Blue
    Kind.Line -> Colours.Text
    Kind.Delete -> Colours.Red
}

private fun Kind.edge(): Modifier.(Shape) -> Modifier = { shape ->
    when (this@edge) {
        Kind.Soft -> border(1.dp, Colours.Selected, shape)
        Kind.Line -> border(1.dp, Colours.Border, shape)
        Kind.Delete -> border(1.dp, see(Colours.Red, 0.18f), shape)
        else -> this
    }
}

/** A button (.btn): text, an optional icon, and a "busy" spinner while saving. Presses down when tapped. */
@Composable
fun Btn(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: Kind = Kind.Blue,
    icon: ImageVector? = null,
    pill: Boolean = false,
    busy: Boolean = false,
    /** the small row buttons of a card (.qa3 .btn): 13 sp text, less padding */
    small: Boolean = false,
) {
    val shape = if (pill) RoundedCornerShape(999.dp) else RoundedCornerShape(Size.Radius)
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    val solid = kind == Kind.Blue || kind == Kind.Green
    val fill = when {
        pressed && kind == Kind.Soft -> Colours.Selected
        pressed && kind == Kind.Line -> Colours.Page
        else -> kind.fill()
    }
    Row(
        modifier
            .scale(if (pressed) 0.98f else 1f)
            .heightIn(min = if (pill) 52.dp else Size.Tap)
            .then(
                when {
                    solid -> Modifier.shadow(if (pressed) 2.dp else 6.dp, shape, ambientColor = see(kind.fill(), 0.45f), spotColor = see(kind.fill(), 0.45f))
                    kind == Kind.Line -> Modifier.raised(shape)
                    else -> Modifier
                },
            )
            .background(fill, shape)
            .then(if (solid) Modifier.background(shine(), shape) else Modifier)
            .let { kind.edge()(it, shape) }
            .clickable(interactionSource = press, indication = null, role = Role.Button, enabled = !busy, onClick = onClick)
            .padding(horizontal = if (small) 6.dp else 16.dp, vertical = if (small) 4.dp else 10.dp),
        horizontalArrangement = Arrangement.spacedBy(if (small) 6.dp else 8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) Spinner(kind.ink())
        else if (icon != null) Icon(icon, contentDescription = null, tint = kind.ink(), modifier = Modifier.size(if (small) 18.dp else 20.dp))
        // a long label goes onto a second line on narrow phones, never cut (fit rule, owner 15 Nov 2026)
        T(text, colour = kind.ink(), weight = if (pill) FontWeight.Bold else FontWeight.SemiBold, size = if (pill) 16.sp else if (small) 13.sp else 15.sp, align = TextAlign.Center)
    }
}

/** The main blue (or green) button of Sign In and similar screens. */
@Composable
fun MainButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, pill: Boolean = false, green: Boolean = false) =
    Btn(text, onClick, modifier, kind = if (green) Kind.Green else Kind.Blue, pill = pill)

/** A square icon-only button (.btn.ico), 44 dp; [kind] null is a bare icon (top bars). */
@Composable
fun IconBtn(icon: ImageVector, label: String, onClick: () -> Unit, kind: Kind? = null, tint: Color? = null) {
    val shape = RoundedCornerShape(Size.Radius)
    Box(
        Modifier
            .size(Size.Tap)
            .then(if (kind == Kind.Line) Modifier.raised(shape) else Modifier)
            .then(if (kind != null) Modifier.background(kind.fill(), shape) else Modifier)
            .let { if (kind != null) kind.edge()(it, shape) else it }
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = tint ?: kind?.ink() ?: Colours.Text, modifier = Modifier.size(20.dp))
    }
}

/** A 44 dp square tap area with an icon (the eye in a password field, contacts in a name field). */
@Composable
fun IconTap(icon: ImageVector, label: String, onClick: () -> Unit, tint: Color = Colours.Text2, iconSize: Dp = 20.dp) {
    Box(
        Modifier.sizeIn(minWidth = Size.Tap, minHeight = Size.Tap).clickable(role = Role.Button, onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(iconSize))
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
        T(text, colour = Colours.Blue, weight = FontWeight.SemiBold, size = 14.sp)
    }
}

/**
 * A labelled input (.fld + .inp). Optional: [prefix] ("+91", "₹"), a [leading] icon (calendar,
 * search), a [trailing] tap (contacts), the show/hide eye for a [password], and an [error] line.
 * [label] null leaves the label out (the search box).
 */
@Composable
fun Field(
    label: String?,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    keyboard: KeyboardOptions = KeyboardOptions.Default,
    placeholder: String = "",
    prefix: String? = null,
    leading: ImageVector? = null,
    trailing: (@Composable () -> Unit)? = null,
    error: String? = null,
    bold: Boolean = false,
    password: Boolean = false,
    shown: Boolean = false,
    onToggleShown: () -> Unit = {},
    showLabel: String = "",
    hideLabel: String = "",
    readOnly: Boolean = false,
) {
    val focus = remember { MutableInteractionSource() }
    val focused by focus.collectIsFocusedAsState()
    val shape = RoundedCornerShape(Size.RadiusSmall)
    val edge = when {
        error != null -> Colours.Red
        focused -> Colours.Blue
        else -> Colours.Border
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (label != null) T(label, colour = Colours.Text2, weight = FontWeight.SemiBold, size = 13.sp)
        Row(
            Modifier
                .fillMaxWidth()
                .then(if (focused) Modifier.border(3.dp, Colours.Selected, RoundedCornerShape(Size.RadiusSmall + 3.dp)).padding(3.dp) else Modifier.padding(3.dp))
                .heightIn(min = Size.Tap)
                .background(Colours.Card, shape)
                .border(1.dp, edge, shape)
                .padding(start = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (leading != null) Icon(leading, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(20.dp))
            if (prefix != null) T(prefix, colour = Colours.Text2, weight = FontWeight.SemiBold)
            Box(Modifier.weight(1f).padding(end = if (password || trailing != null) 0.dp else 10.dp), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty() && placeholder.isNotEmpty()) T(placeholder, colour = Colours.Text3, oneLine = true)
                BasicTextField(
                    value = value,
                    onValueChange = onChange,
                    singleLine = true,
                    readOnly = readOnly,
                    interactionSource = focus,
                    keyboardOptions = keyboard,
                    visualTransformation = if (password && !shown) PasswordVisualTransformation() else VisualTransformation.None,
                    textStyle = TextStyle(
                        fontFamily = LocalFont.current,
                        fontSize = 15.sp,
                        color = Colours.Text,
                        fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
                        fontFeatureSettings = if (bold) "tnum" else null,
                    ),
                    cursorBrush = SolidColor(Colours.Blue),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (password) IconTap(if (shown) Icons.EyeOff else Icons.Eye, if (shown) hideLabel else showLabel, onToggleShown, tint = Colours.Text3)
            trailing?.invoke()
        }
        if (error != null) T(error, colour = Colours.Red, size = 12.sp)
    }
}

/** The white raised card of Sign In (.si2-cd). */
@Composable
fun RaisedCard(modifier: Modifier = Modifier, corner: Dp = 20.dp, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(corner)
    Box(modifier.raised(shape, more = true).background(Colours.Card, shape)) { content() }
}

/** A white box with a thin border (.box), slightly raised. */
@Composable
fun BoxCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Column(
        modifier.fillMaxWidth().raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) { content() }
}

/** A row of buttons sharing the width (.row with .btn.grow). */
@Composable
fun ButtonRow(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, content = content)
}
