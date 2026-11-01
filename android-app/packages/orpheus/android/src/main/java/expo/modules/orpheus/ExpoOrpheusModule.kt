package expo.modules.orpheus

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Float32Array
import expo.modules.orpheus.douyin.DouyinManager
import expo.modules.orpheus.network.BilibiliAccountRequest
import expo.modules.orpheus.util.DirectoryPickerContract
import expo.modules.orpheus.exception.ControllerNotInitializedException
import expo.modules.orpheus.manager.CoverDownloadManager
import expo.modules.orpheus.manager.DownloadCache
import expo.modules.orpheus.manager.LyricsConsumer
import expo.modules.orpheus.manager.LyriconBackend
import expo.modules.orpheus.manager.SpectrumManager
import expo.modules.orpheus.model.DownloadTaskRecord
import expo.modules.orpheus.model.TrackRecord
import expo.modules.orpheus.service.OrpheusDownloadService
import expo.modules.orpheus.service.OrpheusMusicService
import expo.modules.orpheus.util.OfflineDownloadPolicy
import expo.modules.orpheus.util.DownloadUtil
import expo.modules.orpheus.util.ExportOptions
import expo.modules.orpheus.util.RecentMusicHistoryStorage
import expo.modules.orpheus.util.GeneralStorage
import expo.modules.orpheus.util.LoudnessStorage
import expo.modules.orpheus.util.TrackResumeStorage
import expo.modules.orpheus.util.PlaybackReplacementGuard
import expo.modules.orpheus.util.PlaybackNetworkPolicy
import expo.modules.orpheus.util.PlaybackPreparation
import expo.modules.orpheus.util.LocalAudioProbe
import expo.modules.orpheus.util.PlaybackSessionSnapshot
import expo.modules.orpheus.util.PlaybackSourceIdentity
import expo.modules.orpheus.util.FmPlaybackSessions
import expo.modules.orpheus.widget.WidgetRenderer
import expo.modules.orpheus.widget.WidgetThemeStore
import expo.modules.orpheus.util.runExportDownloads
import expo.modules.orpheus.util.toJsMap
import expo.modules.orpheus.util.toMediaItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import java.util.UUID

@UnstableApi
class ExpoOrpheusModule : Module() {
    private val uncompletedDownloadStates = intArrayOf(
        Download.STATE_QUEUED,
        Download.STATE_STOPPED,
        Download.STATE_DOWNLOADING,
        Download.STATE_FAILED,
        Download.STATE_REMOVING,
        Download.STATE_RESTARTING,
    )

    private val sleepTimerListener: () -> Unit = {
        sendEvent("onListeningSleepTimerChanged", emptyMap<String, Any>())
    }

    // keep this controller only to make sure MediaLibraryService is init.
    private var controllerFuture: ListenableFuture<MediaController>? = null

    private var player: Player? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    private var downloadManager: DownloadManager? = null

    private val spectrumManager = SpectrumManager { audioSessionId, error ->
        GeneralStorage.setSpectrumVisualizerEnabled(false)
        sendEvent(
            "onSpectrumVisualizerEnabledChanged", mapOf(
                "enabled" to false
            )
        )
        sendEvent(
            "onSpectrumVisualizerError", mapOf(
                "audioSessionId" to audioSessionId,
                "message" to (error.message ?: error.javaClass.simpleName)
            )
        )
    }
    private var tempBuffer: FloatArray? = null

    private val ioScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val playbackReplacement = PlaybackReplacementGuard.shared
    private val playbackReplacementOwner = Any()

    // applicationContext 在 OnCreate 时缓存，生命周期与 Application 一致，
    // 不受 React Native 组件卸载导致 reactContext 变 null 的影响。
    private var cachedAppContext: Context? = null

    private lateinit var directoryPickerLauncher: AppContextActivityResultLauncher<String, String?>

    // 记录上一首歌曲的 ID，用于在切歌时发送给 JS
    private var lastMediaId: String? = null

    val json = Json { ignoreUnknownKeys = true }

    private val playerListener = object : Player.Listener {

        /**
         * 核心：处理切歌、播放结束逻辑
         */
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val newId = mediaItem?.mediaId ?: ""
            Log.e("Orpheus", "onMediaItemTransition: $reason")

            // Headless task is handled by Service, no need to send event here if removed from API
            lastMediaId = newId
            saveCurrentPosition()
        }

        override fun onTimelineChanged(timeline: Timeline, reason: Int) {
            sendEvent("onQueueChanged", emptyMap())
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int
        ) {
            // Logic moved to Service
        }


        /**
         * 处理播放状态改变
         */
        override fun onPlaybackStateChanged(state: Int) {
            // state: 1=IDLE, 2=BUFFERING, 3=READY, 4=ENDED
            sendEvent(
                "onPlaybackStateChanged", mapOf(
                    "state" to state
                )
            )

            updateProgressRunnerState()
        }

        /**
         * 处理播放/暂停状态
         */
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            sendEvent(
                "onIsPlayingChanged", mapOf(
                    "status" to isPlaying
                )
            )

            if (isPlaying) {
                startSpectrumVisualizerIfEnabled()
            } else {
                spectrumManager.stop()
            }

            updateProgressRunnerState()
        }

        override fun onAudioSessionIdChanged(audioSessionId: Int) {
            if (audioSessionId == C.AUDIO_SESSION_ID_UNSET) {
                spectrumManager.stop()
                return
            }

            startSpectrumVisualizerIfEnabled(audioSessionId)
        }

        /**
         * 处理错误
         */
        override fun onPlayerError(error: PlaybackException) {
            val map = error.toJsMap().toMutableMap()
            map["platform"] = "android"
            sendEvent("onPlayerError", map)
        }

        override fun onRepeatModeChanged(repeatMode: Int) {
            super.onRepeatModeChanged(repeatMode)
            if (OrpheusMusicService.instance?.isCandidateAudition() != true) GeneralStorage.saveRepeatMode(repeatMode)
        }

        override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) {
            super.onShuffleModeEnabledChanged(shuffleModeEnabled)
            sendEvent("onQueueChanged", emptyMap())
        }

        override fun onPlaybackParametersChanged(playbackParameters: androidx.media3.common.PlaybackParameters) {
            sendEvent(
                "onPlaybackSpeedChanged", mapOf(
                    "speed" to playbackParameters.speed
                )
            )
        }
    }

    private fun startSpectrumVisualizerIfEnabled(
        audioSessionId: Int = player?.audioSessionId ?: C.AUDIO_SESSION_ID_UNSET
    ) {
        if (!GeneralStorage.isSpectrumVisualizerEnabled()) return
        if (player?.isPlaying != true) return
        if (audioSessionId == C.AUDIO_SESSION_ID_UNSET) return

        spectrumManager.start(audioSessionId)
    }

    private val accountExpiredListener: (Long) -> Unit = { generation ->
        mainHandler.post {
            if (OrpheusConfig.accountGeneration() == generation && !OrpheusConfig.hasAccountSession())
                sendEvent("onBilibiliSessionExpired", mapOf("generation" to generation))
        }
    }

    private val networkPolicyListener: (Boolean) -> Unit = {
        sendEvent("onPlaybackNetworkPolicyChanged", PlaybackNetworkPolicy.state())
    }

    @OptIn(UnstableApi::class)
    override fun definition() = ModuleDefinition {
        Name("Orpheus")

        Events(
            "onBilibiliSessionExpired",
            "onPlaybackNetworkPolicyChanged",
            "onPlaybackStateChanged",
            "onPlayerError",
            "onPositionUpdate",
            "onIsPlayingChanged",
            "onDownloadUpdated",
            "onPlaybackSpeedChanged",
            "onRecentMusicHistoryChanged",
            "onTrackStarted",
            "onTrackFinished",
            "onCoverDownloadProgress",
            "onExportProgress",
            "onStatusBarLyricsStatusChanged",
            "onSpectrumVisualizerError",
            "onSpectrumVisualizerEnabledChanged",
            "onRequestClearLyrics",
            "onQueueChanged",
            "onListeningSleepTimerChanged"
        )

        RegisterActivityContracts {
            directoryPickerLauncher = registerForActivityResult(DirectoryPickerContract())
        }

        Function("areNotificationsEnabled") {
            val context = appContext.reactContext ?: throw IllegalStateException("Application unavailable")
            val manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            val channel = manager.getNotificationChannel(androidx.media3.session.DefaultMediaNotificationProvider.DEFAULT_CHANNEL_ID)
            androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled() &&
                channel?.importance != android.app.NotificationManager.IMPORTANCE_NONE
        }

        OnCreate {
            OrpheusConfig.addExpiredListener(accountExpiredListener)
            val context = appContext.reactContext ?: return@OnCreate
            cachedAppContext = context.applicationContext
            PlaybackNetworkPolicy.initialize(context)
            PlaybackNetworkPolicy.addListener(networkPolicyListener)
            GeneralStorage.initialize(context)
            LoudnessStorage.initialize(context)
            TrackResumeStorage.initialize(context)
            expo.modules.orpheus.manager.CachedUriManager.initialize(context)
            val sessionToken = SessionToken(
                context,
                ComponentName(context, OrpheusMusicService::class.java)
            )
            controllerFuture = MediaController.Builder(context, sessionToken)
                .setApplicationLooper(Looper.getMainLooper()).buildAsync()


            OrpheusMusicService.addOnServiceReadyListener { service ->
                mainHandler.post {
                    if (this@ExpoOrpheusModule.player != service.player) {
                        this@ExpoOrpheusModule.player?.removeListener(playerListener)
                        this@ExpoOrpheusModule.player = service.player
                        this@ExpoOrpheusModule.player?.addListener(playerListener)
                    }

                    service.addSleepTimerListener(sleepTimerListener)
                    sendEvent("onQueueChanged", emptyMap<String, Any>())
                    startSpectrumVisualizerIfEnabled()

                    service.statusBarLyricsManager.setStatusChangeListener(object :
                        expo.modules.orpheus.manager.StatusBarLyricsManager.StatusChangeListener {
                        override fun onStatusChanged() {
                            sendEvent("onStatusBarLyricsStatusChanged", emptyMap<String, Any>())
                        }
                    })

                    service.addTrackEventListener(object : OrpheusMusicService.TrackEventListener {
                        override fun onPlaybackSessionChanged() {
                            sendEvent("onQueueChanged", emptyMap<String, Any>())
                        }
                        override fun onRecentMusicHistoryChanged() {
                            sendEvent("onRecentMusicHistoryChanged", emptyMap<String, Any>())
                        }
                        override fun onTrackStarted(trackId: String, reason: Int) {
                            sendEvent(
                                "onTrackStarted", mapOf(
                                    "trackId" to trackId,
                                    "reason" to reason
                                )
                            )
                        }

                        override fun onTrackFinished(
                            trackId: String,
                            finalPosition: Double,
                            duration: Double
                        ) {
                            sendEvent(
                                "onTrackFinished", mapOf(
                                    "trackId" to trackId,
                                    "finalPosition" to finalPosition,
                                    "duration" to duration
                                )
                            )
                        }
                    })

                    service.addLyricEventListener(object : OrpheusMusicService.LyricEventListener {
                        override fun onLyricCleared(trackId: String) {
                            sendEvent(
                                "onRequestClearLyrics", mapOf(
                                    "trackId" to trackId
                                )
                            )
                        }
                    })
                }
            }

            downloadManager = DownloadUtil.getDownloadManager(context)
            downloadManager?.addListener(downloadListener)
        }

        OnDestroy {
            OrpheusConfig.removeExpiredListener(accountExpiredListener)
            PlaybackNetworkPolicy.removeListener(networkPolicyListener)
            mainHandler.post {
                playbackReplacement.cancelOwned(playbackReplacementOwner)
                mainHandler.removeCallbacks(progressSendEventRunnable)
                mainHandler.removeCallbacks(progressSaveRunnable)
                mainHandler.removeCallbacks(downloadProgressRunnable)
                controllerFuture?.let { MediaController.releaseFuture(it) }
                downloadManager?.removeListener(downloadListener)
                player?.removeListener(playerListener)
                OrpheusMusicService.instance?.removeSleepTimerListener(sleepTimerListener)
                OrpheusMusicService.removeOnServiceReadyListener { }
                player = null
                spectrumManager.stop()
                ioScope.cancel()
                Log.d("Orpheus", "Destroy media controller")
            }
        }

        Property("restorePlaybackPositionEnabled")
            .get { GeneralStorage.isRestoreEnabled() }
            .set { enabled: Boolean -> GeneralStorage.setRestoreEnabled(enabled) }

        Property("loudnessNormalizationEnabled")
            .get { GeneralStorage.isLoudnessNormalizationEnabled() }
            .set { enabled: Boolean -> GeneralStorage.setLoudnessNormalizationEnabled(enabled) }

        Property("autoplayOnStartEnabled")
            .get { GeneralStorage.isAutoplayOnStartEnabled() }
            .set { enabled: Boolean -> GeneralStorage.setAutoplayOnStartEnabled(enabled) }

        /**
         * 续播策略：0 = 不自动续播（music），1 = 逐首断点续播（podcast）。
         * 原生持久化，供服务冷启动时无需等待 JS 即可使用。
         */
        Property("playbackResumeStrategy")
            .get { TrackResumeStorage.getStrategy() }
            .set { strategy: Int -> TrackResumeStorage.setStrategy(strategy) }

        Property("isSpectrumVisualizerEnabled")
            .get { GeneralStorage.isSpectrumVisualizerEnabled() }
            .set { enabled: Boolean ->
                GeneralStorage.setSpectrumVisualizerEnabled(enabled)
                mainHandler.post {
                    if (enabled) {
                        startSpectrumVisualizerIfEnabled()
                    } else {
                        spectrumManager.stop()
                    }
                    sendEvent(
                        "onSpectrumVisualizerEnabledChanged", mapOf(
                            "enabled" to GeneralStorage.isSpectrumVisualizerEnabled()
                        )
                    )
                }
            }

        Property("isDesktopLyricsShown")
            .get { GeneralStorage.isDesktopLyricsShown() }

        Property("isDesktopLyricsLocked")
            .get { GeneralStorage.isDesktopLyricsLocked() }
            .set { locked: Boolean ->
                GeneralStorage.setDesktopLyricsLocked(locked)
                mainHandler.post {
                    OrpheusMusicService.instance?.floatingLyricsManager?.setLocked(locked)
                }
            }

        Property("isStatusBarLyricsEnabled")
            .get { GeneralStorage.isStatusBarLyricsEnabled() }
            .set { enabled: Boolean ->
                GeneralStorage.setStatusBarLyricsEnabled(enabled)
                mainHandler.post {
                    OrpheusMusicService.instance?.statusBarLyricsManager?.enabled = enabled
                }
            }

        Property("isCarLyricsEnabled")
            .get { GeneralStorage.isCarLyricsEnabled() }
            .set { enabled: Boolean ->
                GeneralStorage.setCarLyricsEnabled(enabled)
                mainHandler.post {
                    OrpheusMusicService.instance?.setCarLyricsEnabled(enabled)
                }
            }

        Property("statusBarLyricsProvider")
            .get { GeneralStorage.getStatusBarLyricsProvider() }
            .set { provider: String ->
                // Lyricon requires API 27+; silently fall back to superlyric on older devices
                // so the persisted value always reflects what is actually used.
                val effective = if (provider == "lyricon" && Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
                    "superlyric"
                } else {
                    provider
                }
                GeneralStorage.setStatusBarLyricsProvider(effective)
                mainHandler.post {
                    GeneralStorage.setStatusBarLyricsProvider(effective)
                    val service = OrpheusMusicService.instance ?: return@post
                    service.statusBarLyricsManager.backend = service.createStatusBarBackend(effective)
                }
            }

        Property("isSuperLyricApiEnabled")
            .get { com.hchen.superlyricapi.SuperLyricTool.isEnabled }

        Property("isLyriconApiEnabled")
            .get {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) return@get false
                OrpheusMusicService.instance?.statusBarLyricsManager?.backend
                    ?.let { it is LyriconBackend && it.isAvailable }
                    ?: false
            }

        Property("isMeizuStatusBarLyricsApiEnabled")
            .get { true }


        AsyncFunction("pauseForAccountGate") Coroutine { ->
            withContext(Dispatchers.Main.immediate) {
                playbackReplacement.cancel()
                OrpheusMusicService.instance?.pauseForAccountGate()
                Unit
            }
        }

        Function("setBilibiliOfflineAccess") { enabled: Boolean ->
            val previous = OrpheusConfig.accountGeneration()
            OrpheusConfig.setOfflineAccess(enabled)
            if (previous != OrpheusConfig.accountGeneration()) {
                playbackReplacement.cancel()
                OfflineDownloadPolicy.cancelAccountWork()
                OrpheusMusicService.instance?.onAccountSessionChanged()
            }
        }

        Function("getBilibiliSessionGeneration") { OrpheusConfig.accountGeneration() }

        Function("setGuestPlaybackAccess") { enabled: Boolean ->
            val previous = OrpheusConfig.accountGeneration()
            OrpheusConfig.setGuestAccess(enabled)
            if (previous != OrpheusConfig.accountGeneration()) {
                playbackReplacement.cancel()
                OfflineDownloadPolicy.cancelAccountWork()
                OrpheusMusicService.instance?.onAccountSessionChanged()
            }
        }

        AsyncFunction("openDouyinLogin") Coroutine { ->
            val activity = appContext.currentActivity
                ?: appContext.activityProvider?.currentActivity
                ?: throw IllegalStateException("当前界面未就绪，请稍后重试")
            DouyinManager.openLoginDialog(activity)
        }

        AsyncFunction("douyinGetQrCode") Coroutine { ->
            val context = cachedAppContext ?: appContext.reactContext
                ?: throw IllegalStateException("应用上下文不可用")
            DouyinManager.getLoginQrCode(context)
        }

        AsyncFunction("douyinPollQrStatus") Coroutine { ->
            val context = cachedAppContext ?: appContext.reactContext
                ?: throw IllegalStateException("应用上下文不可用")
            DouyinManager.pollLoginQrStatus(context)
        }

        Function("setDouyinCookie") { cookie: String ->
            DouyinManager.setCookie(cookie)
        }

        Function("clearDouyinCookie") {
            DouyinManager.clearCookie()
        }

        AsyncFunction("douyinApiRequest") Coroutine { endpoint: String ->
            val context = cachedAppContext ?: appContext.reactContext
                ?: throw IllegalStateException("应用上下文不可用")
            DouyinManager.apiRequest(context, endpoint)
        }

        AsyncFunction("douyinResolveShare") Coroutine { textOrUrl: String ->
            val context = cachedAppContext ?: appContext.reactContext
                ?: throw IllegalStateException("应用上下文不可用")
            DouyinManager.resolveShare(context, textOrUrl)
        }

        Function("douyinRegisterStreams") { streamsJson: String ->
            DouyinManager.registerStreamsJson(streamsJson)
        }

        AsyncFunction("bilibiliSubtitleRequest") Coroutine { url: String ->
            withContext(Dispatchers.IO) { BilibiliAccountRequest.subtitle(url) }
        }

        AsyncFunction("bilibiliAccountRequest") Coroutine { url: String, cookie: String ->
            withContext(Dispatchers.IO) { BilibiliAccountRequest.get(url, cookie) }
        }

        Function("setBilibiliCookie") { cookie: String ->
            val previous = OrpheusConfig.accountGeneration()
            OrpheusConfig.bilibiliCookie = cookie
            if (previous != OrpheusConfig.accountGeneration() || !OrpheusConfig.hasAccountSession()) {
                playbackReplacement.cancel()
                OfflineDownloadPolicy.cancelAccountWork()
                // Never retain prepared audio across logout or an account switch.
                OrpheusMusicService.instance?.onAccountSessionChanged()
            }
        }

        AsyncFunction("getPosition") Coroutine { ->
            withPlayerOnMainThread { it.currentPosition.toDouble() / 1000.0 }
        }

        AsyncFunction("getDuration") Coroutine { ->
            val d = withPlayerOnMainThread { it.duration }
            if (d == C.TIME_UNSET) 0.0 else d.toDouble() / 1000.0
        }

        AsyncFunction("getBuffered") Coroutine { ->
            withPlayerOnMainThread { it.bufferedPosition.toDouble() / 1000.0 }
        }

        AsyncFunction("getIsPlaying") Coroutine { ->
            withPlayerOnMainThread { it.isPlaying }
        }

        AsyncFunction("getCurrentIndex") Coroutine { ->
            withPlayerOnMainThread { it.currentMediaItemIndex }
        }

        AsyncFunction("getCurrentTrack") Coroutine { ->
            val currentItem = withPlayerOnMainThread { it.currentMediaItem } ?: return@Coroutine null

            mediaItemToTrackRecord(currentItem)
        }

        AsyncFunction("getShuffleMode") {
            // Read from persisted state (managed by ShuffleManager).
            GeneralStorage.getShuffleMode()
        }

        AsyncFunction("getIndexTrack") Coroutine { index: Int ->
            val item = withPlayerOnMainThread { currentPlayer ->
                if (index < 0 || index >= currentPlayer.mediaItemCount) {
                    return@withPlayerOnMainThread null
                }

                currentPlayer.getMediaItemAt(index)
            }
                ?: return@Coroutine null

            mediaItemToTrackRecord(item)
        }

        AsyncFunction("getPlaybackNetworkPolicy") { PlaybackNetworkPolicy.refreshState() }
        AsyncFunction("setWifiOnlyPlayback") { enabled: Boolean ->
            PlaybackNetworkPolicy.setEnabled(enabled)
            PlaybackNetworkPolicy.state()
        }

        AsyncFunction("play") Coroutine { ->
            withPlayerOnMainThread { currentPlayer ->
                OrpheusConfig.requirePlaybackAccess()
                playbackReplacement.cancel()
                if (currentPlayer.playbackState == Player.STATE_ENDED) {
                    currentPlayer.seekTo(0)
                }
                prepareIfIdle(currentPlayer)
                currentPlayer.play()
            }
        }

        AsyncFunction("pause") Coroutine { ->
            withPlayerOnMainThread {
                playbackReplacement.cancel()
                it.pause()
            }
        }

        AsyncFunction("clear") Coroutine { ->
            withServiceAndPlayerOnMainThread { service, currentPlayer ->
                service.requireNotCandidateAudition()
                playbackReplacement.cancel()
                // 清空队列前先保存当前音频断点，逐首记录需保留
                service.saveCurrentResumeRecord()
                currentPlayer.clearMediaItems()
                GeneralStorage.saveQueue(emptyList())
                GeneralStorage.savePosition(0, 0L)
            }
        }

        AsyncFunction("skipTo") Coroutine { index: Int ->
            // 跳转到指定索引的开头
            // When shuffle is enabled, `index` is the position in the shuffle-traversal
            // order (as returned by getQueue). Convert to the physical queue index first.
            withServiceAndPlayerOnMainThread { service, currentPlayer ->
                playbackReplacement.cancel()
                if (service.shuffleManager.isEnabled) {
                    val order = service.shuffleManager.getTraversalOrder()
                    val physicalIndex = order?.getOrElse(index) { C.INDEX_UNSET } ?: C.INDEX_UNSET
                    if (physicalIndex != C.INDEX_UNSET) {
                        currentPlayer.seekTo(physicalIndex, C.TIME_UNSET)
                    } else {
                        return@withServiceAndPlayerOnMainThread
                    }
                } else {
                    currentPlayer.seekTo(index, C.TIME_UNSET)
                }
                prepareIfIdle(currentPlayer)
            }
        }

        AsyncFunction("skipToNext") Coroutine { ->
            withPlayerOnMainThread { currentPlayer ->
                playbackReplacement.cancel()
                // When in REPEAT_MODE_ONE, always allow next - wrap around if at the end
                val mediaItemCount = currentPlayer.mediaItemCount
                if (currentPlayer.repeatMode == Player.REPEAT_MODE_ONE
                    && mediaItemCount > 0
                    && !currentPlayer.hasNextMediaItem()
                ) {
                    currentPlayer.seekTo(0, C.TIME_UNSET)
                    prepareIfIdle(currentPlayer)
                    return@withPlayerOnMainThread
                }

                if (currentPlayer.hasNextMediaItem()) {
                    currentPlayer.seekToNext()
                    prepareIfIdle(currentPlayer)
                }
            }
        }

        AsyncFunction("skipToPrevious") Coroutine { ->
            withPlayerOnMainThread { currentPlayer ->
                playbackReplacement.cancel()
                // When in REPEAT_MODE_ONE, always allow previous - wrap around if at the beginning
                val mediaItemCount = currentPlayer.mediaItemCount
                if (currentPlayer.repeatMode == Player.REPEAT_MODE_ONE
                    && mediaItemCount > 0
                    && !currentPlayer.hasPreviousMediaItem()
                ) {
                    currentPlayer.seekTo(mediaItemCount - 1, C.TIME_UNSET)
                    prepareIfIdle(currentPlayer)
                    return@withPlayerOnMainThread
                }

                if (currentPlayer.hasPreviousMediaItem()) {
                    currentPlayer.seekToPreviousMediaItem()
                    prepareIfIdle(currentPlayer)
                }
            }
        }

        AsyncFunction("seekTo") Coroutine { seconds: Double ->
            val ms = (seconds * 1000).toLong()
            withPlayerOnMainThread {
                playbackReplacement.cancel()
                it.seekTo(ms)
            }
        }

        AsyncFunction("setRepeatMode") Coroutine { mode: Int ->
            // mode: 0=OFF, 1=TRACK, 2=QUEUE
            val repeatMode = when (mode) {
                1 -> Player.REPEAT_MODE_ONE
                2 -> Player.REPEAT_MODE_ALL
                else -> Player.REPEAT_MODE_OFF
            }
            withServiceAndPlayerOnMainThread { service, _ ->
                playbackReplacement.cancel()
                service.applyRepeatMode(repeatMode)
            }
        }

        AsyncFunction("setMusicPlaybackOrder") Coroutine { order: String, expectedEntryId: String ->
            withServiceAndPlayerOnMainThread { service, _ -> service.setMusicPlaybackOrder(order, expectedEntryId) }
        }

        AsyncFunction("selectMusicQueueEntry") Coroutine { expectedEntryId: String, entryId: String ->
            withServiceAndPlayerOnMainThread { service, _ -> service.selectMusicQueueEntry(expectedEntryId, entryId) }
        }

        AsyncFunction("setShuffleMode") Coroutine { enabled: Boolean ->
            // Delegate to the service's ShuffleManager which uses Media3's built-in
            // shuffleModeEnabled for O(1) shuffle toggle without physical queue reordering.
            withServiceOnMainThread { service ->
                playbackReplacement.cancel()
                if (service != null) {
                    service.applyShuffleMode(enabled)
                } else {
                    // Service not yet bound — persist the preference for restorePlayerState to pick up
                    GeneralStorage.saveShuffleMode(enabled)
                }
            }
        }

        AsyncFunction("getRepeatMode") Coroutine { ->
            withPlayerOnMainThread { it.repeatMode }
        }

        AsyncFunction("getAdjacentTracks") Coroutine { ->
            withPlayerOnMainThread { currentPlayer ->
                val mediaItemCount = currentPlayer.mediaItemCount
                val currentIdx = currentPlayer.currentMediaItemIndex

                fun resolvePrev(): TrackRecord? {
                    if (mediaItemCount == 0 || currentIdx == C.INDEX_UNSET) return null
                    if (currentPlayer.hasPreviousMediaItem()) {
                        val idx = currentPlayer.previousMediaItemIndex
                        if (idx in 0 until mediaItemCount) {
                            return mediaItemToTrackRecord(currentPlayer.getMediaItemAt(idx))
                        }
                    }
                    if (currentPlayer.repeatMode == Player.REPEAT_MODE_ONE) {
                        return mediaItemToTrackRecord(currentPlayer.getMediaItemAt(mediaItemCount - 1))
                    }
                    return null
                }

                fun resolveNext(): TrackRecord? {
                    if (mediaItemCount == 0 || currentIdx == C.INDEX_UNSET) return null
                    if (currentPlayer.hasNextMediaItem()) {
                        val idx = currentPlayer.nextMediaItemIndex
                        if (idx in 0 until mediaItemCount) {
                            return mediaItemToTrackRecord(currentPlayer.getMediaItemAt(idx))
                        }
                    }
                    if (currentPlayer.repeatMode == Player.REPEAT_MODE_ONE) {
                        return mediaItemToTrackRecord(currentPlayer.getMediaItemAt(0))
                    }
                    return null
                }

                mapOf(
                    "previous" to resolvePrev(),
                    "next" to resolveNext()
                )
            }
        }

        AsyncFunction("removeTrack") Coroutine { index: Int ->
            withServiceAndPlayerOnMainThread { service, currentPlayer ->
                service.requireNotCandidateAudition()
                playbackReplacement.cancel()
                if (service.shuffleManager.isEnabled) {
                    // index is the shuffle-traversal position; resolve to physical index.
                    val order = service.shuffleManager.getTraversalOrder()
                    val physicalIndex = order?.getOrElse(index) { -1 } ?: -1
                    if (physicalIndex >= 0 && physicalIndex < currentPlayer.mediaItemCount) {
                        currentPlayer.removeMediaItem(physicalIndex)
                    }
                } else {
                    if (index >= 0 && index < currentPlayer.mediaItemCount) {
                        currentPlayer.removeMediaItem(index)
                    }
                }
            }
        }

        AsyncFunction("moveTrack") Coroutine { fromIndex: Int, toIndex: Int ->
            withServiceAndPlayerOnMainThread { service, currentPlayer ->
                service.requireNotCandidateAudition()
                playbackReplacement.cancel()
                val count = currentPlayer.mediaItemCount
                if (fromIndex !in 0 until count || toIndex !in 0 until count || fromIndex == toIndex) {
                    return@withServiceAndPlayerOnMainThread
                }
                if (service.shuffleManager.isEnabled) {
                    service.shuffleManager.moveInTraversal(fromIndex, toIndex)
                } else {
                    currentPlayer.moveMediaItem(fromIndex, toIndex)
                }
            }
        }

        AsyncFunction("getQueue") Coroutine { ->
            val items = withServiceAndPlayerOnMainThread { service, currentPlayer ->
                // When shuffle is enabled, return items in the logical playback (shuffle traversal)
                // order so the UI displays what will actually be played next.
                val traversal = if (service.shuffleManager.isEnabled) {
                    service.shuffleManager.getTraversalOrder()
                } else {
                    null
                }

                if (traversal != null) {
                    traversal.map { physicalIdx -> currentPlayer.getMediaItemAt(physicalIdx) }
                } else {
                    List(currentPlayer.mediaItemCount) { index -> currentPlayer.getMediaItemAt(index) }
                }
            }

            items.map(::mediaItemToTrackRecord)
        }

        AsyncFunction("reverseRemainingQueue") Coroutine { ->
            withServiceAndPlayerOnMainThread { service, currentPlayer ->
                service.requireNotCandidateAudition()
                playbackReplacement.cancel()
                // Shuffle traversal has its own order. The queue UI disables this action
                // while shuffle is enabled, and the native guard keeps the API safe for
                // callers outside that UI.
                if (service.shuffleManager.isEnabled) return@withServiceAndPlayerOnMainThread

                val currentIndex = currentPlayer.currentMediaItemIndex
                val lastIndex = currentPlayer.mediaItemCount - 1
                if (currentIndex == C.INDEX_UNSET || currentIndex >= lastIndex) {
                    return@withServiceAndPlayerOnMainThread
                }

                // Build the reversed pending suffix in one pass, then replace it in a
                // single playlist operation. The current item is outside that range, so
                // Media3 keeps its playback position and play state intact.
                val reversedRemaining = ArrayList<MediaItem>(lastIndex - currentIndex)
                for (index in lastIndex downTo currentIndex + 1) {
                    reversedRemaining.add(currentPlayer.getMediaItemAt(index))
                }
                currentPlayer.replaceMediaItems(
                    currentIndex + 1,
                    currentPlayer.mediaItemCount,
                    reversedRemaining
                )
            }
        }

        AsyncFunction("setListeningSleepTimer") Coroutine { expectedSourceId: String, mode: String, durationMs: Long? ->
            withServiceAndPlayerOnMainThread { service, _ ->
                service.setListeningSleepTimer(expectedSourceId, mode, durationMs)
            }
        }

        AsyncFunction("setSleepTimer") Coroutine { durationMs: Long ->
            withContext(Dispatchers.Main.immediate) { OrpheusMusicService.instance?.startSleepTimer(durationMs) }
        }

        AsyncFunction("getSleepTimerEndTime") Coroutine { ->
            withContext(Dispatchers.Main.immediate) { OrpheusMusicService.instance?.getSleepTimerRemaining() }
        }

        AsyncFunction("cancelSleepTimer") Coroutine { ->
            withContext(Dispatchers.Main.immediate) { OrpheusMusicService.instance?.cancelSleepTimer() }
        }

        AsyncFunction("addToEnd") Coroutine { tracks: List<TrackRecord>, startFromId: String?, clearQueue: Boolean? ->
            OrpheusConfig.requirePlaybackAccess()
            val context = appContext.reactContext
            val mediaItems = tracks.map { track ->
                track.toMediaItem(context)
            }
            withServiceAndPlayerOnMainThread { service, currentPlayer ->
                service.requireNotCandidateAudition()
                playbackReplacement.cancel()
                if (clearQueue == true) {
                    // 替换队列前先保存旧音频断点
                    service.saveCurrentResumeRecord()
                    currentPlayer.clearMediaItems()
                }
                val initialSize = currentPlayer.mediaItemCount
                currentPlayer.addMediaItems(mediaItems)

                if (!startFromId.isNullOrEmpty()) {
                    val relativeIndex = tracks.indexOfFirst { it.id == startFromId }

                    if (relativeIndex != -1) {
                        val targetIndex = initialSize + relativeIndex

                        currentPlayer.seekTo(targetIndex, C.TIME_UNSET)
                        currentPlayer.prepare()
                        currentPlayer.play()

                        return@withServiceAndPlayerOnMainThread
                    }
                }

                if (currentPlayer.playbackState == Player.STATE_IDLE) {
                    currentPlayer.prepare()
                }
            }
        }

        Function("newLocalAudioUuid") { UUID.randomUUID().toString() }

        AsyncFunction("probeLocalAudio") Coroutine { id: String ->
            val context = requireNotNull(cachedAppContext) { "Application unavailable" }
            withContext(Dispatchers.IO) { LocalAudioProbe.probe(context.filesDir, id).toJsMap() }
        }

        AsyncFunction("getRecentMusicHistory") Coroutine { ->
            val context = cachedAppContext ?: error("最近播放存储尚未就绪。")
            withContext(Dispatchers.IO) {
                RecentMusicHistoryStorage.initialize(context)
                RecentMusicHistoryStorage.read().map { it.toJsMap() }
            }
        }

        AsyncFunction("clearRecentMusicHistory") Coroutine { ->
            val context = cachedAppContext ?: error("最近播放存储尚未就绪。")
            withContext(Dispatchers.IO) {
                RecentMusicHistoryStorage.initialize(context)
                RecentMusicHistoryStorage.clear()
            }
            sendEvent("onRecentMusicHistoryChanged", emptyMap<String, Any>())
        }

        AsyncFunction("getPlaybackSnapshot") Coroutine { ->
            withServiceAndPlayerOnMainThread { service, _ -> service.playbackSnapshotMap() }
        }

        AsyncFunction("cancelPlaybackReplacement") Coroutine { ->
            withContext(Dispatchers.Main.immediate) {
                playbackReplacement.begin(playbackReplacementOwner)
            }
        }

        AsyncFunction("cancelPlaybackReplacementIfCurrent") Coroutine { token: Long ->
            withContext(Dispatchers.Main.immediate) {
                val cancelled = playbackReplacement.cancelIfCurrent(token)
                if (cancelled) OrpheusMusicService.instance?.cancelCandidateAudition(token)
                cancelled
            }
        }

        AsyncFunction("isPlaybackReplacementCurrent") Coroutine { token: Long ->
            withContext(Dispatchers.Main.immediate) {
                playbackReplacement.isCurrent(token)
            }
        }

        AsyncFunction("finishPlaybackPreparationIfCurrent") Coroutine { token: Long ->
            withContext(Dispatchers.Main.immediate) { playbackReplacement.finishIfCurrent(token) }
        }

        AsyncFunction("setWidgetThemeProjection") Coroutine { projectionJson: String ->
            withContext(Dispatchers.Main.immediate) {
                val context = appContext.reactContext?.applicationContext
                    ?: error("Widget theme application context is unavailable")
                val result = WidgetThemeStore.save(context, projectionJson)
                if (result == "applied") WidgetRenderer.updateAll(context)
                result
            }
        }

        AsyncFunction("replacePlayback") Coroutine { tracks: List<TrackRecord>, currentEntryId: String,
            positionSeconds: Double, speed: Float, shouldPlay: Boolean, mode: String, token: Long, fmContextId: String? ->
            try {
                check(playbackReplacement.isCurrent(token)) { "PlaybackReplacementCancelled" }
                require(mode == "music" || mode == "listening") { "Invalid playback mode" }
                require(positionSeconds.isFinite() && positionSeconds >= 0 && positionSeconds <= Long.MAX_VALUE / 1000.0 && speed.isFinite() && speed in 0.1f..3f) {
                    "Invalid playback position or speed"
                }
                require(tracks.isNotEmpty() && tracks.map { it.id }.distinct().size == tracks.size) { "Invalid playback queue" }
                val target = tracks.firstOrNull { it.id == currentEntryId } ?: error("Current source is absent from queue")
                require(tracks.all { PlaybackSourceIdentity.isValidEntry(it.id, it.sourceId, it.url, mode) }) { "Expected stable playback source identities" }
                val resumed = withServiceAndPlayerOnMainThread { service, _ ->
                    check(playbackReplacement.isCurrent(token)) { "PlaybackReplacementCancelled" }
                    if (mode == "music" && fmContextId == null && service.canResumeMusicSelection(tracks, currentEntryId))
                        playbackReplacement.commit(token) { service.resumeCurrentMusic(shouldPlay) }
                    else null
                }
                if (resumed != null) resumed else {
                    withContext(Dispatchers.IO) { PlaybackPreparation.checkAudio(requireNotNull(cachedAppContext), target.url, playbackReplacement, token) }
                    withServiceAndPlayerOnMainThread { service, _ ->
                        playbackReplacement.commit(token) {
                            service.replacePlayback(PlaybackSessionSnapshot(
                                mode, tracks, target.sourceId ?: target.id, positionSeconds, target.duration ?: 0.0,
                                speed, shouldPlay, System.currentTimeMillis(), currentEntryId,
                            ), fmContextId)
                        } ?: error("PlaybackReplacementCancelled")
                    }
                }
            } finally {
                withContext(NonCancellable + Dispatchers.Main.immediate) { playbackReplacement.finishIfCurrent(token) }
            }
        }

        AsyncFunction("switchMusicPart") Coroutine { target: TrackRecord, expectedCurrentEntryId: String,
            expectedSourceId: String, token: Long ->
            try {
                check(playbackReplacement.isCurrent(token)) { "PlaybackReplacementCancelled" }
                val generation = OrpheusConfig.accountGeneration()
                require(target.id == expectedCurrentEntryId && target.sourceId != null &&
                    PlaybackSourceIdentity.isValidEntry(target.id, target.sourceId, target.url, "music") &&
                    PlaybackSourceIdentity.sameBilibiliVideo(expectedSourceId, requireNotNull(target.sourceId))) {
                    "只能切换当前视频的同一 BV 分 P。"
                }
                withContext(Dispatchers.IO) { PlaybackPreparation.checkAudio(requireNotNull(cachedAppContext), target.url, playbackReplacement, token) }
                withServiceAndPlayerOnMainThread { service, _ ->
                    check(generation == OrpheusConfig.accountGeneration()) { "PlaybackReplacementCancelled" }
                    playbackReplacement.commit(token) {
                        service.switchMusicPart(target, expectedCurrentEntryId, expectedSourceId)
                    } ?: error("PlaybackReplacementCancelled")
                }
            } finally {
                withContext(NonCancellable + Dispatchers.Main.immediate) { playbackReplacement.finishIfCurrent(token) }
            }
        }

        AsyncFunction("replaceListeningPlayback") Coroutine { tracks: List<TrackRecord>, currentEntryId: String,
            positionSeconds: Double, speed: Float, shouldPlay: Boolean, token: Long, listeningResumeOverrides: Map<String, Double> ->
            val mode = "listening"
            try {
                check(playbackReplacement.isCurrent(token)) { "PlaybackReplacementCancelled" }
                require(expo.modules.orpheus.util.ListeningResumeOverrides.valid(mode, tracks, listeningResumeOverrides)) { "Invalid listening resume overrides" }
                require(positionSeconds.isFinite() && positionSeconds >= 0 && positionSeconds <= Long.MAX_VALUE / 1000.0 && speed.isFinite() && speed in 0.1f..3f) {
                    "Invalid playback position or speed"
                }
                require(tracks.isNotEmpty() && tracks.map { it.id }.distinct().size == tracks.size) { "Invalid playback queue" }
                val target = tracks.firstOrNull { it.id == currentEntryId } ?: error("Current source is absent from queue")
                require(tracks.all { PlaybackSourceIdentity.isValidEntry(it.id, it.sourceId, it.url, mode) }) { "Expected stable playback source identities" }
                withContext(Dispatchers.IO) { PlaybackPreparation.checkAudio(requireNotNull(cachedAppContext), target.url, playbackReplacement, token) }
                withServiceAndPlayerOnMainThread { service, _ ->
                    playbackReplacement.commit(token) {
                        service.replacePlayback(PlaybackSessionSnapshot(
                            mode, tracks, target.sourceId ?: target.id, positionSeconds, target.duration ?: 0.0,
                            speed, shouldPlay, System.currentTimeMillis(), currentEntryId,
                            listeningResumeOverrides = if (listeningResumeOverrides.containsKey(target.sourceId ?: target.id))
                                listeningResumeOverrides + ((target.sourceId ?: target.id) to positionSeconds) else listeningResumeOverrides,
                            listeningResumeBlocked = listeningResumeOverrides.keys,
                        ), null)
                    } ?: error("PlaybackReplacementCancelled")
                }
            } finally {
                withContext(NonCancellable + Dispatchers.Main.immediate) { playbackReplacement.finishIfCurrent(token) }
            }
        }

        AsyncFunction("startCandidateAudition") Coroutine { track: TrackRecord, token: Long ->
            try {
                check(playbackReplacement.isCurrent(token)) { "PlaybackReplacementCancelled" }
                expo.modules.orpheus.util.CandidateAudition.temporary(track)
                withContext(Dispatchers.IO) { PlaybackPreparation.checkAudio(requireNotNull(cachedAppContext), track.url, playbackReplacement, token) }
                withServiceAndPlayerOnMainThread { service, _ ->
                    playbackReplacement.commit(token) { service.startCandidateAudition(track, token) }
                        ?: error("PlaybackReplacementCancelled")
                }
            } finally {
                withContext(NonCancellable + Dispatchers.Main.immediate) { playbackReplacement.finishIfCurrent(token) }
            }
        }

        AsyncFunction("endCandidateAudition") Coroutine { auditionId: String ->
            withServiceAndPlayerOnMainThread { service, _ ->
                service.endCandidateAudition(auditionId)
            }
        }

        AsyncFunction("startFm") Coroutine { tracks: List<TrackRecord>, token: Long ->
            try {
                check(playbackReplacement.isCurrent(token)) { "PlaybackReplacementCancelled" }
                FmPlaybackSessions.validateTracks(tracks)
                withContext(Dispatchers.IO) { PlaybackPreparation.checkAudio(requireNotNull(cachedAppContext), tracks.first().url, playbackReplacement, token) }
                withServiceAndPlayerOnMainThread { service, _ ->
                    playbackReplacement.commit(token) { service.startFm(tracks) }
                        ?: error("PlaybackReplacementCancelled")
                }
            } finally {
                withContext(NonCancellable + Dispatchers.Main.immediate) { playbackReplacement.finishIfCurrent(token) }
            }
        }

        AsyncFunction("exitFm") Coroutine { fmId: String, token: Long ->
            try {
                check(playbackReplacement.isCurrent(token)) { "PlaybackReplacementCancelled" }
                val target = withServiceAndPlayerOnMainThread { service, _ -> service.fmReturnTarget(fmId) }
                target.tracks.firstOrNull { it.id == target.currentEntryId }?.let { selected ->
                    withContext(Dispatchers.IO) { PlaybackPreparation.checkAudio(requireNotNull(cachedAppContext), selected.url, playbackReplacement, token) }
                }
                withServiceAndPlayerOnMainThread { service, _ ->
                    playbackReplacement.commit(token) { service.exitFm(fmId) }
                        ?: error("PlaybackReplacementCancelled")
                }
            } finally {
                withContext(NonCancellable + Dispatchers.Main.immediate) { playbackReplacement.finishIfCurrent(token) }
            }
        }

        AsyncFunction("appendFm") Coroutine { tracks: List<TrackRecord>, fmId: String, expectedTailEntryId: String ->
            withServiceAndPlayerOnMainThread { service, _ -> service.appendFm(tracks, fmId, expectedTailEntryId) }
        }

        AsyncFunction("removeMusicQueueEntry") Coroutine { expectedCurrentEntryId: String, entryId: String, expectedQueueEntryIds: List<String> ->
            withServiceAndPlayerOnMainThread { service, _ ->
                service.removeMusicQueueEntry(expectedCurrentEntryId, entryId, expectedQueueEntryIds)
            }
        }

        AsyncFunction("undoMusicQueueRemoval") Coroutine { token: String ->
            withServiceAndPlayerOnMainThread { service, _ -> service.undoMusicQueueRemoval(token) }
        }

        AsyncFunction("moveMusicQueueEntryNext") Coroutine { expectedCurrentEntryId: String, entryId: String, expectedQueueEntryIds: List<String> ->
            withServiceAndPlayerOnMainThread { service, _ ->
                service.moveMusicQueueEntryNext(expectedCurrentEntryId, entryId, expectedQueueEntryIds)
            }
        }

        AsyncFunction("playNext") Coroutine { track: TrackRecord ->
            val context = appContext.reactContext
            val mediaItem = track.toMediaItem(context)
            withServiceAndPlayerOnMainThread { service, currentPlayer ->
                service.requireNotCandidateAudition()
                playbackReplacement.cancel()
                val shuffleEnabled = service.shuffleManager.isEnabled

                var existingIndex = -1
                for (i in 0 until currentPlayer.mediaItemCount) {
                    if (currentPlayer.getMediaItemAt(i).mediaId == track.id) {
                        existingIndex = i
                        break
                    }
                }

                if (existingIndex != -1) {
                    if (existingIndex == currentPlayer.currentMediaItemIndex) {
                        return@withServiceAndPlayerOnMainThread
                    }
                    if (shuffleEnabled) {
                        // Remove the existing instance then re-add right after the current item.
                        // Using remove+add (rather than moveMediaItem) keeps the physical insertion
                        // index deterministic: after removing existingIndex, currentMediaItemIndex
                        // is automatically adjusted, so +1 always points to the correct next slot.
                        currentPlayer.removeMediaItem(existingIndex)
                        val insertPhysical =
                            (currentPlayer.currentMediaItemIndex + 1).coerceAtMost(currentPlayer.mediaItemCount)
                        currentPlayer.addMediaItem(insertPhysical, mediaItem)
                        service.shuffleManager.repositionAsNext(insertPhysical)
                    } else {
                        val targetIndex = currentPlayer.currentMediaItemIndex + 1
                        val safeTargetIndex = targetIndex.coerceAtMost(currentPlayer.mediaItemCount)
                        currentPlayer.moveMediaItem(existingIndex, safeTargetIndex)
                    }
                } else {
                    val targetIndex = currentPlayer.currentMediaItemIndex + 1
                    val safeTargetIndex = targetIndex.coerceAtMost(currentPlayer.mediaItemCount)
                    currentPlayer.addMediaItem(safeTargetIndex, mediaItem)
                    if (shuffleEnabled) {
                        service.shuffleManager.repositionAsNext(safeTargetIndex)
                    }
                }

                if (currentPlayer.playbackState == Player.STATE_IDLE) {
                    currentPlayer.prepare()
                }
            }
        }

        AsyncFunction("getOfflineStorage") {
            val context = appContext.reactContext ?: error("应用未就绪")
            mapOf("limitBytes" to OfflineDownloadPolicy.limit(context),
                "usedBytes" to DownloadCache.getStableCache(context).cacheSpace,
                "freeBytes" to context.filesDir.usableSpace)
        }
        AsyncFunction("setOfflineStorageLimit") { bytes: Double ->
            val context = appContext.reactContext ?: error("应用未就绪")
            require(bytes.isFinite() && bytes % 1.0 == 0.0) { "容量上限无效" }
            OfflineDownloadPolicy.setLimit(context, bytes.toLong())
        }
        AsyncFunction("saveOfflineTrack") { track: TrackRecord ->
            val context = appContext.reactContext ?: error("应用未就绪")
            val uri = track.url.toUri()
            val bvid = uri.getQueryParameter("bvid") ?: ""
            val cid = uri.getQueryParameter("cid")?.toLongOrNull()
            require(uri.scheme == "orpheus" && uri.host == "bilibili" &&
                bvid.matches(Regex("BV[A-Za-z0-9]{10}")) && cid != null && cid > 0 &&
                track.sourceId == "bilibili:$bvid:$cid" && !uri.queryParameterNames.contains("meloOffline") &&
                expo.modules.orpheus.util.PlaybackSourceIdentity.isValid(track.sourceId ?: "", track.url)) { "仅支持已核对来源的 B 站独立音轨" }
            OfflineDownloadPolicy.requireWifi(context)
            check(OfflineDownloadPolicy.limit(context) > 0) { "请先在离线管理设置容量上限" }
            val digest = java.security.MessageDigest.getInstance("SHA-256")
                .digest(track.url.toByteArray()).joinToString("") { "%02x".format(it) }
            val request = DownloadRequest.Builder("melo-offline:$digest", uri)
                .setCustomCacheKey(track.url)
                .setData(json.encodeToString(track).toByteArray()).build()
            DownloadService.sendAddDownload(context, OrpheusDownloadService::class.java, request, false)
        }
        AsyncFunction("pauseOfflineDownload") { id: String ->
            val context = appContext.reactContext ?: error("应用未就绪")
            require(id.startsWith("melo-offline:"))
            DownloadUtil.getDownloadManager(context).downloadIndex.getDownload(id)?.let { OfflineDownloadPolicy.cancelUri(it.request.uri.toString()) }
            DownloadService.sendSetStopReason(context, OrpheusDownloadService::class.java, id, 1, false)
        }
        AsyncFunction("retryOfflineDownload") { id: String ->
            val context = appContext.reactContext ?: error("应用未就绪")
            require(id.startsWith("melo-offline:"))
            OfflineDownloadPolicy.requireWifi(context)
            val download = DownloadUtil.getDownloadManager(context).downloadIndex.getDownload(id)
                ?: error("离线任务已不存在")
            if (download.state == Download.STATE_COMPLETED && !OfflineDownloadPolicy.verified(context, download)) {
                DownloadService.sendRemoveDownload(context, OrpheusDownloadService::class.java, id, false)
            }
            DownloadService.sendAddDownload(context, OrpheusDownloadService::class.java, download.request, 0, false)
        }

        AsyncFunction("downloadTrack") { track: TrackRecord ->
            val context = appContext.reactContext ?: return@AsyncFunction
            val downloadRequest = DownloadRequest.Builder(track.id, track.url.toUri())
                .setData(json.encodeToString(track).toByteArray())
                .build()

            DownloadService.sendAddDownload(
                context,
                OrpheusDownloadService::class.java,
                downloadRequest,
                false
            )
        }

        AsyncFunction("multiDownload") { tracks: List<TrackRecord> ->
            val context = appContext.reactContext ?: return@AsyncFunction
            tracks.forEach { track ->
                val downloadRequest = DownloadRequest.Builder(track.id, track.url.toUri())
                    .setData(json.encodeToString(track).toByteArray())
                    .build()
                DownloadService.sendAddDownload(
                    context,
                    OrpheusDownloadService::class.java,
                    downloadRequest,
                    false
                )
            }
            return@AsyncFunction
        }

        AsyncFunction("resumeDownload") { id: String ->
            val context = appContext.reactContext ?: return@AsyncFunction
            DownloadService.sendSetStopReason(
                context,
                OrpheusDownloadService::class.java,
                id,
                Download.STOP_REASON_NONE,
                false
            )
        }

        AsyncFunction("retryDownload") { track: TrackRecord ->
            val context = appContext.reactContext ?: return@AsyncFunction
            val downloadRequest = DownloadRequest.Builder(track.id, track.url.toUri())
                .setData(json.encodeToString(track).toByteArray())
                .build()
            DownloadService.sendAddDownload(
                context,
                OrpheusDownloadService::class.java,
                downloadRequest,
                false
            )
        }

        AsyncFunction("setDownloadMaxParallelTasks") { maxParallelTasks: Int ->
            val context = appContext.reactContext ?: return@AsyncFunction
            DownloadUtil.setMaxParallelDownloads(context, maxParallelTasks)
        }

        AsyncFunction("setAllowSimultaneousPlayback") Coroutine { enabled: Boolean ->
            withPlayerOnMainThread { player ->
                val audioAttributes = AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build()
                player.setAudioAttributes(audioAttributes, !enabled)
            }
        }

        AsyncFunction("removeDownload") { id: String ->
            val context = appContext.reactContext ?: return@AsyncFunction
            if (id.startsWith("melo-offline:")) DownloadUtil.getDownloadManager(context).downloadIndex.getDownload(id)?.let { OfflineDownloadPolicy.cancelUri(it.request.uri.toString()) }
            DownloadService.sendRemoveDownload(
                context,
                OrpheusDownloadService::class.java,
                id,
                false
            )
            CoverDownloadManager.deleteCover(context, id)
        }

        AsyncFunction("removeDownloads") { ids: List<String> ->
            val context = appContext.reactContext ?: return@AsyncFunction
            for (id in ids) {
                DownloadService.sendRemoveDownload(
                    context,
                    OrpheusDownloadService::class.java,
                    id,
                    false
                )
                CoverDownloadManager.deleteCover(context, id)
            }
        }

        AsyncFunction("removeAllDownloads") {
            val context = appContext.reactContext ?: return@AsyncFunction null
            DownloadService.sendRemoveAllDownloads(
                context,
                OrpheusDownloadService::class.java,
                false
            )
            CoverDownloadManager.deleteAllCovers(context)
        }

        AsyncFunction("clearPlaybackCache") Coroutine { ->
            val context = cachedAppContext ?: error("Orpheus application context is unavailable")
            withContext(Dispatchers.IO) { DownloadCache.clearLruCache(context) }
        }

        AsyncFunction("getDownloads") {
            val context =
                appContext.reactContext ?: return@AsyncFunction emptyList<DownloadTaskRecord>()
            val downloadManager = DownloadUtil.getDownloadManager(context)
            val downloadIndex = downloadManager.downloadIndex

            val cursor = downloadIndex.getDownloads()
            val result = ArrayList<DownloadTaskRecord>()

            try {
                while (cursor.moveToNext()) {
                    val download = cursor.download
                    result.add(getDownloadRecord(download))
                }
            } finally {
                cursor.close()
            }
            return@AsyncFunction result
        }

        AsyncFunction("getCompletedDownloadTasks") {
            val context =
                appContext.reactContext ?: return@AsyncFunction emptyList<DownloadTaskRecord>()
            val downloadIndex = DownloadUtil.getDownloadManager(context).downloadIndex
            val cursor = downloadIndex.getDownloads(Download.STATE_COMPLETED)
            val result = ArrayList<DownloadTaskRecord>()

            try {
                while (cursor.moveToNext()) {
                    result.add(getDownloadRecord(cursor.download))
                }
            } finally {
                cursor.close()
            }
            return@AsyncFunction result
        }

        AsyncFunction("getDownloadStatusByIds") { ids: List<String> ->
            val context =
                appContext.reactContext ?: return@AsyncFunction emptyMap<String, Int>()
            val downloadManager = DownloadUtil.getDownloadManager(context)
            val downloadIndex = downloadManager.downloadIndex

            val result = mutableMapOf<String, Int>()

            for (id in ids) {
                val download = downloadIndex.getDownload(id)
                if (download != null) {
                    result[id] = download.state
                }
            }
            return@AsyncFunction result
        }

        AsyncFunction("clearUncompletedDownloadTasks") {
            val context = appContext.reactContext ?: return@AsyncFunction null
            val downloadManager = DownloadUtil.getDownloadManager(context)
            val downloadIndex = downloadManager.downloadIndex

            val cursor = downloadIndex.getDownloads(*uncompletedDownloadStates)
            try {
                while (cursor.moveToNext()) {
                    val download = cursor.download
                    DownloadService.sendRemoveDownload(
                        context,
                        OrpheusDownloadService::class.java,
                        download.request.id,
                        false
                    )
                }
            } finally {
                cursor.close()
            }
        }

        AsyncFunction("downloadMissingCovers") {
            val context =
                appContext.reactContext ?: return@AsyncFunction 0
            val downloadManager = DownloadUtil.getDownloadManager(context)
            val downloadIndex = downloadManager.downloadIndex
            val cursor = downloadIndex.getDownloads()

            // 先收集所有待下载项
            data class PendingCover(val trackId: String, val artworkUrl: String)

            val pendingList = mutableListOf<PendingCover>()

            try {
                while (cursor.moveToNext()) {
                    val download = cursor.download
                    if (download.state != Download.STATE_COMPLETED) continue
                    if (download.request.data.isEmpty()) continue

                    val trackId = download.request.id
                    if (CoverDownloadManager.getCoverFile(context, trackId) != null) continue

                    try {
                        val track = json.decodeFromString<TrackRecord>(
                            String(download.request.data)
                        )
                        val artwork = track.artwork
                        if (!artwork.isNullOrEmpty()) {
                            pendingList.add(PendingCover(trackId, artwork))
                        }
                    } catch (e: Exception) {
                        Log.e("Orpheus", "Failed to parse track for cover: ${e.message}")
                    }
                }
            } finally {
                cursor.close()
            }

            val total = pendingList.size
            if (total == 0) return@AsyncFunction 0

            // 在 IO 线程顺序下载，逐个发送进度事件
            ioScope.launch {
                pendingList.forEachIndexed { index, item ->
                    val status = try {
                        CoverDownloadManager.downloadCover(context, item.trackId, item.artworkUrl)
                        "success"
                    } catch (e: Exception) {
                        Log.e("Orpheus", "Cover download failed for ${item.trackId}: ${e.message}")
                        "failed"
                    }
                    sendEvent(
                        "onCoverDownloadProgress", mapOf(
                            "current" to (index + 1),
                            "total" to total,
                            "trackId" to item.trackId,
                            "status" to status
                        )
                    )
                }
            }

            return@AsyncFunction total
        }

        AsyncFunction("exportDownloads") { ids: List<String>, destinationUri: String, filenamePattern: String?, embedLyrics: Boolean, convertToLrc: Boolean, cropCoverArt: Boolean ->
            val context = appContext.reactContext ?: run {
                sendEvent(
                    "onExportProgress", mapOf(
                        "status" to "error",
                        "message" to "React context is null"
                    )
                )
                return@AsyncFunction
            }
            runExportDownloads(
                ids = ids,
                destinationUri = destinationUri,
                context = context,
                options = ExportOptions(
                    filenamePattern = filenamePattern,
                    embedLyrics = embedLyrics,
                    convertToLrc = convertToLrc,
                    cropCoverArt = cropCoverArt,
                ),
                json = json,
                ioScope = ioScope,
                sendEvent = ::sendEvent,
            )
        }

        Function("getDownloadedCoverUri") { trackId: String ->
            val context = appContext.reactContext ?: return@Function null
            val file = CoverDownloadManager.getCoverFile(context, trackId)
            file?.let { "file://${it.absolutePath}" }
        }

        AsyncFunction("getUncompletedDownloadTasks") {
            val context =
                appContext.reactContext ?: return@AsyncFunction emptyList<DownloadTaskRecord>()
            val downloadManager = DownloadUtil.getDownloadManager(context)
            val downloadIndex = downloadManager.downloadIndex

            val cursor = downloadIndex.getDownloads(*uncompletedDownloadStates)
            val result = ArrayList<DownloadTaskRecord>()

            try {
                while (cursor.moveToNext()) {
                    val download = cursor.download
                    result.add(getDownloadRecord(download))
                }
            } finally {
                cursor.close()
            }
            return@AsyncFunction result
        }

        AsyncFunction("checkOverlayPermission") {
            val context = appContext.reactContext ?: return@AsyncFunction false
            android.provider.Settings.canDrawOverlays(context)
        }

        AsyncFunction("requestOverlayPermission") Coroutine { ->
            val context = appContext.reactContext ?: return@Coroutine false
            withContext(Dispatchers.Main.immediate) {
                if (!android.provider.Settings.canDrawOverlays(context)) {
                    val intent = android.content.Intent(
                        android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        "package:${context.packageName}".toUri()
                    )
                    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(intent)
                }
            }
        }

        AsyncFunction("showDesktopLyrics") Coroutine { ->
            withServiceOnMainThread { it?.floatingLyricsManager?.show() }
        }

        AsyncFunction("hideDesktopLyrics") Coroutine { ->
            withServiceOnMainThread { it?.floatingLyricsManager?.hide() }
        }

        AsyncFunction("setLyricsInternal") Coroutine { lyricsJson: String, consumerIds: List<String> ->
            submitLyricsInternal(lyricsJson, resolveLyricsConsumers(consumerIds))
        }

        AsyncFunction("clearOverlays") Coroutine { ->
            // 无歌词时临时隐藏 overlay，但不修改 GeneralStorage（用户偏好保持 true）
            // 当再次收到歌词时，桌面歌词会按用户偏好重新 show()
            withServiceOnMainThread { service ->
                service?.lyricsManager?.clearConsumers(LyricsConsumer.all(), softHideDesktop = true)
            }
        }

        AsyncFunction("setPlaybackSpeed") Coroutine { speed: Float ->
            withPlayerOnMainThread {
                playbackReplacement.cancel()
                it.setPlaybackSpeed(speed)
            }
        }

        AsyncFunction("selectDirectory") Coroutine { ->
            val context = appContext.reactContext ?: return@Coroutine null
            val uriString = try {
                directoryPickerLauncher.launch("")
            } catch (e: Exception) {
                Log.e("Orpheus", "Directory picker launch failed (framework race condition): ${e.message}")
                null
            }
            if (uriString != null) {
                try {
                    val treeUri = uriString.toUri()
                    context.contentResolver.takePersistableUriPermission(
                        treeUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    )
                } catch (e: Exception) {
                    Log.e("Orpheus", "Failed to take persistable URI permission: ${e.message}")
                }
            }
            uriString
        }

        AsyncFunction("isDirectoryPickerAvailable") {
            val context = appContext.reactContext ?: return@AsyncFunction false
            Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).resolveActivity(context.packageManager) != null
        }

        AsyncFunction("getPlaybackSpeed") Coroutine { ->
            withPlayerOnMainThread { it.playbackParameters.speed }
        }

        Function("getLruCachedUris") { uris: List<String> ->
            try {
                uris.filter { uri ->
                    expo.modules.orpheus.manager.CachedUriManager.isFullyCached(uri)
                }
            } catch (e: Exception) {
                emptyList<String>()
            }
        }

        Function("updateSpectrumData") { destination: Float32Array ->
            val size = destination.length
            if (tempBuffer == null || tempBuffer!!.size != size) {
                tempBuffer = FloatArray(size)
            }
            val buffer = tempBuffer!!
            spectrumManager.getSpectrumData(buffer)

            val byteBuffer = destination.toDirectBuffer()
            byteBuffer.order(java.nio.ByteOrder.nativeOrder())
            byteBuffer.asFloatBuffer().put(buffer)
        }

        Function("exportData") {
            val playerQueue = GeneralStorage.exportConfig()
            val loudness = LoudnessStorage.exportAll()
            mapOf("playerQueue" to playerQueue, "loudness" to loudness)
        }

        @Suppress("UNCHECKED_CAST")
        Function("importData") { data: Map<String, Any> ->
            val playerQueue = (data["playerQueue"] as? Map<String, Any>) ?: emptyMap()
            val loudness = (data["loudness"] as? Map<String, Any>) ?: emptyMap()
            GeneralStorage.importConfig(playerQueue)
            loudness.forEach { (key, value) ->
                LoudnessStorage.setLoudnessData(key, (value as Number).toDouble())
            }
        }
    }

    private fun getDownloadRecord(download: Download): DownloadTaskRecord {
        val trackJson = if (download.request.data.isNotEmpty()) {
            String(download.request.data)
        } else null

        val record = DownloadTaskRecord().apply {
            id = download.request.id
            state = download.state
            percentDownloaded = download.percentDownloaded
            bytesDownloaded = download.bytesDownloaded
            stopReason = download.stopReason
            contentLength = download.contentLength
            val context = appContext.reactContext
            verifiedComplete = context != null && OfflineDownloadPolicy.verified(context, download)
        }

        if (trackJson != null) {
            try {
                record.track = json.decodeFromString<TrackRecord>(trackJson)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
        return record
    }

    private fun getDownloadEventPayload(download: Download): Map<String, Any> {
        val record = getDownloadRecord(download)
        return mutableMapOf<String, Any>(
            "id" to record.id,
            "state" to record.state,
            "percentDownloaded" to record.percentDownloaded,
            "bytesDownloaded" to record.bytesDownloaded,
            "contentLength" to record.contentLength,
            "verifiedComplete" to record.verifiedComplete,
            "stopReason" to record.stopReason,
        ).apply {
            record.track?.let { put("track", it) }
        }
    }

    private val downloadListener = object : DownloadManager.Listener {
        override fun onDownloadChanged(
            downloadManager: DownloadManager,
            download: Download,
            finalException: Exception?
        ) {
            sendEvent("onDownloadUpdated", getDownloadEventPayload(download))
            updateDownloadProgressRunnerState()

            // 歌曲下载完成后，异步下载封面
            if (download.state == Download.STATE_COMPLETED && download.request.data.isNotEmpty() && !download.request.id.startsWith("melo-offline:")) {
                // 封面下载只需能访问文件系统的 Context，使用 OnCreate 时缓存的
                // applicationContext，避免 reactContext 为 null 时封面静默跳过。
                val context = cachedAppContext ?: appContext.reactContext ?: return
                try {
                    val track = json.decodeFromString<TrackRecord>(
                        String(download.request.data)
                    )
                    val artwork = track.artwork
                    if (!artwork.isNullOrEmpty()) {
                        ioScope.launch {
                            CoverDownloadManager.downloadCover(context, track.id, artwork)
                        }
                    }
                } catch (e: Exception) {
                    Log.e("Orpheus", "Failed to trigger cover download: ${e.message}")
                }
            }
        }
    }

    private val downloadProgressRunnable = object : Runnable {
        override fun run() {
            val manager = downloadManager ?: return
            if (manager.currentDownloads.isNotEmpty()) {
                for (download in manager.currentDownloads) {
                    if (download.state == Download.STATE_DOWNLOADING) {
                        sendEvent("onDownloadUpdated", getDownloadEventPayload(download))
                    }
                }
                mainHandler.postDelayed(this, 500)
            }
        }
    }

    private fun updateDownloadProgressRunnerState() {
        mainHandler.removeCallbacks(downloadProgressRunnable)
        val manager = downloadManager ?: return

        val hasActiveDownloads =
            manager.currentDownloads.any { it.state == Download.STATE_DOWNLOADING }

        if (hasActiveDownloads) {
            mainHandler.post(downloadProgressRunnable)
        }
    }

    private val progressSendEventRunnable = object : Runnable {
        override fun run() {
            val p = player ?: return

            if (p.isPlaying) {
                val currentMs = p.currentPosition
                val durationMs = p.duration

                sendEvent(
                    "onPositionUpdate", mapOf(
                        "position" to currentMs / 1000.0,
                        "duration" to if (durationMs == C.TIME_UNSET) 0.0 else durationMs / 1000.0,
                        "buffered" to p.bufferedPosition / 1000.0
                    )
                )
            }

            mainHandler.postDelayed(this, 200)
        }
    }

    private val progressSaveRunnable = object : Runnable {
        override fun run() {
            saveCurrentPosition()
            mainHandler.postDelayed(this, 5000)
        }
    }

    private fun updateProgressRunnerState() {
        val p = player
        // 如果正在播放且状态是 READY，则开始轮询
        if (p != null && p.isPlaying && p.playbackState == Player.STATE_READY) {
            mainHandler.removeCallbacks(progressSendEventRunnable)
            mainHandler.removeCallbacks(progressSaveRunnable)
            mainHandler.post(progressSaveRunnable)
            mainHandler.post(progressSendEventRunnable)
        } else {
            mainHandler.removeCallbacks(progressSendEventRunnable)
            mainHandler.removeCallbacks(progressSaveRunnable)
        }
    }

    private fun mediaItemToTrackRecord(item: MediaItem): TrackRecord {
        val extras = item.mediaMetadata.extras
        val trackJson = extras?.getString("track_json")

        if (trackJson != null) {
            try {
                return json.decodeFromString(trackJson)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        val track = TrackRecord()
        track.id = item.mediaId
        track.url = item.localConfiguration?.uri?.toString() ?: ""
        track.title = item.mediaMetadata.title?.toString()
        track.artist = item.mediaMetadata.artist?.toString()
        track.artwork = item.mediaMetadata.artworkUri?.toString()

        return track
    }

    private fun saveCurrentPosition() {
        if (OrpheusMusicService.instance?.isCandidateAudition() == true) return
        val p = player ?: return
        if (p.playbackState != Player.STATE_IDLE) {
            GeneralStorage.savePosition(
                p.currentMediaItemIndex,
                p.currentPosition
            )
        }
    }

    private fun ensurePlayer() {
        val service = OrpheusMusicService.instance
            ?: throw ControllerNotInitializedException()
        val servicePlayer = service.ensurePlayer()
        if (this.player !== servicePlayer) {
            this.player?.removeListener(playerListener)
            this.player = servicePlayer
            servicePlayer.addListener(playerListener)
        }
    }

    private fun prepareIfIdle(player: Player) {
        OrpheusConfig.requirePlaybackAccess()
        if (player.playbackState == Player.STATE_IDLE && player.mediaItemCount > 0) {
            player.prepare()
        }
    }

    private suspend fun awaitController() {
        val future = controllerFuture ?: throw ControllerNotInitializedException()
        suspendCancellableCoroutine<Unit> { continuation ->
            future.addListener({
                try {
                    future.get()
                    if (continuation.isActive) continuation.resume(Unit)
                } catch (error: Exception) {
                    if (continuation.isActive) {
                        continuation.resumeWithException(error.cause ?: error)
                    }
                }
            }, MoreExecutors.directExecutor())
        }
    }

    private suspend fun <T> withPlayerOnMainThread(block: (Player) -> T): T {
        awaitController()
        return withContext(Dispatchers.Main.immediate) {
            ensurePlayer()
            val currentPlayer = player ?: throw ControllerNotInitializedException()
            block(currentPlayer)
        }
    }

    private suspend fun <T> withServiceAndPlayerOnMainThread(block: (OrpheusMusicService, Player) -> T): T {
        awaitController()
        return withContext(Dispatchers.Main.immediate) {
            ensurePlayer()
            val service = OrpheusMusicService.instance ?: throw ControllerNotInitializedException()
            val currentPlayer = player ?: throw ControllerNotInitializedException()
            block(service, currentPlayer)
        }
    }

    private suspend fun <T> withServiceOnMainThread(block: (OrpheusMusicService?) -> T): T =
        withContext(Dispatchers.Main.immediate) {
            block(OrpheusMusicService.instance)
        }

    private suspend fun submitLyricsInternal(
        lyricsJson: String,
        consumers: Set<LyricsConsumer>,
    ) {
        try {
            val data = json.decodeFromString<expo.modules.orpheus.model.LyricsData>(lyricsJson)
            withServiceOnMainThread { service ->
                service?.lyricsManager?.submitLyrics(data, consumers)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(
                "OrpheusLyrics",
                "[Module] submitLyrics failed consumers=${consumers.joinToString()} reason=${e.message}",
                e,
            )
        }
    }

    private fun resolveLyricsConsumers(consumerIds: List<String>): Set<LyricsConsumer> {
        if (consumerIds.isEmpty()) return LyricsConsumer.all()

        val resolved = consumerIds.mapNotNull { LyricsConsumer.fromIdentifier(it) }.toSet()
        if (resolved.isEmpty()) {
            Log.w("OrpheusLyrics", "[Module] No valid consumers resolved from $consumerIds")
        }
        return resolved
    }
}
