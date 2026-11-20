package billingo.app.ui.parts

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import billingo.app.data.ApiError

/** One screen's data from the server: loading, ready, or refused (with why). */
class Loaded<T> {
    var data by mutableStateOf<T?>(null)
        internal set
    var problem by mutableStateOf<ApiError?>(null)
        internal set
    var loading by mutableStateOf(true)
        internal set
    internal var again by mutableIntStateOf(0)
    /** ask the server again (pull down, Try Again, internet back) */
    fun reload() { again++ }
}

/** Loads [get] when the screen opens and again on [Loaded.reload] or when [key] changes; keeps old data while reloading. */
@Composable
fun <T> load(vararg key: Any?, get: suspend () -> T): Loaded<T> {
    val l = remember(*key) { Loaded<T>() }
    LaunchedEffect(l.again, *key) {
        l.loading = true
        try { l.data = get(); l.problem = null } catch (e: ApiError) { l.problem = e } finally { l.loading = false }
    }
    return l
}
