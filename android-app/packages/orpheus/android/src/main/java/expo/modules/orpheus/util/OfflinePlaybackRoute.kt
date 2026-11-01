package expo.modules.orpheus.util

import java.io.IOException
import java.net.URI

/** Both saved-list entries and ordinary entries use the same verified, cache-only route. */
internal object OfflinePlaybackRoute {
    const val SUFFIX = "&meloOffline=1"

    fun cacheKey(
        uri: String,
        hasPlaybackAccess: Boolean,
        hasAccountSession: Boolean,
        complete: (String) -> Boolean,
    ): String? {
        if (!hasPlaybackAccess ||
            LocalAudioIdentity.idFromUri(uri) != null ||
            DouyinAudioIdentity.idFromUri(uri) != null
        ) return null
        val explicit = uri.endsWith(SUFFIX)
        if (!explicit && hasAccountSession) return null
        val key = uri.removeSuffix(SUFFIX)
        val parsed = runCatching { URI(key) }.getOrElse { throw IOException("离线音源身份无效") }
        val parameters = parsed.rawQuery?.split('&')?.map { it.split('=', limit = 2) }
            ?.filter { it.size == 2 }?.associate { it[0] to it[1] } ?: emptyMap()
        val source = "bilibili:${parameters["bvid"]}:${parameters["cid"]}"
        if (!PlaybackSourceIdentity.isValid(source, key)) throw IOException("离线音源身份无效")
        if (!complete(key)) throw IOException("离线内容缺失或不完整，请联网后重新保存")
        return key
    }
}
