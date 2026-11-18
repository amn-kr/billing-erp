package billingo.app.ui.theme

import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The font for the language on screen: Hindi gets Noto Sans Devanagari, everything else Inter. */
val LocalFont = staticCompositionLocalOf { Inter }

/** Sizes from the design (reference/design/mobile.html). */
object Size {
    /** smallest tap target */
    val Tap = 44.dp
    val RadiusSmall = 8.dp
    val Radius = 12.dp
    val RadiusLarge = 16.dp
}

@Composable
fun BillinGoTheme(content: @Composable () -> Unit) {
    val hindi = LocalConfiguration.current.locales[0].language == "hi"
    val font = if (hindi) Devanagari else Inter
    CompositionLocalProvider(
        LocalFont provides font,
        LocalTextStyle provides TextStyle(fontFamily = font, fontSize = 15.sp, color = Colours.Text),
        LocalTextSelectionColors provides TextSelectionColors(handleColor = Colours.Blue, backgroundColor = Colours.Selected),
        content = content,
    )
}
