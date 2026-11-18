package billingo.app.data

import android.content.Context
import android.provider.ContactsContract.CommonDataKinds.Phone
import billingo.app.ui.parties.PartyForm

/** A contact on the phone with a mobile number. */
data class PhoneContact(val name: String, val mobile: String)

object Contacts {
    /** A 10-digit Indian mobile number (starts with 6, 7, 8 or 9), as the server accepts. */
    fun isMobile(m: String) = m.length == 10 && m[0] in '6'..'9' && m.all { it.isDigit() }

    /** Contacts with a mobile number, one per number, sorted by name. */
    fun tidy(raw: List<Pair<String, String>>): List<PhoneContact> =
        raw.mapNotNull { (n, p) -> PartyForm.mobile(p).takeIf(::isMobile)?.let { PhoneContact(n.trim().ifBlank { it }, it) } }
            .distinctBy { it.mobile }
            .sortedBy { it.name.lowercase() }

    /** Reads the phone's contacts (needs the "Contacts" permission, asked first). */
    fun read(ctx: Context): List<PhoneContact> {
        val out = mutableListOf<Pair<String, String>>()
        ctx.contentResolver.query(Phone.CONTENT_URI, arrayOf(Phone.DISPLAY_NAME, Phone.NUMBER), null, null, null)?.use { c ->
            val n = c.getColumnIndex(Phone.DISPLAY_NAME)
            val p = c.getColumnIndex(Phone.NUMBER)
            while (c.moveToNext()) out += (c.getString(n) ?: "") to (c.getString(p) ?: "")
        }
        return tidy(out)
    }
}
