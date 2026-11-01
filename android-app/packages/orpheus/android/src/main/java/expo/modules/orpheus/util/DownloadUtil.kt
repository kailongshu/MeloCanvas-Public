package expo.modules.orpheus.util

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.core.net.toUri
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.scheduler.Requirements
import expo.modules.orpheus.OrpheusConfig
import expo.modules.orpheus.bilibili.BilibiliRepository
import expo.modules.orpheus.douyin.DouyinManager
import expo.modules.orpheus.manager.DownloadCache
import expo.modules.orpheus.service.OrpheusDownloadService
import java.io.IOException
import java.util.concurrent.Executors

@UnstableApi
object DownloadUtil {
    private const val DEFAULT_MAX_PARALLEL_DOWNLOADS = 1
    private const val MIN_MAX_PARALLEL_DOWNLOADS = 1
    private const val MAX_MAX_PARALLEL_DOWNLOADS = 1

    private var downloadManager: DownloadManager? = null
    private var maxParallelDownloads = DEFAULT_MAX_PARALLEL_DOWNLOADS

    private var playerDataSourceFactory: DataSource.Factory? = null
    private var downloadDataSourceFactory: DataSource.Factory? = null

    private var downloadNotificationHelper: DownloadNotificationHelper? = null

    @Synchronized
    fun getDownloadManager(context: Context): DownloadManager {
        if (downloadManager == null) {
            val databaseProvider = StandaloneDatabaseProvider(context)
            downloadManager = DownloadManager(
                context,
                databaseProvider,
                DownloadCache.getStableCache(context),
                getDownloadDataSourceFactory(context),
                Executors.newFixedThreadPool(6)
            ).apply {
                maxParallelDownloads = this@DownloadUtil.maxParallelDownloads
                requirements = Requirements(Requirements.NETWORK)
            }
        }
        OfflineDownloadPolicy.observe(context.applicationContext, downloadManager!!)
        return downloadManager!!
    }

    @Synchronized
    fun setMaxParallelDownloads(context: Context, value: Int) {
        maxParallelDownloads = value.coerceIn(
            MIN_MAX_PARALLEL_DOWNLOADS,
            MAX_MAX_PARALLEL_DOWNLOADS
        )
        getDownloadManager(context).maxParallelDownloads = maxParallelDownloads
    }

    @Synchronized
    fun getPlayerDataSourceFactory(context: Context): DataSource.Factory {
        if (playerDataSourceFactory == null) {
            PlaybackNetworkPolicy.initialize(context)
            val upstreamFactory = getPlaybackUpstreamFactory()

            val downloadCache = DownloadCache.getStableCache(context)
            val lruCache = DownloadCache.getLruCache(context)

            val cacheFactory = CacheDataSource.Factory()
                .setCache(lruCache)
                .setUpstreamDataSourceFactory(upstreamFactory)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

            val downloadFactory = CacheDataSource.Factory()
                .setCache(downloadCache)
                .setUpstreamDataSourceFactory(cacheFactory)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
                .setCacheWriteDataSinkFactory(null)

            // Local copies bypass both remote caches; the resolver only accepts opaque local IDs.
            playerDataSourceFactory = AccountPlaybackDataSource.factory(context, OfflinePlaybackDataSource.factory(context, ResolvingDataSource.Factory(
                DefaultDataSource.Factory(context.applicationContext, downloadFactory),
                LocalAudioResolver(context.applicationContext),
            )))
        }
        return playerDataSourceFactory!!
    }


    @Synchronized
    private fun getDownloadDataSourceFactory(context: Context): DataSource.Factory {
        if (downloadDataSourceFactory == null) {
            downloadDataSourceFactory = OfflineDownloadPolicy.factory(context) { calls, onResolveCall -> getUpstreamFactory(calls, onResolveCall).createDataSource() }
        }
        return downloadDataSourceFactory!!
    }

    private fun getUpstreamFactory(calls: okhttp3.Call.Factory = expo.modules.orpheus.network.OkHttpClientManager.okHttpClient, onResolveCall: (retrofit2.Call<*>) -> Unit = {}): DataSource.Factory {
        val httpDataSourceFactory = androidx.media3.datasource.okhttp.OkHttpDataSource.Factory(
            calls
        )
            .setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")

        return ResolvingDataSource.Factory(
            httpDataSourceFactory,
            BilibiliResolver(onResolveCall)
        )
    }

    /** Unknown length and any hole are NOT offline-complete. Never add partial layers together. */
    fun hasCompletePlaybackCache(context: Context, key: String): Boolean = runCatching {
        listOf(DownloadCache.getStableCache(context), DownloadCache.getLruCache(context)).any { cache ->
            val length = androidx.media3.datasource.cache.ContentMetadata.getContentLength(cache.getContentMetadata(key))
            length > 0 && cache.isCached(key, 0, length)
        }
    }.getOrDefault(false)

    private fun getPlaybackUpstreamFactory(): DataSource.Factory = DataSource.Factory {
        // A loader retry from before Wi-Fi loss must not obtain fresh ownership after reconnection.
        val ownerEpoch = PlaybackNetworkPolicy.epoch()
        var lease: PlaybackNetworkGate.Lease? = null
        fun network(): PlaybackNetworkGate.Lease = checkNotNull(lease)
        val calls = okhttp3.Call.Factory { request ->
            OrpheusConfig.requirePlaybackAccess()
            network().check()
            expo.modules.orpheus.network.OkHttpClientManager.okHttpClient.newCall(request).also { call ->
                network().register { call.cancel() }
            }
        }
        val upstream = ResolvingDataSource.Factory(
            androidx.media3.datasource.okhttp.OkHttpDataSource.Factory(calls).setUserAgent("Mozilla/5.0"),
            BilibiliResolver { network() },
        ).createDataSource()
        object : DataSource by upstream {
            override fun open(dataSpec: DataSpec): Long {
                OrpheusConfig.requirePlaybackAccess()
                lease = PlaybackNetworkPolicy.begin(ownerEpoch)
                return try { upstream.open(dataSpec) } catch (error: Exception) {
                    lease?.close(); lease = null; throw error
                }
            }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                OrpheusConfig.requirePlaybackAccess()
                network().check()
                return upstream.read(buffer, offset, length)
            }
            override fun close() {
                try { upstream.close() } finally { lease?.close(); lease = null }
            }
        }
    }

    @Synchronized
    fun getDownloadNotificationHelper(context: Context): DownloadNotificationHelper {
        if (downloadNotificationHelper == null) {
            downloadNotificationHelper =
                DownloadNotificationHelper(context, OrpheusDownloadService.CHANNEL_ID)
        }
        return downloadNotificationHelper!!
    }

    fun getReadOnlyCacheDataSource(context: Context): CacheDataSource {
        val cache = DownloadCache.getStableCache(context)
        return CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(null) // No upstream, only cache
            .setCacheReadDataSourceFactory(androidx.media3.datasource.FileDataSource.Factory())
            .setFlags(CacheDataSource.FLAG_BLOCK_ON_CACHE)
            .createDataSource()
    }

    private class LocalAudioResolver(private val context: Context) : ResolvingDataSource.Resolver {
        override fun resolveDataSpec(dataSpec: DataSpec): DataSpec {
            LocalAudioIdentity.idFromUri(dataSpec.uri.toString())?.let { id ->
                val file = LocalAudioFiles.requireFile(context.filesDir, id)
                return dataSpec.withUri(Uri.fromFile(file))
            }
            // Do not expose DefaultDataSource's arbitrary file/content/asset/data/UDP inputs.
            if (dataSpec.uri.scheme !in listOf("http", "https", "orpheus")) {
                throw IOException("Unsupported playback source URI")
            }
            return dataSpec
        }
    }

    private class BilibiliResolver(private val onResolveCall: (retrofit2.Call<*>) -> Unit = {}, private val network: (() -> PlaybackNetworkGate.Lease)? = null) :
        ResolvingDataSource.Resolver {
        override fun resolveDataSpec(dataSpec: DataSpec): DataSpec {
            network?.invoke()?.check()
            val uri = dataSpec.uri
            if (uri.scheme == "orpheus" && uri.host == "douyin") {
                try {
                    val awemeId = DouyinAudioIdentity.idFromUri(uri.toString())
                        ?: throw IOException("Invalid Douyin audio URI")
                    val realUrl = DouyinManager.resolveAudioStreamUrl(awemeId)
                    val headers = HashMap<String, String>()
                    headers["Referer"] = "https://www.douyin.com/"
                    headers["User-Agent"] = DouyinManager.DESKTOP_UA
                    return dataSpec.buildUpon()
                        .setUri(realUrl.toUri())
                        .setHttpRequestHeaders(headers)
                        .setKey(uri.toString())
                        .build()
                } catch (e: IOException) {
                    throw e
                } catch (e: Exception) {
                    throw IOException("Douyin audio resolution failed: ${e.message}")
                }
            }
            if (uri.scheme == "orpheus" && uri.host == "bilibili") {
                try {
                    OrpheusConfig.requireOnlineOrGuestSession()
                    val bvid = uri.getQueryParameter("bvid")
                    val cid = uri.getQueryParameter("cid")?.toLongOrNull()
                    val quality = uri.getQueryParameter("quality")?.toIntOrNull() ?: 30280
                    val (realUrl, volume) = BilibiliRepository.resolveAudioUrl(
                        bvid = bvid!!,
                        cid = cid,
                        audioQuality = quality,
                        enableDolby = uri.getQueryParameter("dolby") == "1",
                        enableHiRes = uri.getQueryParameter("hires") == "1",
                        cookie = OrpheusConfig.bilibiliCookie,
                        onCall = { call -> onResolveCall(call); network?.invoke()?.register { call.cancel() } },
                    )
                    // 在这里保存响度均衡数据，并且直接发一个事件，在 OrpheusMusicService 监听
                    if (volume !== null) {
                        Log.d(
                            "LoudnessNormalization",
                            "uri: ${dataSpec.uri}, measuredI: ${volume.measuredI}"
                        )
                        LoudnessStorage.setLoudnessData(dataSpec.uri.toString(), volume.measuredI)
                    }

                    val headers = HashMap<String, String>()
                    headers["Referer"] = "https://www.bilibili.com/"

                    return dataSpec.buildUpon()
                        .setUri(realUrl.toUri())
                        .setHttpRequestHeaders(headers)
                        .setKey(uri.toString())
                        .build()
                } catch (_: Exception) {
                    throw IOException("Bilibili audio resolution failed")
                }
            }
            return dataSpec
        }
    }
}
