package billingo.app

import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import billingo.app.data.Api
import billingo.app.data.AppModel
import billingo.app.data.SafeStore
import billingo.app.data.Screen
import billingo.app.ui.blocks.BlocksScreen
import billingo.app.ui.signin.SignInScreen
import billingo.app.ui.start.ChooseCompanyScreen
import billingo.app.ui.start.LockScreen
import billingo.app.ui.start.SignedInScreen
import billingo.app.ui.start.StartingScreen
import billingo.app.ui.start.words
import billingo.app.ui.theme.BillinGoTheme

class MainActivity : FragmentActivity() {
    private val model: AppModel by lazy {
        val store = SafeStore(applicationContext)
        ViewModelProvider(this, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                AppModel(Api(BuildConfig.API_URL, store), store, ::fingerprintReady) as T
        })[AppModel::class.java]
    }

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val later = { Toast.makeText(this, R.string.coming_next, Toast.LENGTH_SHORT).show() }
        setContent {
            BillinGoTheme {
                // test builds can open the Building Blocks page: --ez blocks true, or 5 taps on the version line
                var blocks by rememberSaveable { mutableStateOf(BuildConfig.DEBUG && intent.getBooleanExtra("blocks", false)) }
                if (blocks) { BlocksScreen(onBack = { blocks = false }); return@BillinGoTheme }
                val m = model
                val problem = words(m.problem)
                when (val s = m.screen) {
                    is Screen.Starting -> StartingScreen(s.problem, m::resume, { m.signOut() })
                    Screen.SignIn -> SignInScreen(
                        version = BuildConfig.VERSION_NAME,
                        busy = m.busy,
                        problem = problem,
                        onSignIn = m::signIn,
                        onRegister = m::register,
                        onLanguage = later,
                        onSecret = if (BuildConfig.DEBUG) ({ blocks = true }) else null,
                    )
                    is Screen.Choose -> ChooseCompanyScreen(s.me, m.busy, problem, m::choose, if (s.fromHome) ({ m.backHome(s.me) }) else null)
                    is Screen.Lock -> {
                        LockScreen(s.company, ::unlock, ::unlock) { m.signOut() }
                        LaunchedEffect(Unit) { unlock() }
                    }
                    is Screen.Home -> SignedInScreen(
                        s.me, m.busy, problem, fingerprintReady(), m.fingerprintOn, m::setFingerprint, m::switchCompany, m::signOut,
                    )
                }
            }
        }
    }
}
