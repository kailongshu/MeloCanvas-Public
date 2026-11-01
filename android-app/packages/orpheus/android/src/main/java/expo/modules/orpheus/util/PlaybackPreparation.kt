package expo.modules.orpheus.util

import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import expo.modules.orpheus.OrpheusConfig
import expo.modules.orpheus.bilibili.BilibiliRepository
import expo.modules.orpheus.douyin.DouyinManager
import expo.modules.orpheus.network.OkHttpClientManager
import okhttp3.Request
import java.io.IOException

@OptIn(UnstableApi::class)
object PlaybackPreparation {
    /** Resolve DASH audio and probe its CDN without touching the player or storing the signed URL. */
    fun checkAudio(context: Context, uri: String, guard: PlaybackReplacementGuard, token: Long) {
        val parsedUri = Uri.parse(uri)
        if (parsedUri.scheme == "http" || parsedUri.scheme == "https") {
            check(guard.isCurrent(token)) { "PlaybackReplacementCancelled" }
            return
        }
        OrpheusConfig.requirePlaybackAccess()
        check(guard.isCurrent(token)) { "PlaybackReplacementCancelled" }
        LocalAudioIdentity.idFromUri(uri)?.let { id ->
            LocalAudioProbe.probe(context.filesDir, id)
            check(guard.isCurrent(token)) { "PlaybackReplacementCancelled" }
            return
        }
        DouyinAudioIdentity.idFromUri(uri)?.let { awemeId ->
            PlaybackNetworkPolicy.initialize(context)
            if (DownloadUtil.hasCompletePlaybackCache(context, uri)) return
            val network = PlaybackNetworkPolicy.begin()
            guard.onFinished(token) { network.close() }
            try {
                network.register { guard.cancelIfCurrent(token) }
                DouyinManager.resolveAudioStreamUrl(awemeId)
                check(guard.isCurrent(token)) { "PlaybackReplacementCancelled" }
                network.check()
                return
            } catch (error: Exception) {
                network.close()
                throw error
            }
        }
        if (OfflinePlaybackDataSource.check(context, uri)) {
            check(guard.isCurrent(token)) { "PlaybackReplacementCancelled" }
            return
        }
        OrpheusConfig.requireOnlineOrGuestSession()
        val source = Uri.parse(uri)
        require(source.scheme == "orpheus" && source.host == "bilibili") { "Expected stable Bilibili source URI" }
        val bvid = requireNotNull(source.getQueryParameter("bvid"))
        val cid = requireNotNull(source.getQueryParameter("cid")?.toLongOrNull())
        require(cid > 0 && Regex("BV[A-Za-z0-9]{10}").matches(bvid)) { "Invalid Bilibili source identity" }
        PlaybackNetworkPolicy.initialize(context)
        if (DownloadUtil.hasCompletePlaybackCache(context, uri)) return
        val network = PlaybackNetworkPolicy.begin()
        guard.onFinished(token) { network.close() }
        try {
            network.register { guard.cancelIfCurrent(token) }
            val (url, _) = BilibiliRepository.resolveAudioUrl(
                bvid, cid, source.getQueryParameter("quality")?.toIntOrNull() ?: 30232,
                source.getQueryParameter("dolby") == "1", source.getQueryParameter("hires") == "1",
                OrpheusConfig.bilibiliCookie,
            ) { call ->
                guard.register(token) { call.cancel() }
                network.register { call.cancel() }
            }
            val request = Request.Builder().url(url)
                .header("Referer", "https://www.bilibili.com/")
                .header("User-Agent", "Mozilla/5.0")
                .header("Range", "bytes=0-0").build()
            val call = OkHttpClientManager.okHttpClient.newCall(request)
            guard.register(token) { call.cancel() }
            network.register { call.cancel() }
            call.execute().use { response ->
                if (!response.isSuccessful) throw IOException("Audio probe Http Error: ${response.code}")
                val input = response.body?.byteStream() ?: throw IOException("Audio probe has no body")
                if (input.read() < 0) throw IOException("Audio probe returned empty audio")
                network.check()
            }
        } catch (error: Exception) {
            network.close()
            throw error
        }
    }
}
