package billingo.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import billingo.app.ui.blocks.BlocksScreen
import billingo.app.ui.signin.SignInScreen
import billingo.app.ui.theme.BillinGoTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BillinGoTheme {
                // test builds can also start on it: adb shell am start -n in.billingo.app/billingo.app.MainActivity --ez blocks true
                var blocks by rememberSaveable { mutableStateOf(BuildConfig.DEBUG && intent.getBooleanExtra("blocks", false)) }
                if (blocks) BlocksScreen(onBack = { blocks = false })
                else SignInScreen(version = BuildConfig.VERSION_NAME, onSecret = if (BuildConfig.DEBUG) ({ blocks = true }) else null)
            }
        }
    }
}
