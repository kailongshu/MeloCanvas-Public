package expo.modules.orpheus.util

import java.net.URI

/** Stable Douyin audio content identity; avoids persisting expiring signed CDN URLs in queues. */
object DouyinAudioIdentity {
    private val awemePattern = Regex("[1-9][0-9]{5,24}")
    private const val SOURCE_PREFIX = "douyin:"
    private const val URI_PREFIX = "orpheus://douyin?awemeId="

    fun validId(awemeId: String): Boolean = awemePattern.matches(awemeId)

    fun sourceId(awemeId: String): String {
        require(validId(awemeId)) { "DouyinAudioInvalidIdentity" }
        return SOURCE_PREFIX + awemeId
    }

    fun uri(awemeId: String): String {
        require(validId(awemeId)) { "DouyinAudioInvalidIdentity" }
        return URI_PREFIX + awemeId
    }

    fun idFromUri(rawUri: String): String? = runCatching {
        if (!rawUri.startsWith(URI_PREFIX)) return null
        val parsed = URI(rawUri)
        if (parsed.scheme != "orpheus" || parsed.host != "douyin" ||
            parsed.fragment != null || parsed.port != -1 || parsed.userInfo != null) return null
        val id = rawUri.removePrefix(URI_PREFIX)
        id.takeIf(::validId)
    }.getOrNull()

    fun isValid(source: String, rawUri: String): Boolean =
        idFromUri(rawUri)?.let { source == sourceId(it) } == true
}
