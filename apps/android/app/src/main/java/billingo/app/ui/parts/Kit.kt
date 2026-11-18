package billingo.app.ui.parts

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import billingo.app.ui.theme.Colours
import billingo.app.ui.theme.Colours.see
import billingo.app.ui.theme.Size

/*
 * The larger building blocks of design step 7.2, made from the basic ones in Parts.kt.
 * Every money amount also shows an arrow or a word, never colour alone (owner, 15 Nov 2026).
 */

/** A small grey label above a group in the Building Blocks page (.lbl). */
@Composable
fun SectionLabel(text: String) {
    T(text.uppercase(), Modifier.padding(start = 2.dp, top = 6.dp), size = 11.sp, weight = FontWeight.SemiBold, colour = Colours.Text3)
}

/** The top bar (.hdr): menu, the shop name on one line with "…", the date, and a bell. */
@Composable
fun TopBar(title: String, sub: String, onMenu: () -> Unit, onBell: () -> Unit, menuLabel: String, bellLabel: String) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier.fillMaxWidth().raised(shape).background(Colours.Card, shape).border(1.dp, Colours.Border, shape).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        IconBtn(Icons.Menu, menuLabel, onMenu)
        Column(Modifier.weight(1f)) {
            T(title, weight = FontWeight.Bold, oneLine = true)
            T(sub, size = 12.sp, colour = Colours.Text3, oneLine = true)
        }
        IconBtn(Icons.Bell, bellLabel, onBell)
    }
}

/**
 * A navy summary card (.nv): "You'll Get" in bright green with ↓, "You'll Give" in bright red
 * with ↑, the amount large with smaller paise.
 */
@Composable
fun SummaryCard(label: String, amount: String, sub: String, toGet: Boolean, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(Size.RadiusLarge)
    val (rupees, paise) = Format.split(amount)
    Column(
        modifier
            .shadow(10.dp, shape, ambientColor = see(Colours.Navy, 0.7f), spotColor = see(Colours.Navy, 0.7f))
            .clip(shape)
            .background(Colours.Navy)
            // radial-gradient(120% 90% at 100% 0%, blue .95, transparent 60%) and the soft bubble
            .drawBehind {
                drawRect(Brush.radialGradient(listOf(see(Colours.Blue, 0.95f), see(Colours.Blue, 0f)), center = Offset(size.width, 0f), radius = size.width * 0.72f))
                drawCircle(see(Colours.OnColour, 0.07f), radius = 45.dp.toPx(), center = Offset(size.width - 17.dp.toPx(), size.height + 5.dp.toPx()))
            }
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(if (toGet) Icons.Down else Icons.Up, contentDescription = null, tint = Colours.Selected, modifier = Modifier.size(14.dp))
            T(label, size = 12.sp, colour = Colours.Selected, oneLine = true)
        }
        Row(verticalAlignment = Alignment.Bottom) {
            val c = if (toGet) Colours.BrightGreen else Colours.BrightRed
            T("₹", size = 14.sp, weight = FontWeight.SemiBold, colour = c, modifier = Modifier.padding(end = 2.dp, bottom = 3.dp))
            T(rupees, size = 22.sp, weight = FontWeight.Bold, colour = c, numbers = true, oneLine = true)
            if (paise.isNotEmpty()) T(paise, size = 12.sp, weight = FontWeight.SemiBold, colour = see(c, 0.75f), modifier = Modifier.padding(bottom = 3.dp))
        }
        T(sub, size = 12.sp, colour = Colours.Selected)
    }
}

/** Tabs (.tabs): a light slate track, the selected tab a raised white pill with blue text. */
@Composable
fun Tabs(items: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(Modifier.fillMaxWidth().background(Colours.LightSlate, shape).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEachIndexed { i, name ->
            val on = i == selected
            val pill = RoundedCornerShape(9.dp)
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = Size.Tap)
                    .then(if (on) Modifier.shadow(2.dp, pill, ambientColor = see(Colours.Text, 0.12f), spotColor = see(Colours.Text, 0.12f)).background(Colours.Card, pill) else Modifier)
                    .clickable(role = Role.Tab, onClick = { onSelect(i) })
                    .padding(horizontal = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                T(name, size = 14.sp, weight = FontWeight.SemiBold, colour = if (on) Colours.Blue else Colours.Text2, oneLine = true, align = TextAlign.Center)
            }
        }
    }
}

/** What a money amount means: to get (green ↓), to give (red ↑) or settled (grey). */
enum class Due { ToGet, ToGive, Settled, Plain }

/**
 * A list row (.li): the name on one line with "…", a detail line under it, and an end part
 * (an amount with its word, or a value with a badge).
 */
@Composable
fun ListRow(name: String, sub: String, onClick: (() -> Unit)? = null, end: @Composable () -> Unit = {}) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .raised(shape)
            .background(Colours.Card, shape)
            .border(1.dp, Colours.Border, shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f)) {
            T(name, weight = FontWeight.SemiBold, oneLine = true)
            T(sub, size = 12.sp, colour = Colours.Text3, oneLine = true)
        }
        Column(Modifier.widthIn(max = 180.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) { end() }
    }
}

/** The end of a party row: the amount, and under it "↓ To Get" / "↑ To Give" / "Settled". */
@Composable
fun AmountWithWord(amount: String, word: String, due: Due) {
    val c = when (due) {
        Due.ToGet -> Colours.Green
        Due.ToGive -> Colours.Red
        Due.Settled -> Colours.Text3
        Due.Plain -> Colours.Text
    }
    T(amount, weight = FontWeight.Bold, colour = c, numbers = true, oneLine = true)
    if (word.isNotEmpty()) T(word, size = 11.sp, weight = FontWeight.SemiBold, colour = c, oneLine = true)
}

/** Badge kinds (.bd): Paid green, Overdue red, Credit / Part Paid / Low Stock orange, Info blue, Draft and Cancelled slate. */
enum class BadgeKind { Paid, Due, Credit, Info, Grey }

/** A small rounded badge; [struck] for Cancelled (never red). */
@Composable
fun Badge(text: String, kind: BadgeKind, icon: ImageVector? = null, struck: Boolean = false) {
    val (fill, ink) = when (kind) {
        BadgeKind.Paid -> Colours.LightGreen to Colours.Green
        BadgeKind.Due -> Colours.LightRed to Colours.Red
        BadgeKind.Credit -> Colours.LightOrange to Colours.Orange
        BadgeKind.Info -> Colours.LightBlue to Colours.Blue
        BadgeKind.Grey -> Colours.LightSlate to Colours.Text2
    }
    val shape = RoundedCornerShape(999.dp)
    Row(
        Modifier.background(fill, shape).border(1.dp, see(Colours.Text, 0.04f), shape).padding(horizontal = 10.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(12.dp))
        T(text, size = 12.sp, weight = FontWeight.SemiBold, colour = ink, oneLine = true, struck = struck)
    }
}

/** The turning circle on a busy button (.spin). */
@Composable
fun Spinner(colour: Color, size: androidx.compose.ui.unit.Dp = 18.dp) {
    val turn by rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween(800, easing = LinearEasing)), label = "turn")
    Canvas(Modifier.size(size)) {
        val w = 2.dp.toPx()
        drawArc(see(colour, 0.45f), 0f, 360f, false, style = Stroke(w))
        drawArc(colour, turn, 90f, false, style = Stroke(w))
    }
}

/** A switch with its words (.tg + .sw2): blue when on, the white knob slides. */
@Composable
fun SwitchRow(text: String, on: Boolean, onChange: (Boolean) -> Unit) {
    val knob by animateDpAsState(if (on) 21.dp else 3.dp, label = "knob")
    Row(
        Modifier.fillMaxWidth().heightIn(min = Size.Tap).clickable(role = Role.Switch) { onChange(!on) }.semantics { contentDescription = text },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        T(text, Modifier.weight(1f))
        Box(Modifier.width(46.dp).height(28.dp).background(if (on) Colours.Blue else Colours.Border, RoundedCornerShape(999.dp))) {
            Box(
                Modifier
                    .offset(x = knob, y = 3.dp)
                    .size(22.dp)
                    .shadow(2.dp, CircleShape, ambientColor = see(Colours.Text, 0.3f), spotColor = see(Colours.Text, 0.3f))
                    .background(Colours.Card, CircleShape),
            )
        }
    }
}

/** A tick box with its words (.chk). */
@Composable
fun CheckRow(text: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = Size.Tap).clickable(role = Role.Checkbox) { onChange(!on) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val shape = RoundedCornerShape(5.dp)
        Box(
            Modifier.size(22.dp).background(if (on) Colours.Blue else Colours.Card, shape).border(if (on) 0.dp else 2.dp, Colours.Text3, shape),
            contentAlignment = Alignment.Center,
        ) {
            if (on) Icon(Icons.Check, contentDescription = null, tint = Colours.OnColour, modifier = Modifier.size(16.dp))
        }
        T(text)
    }
}

/** A choice field (.fld + select): shows the choice; tapping opens the choices (a sheet on the screens). */
@Composable
fun ChoiceField(label: String, value: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(Size.RadiusSmall)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        T(label, colour = Colours.Text2, weight = FontWeight.SemiBold, size = 13.sp)
        Row(
            Modifier
                .fillMaxWidth()
                .padding(3.dp)
                .heightIn(min = Size.Tap)
                .background(Colours.Card, shape)
                .border(1.dp, Colours.Border, shape)
                .clickable(role = Role.DropdownList, onClick = onClick)
                .padding(start = 10.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            T(value, Modifier.weight(1f), oneLine = true)
            Icon(Icons.Chevron, contentDescription = null, tint = Colours.Text3, modifier = Modifier.size(20.dp))
        }
    }
}

/** The bar of buttons at the bottom of a screen (.bar), with a soft shadow above it. */
@Composable
fun BottomBar(content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier
            .fillMaxWidth()
            .shadow(8.dp, shape, ambientColor = see(Colours.Text, 0.18f), spotColor = see(Colours.Text, 0.18f))
            .background(Colours.Card, shape)
            .border(1.dp, Colours.Border, shape)
            .padding(8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/**
 * The dimmed layer behind a sheet or a confirm box (.dim): tapping outside closes it (owner,
 * 17 Nov 2026). Put it last in a screen's Box so it covers everything.
 */
@Composable
fun Dim(onDismiss: () -> Unit, centre: Boolean = false, content: @Composable BoxScope.() -> Unit) {
    Box(
        Modifier.fillMaxSize().background(see(Colours.Text, 0.45f)).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onDismiss),
        contentAlignment = if (centre) Alignment.Center else Alignment.BottomCenter,
        content = content,
    )
}

/** A sheet coming up from the bottom (.sheet) with its grab handle and title. */
@Composable
fun Sheet(title: String, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(topStart = Size.RadiusLarge, topEnd = Size.RadiusLarge)
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(16.dp, shape, ambientColor = see(Colours.Text, 0.35f), spotColor = see(Colours.Text, 0.35f))
            .background(Colours.Card, shape)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
            .navigationBarsPadding()
            .padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.align(Alignment.CenterHorizontally).padding(bottom = 4.dp).width(36.dp).height(4.dp).background(Colours.Border, RoundedCornerShape(2.dp)))
        T(title, weight = FontWeight.Bold)
        content()
    }
}

/** Tiles three to a row (.grid3 + .tile), as in Create New. */
@Composable
fun TileGrid(tiles: List<Pair<ImageVector, String>>, onTap: (Int) -> Unit) {
    tiles.chunked(3).forEachIndexed { r, row ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            row.forEachIndexed { c, (icon, label) ->
                val shape = RoundedCornerShape(Size.RadiusSmall)
                Column(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 72.dp)
                        .background(Colours.Card, shape)
                        .border(1.dp, Colours.Border, shape)
                        .clickable(role = Role.Button) { onTap(r * 3 + c) }
                        .padding(horizontal = 4.dp, vertical = 10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
                ) {
                    Box(Modifier.background(Colours.LightBlue, RoundedCornerShape(12.dp)).padding(8.dp)) {
                        Icon(icon, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(20.dp))
                    }
                    T(label, size = 12.sp, weight = FontWeight.SemiBold, align = TextAlign.Center)
                }
            }
            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

/** A confirm box (.dlg): a question, what will happen, and two buttons. */
@Composable
fun ConfirmBox(title: String, text: String, keep: String, act: String, onKeep: () -> Unit, onAct: () -> Unit, danger: Boolean = true) {
    val shape = RoundedCornerShape(Size.RadiusLarge)
    Column(
        Modifier
            .padding(16.dp)
            .fillMaxWidth()
            .raised(shape, more = true)
            .background(Colours.Card, shape)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        T(title, size = 17.sp, weight = FontWeight.Bold)
        T(text, size = 13.sp, colour = Colours.Text2)
        ButtonRow {
            Btn(keep, onKeep, Modifier.weight(1f), kind = Kind.Line)
            Btn(act, onAct, Modifier.weight(1f), kind = if (danger) Kind.Delete else Kind.Blue)
        }
    }
}

/** Banner kinds (.ban): no internet (red), server waking up (orange), view-only shop (blue), staff (slate). */
enum class BannerKind { Offline, Waking, ViewOnly, Staff }

/** A banner with an icon, a bold line and a detail line; a stripe in its own colour on the left. */
@Composable
fun Banner(kind: BannerKind, title: String, text: String, link: String? = null, onLink: () -> Unit = {}) {
    val (fill, ink, icon) = when (kind) {
        BannerKind.Offline -> Triple(Colours.LightRed, Colours.Red, Icons.NoWifi)
        BannerKind.Waking -> Triple(Colours.LightOrange, Colours.Orange, Icons.Clock)
        BannerKind.ViewOnly -> Triple(Colours.LightBlue, Colours.Blue, Icons.Lock)
        BannerKind.Staff -> Triple(Colours.LightSlate, Colours.Text2, Icons.User)
    }
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(fill)
            .drawBehind { drawRect(ink, size = androidx.compose.ui.geometry.Size(3.dp.toPx(), size.height)) }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f)) {
            T(title, size = 14.sp, weight = FontWeight.Bold, colour = ink)
            T(text, size = 14.sp, colour = ink)
        }
        if (link != null) LinkButton(link, onLink)
    }
}

/** A short message at the bottom (.toast): dark, with a bright green tick when something was saved. */
@Composable
fun Toast(text: String, ok: Boolean = true) {
    val shape = RoundedCornerShape(Size.Radius)
    Row(
        Modifier.fillMaxWidth().raised(shape, more = true).background(Colours.Text, shape).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (ok) Icon(Icons.Check, contentDescription = null, tint = Colours.BrightGreen, modifier = Modifier.size(20.dp))
        T(text, size = 14.sp, colour = Colours.OnColour)
    }
}

/** Grey bars while a list loads (.skel), gently pulsing. */
@Composable
fun Loading(widths: List<Float> = listOf(0.6f, 0.9f, 0.4f)) {
    val a by rememberInfiniteTransition(label = "pulse").animateFloat(1f, 0.55f, infiniteRepeatable(tween(1200), RepeatMode.Reverse), label = "a")
    BoxCard {
        widths.forEach { w -> Box(Modifier.fillMaxWidth(w).height(14.dp).background(see(Colours.LightSlate, a), RoundedCornerShape(6.dp))) }
    }
}

/** An empty list (.empty): a ring with an icon, a title, a line of help and one button. */
@Composable
fun EmptyState(icon: ImageVector, title: String, text: String, button: String, onButton: () -> Unit) {
    BoxCard {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier
                    .size(68.dp)
                    .background(Colours.LightBlue, CircleShape)
                    .padding(6.dp)
                    .background(Brush.linearGradient(listOf(Colours.LightBlue, Colours.Selected)), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = Colours.Blue, modifier = Modifier.size(26.dp))
            }
            T(title, weight = FontWeight.Bold, align = TextAlign.Center)
            T(text, size = 13.sp, colour = Colours.Text2, align = TextAlign.Center)
            Btn(button, onButton, icon = Icons.Plus)
        }
    }
}
