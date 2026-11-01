package expo.modules.orpheus.util

import org.junit.Assert.*
import org.junit.Test

class PlaybackSourceIdentityTest {
    @Test fun directMusicOccurrenceCanRetainItsOriginalPartIdOnlyWithinOneVideo() {
        val first = "bilibili:BV1vT411i7ET:123"
        val next = "bilibili:BV1vT411i7ET:124"
        val uri = "orpheus://bilibili?bvid=BV1vT411i7ET&cid=124&quality=30232"
        assertTrue(PlaybackSourceIdentity.isValidEntry(first, next, uri, "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry(first, next, uri, "listening"))
        assertFalse(PlaybackSourceIdentity.isValidEntry(first, next, uri.replace("cid=124", "cid=123"), "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("bilibili:BV1Q541167Qg:123", next, uri, "music"))
        for (invalid in listOf("bilibili:BV1vT411i7ET:0", "bilibili:BV1vT411i7ET:0123",
            "bilibili:BV1vT411i7ET:9007199254740992", "arbitrary")) {
            assertFalse(PlaybackSourceIdentity.isValidEntry(invalid, next, uri, "music"))
            assertFalse(PlaybackSourceIdentity.sameBilibiliVideo(invalid, next))
        }
    }

    @Test fun localPlaylistOccurrencesKeepRealSourceAndMusicOnlyBoundary() {
        val uuid = "12345678-90ab-4cde-8fab-123456789abc"
        val source = LocalAudioIdentity.sourceId(uuid)
        val uri = LocalAudioIdentity.uri(uuid)
        assertTrue(PlaybackSourceIdentity.isValidEntry(source, null, uri, "music"))
        assertTrue(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", source, uri, "music"))
        assertTrue(PlaybackSourceIdentity.isValidEntry("playlist-item:a2", source, uri, "music"))
        for (entry in listOf(source, "playlist-item:a1")) {
            assertFalse(PlaybackSourceIdentity.isValidEntry(entry, source, uri, "listening"))
            assertFalse(PlaybackSourceIdentity.isValidEntry(entry, source, uri, "fm"))
        }
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", null, uri, "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", source, uri.replace("89abc", "89abd"), "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", source, "file:///tmp/audio.wav", "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", source, "content://audio/123", "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", source, "https://example.com/audio", "music"))
        for (entry in listOf("playlist-item:", "playlist-item: padded ", "arbitrary-id")) {
            assertFalse(PlaybackSourceIdentity.isValidEntry(entry, source, uri, "music"))
        }
    }

    @Test fun playlistOccurrencesKeepStrictUnderlyingBvCidValidation() {
        val source = "bilibili:BV1vT411i7ET:123"
        val uri = "orpheus://bilibili?bvid=BV1vT411i7ET&cid=123&quality=30232"
        assertTrue(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", source, uri, "music"))
        assertTrue(PlaybackSourceIdentity.isValidEntry("playlist-item:a2", source, uri, "music"))
        assertTrue(PlaybackSourceIdentity.isValidEntry(source, null, uri, "listening"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", null, uri, "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", source, uri.replace("cid=123", "cid=124"), "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", source, "https://cdn.example/audio?token=secret", "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("arbitrary-id", source, uri, "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:", source, uri, "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item: padded ", source, uri, "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:a1", source, uri, "listening"))
    }

    @Test fun stableBvCidIdentityAllowsDifferentParts() {
        assertTrue(PlaybackSourceIdentity.isValid("bilibili:BV1vT411i7ET:123", "orpheus://bilibili?bvid=BV1vT411i7ET&cid=123&quality=30232"))
        assertTrue(PlaybackSourceIdentity.isValid("bilibili:BV1vT411i7ET:124", "orpheus://bilibili?cid=124&bvid=BV1vT411i7ET"))
    }

    @Test fun signedCdnAndMismatchedPartCannotBecomePersistentSources() {
        assertFalse(PlaybackSourceIdentity.isValid("bilibili:BV1vT411i7ET:123", "https://example.com/audio.m4s?token=secret"))
        assertFalse(PlaybackSourceIdentity.isValid("bilibili:BV1vT411i7ET:123", "orpheus://bilibili?bvid=BV1vT411i7ET&cid=124"))
        assertFalse(PlaybackSourceIdentity.isValid("bilibili:BV1vT411i7ET:0", "orpheus://bilibili?bvid=BV1vT411i7ET&cid=0"))
        assertFalse(PlaybackSourceIdentity.isValid("bilibili:BV1vT411i7ET:9007199254740992", "orpheus://bilibili?bvid=BV1vT411i7ET&cid=9007199254740992"))
    }

    @Test fun duplicateQueryKeysCannotDisagreeWithAndroidUriResolution() {
        assertFalse(PlaybackSourceIdentity.isValid("bilibili:BV1vT411i7ET:124", "orpheus://bilibili?bvid=BV1vT411i7ET&cid=123&cid=124"))
        assertFalse(PlaybackSourceIdentity.isValid("bilibili:BV1vT411i7ET:123", "orpheus://bilibili?bvid=BV1vT411i7ET&bvid=BV1vT411i7ET&cid=123"))
        assertFalse(PlaybackSourceIdentity.isValid("bilibili:BV1vT411i7ET:123", "orpheus://bilibili?bvid=BV1vT411i7ET&cid=123&quality=30232&quality=30280"))
        val douyinSource = DouyinAudioIdentity.sourceId("7351234567890123456")
        val douyinUri = DouyinAudioIdentity.uri("7351234567890123456")
        assertTrue(PlaybackSourceIdentity.isValidEntry(douyinSource, null, douyinUri, "music"))
        assertTrue(PlaybackSourceIdentity.isValidEntry("playlist-item:d1", douyinSource, douyinUri, "music"))
        assertFalse(PlaybackSourceIdentity.isValidEntry(douyinSource, douyinSource, douyinUri, "listening"))
        assertFalse(PlaybackSourceIdentity.isValidEntry("playlist-item:d1", douyinSource, "https://cdn.example/video.mp4", "music"))
    }
}
