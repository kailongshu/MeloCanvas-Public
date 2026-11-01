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

    private data class CachedStream(val url: String, val savedAt: Long)

    @Volatile
    private var douyinCookie: String = ""
    private val streamCache = ConcurrentHashMap<String, CachedStream>()

    private var headlessWebView: WebView? = null
    private var headlessReady = false
    private val requestSeq = AtomicInteger(1)
    private val pendingFetch = ConcurrentHashMap<Int, CompletableDeferred<String>>()

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
                            cm.setCookie("https://www.douyin.com", "$trimmed; Domain=.douyin.com; Path=/")
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

    /** Interactive native WebView dialog that captures HttpOnly sessionid via CookieManager. */
    suspend fun openLoginDialog(activity: Activity): String = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { continuation ->
            var finished = false
            val handler = Handler(Looper.getMainLooper())
            val cm = CookieManager.getInstance()
            cm.setAcceptCookie(true)
            // Clear stale session cookies before interactive login so re-login never closes prematurely.
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

            var desktopMode = true
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
                text = "登录抖音（扫码 / 短信）"
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                typeface = Typeface.DEFAULT_BOLD
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }

            val modeBtn = TextView(activity).apply {
                text = "切触屏版"
                setTextColor(Color.parseColor("#A5B4FC"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setPadding(dp(10), dp(6), dp(10), dp(6))
                setOnClickListener {
                    desktopMode = !desktopMode
                    val nextLabel: CharSequence = if (desktopMode) "切触屏版" else "切扫码版"
                    text = nextLabel
                    webView.settings.userAgentString = if (desktopMode) DESKTOP_UA else MOBILE_UA
                    webView.loadUrl(DOUYIN_HOME)
                }
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
            header.addView(modeBtn)
            header.addView(doneBtn)
            header.addView(closeBtn)

            val hintBar = TextView(activity).apply {
                text = "提示：若页面右上角有「登录」按钮请点击登录；支持抖音 App 扫码或手机号验证码，登录成功后会自动返回。"
                setTextColor(Color.parseColor("#D1D5DB"))
                setBackgroundColor(Color.parseColor("#252836"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setPadding(dp(14), dp(8), dp(14), dp(8))
            }

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
            }
            webView.webChromeClient = WebChromeClient()
            webView.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
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
                    val current = cm.getCookie(DOUYIN_HOME).orEmpty()
                    if (hasSessionCookie(current)) {
                        finishWith(current)
                        return
                    }
                    handler.postDelayed(this, 1200L)
                }
            }

            dialog.setContentView(root)
            dialog.setOnCancelListener { finishWith("") }
            dialog.setOnDismissListener { finishWith("") }
            dialog.show()
            webView.loadUrl(DOUYIN_HOME)
            handler.postDelayed(pollRunnable, 1500L)

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
                }
                created.addJavascriptInterface(JsBridge(), "MeloDouyinBridge")
                headlessWebView = created
            }
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
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

    /**
     * Executes a Douyin web API endpoint inside www.douyin.com WebView context so bdms/a_bogus
     * and HttpOnly cookies are automatically attached, with OkHttp fallback.
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
        val webBody = runCatching {
            val wv = ensureHeadlessWebView(context)
            if (wv != null) {
                val id = requestSeq.getAndIncrement()
                val deferred = CompletableDeferred<String>()
                pendingFetch[id] = deferred
                val escapedUrl = JSONObject.quote(normalizedEndpoint)
                val escapedBody = JSONObject.quote(postBody)
                val fetchOptions = if (isPost) {
                    """{
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'Accept': 'application/json, text/plain, */*',
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                        },
                        body: $escapedBody
                    }"""
                } else {
                    """{
                        method: 'GET',
                        credentials: 'include',
                        headers: { 'Accept': 'application/json, text/plain, */*' }
                    }"""
                }
                val js = """
                    (function() {
                        fetch($escapedUrl, $fetchOptions)
                        .then(function(r) { return r.text(); })
                        .then(function(t) { window.MeloDouyinBridge.onResult($id, t || ''); })
                        .catch(function(e) { window.MeloDouyinBridge.onResult($id, ''); });
                    })();
                """.trimIndent()
                withContext(Dispatchers.Main) {
                    wv.evaluateJavascript(js, null)
                }
                val res = withTimeoutOrNull(14000L) { deferred.await() }.orEmpty()
                pendingFetch.remove(id)
                res
            } else ""
        }.getOrDefault("")

        if (webBody.trim().startsWith("{")) {
            return webBody
        }

        return withContext(Dispatchers.IO) {
            if (isPost) directPost(normalizedEndpoint, postBody) else directGet(normalizedEndpoint)
        }
    }

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
        val builder = Request.Builder()
            .url(url)
            .header("User-Agent", ua)
            .header("Referer", DOUYIN_HOME)
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
        val builder = Request.Builder()
            .url(url)
            .header("User-Agent", ua)
            .header("Referer", DOUYIN_HOME)
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
            val detailBody = apiRequest(context, "/aweme/v1/web/aweme/detail/?aweme_id=$resolvedId&aid=6383")
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
            if (now - cached.savedAt < STREAM_TTL_MS && cached.url.startsWith("https://")) {
                return cached.url
            }
        }

        // Re-resolve fresh stream URL via mobile share page or web detail endpoint
        val shareItem = runCatching { fetchSharePageItem(awemeId) }.getOrNull()
        if (shareItem != null) {
            val normalized = normalizeAwemeObject(shareItem, awemeId)
            val url = normalized.optString("audioUrl")
            if (url.startsWith("https://")) {
                registerStream(awemeId, url)
                return url
            }
        }

        val webDetailItem = runCatching {
            val raw = directGet("https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=$awemeId&aid=6383")
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

        // Fall back to stale cached URL if still present
        streamCache[awemeId]?.url?.takeIf { it.startsWith("https://") }?.let { return it }
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
