package billingo.app

import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
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
import billingo.app.ui.docs.BillScreen
import billingo.app.ui.docs.BrandQuoteScreen
import billingo.app.ui.docs.ChallanFormScreen
import billingo.app.ui.docs.ChallanScreen
import billingo.app.ui.docs.ChallansScreen
import billingo.app.ui.docs.PaymentsScreen
import billingo.app.ui.docs.QuoteScreen
import billingo.app.ui.docs.ReceiptScreen
import billingo.app.ui.docs.ReceiveScreen
import billingo.app.ui.docs.QuotesScreen
import billingo.app.ui.docs.SaleBillsScreen
import billingo.app.ui.items.AdjustScreen
import billingo.app.ui.items.AdjustmentsScreen
import billingo.app.ui.items.BrandsScreen
import billingo.app.ui.items.BulkActiveScreen
import billingo.app.ui.items.GodownsScreen
import billingo.app.ui.items.PriceManagerScreen
import billingo.app.ui.items.TransferScreen
import billingo.app.ui.sale.CustomerScreen
import billingo.app.ui.sale.SaleLineScreen
import billingo.app.ui.sale.SaleScreen
import billingo.app.ui.sale.SavedScreen
import billingo.app.ui.items.ItemFormScreen
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

    @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
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
                val kept = remember { mutableSetOf<String>() }
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
                            val features = s.me.business?.features.orEmpty()
                            // a screen opened above Home; the phone's Back closes it
                            val top = m.stack.lastOrNull()
                            // a closed screen forgets what it kept, so a second New Item opens empty
                            val live = m.stack.mapIndexed { i, r -> "${i + 1}:$r" }.toSet()
                            SideEffect { kept.filter { it !in live }.forEach { holder.removeState(it); kept.remove(it) }; kept.addAll(live) }
                            if (top != null) {
                                // with the keyboard open, Back only closes the keyboard (what was typed stays)
                                val imeOpen = WindowInsets.isImeVisible
                                val keyboard = LocalSoftwareKeyboardController.current
                                val focus = LocalFocusManager.current
                                BackHandler { if (imeOpen) { focus.clearFocus(); keyboard?.hide() } else m.back() }
                                // each open screen keeps its own choices (tab, filter, search) while another is on top
                                holder.SaveableStateProvider("${m.stack.size}:$top") {
                                when (top) {
                                    is Route.Parties -> PartiesScreen(m.server, top.bal, { m.back() }, { p -> m.open(Route.Party(p.id, p.name)) }, { m.open(Route.PartyForm(null)) })
                                    is Route.Party -> PartyScreen(
                                        m.server, top.id, top.name, shop, { m.back() }, { m.open(Route.Statement(top.id, top.name)) }, { m.open(Route.PartyForm(top.id)) }, later,
                                        onBill = { id, no -> m.open(Route.Bill(id, no)) }, onNewBill = { m.newSale(features, partyId = top.id) },
                                        onTakePayment = { m.open(Route.Receive(partyId = top.id)) },
                                    )
                                    Route.Items -> ItemsScreen(m.server, { m.back() }, { i -> m.open(Route.Item(i.id, i.name)) }, { code -> m.open(Route.ItemForm(null, code)) }) { n ->
                                        // Items › More: Price Manager, Bulk Active / Inactive, Brands And Series, Stock Adjustments, Godowns; the rate list comes with the PDF (8.5)
                                        when (n) { 0 -> m.open(Route.Prices); 1 -> m.open(Route.BulkActive); 2 -> m.open(Route.Brands); 3 -> m.open(Route.Adjustments); 4 -> m.open(Route.Godowns); else -> later() }
                                    }
                                    Route.Prices -> PriceManagerScreen(m.server, { m.back() }, later)
                                    Route.BulkActive -> BulkActiveScreen(m.server, { m.back() }) { m.loadHome() }
                                    Route.Brands -> BrandsScreen(m.server) { m.back() }
                                    Route.Adjustments -> AdjustmentsScreen(m.server, { m.back() }, { id, name -> m.open(Route.Item(id, name)) }) { id -> m.open(Route.Adjust(id)) }
                                    Route.Godowns -> GodownsScreen(m.server, { m.back() }) { m.open(Route.Transfer) }
                                    Route.Transfer -> TransferScreen(m.server, { m.back() }) { m.back(); m.loadHome() }
                                    is Route.Item -> ItemScreen(m.server, top.id, top.name, { m.back() }, { m.open(Route.Adjust(top.id)) }, { m.open(Route.ItemForm(top.id)) }, later) { m.newSale(features, itemId = top.id) }
                                    is Route.ItemForm -> ItemFormScreen(
                                        m.server, top.id, top.code, s.me.business?.features.orEmpty(), { m.back() },
                                        onSaved = { id, name -> m.replace(Route.Item(id, name)); m.loadHome() },
                                        onGone = { top.id?.let(m::leaveItem); m.loadHome() },
                                    )
                                    is Route.Adjust -> AdjustScreen(m.server, top.id) { m.back(); m.loadHome() }
                                    is Route.PartyForm -> PartyFormScreen(
                                        m.server, top.id, { m.back() },
                                        // from Choose Customer: back to the bill, with the new party on it
                                        onSaved = { id, name -> if (top.forSale) { m.back(); m.back(); m.saleParty(features, id) } else m.replace(Route.Party(id, name)); m.loadHome() },
                                        onGone = { top.id?.let(m::leaveParty); m.loadHome() },
                                    )
                                    is Route.Statement -> StatementScreen(m.server, top.id, top.name, { m.back() }, later)
                                    Route.Sale -> SaleScreen(
                                        m.sale, { m.back() }, { m.open(Route.SaleCustomer) }, { k, item -> m.open(Route.SaleLine(k, item)) },
                                        onSaved = {
                                            val q = m.sale.saved
                                            // a quotation opens its own page once saved (design 7.4e); a bill shows Bill Saved
                                            if (q != null && q.second.quote) {
                                                if (q.second.edit != null) m.back() else m.replace(Route.Quote(q.first.id, q.first.number, m.sale.after))
                                                android.widget.Toast.makeText(this@MainActivity, getString(R.string.qt_saved, q.first.number), android.widget.Toast.LENGTH_SHORT).show()
                                            } else m.replace(Route.SaleSaved)
                                            m.loadHome(); m.docsChanged()
                                        },
                                        onNew = { m.saleAgain(features); m.loadHome() },
                                        onTryAgain = { m.saleRetry(features) },
                                        onLater = later,
                                    )
                                    Route.SaleCustomer -> CustomerScreen(m.sale, { m.back() }) { m.open(Route.PartyForm(null, forSale = true)) }
                                    is Route.SaleLine -> SaleLineScreen(m.sale, top.index, top.itemId) { m.back() }
                                    Route.SaleBills -> SaleBillsScreen(m.server, { m.back() }, { b -> m.open(Route.Bill(b.id, b.number)) }) { m.newSale(features) }
                                    is Route.Bill -> BillScreen(
                                        m.server, top.id, top.number, features, s.me.business?.itemOptions, m.docsVersion, { m.back() },
                                        onParty = { id, name -> m.open(Route.Party(id, name)) },
                                        onChanged = { m.loadHome(); m.docsChanged() },
                                        onEdit = { m.sale.missingWords = { getString(R.string.eb_missing, it.joinToString(", ")) }; m.editSale(features, top.id) },
                                        onLater = later,
                                        onTakePayment = { p -> m.open(Route.Receive(partyId = p)) },
                                    )
                                    is Route.Quotes -> QuotesScreen(
                                        m.server, top.pick, { m.back() }, { q -> m.open(Route.Quote(q.id, q.number)) },
                                        onItems = { m.newQuote(features) }, onBrand = { m.open(Route.BrandQuote()) },
                                    )
                                    is Route.Quote -> QuoteScreen(
                                        m.server, top.id, top.number, top.after, features, s.me.business?.itemOptions, m.docsVersion, { m.back() },
                                        onParty = { id, name -> m.open(Route.Party(id, name)) },
                                        onBill = { id, no -> m.open(Route.Bill(id, no)) },
                                        onEdit = { m.sale.missingWords = { getString(R.string.eb_missing, it.joinToString(", ")) }; m.editSale(features, top.id) },
                                        onCopy = { m.sale.missingWords = { getString(R.string.eb_missing, it.joinToString(", ")) }; m.copyQuote(features, top.id) },
                                        onConvert = { m.quoteToBill(features, top.id) },
                                        onBrandEdit = { m.open(Route.BrandQuote(id = top.id)) },
                                        onBrandCopy = { m.open(Route.BrandQuote(copyOf = top.id)) },
                                        onBrandBill = { ser -> m.brandToBill(features, top.id, ser) },
                                        onChanged = { m.loadHome(); m.docsChanged() },
                                        onLater = later,
                                    )
                                    is Route.BrandQuote -> BrandQuoteScreen(m.server, features, top.id, top.copyOf, { m.back() }) { id, no ->
                                        // a changed one goes back to its page; a new one opens its page (design 7.4e)
                                        if (top.id != null) m.back() else m.replace(Route.Quote(id, no))
                                        android.widget.Toast.makeText(this@MainActivity, getString(R.string.qt_saved, no), android.widget.Toast.LENGTH_SHORT).show()
                                        m.loadHome(); m.docsChanged()
                                    }
                                    Route.Challans -> ChallansScreen(m.server, { m.back() }, { c -> m.open(Route.Challan(c.id, c.number)) }) { m.newChallan(features) }
                                    is Route.Challan -> ChallanScreen(
                                        m.server, top.id, top.number, m.docsVersion, features, s.me.business?.itemOptions, { m.back() },
                                        onParty = { id, name -> m.open(Route.Party(id, name)) },
                                        onBill = { id, no -> m.open(Route.Bill(id, no)) },
                                        onEdit = { m.sale.missingWords = { getString(R.string.eb_missing, it.joinToString(", ")) }; m.editChallan(features, top.id) },
                                        onConvert = { m.challanToBill(features, top.id) },
                                        onChanged = { m.loadHome(); m.docsChanged() },
                                        onLater = later,
                                    )
                                    Route.ChallanForm -> ChallanFormScreen(
                                        m.sale, { m.back() }, { m.open(Route.SaleCustomer) }, { k, item -> m.open(Route.SaleLine(k, item)) },
                                        onSaved = { id, no ->
                                            // a changed one goes back to its page; a new one opens its page (design 7.4e)
                                            if (m.sale.draft?.edit != null) m.back() else m.replace(Route.Challan(id, no))
                                            android.widget.Toast.makeText(this@MainActivity, getString(R.string.qt_saved, no), android.widget.Toast.LENGTH_SHORT).show()
                                            m.loadHome(); m.docsChanged()
                                        },
                                        onTryAgain = { m.saleRetry(features) },
                                    )
                                    Route.Payments -> PaymentsScreen(m.server, { m.back() }, { r -> m.open(Route.Receipt(r.id, r.number)) }) { m.open(Route.Receive()) }
                                    is Route.Receipt -> ReceiptScreen(
                                        m.server, top.id, top.number, m.docsVersion, { m.back() },
                                        onParty = { id, name -> m.open(Route.Party(id, name)) },
                                        onBill = { id, no -> m.open(Route.Bill(id, no)) },
                                        onEdit = { m.open(Route.Receive(editId = top.id)) },
                                        onGone = { m.back(); m.loadHome(); m.docsChanged() },
                                    )
                                    is Route.Receive -> ReceiveScreen(m.server, top.partyId, top.editId, { m.back() }) { id, no ->
                                        // a changed one goes back to its page; a new one opens its page
                                        if (top.editId != null) m.back() else m.replace(Route.Receipt(id, no))
                                        android.widget.Toast.makeText(this@MainActivity, getString(R.string.qt_saved, no), android.widget.Toast.LENGTH_SHORT).show()
                                        m.loadHome(); m.docsChanged()
                                    }
                                    Route.SaleSaved -> SavedScreen(m.sale, features, s.me.business?.itemOptions, onNew = { m.saleAgain(features); m.replace(Route.Sale) }, onDone = { m.back() })
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
                                onNewBill = { m.newSale(features) },
                                onBill = { b -> m.open(Route.Bill(b.id, b.number)) },
                                onTakePayment = { m.open(Route.Receive()) },
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
                                    onStockLine = { n -> menuOpen = false; m.open(when (n) { 1 -> Route.Prices; 2 -> Route.Adjustments; else -> Route.Godowns }) },
                                    onSaleBills = { menuOpen = false; m.open(Route.SaleBills) },
                                    onQuotes = { menuOpen = false; m.open(Route.Quotes()) },
                                    onChallans = { menuOpen = false; m.open(Route.Challans) },
                                    onPayments = { menuOpen = false; m.open(Route.Payments) },
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
                                // Sale Bill (1st), New Party (10th) and New Item (11th) open; the others come in later steps
                                CreateNewSheet({ createOpen = false }) { i -> createOpen = false; when (i) { 0 -> m.newSale(features); 1 -> m.open(Route.Quotes(pick = true)); 2 -> m.newChallan(features); 3 -> m.open(Route.Receive()); 9 -> m.open(Route.PartyForm(null)); 10 -> m.open(Route.ItemForm(null)); else -> later() } }
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
