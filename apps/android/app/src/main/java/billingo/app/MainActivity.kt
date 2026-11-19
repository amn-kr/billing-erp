package billingo.app

import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import billingo.app.data.Api
import billingo.app.data.AppModel
import billingo.app.data.SafeStore
import billingo.app.data.Route
import billingo.app.data.Screen
import billingo.app.ui.parties.PartiesScreen
import billingo.app.ui.parties.PartyFormScreen
import billingo.app.ui.parties.PartyScreen
import billingo.app.ui.parties.StatementScreen
import billingo.app.ui.blocks.BlocksScreen
import billingo.app.ui.home.CreateNewSheet
import billingo.app.ui.items.AdjustScreen
import billingo.app.ui.items.ItemScreen
import billingo.app.ui.items.ItemsScreen
import billingo.app.ui.home.HomeScreen
import billingo.app.ui.home.LanguageSheet
import billingo.app.ui.home.SideMenu
import billingo.app.ui.home.SignOutBox
import billingo.app.ui.signin.SignInScreen
import billingo.app.ui.start.ChooseCompanyScreen
import billingo.app.ui.start.LockScreen
import billingo.app.ui.start.StartingScreen
import billingo.app.ui.start.words
import billingo.app.ui.theme.BillinGoTheme

class MainActivity : AppCompatActivity() {
    private lateinit var api: Api

    private val model: AppModel by lazy {
        val store = SafeStore(applicationContext)
        api = Api(BuildConfig.API_URL, store)
        ViewModelProvider(this, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = AppModel(api, store, ::fingerprintReady) as T
        })[AppModel::class.java]
    }

    /** "No Internet" (design 7.4j): Android tells us when the phone loses or finds a network. */
    private var online by mutableStateOf(true)
    private val net = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            runOnUiThread { val was = online; online = true; if (!was && model.screen is Screen.Home) model.loadHome() }
        }
        // the phone's main network is gone; when another one takes over, onAvailable comes next
        override fun onLost(network: Network) { runOnUiThread { online = false } }
    }
    private fun hasNetwork(): Boolean = getSystemService(ConnectivityManager::class.java).activeNetwork != null

    /** The phone has a fingerprint (or face) or a screen lock set up. */
    private fun fingerprintReady(): Boolean =
        BiometricManager.from(this).canAuthenticate(BIOMETRIC_WEAK or DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS

    /** Android's own fingerprint window; the phone's screen lock (PIN or pattern) is offered too. */
    private fun unlock() {
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = model.resume()
        })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(getString(R.string.unlock_title))
                .setSubtitle(getString(R.string.unlock_sub))
                .setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL)
                .build(),
        )
    }

    /** English or Hindi for the whole app; Android keeps the choice (also on Android 7 to 12). */
    private fun setLanguage(code: String) = AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(code))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val m = model
        online = hasNetwork()
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(net)
        val later = { Toast.makeText(this, R.string.later_step, Toast.LENGTH_SHORT).show() }
        val gst = { Toast.makeText(this, R.string.gst_soon, Toast.LENGTH_SHORT).show() }
        setContent {
            BillinGoTheme {
                // test builds can open the Building Blocks page: --ez blocks true, or 5 taps on the version line
                var blocks by rememberSaveable { mutableStateOf(BuildConfig.DEBUG && intent.getBooleanExtra("blocks", false)) }
                var languageOpen by rememberSaveable { mutableStateOf(false) }
                var menuOpen by rememberSaveable { mutableStateOf(false) }
                var createOpen by rememberSaveable { mutableStateOf(false) }
                var signOutOpen by rememberSaveable { mutableStateOf(false) }
                val waking by api.slow.collectAsState()
                val holder = rememberSaveableStateHolder()
                val hindi = resources.configuration.locales[0].language == "hi"
                if (blocks) { BlocksScreen(onBack = { blocks = false }); return@BillinGoTheme }
                val problem = words(m.problem)
                Box(Modifier.fillMaxSize()) {
                    when (val s = m.screen) {
                        is Screen.Starting -> StartingScreen(s.problem, m::resume, { m.signOut() })
                        Screen.SignIn -> SignInScreen(
                            version = BuildConfig.VERSION_NAME,
                            busy = m.busy,
                            problem = problem,
                            onSignIn = m::signIn,
                            onRegister = m::register,
                            onLanguage = { languageOpen = true },
                            onSecret = if (BuildConfig.DEBUG) ({ blocks = true }) else null,
                        )
                        is Screen.Choose -> ChooseCompanyScreen(s.me, m.busy, problem, m::choose, if (s.fromHome) ({ m.backHome(s.me) }) else null)
                        is Screen.Lock -> {
                            LockScreen(s.company, ::unlock, ::unlock) { m.signOut() }
                            LaunchedEffect(Unit) { unlock() }
                        }
                        is Screen.Home -> {
                            val shop = s.me.business?.name ?: ""
                            // a screen opened above Home; the phone's Back closes it
                            val top = m.stack.lastOrNull()
                            if (top != null) {
                                BackHandler { m.back() }
                                // each open screen keeps its own choices (tab, filter, search) while another is on top
                                holder.SaveableStateProvider("${m.stack.size}:$top") {
                                when (top) {
                                    is Route.Parties -> PartiesScreen(m.server, top.bal, { m.back() }, { p -> m.open(Route.Party(p.id, p.name)) }, { m.open(Route.PartyForm(null)) })
                                    is Route.Party -> PartyScreen(m.server, top.id, top.name, shop, { m.back() }, { m.open(Route.Statement(top.id, top.name)) }, { m.open(Route.PartyForm(top.id)) }, later)
                                    Route.Items -> ItemsScreen(m.server, { m.back() }, { i -> m.open(Route.Item(i.id, i.name)) }, later)
                                    is Route.Item -> ItemScreen(m.server, top.id, top.name, { m.back() }, { m.open(Route.Adjust(top.id)) }, later)
                                    is Route.Adjust -> AdjustScreen(m.server, top.id) { m.back(); m.loadHome() }
                                    is Route.PartyForm -> PartyFormScreen(
                                        m.server, top.id, { m.back() },
                                        onSaved = { id, name -> m.replace(Route.Party(id, name)); m.loadHome() },
                                        onGone = { top.id?.let(m::leaveParty); m.loadHome() },
                                    )
                                    is Route.Statement -> StatementScreen(m.server, top.id, top.name, { m.back() }, later)
                                }
                                }
                                return@Box
                            }
                            HomeScreen(
                                me = s.me,
                                data = m.home,
                                loading = m.homeLoading,
                                offline = !online,
                                waking = waking > 0,
                                onMenu = { menuOpen = true },
                                onCreate = { createOpen = true },
                                onRefresh = m::loadHome,
                                onLater = later,
                                onParties = { bal -> m.open(Route.Parties(bal)) },
                                onParty = { p -> m.open(Route.Party(p.id, p.name)) },
                                onItem = { i -> m.open(Route.Item(i.id, i.name)) },
                            )
                            if (menuOpen) {
                                BackHandler { menuOpen = false }
                                SideMenu(
                                    company = s.me.business?.name ?: "",
                                    canChange = s.me.memberships.size > 1,
                                    version = BuildConfig.VERSION_NAME,
                                    update = m.update,
                                    onClose = { menuOpen = false },
                                    onChangeCompany = { menuOpen = false; m.switchCompany() },
                                    onLater = later,
                                    onParties = { menuOpen = false; m.open(Route.Parties()) },
                                    onItems = { menuOpen = false; m.open(Route.Items) },
                                    onGst = gst,
                                    onSignOut = { menuOpen = false; signOutOpen = true },
                                    onCheckUpdate = { m.checkUpdate(BuildConfig.VERSION_NAME) },
                                    onDownload = { url -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) },
                                    fingerprintAvailable = fingerprintReady(),
                                    fingerprintOn = m.fingerprintOn,
                                    onFingerprint = m::setFingerprint,
                                )
                            }
                            if (createOpen) {
                                BackHandler { createOpen = false }
                                // the New Party tile (10th) opens the form; the others come in later steps
                                CreateNewSheet({ createOpen = false }) { i -> createOpen = false; if (i == 9) m.open(Route.PartyForm(null)) else later() }
                            }
                            if (signOutOpen) {
                                BackHandler { signOutOpen = false }
                                SignOutBox({ signOutOpen = false }) { signOutOpen = false; m.signOut() }
                            }
                        }
                    }
                    if (languageOpen) {
                        BackHandler { languageOpen = false }
                        LanguageSheet(hindi, { languageOpen = false }) { code -> languageOpen = false; setLanguage(code) }
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(net)
        super.onDestroy()
    }
}
