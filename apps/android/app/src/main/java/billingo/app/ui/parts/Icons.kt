package billingo.app.ui.parts

import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp
import billingo.app.ui.theme.Colours

/**
 * The design's line icons, copied from the <symbol>s of reference/design/mobile.html (24×24, stroke 2,
 * round ends). Drawn in Text colour and tinted where used. The extra EyeOff is the eye with a line.
 */
object Icons {
    private fun icon(name: String, vararg paths: String): ImageVector {
        val b = ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        for (d in paths) {
            b.addPath(
                pathData = PathParser().parsePathString(d).toNodes(),
                stroke = SolidColor(Colours.Text),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        return b.build()
    }

    /** #plus */
    val Plus by lazy { icon("plus", "M12 5v14M5 12h14") }
    /** #search */
    val Search by lazy { icon("search", "M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "m20 20-4-4") }
    /** #trash */
    val Trash by lazy { icon("trash", "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3") }
    /** #share */
    val Share by lazy { icon("share", "M12 3v12M8 7l4-4 4 4M5 13v6h14v-6") }
    /** #book */
    val Book by lazy { icon("book", "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z", "M9.5 10a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M8.5 16a3.5 3.5 0 0 1 7 0") }
    /** #scan */
    val Scan by lazy { icon("scan", "M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 9v6M11 9v6M14 9v6M17 9v6") }
    /** #menu */
    val Menu by lazy { icon("menu", "M4 7h16M4 12h16M4 17h16") }
    /** #bell */
    val Bell by lazy { icon("bell", "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4") }
    /** #back */
    val Back by lazy { icon("back", "M15 5l-7 7 7 7") }
    /** #next */
    val Next by lazy { icon("next", "M9 5l7 7-7 7") }
    /** #nowifi */
    val NoWifi by lazy { icon("nowifi", "M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-3-2M2 8.8a15 15 0 0 1 4.5-2.6M22 8.8A15 15 0 0 0 12 5M12 20h.01") }
    /** #clock */
    val Clock by lazy { icon("clock", "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M12 7v5l3 2") }
    /** #check */
    val Check by lazy { icon("check", "M5 12l5 5L20 7") }
    /** #down */
    val Down by lazy { icon("down", "M12 5v14M6 13l6 6 6-6") }
    /** #up */
    val Up by lazy { icon("up", "M12 19V5M6 11l6-6 6 6") }
    /** #bill */
    val Bill by lazy { icon("bill", "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6") }
    /** #rupee */
    val Rupee by lazy { icon("rupee", "M7 5h10M7 9h10M7 5h3a4 4 0 0 1 0 8H7l7 7") }
    /** #box */
    val Box by lazy { icon("box", "M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10") }
    /** #user */
    val User by lazy { icon("user", "M8 8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M4 21a8 8 0 0 1 16 0") }
    /** #wallet */
    val Wallet by lazy { icon("wallet", "M3 7h16v12H3zM3 7l12-3v3M15 13h2") }
    /** #cart */
    val Cart by lazy { icon("cart", "M3 4h2l2 11h11l2-8H6M9 20h.01M17 20h.01") }
    /** #cal */
    val Calendar by lazy { icon("cal", "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4") }
    /** #gear */
    val Gear by lazy { icon("gear", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1") }
    /** #finger */
    val Fingerprint by lazy { icon("finger", "M12 11v3a6 6 0 0 1-1 3.5M8.5 12.5V11a3.5 3.5 0 0 1 7 0v2.5a10 10 0 0 1-.6 3.5M5.5 15V11a6.5 6.5 0 0 1 11-4.7M18.4 10.5a6.5 6.5 0 0 1 .1 1v1.5M3 9a9.5 9.5 0 0 1 3-4.5M15 2.9A9.5 9.5 0 0 1 21 9") }
    /** #globe */
    val Globe by lazy { icon("globe", "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18") }
    /** #xic */
    val Close by lazy { icon("xic", "M6 6l12 12M18 6 6 18") }
    /** #eyei */
    val Eye by lazy { icon("eyei", "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0") }
    /** #lockic */
    val Lock by lazy { icon("lockic", "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4") }
    /** #chat */
    val Chat by lazy { icon("chat", "M4 20l1.3-3.9A8 8 0 1 1 8 19.3z", "M9 10h.01M12 10h.01M15 10h.01") }
    /** #phone */
    val Phone by lazy { icon("phone", "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z") }
    /** #edit */
    val Edit by lazy { icon("edit", "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4") }
    /** #bulb */
    val Bulb by lazy { icon("bulb", "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z") }
    /** #imp */
    val Import by lazy { icon("imp", "M12 3v11M8 10l4 4 4-4M4 15v4h16v-4") }
    /** #dots */
    val Dots by lazy { icon("dots", "M12 5h.01M12 12h.01M12 19h.01") }
    /** #filter */
    val Filter by lazy { icon("filter", "M4 6h16M7 12h10M10 18h4") }
    /** #eyei with a line across: "Hide Password" */
    val EyeOff by lazy { icon("eyeOff", "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M4 4l16 16") }
    /** the small arrow of a choice field (the design uses the browser's own) */
    val Chevron by lazy { icon("chevron", "M6 9l6 6 6-6") }
}
