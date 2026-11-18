package billingo.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * What the app keeps between openings: the "stay signed in" token, its end date, the company last
 * opened and whether fingerprint unlock is on. Kept small on purpose; data comes from the server.
 */
interface Store {
    var refreshToken: String?
    var refreshExpires: String?
    var companyName: String?
    var fingerprint: Boolean
    fun clearSignIn()
}

/** For tests: everything in memory. */
class MemoryStore : Store {
    override var refreshToken: String? = null
    override var refreshExpires: String? = null
    override var companyName: String? = null
    override var fingerprint: Boolean = false
    override fun clearSignIn() { refreshToken = null; refreshExpires = null; companyName = null; fingerprint = false }
}

/**
 * The phone's safe store (owner, 18 Nov 2026): the token is locked with a key that lives inside
 * Android's Keystore and never leaves it (AES-GCM). Without that key the saved text is useless.
 */
class SafeStore(context: Context) : Store {
    private val prefs = context.getSharedPreferences("billingo.safe", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private fun lock(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun unlock(saved: String): String? = try {
        val all = Base64.decode(saved, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all, 0, 12))
        String(c.doFinal(all, 12, all.size - 12), Charsets.UTF_8)
    } catch (e: Exception) {
        null // a changed or lost key (for example after a phone reset): sign in again
    }

    private fun secret(name: String) = prefs.getString(name, null)?.let(::unlock)
    private fun secret(name: String, v: String?) = prefs.edit().apply { if (v == null) remove(name) else putString(name, lock(v)) }.apply()

    override var refreshToken: String?
        get() = secret("rt")
        set(v) = secret("rt", v)
    override var refreshExpires: String?
        get() = prefs.getString("rtEnds", null)
        set(v) = prefs.edit().putString("rtEnds", v).apply()
    override var companyName: String?
        get() = prefs.getString("company", null)
        set(v) = prefs.edit().putString("company", v).apply()
    override var fingerprint: Boolean
        get() = prefs.getBoolean("fingerprint", false)
        set(v) = prefs.edit().putBoolean("fingerprint", v).apply()

    override fun clearSignIn() = prefs.edit().clear().apply()

    private companion object { const val ALIAS = "billingo.signin" }
}
