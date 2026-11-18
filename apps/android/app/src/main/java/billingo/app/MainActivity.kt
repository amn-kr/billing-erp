package billingo.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import billingo.app.ui.signin.SignInScreen
import billingo.app.ui.theme.BillinGoTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BillinGoTheme {
                SignInScreen(version = BuildConfig.VERSION_NAME)
            }
        }
    }
}
