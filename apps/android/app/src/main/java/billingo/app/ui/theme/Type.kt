package billingo.app.ui.theme

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import billingo.app.R

/** Inter for English, Noto Sans Devanagari for Hindi, both packed inside the app (owner, 18 Nov 2026). */
val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
)

val Devanagari = FontFamily(
    Font(R.font.noto_devanagari_regular, FontWeight.Normal),
    Font(R.font.noto_devanagari_medium, FontWeight.Medium),
    Font(R.font.noto_devanagari_semibold, FontWeight.SemiBold),
    Font(R.font.noto_devanagari_bold, FontWeight.Bold),
)
