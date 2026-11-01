package expo.modules.orpheus.util

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive

@Serializable
data class RecentMusicHistoryEntry(
    val sourceId: String,
    val title: String,
    val artist: String,
    val artwork: String,
    val playedAt: Long,
) {
    fun toJsMap(): Map<String, Any> = mapOf(
        "sourceId" to sourceId, "title" to title, "artist" to artist,
        "artwork" to artwork, "playedAt" to playedAt,
    )
}

@Serializable
private data class RecentMusicHistoryDocument(val version: Int = 1, val entries: List<RecentMusicHistoryEntry>)

/** A single value, with no expiry or truncation. Unknown/corrupt bytes are never overwritten. */
object RecentMusicHistoryCodec {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val source = Regex("bilibili:BV[A-Za-z0-9]{10}:([1-9][0-9]*)")

    private fun valid(entry: RecentMusicHistoryEntry): Boolean {
        val cid = source.matchEntire(entry.sourceId)?.groupValues?.get(1)?.toLongOrNull()
        val validSource = (cid != null && cid in 1..9007199254740991L) ||
            (entry.sourceId.startsWith("local:") && LocalAudioIdentity.validId(entry.sourceId.removePrefix("local:"))) ||
            (entry.sourceId.startsWith("douyin:") && DouyinAudioIdentity.validId(entry.sourceId.removePrefix("douyin:")))
        return validSource && entry.playedAt in 0..9007199254740991L
    }

    fun sorted(entries: List<RecentMusicHistoryEntry>): List<RecentMusicHistoryEntry> =
        entries.sortedWith(compareByDescending<RecentMusicHistoryEntry> { it.playedAt }.thenBy { it.sourceId })

    fun decode(raw: String?): List<RecentMusicHistoryEntry> {
        if (raw == null) return emptyList()
        try {
            val value = json.parseToJsonElement(raw) as? JsonObject ?: error("Invalid history")
            // Unlike an absent key, an absent/unknown version is not an empty history.
            check(value["version"]?.jsonPrimitive?.int == 1)
            val document = json.decodeFromJsonElement<RecentMusicHistoryDocument>(value)
            check(document.entries.all(::valid))
            check(document.entries.map { it.sourceId }.distinct().size == document.entries.size)
            return sorted(document.entries)
        } catch (error: Exception) {
            throw IllegalStateException("最近播放记录损坏或版本不受支持，原记录已保留。", error)
        }
    }

    fun encode(entries: List<RecentMusicHistoryEntry>): String {
        require(entries.all(::valid) && entries.map { it.sourceId }.distinct().size == entries.size)
        return json.encodeToString(RecentMusicHistoryDocument(entries = sorted(entries)))
    }
}

class RecentMusicHistoryPersistence(private val readRaw: () -> String?, private val writeRaw: (String) -> Boolean) {
    fun read(): List<RecentMusicHistoryEntry> = RecentMusicHistoryCodec.decode(readRaw())

    fun clear() {
        check(writeRaw(RecentMusicHistoryCodec.encode(emptyList()))) {
            "最近播放清空失败，请稍后重试。"
        }
    }

    fun record(entry: RecentMusicHistoryEntry) {
        val entries = read() // Refuse writes when stored data cannot be understood.
        check(writeRaw(RecentMusicHistoryCodec.encode(entries.filterNot { it.sourceId == entry.sourceId } + entry))) {
            "最近播放记录保存失败，请稍后重试。"
        }
    }
}

/** Observe settled Player state, not prepare/playWhenReady. Queue IDs distinguish source occurrences. */
class RecentMusicPlaybackObserver {
    private var entryId: String? = null
    private var playing = false
    private var newVisit = false

    fun transition(nextEntryId: String?, repeat: Boolean) {
        if (entryId != nextEntryId || repeat) newVisit = true
        entryId = nextEntryId
    }

    /** A failed commit must remain eligible on the next settled playback event. */
    fun recordFailed() { newVisit = true }

    fun observe(mode: String, currentEntryId: String?, isPlaying: Boolean): Boolean {
        val eligible = mode == "music" && currentEntryId != null && isPlaying
        val record = eligible && (!playing || currentEntryId != entryId || newVisit)
        entryId = currentEntryId
        playing = eligible
        // Preserve a paused/preparing visit until actual playback begins.
        if (eligible) newVisit = false
        return record
    }
}
