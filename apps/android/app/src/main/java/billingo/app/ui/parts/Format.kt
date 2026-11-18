package billingo.app.ui.parts

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Money and numbers as the design shows them, Indian grouping (1,60,119.40). Amounts come from the
 * server as strings with 2 decimals and stay BigDecimal here: never floats (project rule).
 */
object Format {
    /** "160119.4" → "1,60,119.40"; [paise] false drops ".00" only when the paise are zero. */
    fun inr(amount: String, paise: Boolean = true): String = inr(BigDecimal(amount.ifBlank { "0" }), paise)

    fun inr(amount: BigDecimal, paise: Boolean = true): String {
        val v = amount.setScale(2, RoundingMode.HALF_UP)
        val neg = v.signum() < 0
        val abs = v.abs()
        val rupees = abs.toBigInteger().toString()
        val p = abs.remainder(BigDecimal.ONE).movePointRight(2).toBigInteger().toInt()
        val grouped = group(rupees)
        val tail = if (paise || p != 0) "." + p.toString().padStart(2, '0') else ""
        return (if (neg) "-" else "") + grouped + tail
    }

    /** The rupees and the paise apart, for the big amounts where paise are shown smaller (.amt small). */
    fun split(amount: String): Pair<String, String> {
        val s = inr(amount, paise = false)
        val dot = s.indexOf('.')
        return if (dot < 0) s to "" else s.substring(0, dot) to s.substring(dot)
    }

    /** Indian grouping: last 3 digits, then pairs (12,34,567). */
    fun group(digits: String): String {
        if (digits.length <= 3) return digits
        val last = digits.takeLast(3)
        val rest = digits.dropLast(3)
        val pairs = rest.reversed().chunked(2).joinToString(",") { it }.reversed()
        return "$pairs,$last"
    }
}
