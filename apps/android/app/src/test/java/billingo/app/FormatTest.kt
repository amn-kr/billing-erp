package billingo.app

import billingo.app.ui.parts.Format
import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTest {
    @Test
    fun `amounts use Indian grouping with paise`() {
        assertEquals("0.00", Format.inr("0"))
        assertEquals("95.00", Format.inr("95"))
        assertEquals("2,123.00", Format.inr("2123"))
        assertEquals("21,749.40", Format.inr("21749.4"))
        assertEquals("1,60,119.00", Format.inr("160119"))
        assertEquals("12,34,567.89", Format.inr("1234567.89"))
        assertEquals("99,99,99,999.99", Format.inr("999999999.99"))
        assertEquals("-4,000.00", Format.inr("-4000"))
    }

    @Test
    fun `paise can be left out when there are none`() {
        assertEquals("1,60,119", Format.inr("160119", paise = false))
        assertEquals("25,872.40", Format.inr("25872.40", paise = false))
        assertEquals("25,872" to ".40", Format.split("25872.40"))
        assertEquals("1,60,119" to "", Format.split("160119"))
    }

    @Test
    fun `half a paisa rounds up, never with floats`() {
        assertEquals("0.01", Format.inr("0.005"))
        assertEquals("100.00", Format.inr("99.995"))
    }

    @Test
    fun `dates look the same everywhere`() {
        assertEquals("16 Nov 2026", Format.date("2026-11-16"))
        assertEquals("1 Oct 2026", Format.date("2026-10-01"))
        assertEquals("16 नव॰ 2026", Format.date("2026-11-16", hindi = true))
        assertEquals("25 सित॰ 2026", Format.date("2026-09-25T10:00:00Z", hindi = true))
    }

    @Test
    fun `days and quantities`() {
        assertEquals(15, Format.daysBetween("2026-11-01", "2026-11-16"))
        assertEquals(1, Format.daysBetween("2026-02-28", "2026-03-01"))
        assertEquals(-3, Format.daysBetween("2026-11-16", "2026-11-13"))
        assertEquals("120", Format.qty("120.000"))
        assertEquals("2.5", Format.qty("2.500"))
        assertEquals("1,200", Format.qty("1200"))
        assertEquals("0", Format.qty(null))
    }
}
