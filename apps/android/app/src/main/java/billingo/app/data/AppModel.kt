package billingo.app.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

/** Which screen the app shows. */
sealed interface Screen {
    /** opening: renewing the sign-in; [problem] when the server can't be reached */
    data class Starting(val problem: ApiError? = null) : Screen
    data object SignIn : Screen
    /** more than one company: choose where to work */
    data class Choose(val me: Me, val fromHome: Boolean = false) : Screen
    /** fingerprint unlock is on: "Welcome Back" */
    data class Lock(val company: String) : Screen
    data class Home(val me: Me) : Screen
}

/**
 * The app's sign-in journey (design 7.4a: Sign In → Choose Company → Home; next time the
 * fingerprint, when it is on). The server stays the boss: the phone keeps only the sign-in token.
 */
class AppModel(private val api: Api, private val store: Store, private val fingerprintReady: () -> Boolean) : ViewModel() {
    var screen by mutableStateOf<Screen>(Screen.Starting())
        private set
    /** a sign-in or company switch in progress */
    var busy by mutableStateOf(false)
        private set
    /** the last refusal, shown under the form (the screen turns it into words, in English or Hindi) */
    var problem by mutableStateOf<ApiError?>(null)
        private set

    init { open() }

    /** On opening: no saved sign-in → Sign In; fingerprint on → Welcome Back; else straight in. */
    fun open() {
        if (store.refreshToken == null) { screen = Screen.SignIn; return }
        if (store.fingerprint && fingerprintReady()) { screen = Screen.Lock(store.companyName ?: ""); return }
        resume()
    }

    /** After the fingerprint, or when it is off: renew the sign-in and go in. */
    fun resume() {
        screen = Screen.Starting()
        viewModelScope.launch {
            try {
                if (!api.renew()) { screen = Screen.SignIn; return@launch }
                enter(api.me(), choose = false)
            } catch (e: ApiError) {
                screen = Screen.Starting(e)
            }
        }
    }

    fun signIn(email: String, password: String) = act {
        if (email.isBlank()) throw ApiError(400, "", NEED_EMAIL)
        if (password.isEmpty()) throw ApiError(400, "", NEED_PASSWORD)
        val t = api.login(email.trim(), password)
        if (t.owner) { api.logout(); throw ApiError(403, "", OWNER_ACCOUNT) }
        enter(api.me(), choose = true)
    }

    fun register(name: String, email: String, password: String) = act {
        if (email.isBlank()) throw ApiError(400, "", NEED_EMAIL)
        if (password.isEmpty()) throw ApiError(400, "", NEED_PASSWORD)
        api.register(name.trim(), email.trim(), password)
        enter(api.me(), choose = true)
    }

    fun choose(m: Membership) = act {
        api.switchCompany(m.businessId)
        enter(api.me(), choose = false)
    }

    /** Home's "Switch Company": the list again. */
    fun switchCompany() = act { screen = Screen.Choose(api.me(), fromHome = true) }

    /** Back from Choose Company to Home (when it was opened from Home). */
    fun backHome(me: Me) { screen = Screen.Home(me) }

    /** Fingerprint Unlock, saved on the phone (it moves to Settings in 8.10). */
    var fingerprintOn by mutableStateOf(store.fingerprint)
        private set

    fun setFingerprint(on: Boolean) { store.fingerprint = on; fingerprintOn = on }

    fun signOut() = act {
        api.logout()
        fingerprintOn = false
        screen = Screen.SignIn
    }

    fun clearProblem() { problem = null }

    private fun enter(me: Me, choose: Boolean) {
        store.companyName = me.business?.name
        screen = if (choose && me.memberships.size > 1) Screen.Choose(me) else Screen.Home(me)
    }

    private fun act(work: suspend () -> Unit) {
        if (busy) return
        busy = true
        problem = null
        viewModelScope.launch {
            try { work() } catch (e: ApiError) { problem = e } finally { busy = false }
        }
    }

    companion object {
        /** the phone's own refusals (their words are in strings.xml) */
        const val NEED_EMAIL = "need_email"
        const val NEED_PASSWORD = "need_password"
        const val OWNER_ACCOUNT = "owner_account"
    }
}
