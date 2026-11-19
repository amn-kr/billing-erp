package billingo.app.ui.items

import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import billingo.app.R
import billingo.app.ui.parts.Btn
import billingo.app.ui.parts.Dim
import billingo.app.ui.parts.Field
import billingo.app.ui.parts.Header
import billingo.app.ui.parts.IconBtn
import billingo.app.ui.parts.Icons
import billingo.app.ui.parts.Kind
import billingo.app.ui.parts.LinkButton
import billingo.app.ui.parts.Sheet
import billingo.app.ui.parts.T
import billingo.app.ui.theme.Colours
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

/**
 * Scan Barcode (design 7.4c): the camera inside the dark area with the white corner frame and the
 * red line; the first code read closes it and is given to [onCode]. Torch, and Type The Code for a
 * label the camera can't read. Google's barcode reader runs inside the app (no internet needed).
 */
@Composable
fun ScanScreen(onBack: () -> Unit, onCode: (String) -> Unit) {
    val ctx = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var allowed by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var typing by remember { mutableStateOf(false) }
    var torch by remember { mutableStateOf(false) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var done by remember { mutableStateOf(false) }
    val denied = stringResource(R.string.sc_camera_denied)
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        allowed = ok
        if (!ok) { Toast.makeText(ctx, denied, Toast.LENGTH_LONG).show(); typing = true }
    }
    LaunchedEffect(Unit) { if (!allowed) ask.launch(Manifest.permission.CAMERA) }
    LaunchedEffect(torch, camera) { camera?.cameraControl?.enableTorch(torch) }

    fun found(code: String) {
        if (done) return
        done = true
        onCode(code.trim())
    }

    Box(Modifier.fillMaxSize().background(Colours.Text)) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.background(Colours.Card).statusBarsPadding()) {
                Header(stringResource(R.string.sc_title), left = { IconBtn(Icons.Close, stringResource(R.string.close), onBack) }) {
                    IconBtn(Icons.Bulb, stringResource(R.string.sc_torch), { torch = !torch }, if (torch) Kind.Soft else null)
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (allowed) {
                    val analyser = remember { Executors.newSingleThreadExecutor() }
                    val reader = remember { BarcodeScanning.getClient() }
                    DisposableEffect(Unit) { onDispose { analyser.shutdown(); reader.close() } }
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { c ->
                            val view = PreviewView(c).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
                            val future = ProcessCameraProvider.getInstance(c)
                            future.addListener({
                                val provider = future.get()
                                val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
                                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                                analysis.setAnalyzer(analyser) { proxy -> read(proxy, reader) { code -> view.post { found(code) } } }
                                provider.unbindAll()
                                camera = provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                            }, ContextCompat.getMainExecutor(c))
                            view
                        },
                    )
                }
                Column(
                    Modifier.fillMaxSize().padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
                ) {
                    Frame()
                    T(stringResource(R.string.sc_hold), weight = FontWeight.SemiBold, colour = Colours.OnColour, align = TextAlign.Center)
                    Box(Modifier.background(Colours.see(Colours.Text, 0.55f)).padding(horizontal = 4.dp)) {
                        LinkButton(stringResource(R.string.sc_type), { typing = true })
                    }
                }
            }
        }
        if (typing) {
            BackHandler { typing = false }
            TypeCode({ typing = false }) { code -> typing = false; found(code) }
        }
    }
}

/** The white corner frame with the red scan line (.camf). */
@Composable
private fun Frame() {
    Canvas(Modifier.fillMaxWidth(0.78f).widthIn(max = 260.dp).aspectRatio(1.4f)) {
        val w = size.width; val h = size.height
        val arm = 30.dp.toPx(); val r = 14.dp.toPx(); val s = 3.dp.toPx()
        val corner = Stroke(width = s)
        // each corner: a rounded square, only two sides of it drawn (by clipping to the corner)
        listOf(Offset(0f, 0f), Offset(w - arm, 0f), Offset(0f, h - arm), Offset(w - arm, h - arm)).forEachIndexed { i, o ->
            val dx = if (i % 2 == 0) 0f else -arm
            val dy = if (i < 2) 0f else -arm
            clipRect(o.x, o.y, o.x + arm, o.y + arm) {
                drawRoundRect(Colours.OnColour, Offset(o.x + dx + s / 2, o.y + dy + s / 2), Size(arm * 2 - s, arm * 2 - s), CornerRadius(r), style = corner)
            }
        }
        drawRect(Colours.BrightRed, Offset(w * 0.08f, h / 2 - 1.dp.toPx()), Size(w * 0.84f, 2.dp.toPx()))
    }
}

@OptIn(ExperimentalGetImage::class)
private fun read(proxy: androidx.camera.core.ImageProxy, reader: com.google.mlkit.vision.barcode.BarcodeScanner, onCode: (String) -> Unit) {
    val img = proxy.image
    if (img == null) { proxy.close(); return }
    reader.process(InputImage.fromMediaImage(img, proxy.imageInfo.rotationDegrees))
        .addOnSuccessListener { codes -> codes.firstOrNull { !it.rawValue.isNullOrBlank() }?.rawValue?.let(onCode) }
        .addOnCompleteListener { proxy.close() }
}

/** Type The Code: for a label the camera can't read. */
@Composable
private fun TypeCode(onClose: () -> Unit, onDone: (String) -> Unit) {
    var code by remember { mutableStateOf("") }
    Dim(onClose) {
        Sheet(stringResource(R.string.sc_type), close = { IconBtn(Icons.Close, stringResource(R.string.close), onClose) }) {
            Field(stringResource(R.string.sc_code), code, { code = it }, placeholder = "8901234567012", keyboard = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Ascii))
            Btn(stringResource(R.string.sc_find), { if (code.isNotBlank()) onDone(code) }, Modifier.fillMaxWidth(), Kind.Blue, Icons.Search)
        }
    }
}
