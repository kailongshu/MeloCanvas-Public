package expo.modules.orpheus.util

import java.net.URI

object PlaybackSourceIdentity {
    fun isValidEntry(entryId: String, sourceId: String?, url: String, mode: String): Boolean {
        if (mode != "music" && mode != "listening") return false
        val source = sourceId ?: entryId
        // Local files and Douyin tracks keep their real identity while saved playlists address occurrences.
        val local = LocalAudioIdentity.isValid(source, url)
        val douyin = DouyinAudioIdentity.isValid(source, url)
        if ((local || douyin) && mode != "music") return false
        if (!local && !douyin && !isValid(source, url)) return false
        if (entryId == source) return true
        // A direct music occurrence keeps its original part ID across explicit P changes.
        if (!local && !douyin && mode == "music" && sourceId != null && sameBilibiliVideo(entryId, source)) return true
        val itemId = entryId.removePrefix("playlist-item:")
        return mode == "music" && sourceId != null && entryId.startsWith("playlist-item:") &&
            itemId.isNotEmpty() && itemId.trim() == itemId
    }

    fun sameBilibiliVideo(left: String, right: String): Boolean {
        fun bvid(id: String): String? {
            val match = Regex("bilibili:(BV[A-Za-z0-9]{10}):([1-9][0-9]*)").matchEntire(id) ?: return null
            val cid = match.groupValues[2].toLongOrNull() ?: return null
            return match.groupValues[1].takeIf { cid in 1..9007199254740991L }
        }
        val first = bvid(left) ?: return false
        return first == bvid(right)
    }

    fun isValid(id: String, url: String): Boolean = runCatching {
        val uri = URI(url)
        val pairs = uri.rawQuery?.split('&')?.map { it.split('=', limit = 2) } ?: emptyList()
        if (pairs.any { it.size != 2 } || pairs.map { it[0] }.distinct().size != pairs.size) return false
        val params = pairs.associate { it[0] to it[1] }
        val bvid = params["bvid"] ?: return false
        val cid = params["cid"]?.toLongOrNull() ?: return false
        uri.scheme == "orpheus" && uri.host == "bilibili" && uri.fragment == null && uri.port == -1 && uri.userInfo == null &&
            Regex("BV[A-Za-z0-9]{10}").matches(bvid) && cid in 1..9007199254740991L &&
            id == "bilibili:$bvid:$cid"
    }.getOrDefault(false)
}
