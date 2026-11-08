package tv.wis.video

import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.util.Log
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

class Native {
    external fun surface(surface: Surface?, width: Int, height: Int)
}

@InvokeArg
class FlagArgs {
    var on: Boolean = false
}

@InvokeArg
class OpenArgs {
    var url: String = ""
}

@TauriPlugin
class VideoPlugin(private val activity: Activity) : Plugin(activity), SurfaceHolder.Callback {
    private val native = Native()
    private var video: SurfaceView? = null

    private val television: Boolean
        get() = (activity.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager)?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION

    private fun bars(hidden: Boolean) {
        val window = activity.window
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (hidden) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun orient(landscape: Boolean) {
        bars(landscape)
        activity.window.decorView.postDelayed({ bars(landscape) }, 600)
        if (television) return
        activity.requestedOrientation = if (landscape) {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        }
    }

    override fun load(webView: WebView) {
        activity.runOnUiThread { orient(false) }
        webView.setBackgroundColor(Color.TRANSPARENT)
        attach(webView, 0)
        val owner = activity as? ComponentActivity ?: return
        owner.onBackPressedDispatcher.addCallback(
            owner,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    webView.evaluateJavascript("window.__wistvBack ? String(window.__wistvBack()) : 'false'") { result ->
                        Log.i("WiSTV", "back handled by page: $result")
                        if (result != "\"true\"") {
                            isEnabled = false
                            owner.onBackPressedDispatcher.onBackPressed()
                            isEnabled = true
                        }
                    }
                }
            }
        )
    }

    private fun attach(webView: WebView, tries: Int) {
        val parent = webView.parent as? ViewGroup
        if (parent == null) {
            if (tries < 50) webView.postDelayed({ attach(webView, tries + 1) }, 100)
            return
        }
        if (video != null) return
        val view = SurfaceView(activity)
        view.holder.addCallback(this)
        parent.addView(view, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        video = view
    }

    override fun surfaceCreated(holder: SurfaceHolder) {}

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        native.surface(holder.surface, width, height)
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        native.surface(null, 0, 0)
    }

    @Command
    fun awake(invoke: Invoke) {
        val args = invoke.parseArgs(FlagArgs::class.java)
        activity.runOnUiThread {
            if (args.on) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
        invoke.resolve()
    }

    @Command
    fun startupUrl(invoke: Invoke) {
        val data = activity.intent?.data
        val url = if (activity.intent?.action == Intent.ACTION_VIEW && (data?.scheme == "http" || data?.scheme == "https")) data.toString() else null
        val out = JSObject()
        out.put("url", url)
        invoke.resolve(out)
    }

    @Command
    fun landscape(invoke: Invoke) {
        val args = invoke.parseArgs(FlagArgs::class.java)
        activity.runOnUiThread { orient(args.on) }
        invoke.resolve()
    }

    @Command
    fun fullscreen(invoke: Invoke) {
        val args = invoke.parseArgs(FlagArgs::class.java)
        activity.runOnUiThread { bars(args.on) }
        invoke.resolve()
    }

    @Command
    fun open(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(args.url)))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Không mở được liên kết")
        }
    }
}
