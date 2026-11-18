package billingo.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The only colours the phone app may use: the 20 of docs/MOBILE-PLAN.md section 2 (owner,
 * 15 Nov 2026). ColoursTest fails if a colour is written anywhere else in the app's code.
 * Shadows and shine use these same colours made see-through (owner, 16 Nov 2026): [see].
 */
object Colours {
    val Page = Color(0xFFF8FAFC)
    val Card = Color(0xFFFFFFFF)
    val Border = Color(0xFFE2E8F0)
    val Text = Color(0xFF111827)
    val Text2 = Color(0xFF4B5563)
    val Text3 = Color(0xFF6B7280)
    val Blue = Color(0xFF1D4ED8)
    val LightBlue = Color(0xFFEFF6FF)
    val Selected = Color(0xFFDBEAFE)
    val Navy = Color(0xFF1E3A8A)
    val OnColour = Color(0xFFFFFFFF)
    val Green = Color(0xFF15803D)
    val LightGreen = Color(0xFFF0FDF4)
    val Red = Color(0xFFC81E1E)
    val LightRed = Color(0xFFFEF2F2)
    val Orange = Color(0xFFB45309)
    val LightOrange = Color(0xFFFFFBEB)
    val LightSlate = Color(0xFFF3F4F6)
    val BrightGreen = Color(0xFF4ADE80)
    val BrightRed = Color(0xFFFCA5A5)

    /** All 20, in the order of the plan's table. */
    val all = listOf(
        Page, Card, Border, Text, Text2, Text3, Blue, LightBlue, Selected, Navy,
        OnColour, Green, LightGreen, Red, LightRed, Orange, LightOrange, LightSlate, BrightGreen, BrightRed,
    )

    /** One of the 20 colours made see-through, for shadows and shine only. */
    fun see(c: Color, alpha: Float): Color = c.copy(alpha = alpha)
}
