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

/** Screens opened on top of Home (Back closes the top one). */
sealed interface Route {
    /** the party list, maybe filtered to money to get ("rec") or to give ("pay") */
    data class Parties(val bal: String = "all") : Route
    data class Party(val id: String, val name: String) : Route
    data class Statement(val id: String, val name: String) : Route
    /** New Party ([id] null) or Edit Party */
    data class PartyForm(val id: String?) : Route
    data object Items : Route
    data class Item(val id: String, val name: String) : Route
    data class Adjust(val id: String) : Route
    /** New Item ([id] null, maybe with a scanned [code]) or Edit Item */
    data class ItemForm(val id: String?, val code: String = "") : Route
    // 8.4c
    data object Prices : Route
    data object BulkActive : Route
    data object Brands : Route
    data object Adjustments : Route
    data object Godowns : Route
    data object Transfer : Route
}

/** Home's lists; null when the server refused one (no permission) or it hasn't come yet. */
data class HomeData(
    val parties: List<Party>? = null,
    val sales: List<SaleRow>? = null,
    val items: List<Item>? = null,
    val problem: ApiError? = null,
)

/** Check For Update: what the last check found. */
sealed interface Update {
    data object Idle : Update
    data object Checking : Update
    data object Latest : Update
    data class Available(val version: String, val download: String) : Update
    data class Failed(val error: ApiError) : Update
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

    /** Home's lists (loaded when Home opens, again on pull-down) */
    var home by mutableStateOf(HomeData())
        private set
    var homeLoading by mutableStateOf(false)
        private set
    var update by mutableStateOf<Update>(Update.Idle)
        private set

    /** the screens open above Home, the top one last */
    val stack = androidx.compose.runtime.mutableStateListOf<Route>()
    fun open(r: Route) { stack.add(r) }
    fun back(): Boolean = if (stack.isEmpty()) false else { stack.removeAt(stack.lastIndex); true }

    /** the top screen replaced by another (a new party, once saved, opens its page) */
    fun replace(r: Route) { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex); stack.add(r) }

    /** after deleting an item or making it inactive: its form and its page both close */
    fun leaveItem(id: String) {
        while (stack.isNotEmpty()) {
            val t = stack.last()
            if ((t is Route.ItemForm && t.id == id) || (t is Route.Item && t.id == id) || (t is Route.Adjust && t.id == id)) stack.removeAt(stack.lastIndex) else break
        }
    }

    /** after deleting or closing a party: its form and its page both close */
    fun leaveParty(id: String) {
        while (stack.isNotEmpty()) {
            val t = stack.last()
            if ((t is Route.PartyForm && t.id == id) || (t is Route.Party && t.id == id) || (t is Route.Statement && t.id == id)) stack.removeAt(stack.lastIndex) else break
        }
    }

    /** the server, for screens that load their own data */
    val server: Api get() = api

    init { open() }

    /** Load Home's parties, bills and items, each on its own so one refusal doesn't hide the rest. */
    fun loadHome() {
        if (homeLoading) return
        homeLoading = true
        viewModelScope.launch {
            var problem: ApiError? = null
            suspend fun <T> one(get: suspend () -> T): T? = try { get() } catch (e: ApiError) { if (e.status != 403) problem = problem ?: e; null }
            val p = one { api.parties() }
            val s = one { api.sales() }
            val i = one { api.items() }
            // keep what was shown before when the internet is gone
            home = HomeData(p ?: home.parties, s ?: home.sales, i ?: home.items, problem)
            homeLoading = false
        }
    }

    /** Check For Update (design 7.4i): compare with the newest phone version on the releases page. */
    fun checkUpdate(current: String) {
        update = Update.Checking
        viewModelScope.launch {
            update = try {
                val v = api.appVersion()
                if (v.latest != null && v.download != null && newer(v.latest, current)) Update.Available(v.latest, v.download) else Update.Latest
            } catch (e: ApiError) { Update.Failed(e) }
        }
    }

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
        stack.clear()
        fingerprintOn = false
        screen = Screen.SignIn
    }

    fun clearProblem() { problem = null }

    private fun enter(me: Me, choose: Boolean) {
        store.companyName = me.business?.name
        screen = if (choose && me.memberships.size > 1) Screen.Choose(me) else Screen.Home(me)
        if (screen is Screen.Home) { home = HomeData(); stack.clear(); loadHome() }
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

/** "1.0.10" is newer than "1.0.9": compared as numbers. */
fun newer(a: String, b: String): Boolean {
    val x = a.split('.').map { it.toIntOrNull() ?: 0 }
    val y = b.split('.').map { it.toIntOrNull() ?: 0 }
    for (i in 0 until 3) if (x.getOrElse(i) { 0 } != y.getOrElse(i) { 0 }) return x.getOrElse(i) { 0 } > y.getOrElse(i) { 0 }
    return false
}
