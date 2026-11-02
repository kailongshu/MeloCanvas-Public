package expo.modules.orpheus.douyin

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.Keep
import expo.modules.orpheus.network.OkHttpClientManager
import expo.modules.orpheus.util.DouyinAudioIdentity
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume

@SuppressLint("SetJavaScriptEnabled", "SetTextI18n", "StaticFieldLeak")
object DouyinManager {
    const val DESKTOP_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    private const val MOBILE_UA =
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    private const val DOUYIN_HOME = "https://www.douyin.com/"
    private const val STREAM_TTL_MS = 25 * 60 * 1000L
    private const val FALLBACK_SONG_PREFIX = "990000"

    private data class CachedStream(val url: String, val savedAt: Long)

    @Volatile
    private var douyinCookie: String = ""
    private val streamCache = ConcurrentHashMap<String, CachedStream>()

    private var headlessWebView: WebView? = null
    private var headlessReady = false
    private val requestSeq = AtomicInteger(1)
    private val pendingFetch = ConcurrentHashMap<Int, CompletableDeferred<String>>()

    private val noRedirectClient by lazy {
        OkHttpClientManager.okHttpClient.newBuilder()
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }

    fun normalizeHttps(raw: String?): String {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) return ""
        return when {
            trimmed.startsWith("http://") -> "https://" + trimmed.removePrefix("http://")
            trimmed.startsWith("//") -> "https:$trimmed"
            else -> trimmed
        }
    }

    fun hasSessionCookie(raw: String?): Boolean {
        if (raw.isNullOrBlank()) return false
        val pairs = raw.split(';').map { it.trim() }
        return pairs.any { part ->
            val eq = part.indexOf('=')
            if (eq <= 0) false else {
                val key = part.substring(0, eq).trim()
                val value = part.substring(eq + 1).trim()
                value.length >= 8 && (key == "sessionid" || key == "sessionid_ss" || key == "sid_tt" || key == "uid_tt")
            }
        }
    }

    fun getCookie(): String = douyinCookie

    fun setCookie(cookie: String) {
        val cleaned = cookie.replace("\r", "").replace("\n", "").trim()
        douyinCookie = cleaned
        headlessReady = false
        Handler(Looper.getMainLooper()).post {
            runCatching {
                val cm = CookieManager.getInstance()
                cm.setAcceptCookie(true)
                if (cleaned.isEmpty()) {
                    cm.removeAllCookies(null)
                } else {
                    for (pair in cleaned.split(';')) {
                        val trimmed = pair.trim()
                        if (trimmed.contains('=')) {
                            cm.setCookie("https://www.douyin.com", "$trimmed; Path=/")
                            cm.setCookie("https://sso.douyin.com", "$trimmed; Path=/")
                            cm.setCookie("https://douyin.com", "$trimmed; Path=/")
                            cm.setCookie(DOUYIN_HOME, "$trimmed; Path=/")
                        }
                    }
                }
                cm.flush()
            }
        }
    }

    fun clearCookie() {
        setCookie("")
    }

    fun registerStreamsJson(streamsJson: String) {
        runCatching {
            val arr = JSONArray(streamsJson)
            val now = System.currentTimeMillis()
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val id = obj.optString("awemeId").trim()
                val url = normalizeHttps(obj.optString("audioUrl"))
                if (DouyinAudioIdentity.validId(id) && url.startsWith("https://")) {
                    streamCache[id] = CachedStream(url, now)
                }
            }
        }
    }

    fun registerStream(awemeId: String, rawUrl: String) {
        val url = normalizeHttps(rawUrl)
        if (DouyinAudioIdentity.validId(awemeId) && url.startsWith("https://")) {
            streamCache[awemeId] = CachedStream(url, System.currentTimeMillis())
        }
    }

    /**
     * Extracts the Douyin login QR code image (data:image/png;base64,...) directly from the
     * background WebView so the user can scan immediately inside MeloCanvas without opening a full webpage.
     */
    suspend fun getLoginQrCode(context: Context): String {
        val wv = ensureHeadlessWebView(context)
            ?: return JSONObject().put("status", "error").put("message", "登录环境初始化失败").toString()

        val id = requestSeq.getAndIncrement()
        val deferred = CompletableDeferred<String>()
        pendingFetch[id] = deferred

        val js = """
            (function() {
                try {
                    document.querySelectorAll('video, audio').forEach(function(m) {
                        try { m.muted = true; m.pause(); } catch(e) {}
                    });
                    if (!window.__meloQrHooked) {
                        window.__meloQrHooked = true;
                        window.__meloLastQr = '';
                        var origFetch = window.fetch;
                        if (origFetch) {
                            window.fetch = function() {
                                var args = arguments;
                                return origFetch.apply(this, args).then(function(res) {
                                    try {
                                        var u = String(args[0] || '');
                                        if (u.indexOf('get_qrcode') >= 0 || u.indexOf('qrcode') >= 0) {
                                            res.clone().json().then(function(j) {
                                                if (j && j.data && j.data.qrcode) {
                                                    var q = String(j.data.qrcode);
                                                    window.__meloLastQr = q.indexOf('data:image') === 0 ? q : ('data:image/png;base64,' + q);
                                                }
                                            }).catch(function(){});
                                        }
                                    } catch(e) {}
                                    return res;
                                });
                            };
                        }
                        var origOpen = XMLHttpRequest.prototype.open;
                        var origSend = XMLHttpRequest.prototype.send;
                        XMLHttpRequest.prototype.open = function(m, u) {
                            this.__meloUrl = String(u || '');
                            return origOpen.apply(this, arguments);
                        };
                        XMLHttpRequest.prototype.send = function() {
                            var self = this;
                            this.addEventListener('load', function() {
                                try {
                                    if (self.__meloUrl && (self.__meloUrl.indexOf('get_qrcode') >= 0 || self.__meloUrl.indexOf('qrcode') >= 0)) {
                                        var j = JSON.parse(self.responseText || '{}');
                                        if (j && j.data && j.data.qrcode) {
                                            var q = String(j.data.qrcode);
                                            window.__meloLastQr = q.indexOf('data:image') === 0 ? q : ('data:image/png;base64,' + q);
                                        }
                                    }
                                } catch(e) {}
                            });
                            return origSend.apply(this, arguments);
                        };
                    }

                    function isSafeQrSrc(src) {
                        if (!src || typeof src !== 'string') return false;
                        var s = src.toLowerCase();
                        if (s.indexOf('logo') >= 0 || s.indexOf('icon') >= 0 || s.indexOf('avatar') >= 0 ||
                            s.indexOf('badge') >= 0 || s.indexOf('download') >= 0 || s.indexOf('favicon') >= 0) {
                            return false;
                        }
                        return (s.indexOf('data:image') === 0 && s.length > 500) || (s.indexOf('qrcode') >= 0);
                    }

                    function checkContainerQr(doc) {
                        if (!doc) return '';
                        var containers = doc.querySelectorAll(
                            'div[data-e2e="qrcode-login-container"], div[data-e2e="web-login-container"], ' +
                            'div[data-e2e="login-modal"], .qrcode-login-container, .web-login-container, ' +
                            'div[class*="login-container"], div[class*="qrcode-container"], div[class*="login_container"]'
                        );
                        for (var c = 0; c < containers.length; c++) {
                            var container = containers[c];
                            var canvases = container.querySelectorAll('canvas');
                            for (var i = 0; i < canvases.length; i++) {
                                var cv = canvases[i];
                                if (cv.width >= 60 && cv.height >= 60) {
                                    try {
                                        var data = cv.toDataURL('image/png');
                                        if (data && data.length > 500) return data;
                                    } catch(e) {}
                                }
                            }
                            var imgs = container.querySelectorAll('img');
                            for (var j = 0; j < imgs.length; j++) {
                                var im = imgs[j];
                                var src = im.getAttribute('src') || im.src || '';
                                if (isSafeQrSrc(src)) {
                                    return src.indexOf('data:image') === 0 ? src : ('data:image/png;base64,' + src);
                                }
                            }
                        }
                        var qrCanvases = doc.querySelectorAll('canvas.qrcode-canvas, canvas[class*="qrcode"], canvas[class*="qr-code"]');
                        for (var k = 0; k < qrCanvases.length; k++) {
                            var qcv = qrCanvases[k];
                            if (qcv.width >= 60 && qcv.height >= 60) {
                                try {
                                    var d = qcv.toDataURL('image/png');
                                    if (d && d.length > 500) return d;
                                } catch(e) {}
                            }
                        }
                        var qrImgs = doc.querySelectorAll('img[class*="qrcode"], img[class*="qr-code"], img[src*="qrcode"], img[alt*="二维码"], img[alt*="扫码"]');
                        for (var m = 0; m < qrImgs.length; m++) {
                            var msrc = qrImgs[m].getAttribute('src') || qrImgs[m].src || '';
                            if (isSafeQrSrc(msrc)) {
                                return msrc.indexOf('data:image') === 0 ? msrc : ('data:image/png;base64,' + msrc);
                            }
                        }
                        return '';
                    }

                    function findRealQr() {
                        if (window.__meloLastQr && window.__meloLastQr.length > 200) {
                            return window.__meloLastQr;
                        }
                        var mainQr = checkContainerQr(document);
                        if (mainQr) return mainQr;
                        var iframes = document.querySelectorAll('iframe');
                        for (var f = 0; f < iframes.length; f++) {
                            try {
                                var idoc = iframes[f].contentDocument || iframes[f].contentWindow.document;
                                var iqr = checkContainerQr(idoc);
                                if (iqr) return iqr;
                            } catch(e) {}
                        }
                        return window.__meloLastQr || '';
                    }

                    function clickRefreshOrLogin() {
                        var all = document.querySelectorAll('button, div, span, a, p');
                        for (var i = 0; i < all.length; i++) {
                            var t = (all[i].innerText || '').trim();
                            if (t === '点击刷新' || t === '二维码已失效' || t === '刷新二维码' || t === '重新获取') {
                                try { all[i].click(); } catch(e) {}
                            }
                        }
                        for (var j = 0; j < all.length; j++) {
                            var txt = (all[j].innerText || '').trim();
                            if (txt === '扫码登录' || txt === '二维码登录') {
                                try { all[j].click(); } catch(e) {}
                            }
                        }
                        var loginContainer = document.querySelector('div[data-e2e="web-login-container"], .web-login-container, div[data-e2e="login-modal"]');
                        if (!loginContainer) {
                            var loginBtn = document.querySelector('button[data-e2e="login-button"], button[data-e2e="nav-login-button"], [data-e2e="login-button"]');
                            if (loginBtn) {
                                try { loginBtn.click(); } catch(e) {}
                            } else {
                                for (var k = 0; k < all.length; k++) {
                                    var lt = (all[k].innerText || '').trim();
                                    if (lt === '登录' && all[k].offsetWidth > 0 && all[k].offsetHeight > 0) {
                                        try { all[k].click(); break; } catch(e) {}
                                    }
                                }
                            }
                        }
                        try {
                            var ssoUrl = 'https://sso.douyin.com/get_qrcode/?service=https%3A%2F%2Fwww.douyin.com&need_logo=false&need_short_url=true&device_platform=web_app&aid=6383&account_sdk_source=sso&sdk_version=2.2.8-beta.0&language=zh';
                            fetch(ssoUrl, { credentials: 'include' })
                                .then(function(r) { return r.json(); })
                                .then(function(j) {
                                    if (j && j.data && j.data.qrcode) {
                                        var q = String(j.data.qrcode);
                                        window.__meloLastQr = q.indexOf('data:image') === 0 ? q : ('data:image/png;base64,' + q);
                                    }
                                }).catch(function(){});
                        } catch(e) {}
                    }

                    clickRefreshOrLogin();
                    var attempts = 0;
                    var timer = setInterval(function() {
                        attempts++;
                        document.querySelectorAll('video, audio').forEach(function(m) {
                            try { m.muted = true; m.pause(); } catch(e) {}
                        });
                        var qr = findRealQr();
                        if (qr) {
                            clearInterval(timer);
                            window.MeloDouyinBridge.onResult($id, JSON.stringify({ status: 'ready', qrcode: qr }));
                            return;
                        }
                        if (attempts === 3 || attempts === 8 || attempts === 14) {
                            clickRefreshOrLogin();
                        }
                        if (attempts >= 25) {
                            clearInterval(timer);
                            window.MeloDouyinBridge.onResult($id, JSON.stringify({ status: 'empty', qrcode: '' }));
                        }
                    }, 200);
                } catch (err) {
                    window.MeloDouyinBridge.onResult($id, JSON.stringify({ status: 'error', qrcode: '' }));
                }
            })();
        """.trimIndent()

        withContext(Dispatchers.Main) {
            wv.evaluateJavascript(js, null)
        }
        val res = withTimeoutOrNull(8500L) { deferred.await() }
            ?: JSONObject().put("status", "timeout").put("qrcode", "").toString()
        pendingFetch.remove(id)
        return res
    }

    /**
     * Polls whether the QR code in the background WebView has been scanned/confirmed and returns
     * either the captured Cookie or the updated QR status.
     */
    suspend fun pollLoginQrStatus(context: Context): String {
        val cm = CookieManager.getInstance()
        val currentCookie = runCatching { cm.getCookie(DOUYIN_HOME).orEmpty() }.getOrDefault("")
        if (hasSessionCookie(currentCookie)) {
            douyinCookie = currentCookie
            runCatching { cm.flush() }
            return JSONObject().apply {
                put("status", "authenticated")
                put("cookie", currentCookie)
            }.toString()
        }

        val wv = headlessWebView ?: return JSONObject().put("status", "waiting").toString()
        val id = requestSeq.getAndIncrement()
        val deferred = CompletableDeferred<String>()
        pendingFetch[id] = deferred

        val js = """
            (function() {
                try {
                    document.querySelectorAll('video, audio').forEach(function(m) {
                        try { m.muted = true; m.pause(); } catch(e) {}
                    });
                    function isSafeQrSrc(src) {
                        if (!src || typeof src !== 'string') return false;
                        var s = src.toLowerCase();
                        if (s.indexOf('logo') >= 0 || s.indexOf('icon') >= 0 || s.indexOf('avatar') >= 0 ||
                            s.indexOf('badge') >= 0 || s.indexOf('download') >= 0 || s.indexOf('favicon') >= 0) {
                            return false;
                        }
                        return (s.indexOf('data:image') === 0 && s.length > 500) || (s.indexOf('qrcode') >= 0);
                    }
                    function checkContainerQr(doc) {
                        if (!doc) return '';
                        var containers = doc.querySelectorAll(
                            'div[data-e2e="qrcode-login-container"], div[data-e2e="web-login-container"], ' +
                            'div[data-e2e="login-modal"], .qrcode-login-container, .web-login-container, ' +
                            'div[class*="login-container"], div[class*="qrcode-container"], div[class*="login_container"]'
                        );
                        for (var c = 0; c < containers.length; c++) {
                            var container = containers[c];
                            var canvases = container.querySelectorAll('canvas');
                            for (var i = 0; i < canvases.length; i++) {
                                var cv = canvases[i];
                                if (cv.width >= 60 && cv.height >= 60) {
                                    try {
                                        var data = cv.toDataURL('image/png');
                                        if (data && data.length > 500) return data;
                                    } catch(e) {}
                                }
                            }
                            var imgs = container.querySelectorAll('img');
                            for (var j = 0; j < imgs.length; j++) {
                                var im = imgs[j];
                                var src = im.getAttribute('src') || im.src || '';
                                if (isSafeQrSrc(src)) {
                                    return src.indexOf('data:image') === 0 ? src : ('data:image/png;base64,' + src);
                                }
                            }
                        }
                        var qrCanvases = doc.querySelectorAll('canvas.qrcode-canvas, canvas[class*="qrcode"], canvas[class*="qr-code"]');
                        for (var k = 0; k < qrCanvases.length; k++) {
                            var qcv = qrCanvases[k];
                            if (qcv.width >= 60 && qcv.height >= 60) {
                                try {
                                    var d = qcv.toDataURL('image/png');
                                    if (d && d.length > 500) return d;
                                } catch(e) {}
                            }
                        }
                        var qrImgs = doc.querySelectorAll('img[class*="qrcode"], img[class*="qr-code"], img[src*="qrcode"], img[alt*="二维码"], img[alt*="扫码"]');
                        for (var m = 0; m < qrImgs.length; m++) {
                            var msrc = qrImgs[m].getAttribute('src') || qrImgs[m].src || '';
                            if (isSafeQrSrc(msrc)) {
                                return msrc.indexOf('data:image') === 0 ? msrc : ('data:image/png;base64,' + msrc);
                            }
                        }
                        return '';
                    }
                    function findRealQr() {
                        if (window.__meloLastQr && window.__meloLastQr.length > 200) {
                            return window.__meloLastQr;
                        }
                        var mainQr = checkContainerQr(document);
                        if (mainQr) return mainQr;
                        var iframes = document.querySelectorAll('iframe');
                        for (var f = 0; f < iframes.length; f++) {
                            try {
                                var idoc = iframes[f].contentDocument || iframes[f].contentWindow.document;
                                var iqr = checkContainerQr(idoc);
                                if (iqr) return iqr;
                            } catch(e) {}
                        }
                        return window.__meloLastQr || '';
                    }

                    var bodyText = (document.body && document.body.innerText) ? document.body.innerText : '';
                    var qr = findRealQr();
                    if (bodyText.indexOf('扫码成功') >= 0 || bodyText.indexOf('请在手机上确认') >= 0) {
                        window.MeloDouyinBridge.onResult($id, JSON.stringify({ status: 'scanned', qrcode: qr }));
                        return;
                    }
                    if (bodyText.indexOf('二维码已失效') >= 0 || bodyText.indexOf('点击刷新') >= 0) {
                        var all = document.querySelectorAll('button, div, span, a, p');
                        for (var j = 0; j < all.length; j++) {
                            var t = (all[j].innerText || '').trim();
                            if (t === '点击刷新' || t === '二维码已失效' || t === '刷新二维码' || t === '重新获取') {
                                try { all[j].click(); } catch(e) {}
                            }
                        }
                        try {
                            var ssoUrl = 'https://sso.douyin.com/get_qrcode/?service=https%3A%2F%2Fwww.douyin.com&need_logo=false&need_short_url=true&device_platform=web_app&aid=6383&account_sdk_source=sso&sdk_version=2.2.8-beta.0&language=zh';
                            fetch(ssoUrl, { credentials: 'include' })
                                .then(function(r) { return r.json(); })
                                .then(function(j) {
                                    if (j && j.data && j.data.qrcode) {
                                        var q = String(j.data.qrcode);
                                        window.__meloLastQr = q.indexOf('data:image') === 0 ? q : ('data:image/png;base64,' + q);
                                    }
                                }).catch(function(){});
                        } catch(e) {}
                        window.MeloDouyinBridge.onResult($id, JSON.stringify({ status: 'expired', qrcode: qr }));
                        return;
                    }
                    window.MeloDouyinBridge.onResult($id, JSON.stringify({ status: 'waiting', qrcode: qr }));
                } catch(e) {
                    window.MeloDouyinBridge.onResult($id, JSON.stringify({ status: 'waiting', qrcode: '' }));
                }
            })();
        """.trimIndent()

        withContext(Dispatchers.Main) {
            wv.evaluateJavascript(js, null)
        }
        val res = withTimeoutOrNull(2500L) { deferred.await() }
            ?: JSONObject().put("status", "waiting").toString()
        pendingFetch.remove(id)
        return res
    }

    /**
     * Clean interactive login dialog for single-phone SMS code login (background videos muted/hidden).
     */
    suspend fun openLoginDialog(activity: Activity): String = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { continuation ->
            var finished = false
            val handler = Handler(Looper.getMainLooper())
            val cm = CookieManager.getInstance()
            cm.setAcceptCookie(true)
            for (key in listOf("sessionid", "sessionid_ss", "sid_tt", "uid_tt", "sid_guard")) {
                cm.setCookie("https://www.douyin.com", "$key=; Domain=.douyin.com; Path=/; Max-Age=0")
                cm.setCookie(DOUYIN_HOME, "$key=; Path=/; Max-Age=0")
            }
            cm.flush()
            headlessReady = false

            val dialog = Dialog(activity, android.R.style.Theme_DeviceDefault_NoActionBar)
            val root = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.parseColor("#121318"))
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            }

            fun dp(value: Int): Int = TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value.toFloat(),
                activity.resources.displayMetrics,
            ).toInt()

            val webView = WebView(activity)

            fun finishWith(result: String) {
                if (finished) return
                finished = true
                handler.removeCallbacksAndMessages(null)
                runCatching {
                    webView.stopLoading()
                    (webView.parent as? ViewGroup)?.removeView(webView)
                    webView.destroy()
                }
                runCatching { if (dialog.isShowing) dialog.dismiss() }
                if (result.isNotBlank()) {
                    douyinCookie = result
                    runCatching { cm.flush() }
                }
                if (continuation.isActive) continuation.resume(result)
            }

            val header = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(14), dp(12), dp(14), dp(12))
                setBackgroundColor(Color.parseColor("#1C1E26"))
            }

            val titleView = TextView(activity).apply {
                text = "抖音手机号 / 验证码登录"
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                typeface = Typeface.DEFAULT_BOLD
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }

            val doneBtn = TextView(activity).apply {
                text = "我已登录"
                setTextColor(Color.parseColor("#34D399"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                typeface = Typeface.DEFAULT_BOLD
                setPadding(dp(10), dp(6), dp(10), dp(6))
                setOnClickListener {
                    cm.flush()
                    val latest = cm.getCookie(DOUYIN_HOME).orEmpty()
                    if (latest.isNotBlank()) finishWith(latest) else finishWith("")
                }
            }

            val closeBtn = TextView(activity).apply {
                text = "关闭"
                setTextColor(Color.parseColor("#9CA3AF"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setPadding(dp(10), dp(6), dp(4), dp(6))
                setOnClickListener { finishWith("") }
            }

            header.addView(titleView)
            header.addView(doneBtn)
            header.addView(closeBtn)

            val hintBar = TextView(activity).apply {
                text = "已自动静音并屏蔽背景视频，请直接输入手机号获取验证码登录，成功后将自动返回。"
                setTextColor(Color.parseColor("#D1D5DB"))
                setBackgroundColor(Color.parseColor("#252836"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setPadding(dp(14), dp(8), dp(14), dp(8))
            }

            val cleanLoginJs = """
                (function() {
                    if (window.__meloCleanDialogStarted) return;
                    window.__meloCleanDialogStarted = true;
                    var style = document.createElement('style');
                    style.innerHTML = 'video, audio, xg-video-container, [data-e2e="feed-active-video"] { display: none !important; opacity: 0 !important; pointer-events: none !important; } body { background: #121318 !important; }';
                    if (document.head) document.head.appendChild(style);
                    var switchedToSms = false;
                    setInterval(function() {
                        if (document.head && !style.parentNode) document.head.appendChild(style);
                        document.querySelectorAll('video, audio').forEach(function(m) {
                            try { m.muted = true; m.pause(); m.remove(); } catch(e) {}
                        });
                        var nodes = document.querySelectorAll('button, div, span, a');
                        if (!switchedToSms) {
                            for (var i = 0; i < nodes.length; i++) {
                                var t = (nodes[i].innerText || '').trim();
                                if (t === '验证码登录') {
                                    try { nodes[i].click(); switchedToSms = true; break; } catch(e) {}
                                }
                            }
                        }
                        if (!switchedToSms) {
                            for (var j = 0; j < nodes.length; j++) {
                                var lt = (nodes[j].innerText || '').trim();
                                if (lt === '登录') {
                                    try { nodes[j].click(); break; } catch(e) {}
                                }
                            }
                        }
                    }, 400);
                })();
            """.trimIndent()

            cm.setAcceptThirdPartyCookies(webView, true)
            webView.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                userAgentString = DESKTOP_UA
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                useWideViewPort = true
                loadWithOverviewMode = true
                builtInZoomControls = true
                displayZoomControls = false
                mediaPlaybackRequiresUserGesture = true
            }
            webView.webChromeClient = WebChromeClient()
            webView.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    view?.evaluateJavascript(cleanLoginJs, null)
                    val current = cm.getCookie(DOUYIN_HOME).orEmpty()
                    if (hasSessionCookie(current)) {
                        finishWith(current)
                    }
                }
            }

            root.addView(header)
            root.addView(hintBar)
            root.addView(
                webView,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    0,
                    1f,
                ),
            )

            val pollRunnable = object : Runnable {
                override fun run() {
                    if (finished) return
                    webView.evaluateJavascript(cleanLoginJs, null)
                    val current = cm.getCookie(DOUYIN_HOME).orEmpty()
                    if (hasSessionCookie(current)) {
                        finishWith(current)
                        return
                    }
                    handler.postDelayed(this, 1000L)
                }
            }

            dialog.setContentView(root)
            dialog.setOnCancelListener { finishWith("") }
            dialog.setOnDismissListener { finishWith("") }
            dialog.show()
            webView.loadUrl(DOUYIN_HOME)
            handler.postDelayed(pollRunnable, 1200L)

            continuation.invokeOnCancellation {
                handler.post { finishWith("") }
            }
        }
    }

    @Keep
    class JsBridge {
        @JavascriptInterface
        fun onResult(id: Int, body: String) {
            pendingFetch.remove(id)?.complete(body)
        }
    }

    private suspend fun ensureHeadlessWebView(context: Context): WebView? = withContext(Dispatchers.Main) {
        runCatching {
            val existing = headlessWebView
            if (existing != null && headlessReady) return@withContext existing

            val readyDeferred = CompletableDeferred<Boolean>()
            val wv = existing ?: WebView(context.applicationContext).also { created ->
                val cm = CookieManager.getInstance()
                cm.setAcceptCookie(true)
                cm.setAcceptThirdPartyCookies(created, true)
                created.settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    userAgentString = DESKTOP_UA
                    mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                    mediaPlaybackRequiresUserGesture = true
                }
                created.addJavascriptInterface(JsBridge(), "MeloDouyinBridge")
                headlessWebView = created
            }
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    view?.evaluateJavascript(
                        "document.querySelectorAll('video,audio').forEach(function(m){try{m.muted=true;m.pause();}catch(e){}});",
                        null,
                    )
                    headlessReady = true
                    if (!readyDeferred.isCompleted) readyDeferred.complete(true)
                }
            }
            if (!headlessReady) {
                wv.loadUrl(DOUYIN_HOME)
                withTimeoutOrNull(8000L) { readyDeferred.await() }
            }
            wv
        }.getOrNull()
    }

    private fun deduceRefererPath(endpoint: String): String {
        return when {
            endpoint.contains("/music/listcollection/") ||
            endpoint.contains("/aweme/listcollection/") ||
            endpoint.contains("/collects/") -> "/user/self?showTab=favorite_collection"
            endpoint.contains("/query/user/") || endpoint.contains("/user/profile/") -> "/user/self"
            endpoint.contains("/search/") -> "/search?type=video"
            endpoint.contains("/favorite/") -> "/user/self?showTab=like"
            else -> "/user/self"
        }
    }

    /**
     * Executes a Douyin web API endpoint inside www.douyin.com WebView context using XMLHttpRequest/fetch
     * so ByteDance's bdms SDK automatically signs a_bogus and attaches HttpOnly cookies.
     */
    suspend fun apiRequest(context: Context, endpoint: String): String {
        val isPost = endpoint.startsWith("POST:")
        val rawSpec = if (isPost) endpoint.removePrefix("POST:") else endpoint
        val pipeIdx = if (isPost) rawSpec.indexOf('|') else -1
        val rawPath = if (pipeIdx >= 0) rawSpec.substring(0, pipeIdx) else rawSpec
        val postBody = if (pipeIdx >= 0) rawSpec.substring(pipeIdx + 1) else ""
        val normalizedEndpoint = if (rawPath.startsWith("http")) rawPath else {
            "https://www.douyin.com" + (if (rawPath.startsWith("/")) rawPath else "/$rawPath")
        }

        // Intercept search requests with dual-engine fallback (Plan B)
        if (normalizedEndpoint.contains("/aweme/v1/web/search/item/")) {
            return executeSearchWithFallback(context, normalizedEndpoint)
        }

        val referer = deduceRefererPath(normalizedEndpoint)
        val webBody = executeWebViewXhr(context, normalizedEndpoint, isPost, postBody, referer)
        if (webBody.trim().startsWith("{")) {
            return webBody
        }

        return withContext(Dispatchers.IO) {
            if (isPost) directPost(normalizedEndpoint, postBody) else directGet(normalizedEndpoint)
        }
    }

    private suspend fun executeWebViewXhr(
        context: Context,
        normalizedEndpoint: String,
        isPost: Boolean,
        postBody: String,
        refererPath: String? = null,
    ): String = runCatching {
        val wv = ensureHeadlessWebView(context) ?: return@runCatching ""
        val id = requestSeq.getAndIncrement()
        val deferred = CompletableDeferred<String>()
        pendingFetch[id] = deferred
        val escapedUrl = JSONObject.quote(normalizedEndpoint)
        val escapedBody = JSONObject.quote(postBody)
        val escapedReferer = JSONObject.quote(refererPath.orEmpty())
        val method = if (isPost) "POST" else "GET"

        val js = """
            (function() {
                try {
                    document.querySelectorAll('video, audio').forEach(function(m) {
                        try { m.muted = true; m.pause(); } catch(e) {}
                    });
                    var ref = $escapedReferer;
                    if (ref) {
                        try { history.replaceState(null, '', ref); } catch(e) {}
                    }
                    var done = false;
                    function finish(body) {
                        if (done) return;
                        done = true;
                        window.MeloDouyinBridge.onResult($id, body || '');
                    }
                    function doXhr() {
                        try {
                            var xhr = new XMLHttpRequest();
                            xhr.open('$method', $escapedUrl, true);
                            xhr.withCredentials = true;
                            xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
                            if (${if (isPost) "true" else "false"}) {
                                xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
                            }
                            xhr.onload = function() { finish(xhr.responseText || ''); };
                            xhr.onerror = function() { finish(''); };
                            xhr.ontimeout = function() { finish(''); };
                            xhr.timeout = 11000;
                            xhr.send(${if (isPost) escapedBody else "null"});
                        } catch (e) {
                            finish('');
                        }
                    }
                    if (typeof window.fetch === 'function') {
                        try {
                            var opts = {
                                method: '$method',
                                credentials: 'include',
                                headers: { 'Accept': 'application/json, text/plain, */*' }
                            };
                            if (${if (isPost) "true" else "false"}) {
                                opts.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
                                opts.body = $escapedBody;
                            }
                            window.fetch($escapedUrl, opts).then(function(res) {
                                return res.text();
                            }).then(function(txt) {
                                if (txt && txt.trim().indexOf('{') === 0) {
                                    finish(txt);
                                } else {
                                    doXhr();
                                }
                            }).catch(function() {
                                doXhr();
                            });
                            setTimeout(function() { if (!done) doXhr(); }, 6000);
                        } catch(err) {
                            doXhr();
                        }
                    } else {
                        doXhr();
                    }
                } catch (e) {
                    window.MeloDouyinBridge.onResult($id, '');
                }
            })();
        """.trimIndent()

        withContext(Dispatchers.Main) {
            wv.evaluateJavascript(js, null)
        }
        val res = withTimeoutOrNull(12500L) { deferred.await() }.orEmpty()
        pendingFetch.remove(id)
        res
    }.getOrDefault("")

    /**
     * Plan B Dual-Engine Search:
     * 1. Signed Douyin Web XHR search (/aweme/v1/web/search/item/ with full PC web params).
     * 2. If unauthenticated or blocked by slider captcha (0 items), seamlessly falls back to
     *    ByteDance/Toutiao short video original sound search + Cloud Music playable audio search.
     */
    private suspend fun executeSearchWithFallback(context: Context, endpoint: String): String {
        val keyword = extractQueryParam(endpoint, "keyword")
        val offset = extractQueryParam(endpoint, "offset").toIntOrNull() ?: 0
        val count = (extractQueryParam(endpoint, "count").toIntOrNull() ?: 18).coerceIn(6, 30)
        val encodedKw = URLEncoder.encode(keyword, "UTF-8")

        val fullDouyinSearchUrl =
            "https://www.douyin.com/aweme/v1/web/search/item/" +
                "?device_platform=webapp&aid=6383&channel=channel_pc_web" +
                "&search_channel=aweme_video_web&enable_history=1" +
                "&keyword=$encodedKw&search_source=normal_search" +
                "&query_correct_type=1&is_filter_search=0&from_group_id=" +
                "&offset=$offset&count=$count&need_filter_settings=1&list_type=single" +
                "&version_code=190600&version_name=19.6.0"

        val webRes = executeWebViewXhr(
            context = context,
            normalizedEndpoint = fullDouyinSearchUrl,
            isPost = false,
            postBody = "",
            refererPath = "/search/$encodedKw?type=video",
        )

        if (webRes.trim().startsWith("{")) {
            val hasValidItems = runCatching {
                val root = JSONObject(webRes)
                val dataArr = root.optJSONArray("data") ?: root.optJSONArray("aweme_list")
                if (dataArr != null && dataArr.length() > 0) {
                    var validCount = 0
                    for (i in 0 until dataArr.length()) {
                        val item = dataArr.optJSONObject(i) ?: continue
                        val aweme = item.optJSONObject("aweme_info") ?: item
                        if (aweme.optString("aweme_id").isNotBlank()) validCount++
                    }
                    validCount > 0
                } else false
            }.getOrDefault(false)

            if (hasValidItems) {
                return webRes
            }
        }

        // Engine 2: Fallback to ByteDance / Toutiao video original sound + Cloud Music playable streams
        return withContext(Dispatchers.IO) {
            val combined = JSONArray()
            val seenIds = HashSet<String>()

            runCatching {
                val toutiaoItems = searchToutiaoDouyinVideos(keyword, offset / count)
                for (i in 0 until toutiaoItems.length()) {
                    val item = toutiaoItems.optJSONObject(i) ?: continue
                    val id = item.optString("aweme_id")
                    if (id.isNotBlank() && seenIds.add(id)) {
                        combined.put(item)
                    }
                }
            }

            if (combined.length() < count) {
                runCatching {
                    val cloudItems = searchCloudPlayableAudio(keyword, offset, count)
                    for (i in 0 until cloudItems.length()) {
                        val item = cloudItems.optJSONObject(i) ?: continue
                        val id = item.optString("aweme_id")
                        if (id.isNotBlank() && seenIds.add(id)) {
                            combined.put(item)
                        }
                    }
                }
            }

            JSONObject().apply {
                put("status_code", 0)
                put("has_more", if (combined.length() > 0) 1 else 0)
                put("cursor", offset + count)
                put("aweme_list", combined)
            }.toString()
        }
    }

    private fun extractQueryParam(url: String, key: String): String {
        val regex = Regex("[?&]$key=([^&#]*)")
        val raw = regex.find(url)?.groupValues?.get(1).orEmpty()
        return runCatching { java.net.URLDecoder.decode(raw, "UTF-8") }.getOrDefault(raw)
    }

    private fun searchToutiaoDouyinVideos(keyword: String, page: Int): JSONArray {
        val result = JSONArray()
        val query = if (keyword.contains("抖音")) keyword else "$keyword 抖音"
        val encoded = URLEncoder.encode(query, "UTF-8")
        val url = "https://so.toutiao.com/search?keyword=$encoded&pd=synthesis&source=input&page_num=$page"
        val req = Request.Builder()
            .url(url)
            .header("User-Agent", DESKTOP_UA)
            .build()
        val html = OkHttpClientManager.okHttpClient.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return result
            res.body?.string().orEmpty()
        }

        val scriptRegex = Regex("""<script[^>]*data-for="ala-data"[^>]*>(.*?)</script>""", RegexOption.DOT_MATCHES_ALL)
        val dataRegex = Regex("""\{\s*data:\s*(\{.*\})\s*,\s*src_id:\s*"""", RegexOption.DOT_MATCHES_ALL)

        for (match in scriptRegex.findAll(html)) {
            val scriptContent = match.groupValues[1]
            val dataMatch = dataRegex.find(scriptContent) ?: continue
            val d = runCatching { JSONObject(dataMatch.groupValues[1]) }.getOrNull() ?: continue
            val rd = d.optJSONObject("raw_data") ?: continue
            val music = rd.optJSONObject("music")
            val video = rd.optJSONObject("video")

            var playUrl = normalizeHttps(music?.optString("play_url"))
            if (!playUrl.startsWith("https://")) {
                playUrl = firstHttpsUrl(video?.optJSONObject("play_addr"))
            }
            if (!playUrl.startsWith("https://")) {
                val addrList = video?.optJSONArray("play_addr_list")
                if (addrList != null && addrList.length() > 0) {
                    val urls = addrList.optJSONObject(0)?.optJSONArray("play_url_list")
                    if (urls != null && urls.length() > 0) {
                        playUrl = normalizeHttps(urls.optString(0))
                    }
                }
            }
            if (!playUrl.startsWith("https://")) continue

            val awemeId = rd.optString("original_douyin_iid")
                .ifBlank { rd.optString("item_id") }
                .ifBlank { d.optString("group_id") }
                .trim()
            if (!DouyinAudioIdentity.validId(awemeId)) continue

            val rawTitle = rd.optString("title").ifBlank { d.optString("title") }
                .replace(Regex("<[^>]+>"), "")
                .trim()
            val musicTitle = music?.optString("title")?.trim().orEmpty()
            val author = d.optJSONObject("info")?.optString("user_nickname")
                .orEmpty()
                .ifBlank { music?.optString("author").orEmpty() }
                .ifBlank { "抖音原声" }
            val cover = normalizeHttps(
                d.optString("thumbnail_url")
                    .ifBlank { d.optString("large_thumbnail_url") }
                    .ifBlank { music?.optString("album_cover").orEmpty() },
            )
            val dur = video?.optDouble("duration", 0.0)?.takeIf { it > 0 }
                ?: d.optDouble("duration", 0.0)

            registerStream(awemeId, playUrl)
            result.put(
                JSONObject().apply {
                    put("aweme_id", awemeId)
                    put("title", rawTitle.ifBlank { musicTitle.ifBlank { keyword } })
                    put("desc", rawTitle)
                    put("artist", author)
                    put("artwork", cover)
                    put("duration", dur)
                    put("audioUrl", playUrl)
                },
            )
        }
        return result
    }

    private fun searchCloudPlayableAudio(keyword: String, offset: Int, count: Int): JSONArray {
        val result = JSONArray()
        val encoded = URLEncoder.encode(keyword, "UTF-8")
        val url = "https://music.163.com/api/cloudsearch/pc?s=$encoded&type=1&offset=$offset&limit=${count * 2}"
        val req = Request.Builder()
            .url(url)
            .header("User-Agent", DESKTOP_UA)
            .header("Referer", "https://music.163.com/")
            .build()
        val body = OkHttpClientManager.okHttpClient.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return result
            res.body?.string().orEmpty()
        }
        val root = runCatching { JSONObject(body) }.getOrNull() ?: return result
        val songs = root.optJSONObject("result")?.optJSONArray("songs") ?: return result

        for (i in 0 until songs.length()) {
            if (result.length() >= count) break
            val song = songs.optJSONObject(i) ?: continue
            val fee = song.optInt("fee", 0)
            if (fee == 1 || fee == 4) continue
            val songId = song.optLong("id", 0L)
            if (songId <= 0L) continue

            val awemeId = "$FALLBACK_SONG_PREFIX$songId"
            if (!DouyinAudioIdentity.validId(awemeId)) continue

            val name = song.optString("name").trim()
            if (name.isEmpty()) continue

            val artistsArr = song.optJSONArray("ar") ?: song.optJSONArray("artists")
            val artistNames = mutableListOf<String>()
            if (artistsArr != null) {
                for (j in 0 until artistsArr.length()) {
                    val arName = artistsArr.optJSONObject(j)?.optString("name")?.trim().orEmpty()
                    if (arName.isNotEmpty()) artistNames.add(arName)
                }
            }
            val artist = if (artistNames.isNotEmpty()) artistNames.joinToString(" / ") else "抖音原声"
            val album = song.optJSONObject("al") ?: song.optJSONObject("album")
            val cover = normalizeHttps(album?.optString("picUrl"))
            val durationMs = song.optDouble("dt", song.optDouble("duration", 0.0))
            val durationSeconds = if (durationMs > 1000.0) durationMs / 1000.0 else durationMs
            val outerUrl = "https://music.163.com/song/media/outer/url?id=$songId.mp3"

            result.put(
                JSONObject().apply {
                    put("aweme_id", awemeId)
                    put("title", name)
                    put("desc", "$name - $artist")
                    put("artist", artist)
                    put("artwork", cover)
                    put("duration", durationSeconds)
                    put("audioUrl", outerUrl)
                },
            )
        }
        return result
    }

    private fun resolveNeteaseOuterUrl(songId: String): String? = runCatching {
        val req = Request.Builder()
            .url("https://music.163.com/song/media/outer/url?id=$songId.mp3")
            .header("User-Agent", DESKTOP_UA)
            .header("Referer", "https://music.163.com/")
            .build()
        noRedirectClient.newCall(req).execute().use { res ->
            val loc = normalizeHttps(res.header("Location"))
            if (loc.startsWith("https://") && !loc.endsWith("/404")) {
                loc
            } else null
        }
    }.getOrNull()

    private fun currentMergedCookie(): String {
        val cmCookie = runCatching { CookieManager.getInstance().getCookie(DOUYIN_HOME).orEmpty() }.getOrDefault("")
        return when {
            cmCookie.isNotBlank() && douyinCookie.isNotBlank() ->
                if (hasSessionCookie(cmCookie)) cmCookie else "$cmCookie; $douyinCookie"
            cmCookie.isNotBlank() -> cmCookie
            else -> douyinCookie
        }
    }

    private fun directPost(url: String, formBody: String, ua: String = DESKTOP_UA): String {
        val referer = "https://www.douyin.com" + deduceRefererPath(url)
        val builder = Request.Builder()
            .url(url)
            .header("User-Agent", ua)
            .header("Referer", referer)
            .header("Origin", "https://www.douyin.com")
            .header("Accept", "application/json, text/plain, */*")
            .post(formBody.toRequestBody("application/x-www-form-urlencoded; charset=UTF-8".toMediaType()))
        val cookie = currentMergedCookie()
        if (cookie.isNotBlank()) builder.header("Cookie", cookie)
        OkHttpClientManager.okHttpClient.newCall(builder.build()).execute().use { res ->
            if (!res.isSuccessful) throw IOException("Douyin HTTP ${res.code}")
            return res.body?.string().orEmpty()
        }
    }

    private fun directGet(url: String, ua: String = DESKTOP_UA): String {
        val referer = "https://www.douyin.com" + deduceRefererPath(url)
        val builder = Request.Builder()
            .url(url)
            .header("User-Agent", ua)
            .header("Referer", referer)
            .header("Accept", "application/json, text/plain, */*")
        val cookie = currentMergedCookie()
        if (cookie.isNotBlank()) builder.header("Cookie", cookie)
        OkHttpClientManager.okHttpClient.newCall(builder.build()).execute().use { res ->
            if (!res.isSuccessful) throw IOException("Douyin HTTP ${res.code}")
            return res.body?.string().orEmpty()
        }
    }

    /** Extract aweme metadata + clean HTTPS audio/video URL from share text, short link, or awemeId. */
    suspend fun resolveShare(context: Context, textOrUrl: String): String {
        val trimmed = textOrUrl.trim()
        val directId = Regex("(?:^|douyin:|/video/|/note/|modal_id=)([1-9][0-9]{5,24})").find(trimmed)?.groupValues?.get(1)
        val urlMatch = Regex("(https?://[^\\s\"<>]+)").find(trimmed)?.groupValues?.get(1)
            ?.trimEnd(')', ']', '}', '，', '。', ',', ';', '！', '!')

        var awemeId = directId
        var routerItem: JSONObject? = null

        if (urlMatch != null) {
            withContext(Dispatchers.IO) {
                runCatching {
                    val req = Request.Builder()
                        .url(urlMatch)
                        .header("User-Agent", MOBILE_UA)
                        .build()
                    OkHttpClientManager.okHttpClient.newCall(req).execute().use { res ->
                        val finalUrl = res.request.url.toString()
                        val html = res.body?.string().orEmpty()
                        if (awemeId == null) {
                            awemeId = extractAwemeId(finalUrl) ?: extractAwemeId(html)
                        }
                        routerItem = parseRouterDataItem(html)
                    }
                }
            }
        }

        val resolvedId = awemeId ?: routerItem?.optString("aweme_id")?.takeIf { DouyinAudioIdentity.validId(it) }
            ?: throw IOException("未能从链接中识别到抖音作品 ID，请检查分享链接")

        // 1. Try mobile share page _ROUTER_DATA if not yet fetched
        if (routerItem == null) {
            routerItem = withContext(Dispatchers.IO) { fetchSharePageItem(resolvedId) }
        }

        // 2. Also try signed WebView detail API for higher-bitrate pure music.play_url
        val detailItem = runCatching {
            val detailBody = apiRequest(context, "/aweme/v1/web/aweme/detail/?device_platform=webapp&aweme_id=$resolvedId&aid=6383")
            if (detailBody.trim().startsWith("{")) {
                JSONObject(detailBody).optJSONObject("aweme_detail")
            } else null
        }.getOrNull()

        val chosen = detailItem ?: routerItem
            ?: throw IOException("暂时无法读取该抖音作品音频，请先登录抖音账号后重试")

        val normalized = normalizeAwemeObject(chosen, resolvedId)
        val streamUrl = normalized.optString("audioUrl")
        if (streamUrl.isNotBlank()) {
            registerStream(resolvedId, streamUrl)
        }
        return normalized.toString()
    }

    /** Synchronous stream URL resolution used by ExoPlayer DataSource & PlaybackPreparation on IO thread. */
    fun resolveAudioStreamUrl(awemeId: String): String {
        require(DouyinAudioIdentity.validId(awemeId)) { "Invalid Douyin awemeId" }
        val now = System.currentTimeMillis()
        streamCache[awemeId]?.let { cached ->
            if (now - cached.savedAt < STREAM_TTL_MS &&
                cached.url.startsWith("https://") &&
                !cached.url.contains("music.163.com/song/media/outer/url")
            ) {
                return cached.url
            }
        }

        // 0. If this is a fallback cloud audio ID (990000<songId>), resolve its 302 HTTPS stream directly
        if (awemeId.startsWith(FALLBACK_SONG_PREFIX) && awemeId.length > FALLBACK_SONG_PREFIX.length) {
            val songId = awemeId.removePrefix(FALLBACK_SONG_PREFIX)
            val resolvedOuter = resolveNeteaseOuterUrl(songId)
            if (resolvedOuter != null) {
                registerStream(awemeId, resolvedOuter)
                return resolvedOuter
            }
        }

        // 1. Re-resolve fresh stream URL via mobile share page
        val shareItem = runCatching { fetchSharePageItem(awemeId) }.getOrNull()
        if (shareItem != null) {
            val normalized = normalizeAwemeObject(shareItem, awemeId)
            val url = normalized.optString("audioUrl")
            if (url.startsWith("https://")) {
                registerStream(awemeId, url)
                return url
            }
        }

        // 2. Try web video detail endpoint
        val webDetailItem = runCatching {
            val raw = directGet("https://www.douyin.com/aweme/v1/web/aweme/detail/?device_platform=webapp&aweme_id=$awemeId&aid=6383")
            if (raw.trim().startsWith("{")) JSONObject(raw).optJSONObject("aweme_detail") else null
        }.getOrNull()
        if (webDetailItem != null) {
            val normalized = normalizeAwemeObject(webDetailItem, awemeId)
            val url = normalized.optString("audioUrl")
            if (url.startsWith("https://")) {
                registerStream(awemeId, url)
                return url
            }
        }

        // 3. Try web music detail endpoint (for collected music items from /aweme/v1/web/music/listcollection/)
        val musicDetailUrl = runCatching {
            val raw = directGet("https://www.douyin.com/aweme/v1/web/music/detail/?device_platform=webapp&music_id=$awemeId&aid=6383")
            if (raw.trim().startsWith("{")) {
                val musicInfo = JSONObject(raw).optJSONObject("music_info")
                firstHttpsUrl(musicInfo?.optJSONObject("play_url"))
            } else ""
        }.getOrDefault("")
        if (musicDetailUrl.startsWith("https://")) {
            registerStream(awemeId, musicDetailUrl)
            return musicDetailUrl
        }

        // 4. Fall back to cached URL if still present (resolving 302 if it's an outer URL)
        streamCache[awemeId]?.url?.takeIf { it.startsWith("https://") }?.let { cachedUrl ->
            if (cachedUrl.contains("music.163.com/song/media/outer/url")) {
                val sid = Regex("id=([0-9]+)").find(cachedUrl)?.groupValues?.get(1)
                if (!sid.isNullOrBlank()) {
                    resolveNeteaseOuterUrl(sid)?.let { fresh ->
                        registerStream(awemeId, fresh)
                        return fresh
                    }
                }
            }
            return cachedUrl
        }
        throw IOException("抖音原声直链已过期或不可读取，请重新搜索或登录抖音后重试")
    }

    private fun extractAwemeId(text: String): String? {
        val patterns = listOf(
            Regex("/(?:video|note)/([1-9][0-9]{5,24})"),
            Regex("/share/(?:video|slides|note)/([1-9][0-9]{5,24})"),
            Regex("modal_id=([1-9][0-9]{5,24})"),
            Regex("\"aweme_id\"\\s*:\\s*\"([1-9][0-9]{5,24})\""),
        )
        for (regex in patterns) {
            val id = regex.find(text)?.groupValues?.get(1)
            if (id != null && DouyinAudioIdentity.validId(id)) return id
        }
        return null
    }

    private fun fetchSharePageItem(awemeId: String): JSONObject? {
        val req = Request.Builder()
            .url("https://www.iesdouyin.com/share/video/$awemeId/")
            .header("User-Agent", MOBILE_UA)
            .build()
        OkHttpClientManager.okHttpClient.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return null
            val html = res.body?.string().orEmpty()
            return parseRouterDataItem(html)
        }
    }

    private fun parseRouterDataItem(html: String): JSONObject? = runCatching {
        val marker = "window._ROUTER_DATA"
        val idx = html.indexOf(marker)
        if (idx < 0) return null
        val braceStart = html.indexOf('{', idx)
        val scriptEnd = html.indexOf("</script>", braceStart)
        if (braceStart < 0 || scriptEnd <= braceStart) return null
        val jsonText = html.substring(braceStart, scriptEnd).trim().trimEnd(';')
        val root = JSONObject(jsonText)
        val loaderData = root.optJSONObject("loaderData") ?: return null
        val keys = loaderData.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val pageObj = loaderData.optJSONObject(key) ?: continue
            val videoInfoRes = pageObj.optJSONObject("videoInfoRes") ?: continue
            val itemList = videoInfoRes.optJSONArray("item_list") ?: continue
            if (itemList.length() > 0) {
                return itemList.optJSONObject(0)
            }
        }
        null
    }.getOrNull()

    private fun firstHttpsUrl(urlListObj: JSONObject?): String {
        val arr = urlListObj?.optJSONArray("url_list") ?: return ""
        for (i in 0 until arr.length()) {
            val u = normalizeHttps(arr.optString(i))
            if (u.startsWith("https://")) return u
        }
        return ""
    }

    private fun normalizeAwemeObject(aweme: JSONObject, fallbackId: String): JSONObject {
        val awemeId = aweme.optString("aweme_id").takeIf { DouyinAudioIdentity.validId(it) } ?: fallbackId
        val music = aweme.optJSONObject("music")
        val video = aweme.optJSONObject("video")
        val author = aweme.optJSONObject("author")

        val musicUrl = firstHttpsUrl(music?.optJSONObject("play_url"))
        val rawVideoUrl = firstHttpsUrl(video?.optJSONObject("play_addr"))
            .replace("/playwm/", "/play/")
        val videoUriId = video?.optJSONObject("play_addr")?.optString("uri").orEmpty()
        val fallbackPlayUri = if (videoUriId.isNotBlank() && !videoUriId.startsWith("http")) {
            "https://aweme.snssdk.com/aweme/v1/play/?video_id=$videoUriId&ratio=720p&line=0"
        } else ""

        // Prefer dedicated pure audio stream; fall back to MP4 stream (ExoPlayer plays audio track directly)
        val audioUrl = when {
            musicUrl.isNotBlank() -> musicUrl
            rawVideoUrl.isNotBlank() -> rawVideoUrl
            else -> fallbackPlayUri
        }

        val artwork = firstHttpsUrl(music?.optJSONObject("cover_large"))
            .ifBlank { firstHttpsUrl(music?.optJSONObject("cover_medium")) }
            .ifBlank { firstHttpsUrl(video?.optJSONObject("cover")) }
            .ifBlank { firstHttpsUrl(author?.optJSONObject("avatar_thumb")) }

        val desc = aweme.optString("desc").trim()
        val musicTitle = music?.optString("title")?.trim().orEmpty()
        val authorName = author?.optString("nickname")?.trim().orEmpty()
        val musicAuthor = music?.optString("author")?.trim().orEmpty()

        val title = when {
            musicTitle.isNotBlank() && !musicTitle.endsWith("创作的原声") && !musicTitle.startsWith("@") -> musicTitle
            desc.isNotBlank() -> desc.replace(Regex("\\s+"), " ").take(80)
            musicTitle.isNotBlank() -> musicTitle
            else -> "抖音原声 $awemeId"
        }
        val artist = when {
            musicAuthor.isNotBlank() -> musicAuthor
            authorName.isNotBlank() -> authorName
            else -> "抖音创作者"
        }

        val musicDuration = music?.optDouble("duration", 0.0) ?: 0.0
        val videoDurationMs = video?.optDouble("duration", 0.0) ?: 0.0
        val durationSeconds = when {
            musicDuration > 0.0 -> if (musicDuration > 36000) musicDuration / 1000.0 else musicDuration
            videoDurationMs > 0.0 -> if (videoDurationMs > 1000) videoDurationMs / 1000.0 else videoDurationMs
            else -> 0.0
        }

        return JSONObject().apply {
            put("awemeId", awemeId)
            put("title", title)
            put("artist", artist)
            put("artwork", artwork)
            put("duration", durationSeconds)
            put("audioUrl", audioUrl)
            put("desc", desc)
        }
    }
}
