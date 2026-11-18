package billingo.app.ui.parts

import java.math.BigDecimal
import java.math.RoundingMode
import java.util.Calendar
import java.util.TimeZone

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

    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    private val MONTHS_HI = listOf("जन॰", "फ़र॰", "मार्च", "अप्रैल", "मई", "जून", "जुल॰", "अग॰", "सित॰", "अक्टू॰", "नव॰", "दिस॰")

    /** "2026-11-16" → "16 Nov 2026" (one date style everywhere, owner 15 Nov 2026); Hindi "16 नव॰ 2026". */
    fun date(iso: String, hindi: Boolean = false): String {
        val (y, m, d) = iso.take(10).split("-").map { it.toInt() }
        return "$d ${(if (hindi) MONTHS_HI else MONTHS)[m - 1]} $y"
    }

    /** Today in India (the business timezone is Asia/Kolkata), as "2026-11-16". */
    fun todayIso(): String {
        val c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Kolkata"))
        return "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    }

    /** Days from [from] to [to] ("2026-11-01" → "2026-11-16" is 15), counted on the calendar. */
    fun daysBetween(from: String, to: String): Int {
        fun day(iso: String): Long {
            val (y, m, d) = iso.take(10).split("-").map { it.toInt() }
            val c = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
            c.clear(); c.set(y, m - 1, d)
            return c.timeInMillis / 86_400_000L
        }
        return (day(to) - day(from)).toInt()
    }

    /** "120.000" → "120", "2.500" → "2.5": a quantity without needless zeros, Indian grouping. */
    fun qty(v: String?): String {
        if (v.isNullOrBlank()) return "0"
        val b = BigDecimal(v).stripTrailingZeros()
        val plain = if (b.scale() < 0) b.setScale(0).toPlainString() else b.toPlainString()
        val neg = plain.startsWith("-")
        val body = plain.removePrefix("-")
        val whole = body.substringBefore('.')
        val frac = body.substringAfter('.', "")
        return (if (neg) "-" else "") + group(whole) + (if (frac.isNotEmpty()) ".$frac" else "")
    }
}
