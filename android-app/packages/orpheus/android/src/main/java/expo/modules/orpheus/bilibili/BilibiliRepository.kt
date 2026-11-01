package expo.modules.orpheus.bilibili

import android.util.Log
import expo.modules.orpheus.OrpheusConfig
import expo.modules.orpheus.service.OrpheusMusicService
import expo.modules.orpheus.util.PlaybackReplacementGuard
import expo.modules.orpheus.util.OfflineDownloadPolicy

import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object BilibiliRepository {
    val TAG = "Orpheus/BilibiliRepo"

    private val api: BilibiliApi by lazy {
        NetworkModule.retrofit.create(BilibiliApi::class.java)
    }

    private fun <T> execute(call: retrofit2.Call<T>): retrofit2.Response<T> = try {
        call.execute()
    } catch (_: Exception) {
        // Network and serializer failures may contain URLs or server bodies.
        throw IOException("Bilibili API request failed")
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun rejectExpiredAccount(code: Int?, cookie: String?, expectedGeneration: Long) {
        if (code == -101 && OrpheusConfig.expireIfCurrent(cookie, expectedGeneration)) {
            PlaybackReplacementGuard.shared.cancel()
            OfflineDownloadPolicy.cancelAccountWork()
            OrpheusMusicService.instance?.onAccountSessionChanged()
        }
    }

    private var cachedImgKey: String? = null
    private var cachedSubKey: String? = null
    private var cachedDateStr: String? = null

    private fun getTodayDateStr(): String {
        val sdf = SimpleDateFormat("yyyyMMdd", Locale.getDefault())
        return sdf.format(Date())
    }

    @Synchronized
    private fun getWbiKeys(onCall: (retrofit2.Call<*>) -> Unit): Pair<String, String> {
        val today = getTodayDateStr()

        if (cachedImgKey != null && cachedSubKey != null && today == cachedDateStr) {
            return cachedImgKey!! to cachedSubKey!!
        }

        val call = api.getNavInfo()
        onCall(call)
        val response = execute(call)
        val wbiData = response.body()?.data?.wbiImg

        if (!response.isSuccessful || wbiData == null) {
            throw IOException("Bilibili API Error: code=${response.code()}")
        }

        val imgKey = WbiUtil.extractKey(wbiData.imgUrl)
        val subKey = WbiUtil.extractKey(wbiData.subUrl)

        cachedImgKey = imgKey
        cachedSubKey = subKey
        cachedDateStr = today

        return imgKey to subKey
    }

    /**
     * 解析音频 URL
     */
    fun resolveAudioUrl(
        bvid: String,
        cid: Long?,
        audioQuality: Int,
        enableDolby: Boolean,
        enableHiRes: Boolean,
        cookie: String?,
        onCall: (retrofit2.Call<*>) -> Unit = {},
    ): Pair<String, VolumeData?> {
        val expectedGeneration = OrpheusConfig.captureOnlineOrGuestGeneration(cookie)
        var cidInternal = cid
        val (imgKey, subKey) = getWbiKeys(onCall)
        if (cidInternal === null) {
            cidInternal = getFirstCid(bvid, cookie, onCall, expectedGeneration)
        }

        Log.e(TAG, "resolve url: bvid: $bvid, cid: $cid, enableDolby: ")

        val rawParams = mapOf(
            "bvid" to bvid,
            "cid" to cidInternal,
            "fnval" to 4048,
            "fnver" to 0,
            "fourk" to 1,
            "qlt" to audioQuality,
            "voice_balance" to 1
        )

        val signedParams = WbiUtil.sign(rawParams, imgKey, subKey)

        OrpheusConfig.requireOnlineOrGuestSession(expectedGeneration)
        val call = api.getPlayUrl(cookie, signedParams)
        onCall(call)
        val response = execute(call)

        if (!response.isSuccessful) {
            throw IOException("Bilibili API Http Error: ${response.code()}")
        }

        val apiResponse = response.body()
        if (apiResponse?.code != 0) {
            rejectExpiredAccount(apiResponse?.code, cookie, expectedGeneration)
            throw IOException("Bilibili API Error: code=${apiResponse?.code}")
        }

        OrpheusConfig.requireOnlineOrGuestSession(expectedGeneration)
        if (apiResponse.data == null) {
            throw IOException("Bilibili API response data missing")
        }

        val data = apiResponse.data
        val audio = selectAudioStream(data, audioQuality, enableDolby, enableHiRes)
        Log.d(TAG, "audio selected: bvid=$bvid requested=$audioQuality selected=${audio.id} transport=dash")
        return audio.baseUrl to data.volume
    }

    fun getFirstCid(
        bvid: String,
        cookie: String?,
        onCall: (retrofit2.Call<*>) -> Unit = {},
        expectedGeneration: Long = OrpheusConfig.captureOnlineOrGuestGeneration(cookie),
    ): Long {
        OrpheusConfig.requireOnlineOrGuestSession(expectedGeneration)
        val call = api.getPageList(cookie = cookie, bvid = bvid)
        onCall(call)
        val response = execute(call)

        if (!response.isSuccessful) {
            throw IOException("Bilibili API Http Error: ${response.code()}")
        }

        val apiResponse = response.body()
        if (apiResponse?.code != 0) {
            rejectExpiredAccount(apiResponse?.code, cookie, expectedGeneration)
            throw IOException("Bilibili API Error: code=${apiResponse?.code}")
        }

        OrpheusConfig.requireOnlineOrGuestSession(expectedGeneration)
        if (apiResponse.data == null) {
            throw IOException("Bilibili API response data missing")
        }

        return apiResponse.data[0].cid
    }
}
