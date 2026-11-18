package billingo.app

import billingo.app.ui.theme.Colours
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Only the 20 colours (docs/MOBILE-PLAN.md section 2, owner 15 Nov 2026). A colour written anywhere
 * else in the app's code or resources fails the build before an APK is made.
 */
class ColoursTest {
    /** The table of the plan, in order. */
    private val plan = listOf(
        "F8FAFC", "FFFFFF", "E2E8F0", "111827", "4B5563", "6B7280", "1D4ED8", "EFF6FF", "DBEAFE", "1E3A8A",
        "FFFFFF", "15803D", "F0FDF4", "C81E1E", "FEF2F2", "B45309", "FFFBEB", "F3F4F6", "4ADE80", "FCA5A5",
    )
    private val main = File("src/main")

    private fun hex(c: androidx.compose.ui.graphics.Color): String {
        val argb = (c.value shr 32).toLong() and 0xFFFFFFFFL
        return String.format("%06X", argb and 0xFFFFFFL)
    }

    @Test
    fun `the colour file holds exactly the 20 colours of the plan`() {
        assertEquals(plan, Colours.all.map(::hex))
        assertTrue(Colours.all.all { it.alpha == 1f })
    }

    @Test
    fun `no other colour is written in the code`() {
        val wrong = mutableListOf<String>()
        main.walkTopDown().filter { it.isFile && it.extension == "kt" && it.name != "Colours.kt" }.forEach { f ->
            f.readLines().forEachIndexed { i, line ->
                // Color(0x…), Color(red, green, blue) or Material's ready-made colours
                if (Regex("""\bColor\s*\(""").containsMatchIn(line) || Regex("""\bColor\.(Black|White|Red|Green|Blue|Gray|Grey|DarkGray|LightGray|Cyan|Magenta|Yellow)\b""").containsMatchIn(line)) {
                    wrong += "${f.name}:${i + 1}: ${line.trim()}"
                }
            }
        }
        assertTrue("Colours outside ui/theme/Colours.kt:\n" + wrong.joinToString("\n"), wrong.isEmpty())
    }

    @Test
    fun `resources use only the 20 colours`() {
        val allowed = plan.toSet()
        val wrong = mutableListOf<String>()
        main.resolve("res").walkTopDown().filter { it.isFile && it.extension == "xml" }.forEach { f ->
            Regex("""#([0-9A-Fa-f]{6,8})\b""").findAll(f.readText()).forEach { m ->
                val v = m.groupValues[1].uppercase().takeLast(6)
                if (v !in allowed) wrong += "${f.name}: #${m.groupValues[1]}"
            }
        }
        assertTrue("Colours outside the 20:\n" + wrong.joinToString("\n"), wrong.isEmpty())
    }
}
