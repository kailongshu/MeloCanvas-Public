package expo.modules.orpheus.util

import java.io.IOException
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class OfflinePlaybackRouteTest {
    private val uri = "orpheus://bilibili?bvid=BV1eZnA6XEy8&cid=42901111731&quality=30232"

    @Test fun ordinaryOfflineEntryAndExplicitEntryUseTheSameVerifiedCacheKey() {
        val checkedKeys = mutableListOf<String>()
        val complete: (String) -> Boolean = { key -> checkedKeys.add(key); true }
        assertEquals(uri, OfflinePlaybackRoute.cacheKey(uri, true, false, complete))
        assertEquals(uri, OfflinePlaybackRoute.cacheKey(uri + OfflinePlaybackRoute.SUFFIX, true, false, complete))
        assertEquals(uri, OfflinePlaybackRoute.cacheKey(uri + OfflinePlaybackRoute.SUFFIX, true, true, complete))
        assertEquals(listOf(uri, uri, uri), checkedKeys)
    }

    @Test fun onlineOrdinaryAndOpaqueLocalEntriesKeepTheirExistingRoutes() {
        val mustNotReadCache: (String) -> Boolean = { error("Unexpected stable-cache lookup") }
        assertNull(OfflinePlaybackRoute.cacheKey(uri, true, true, mustNotReadCache))
        val local = LocalAudioIdentity.uri("123e4567-e89b-42d3-a456-426614174000")
        assertNull(OfflinePlaybackRoute.cacheKey(local, true, false, mustNotReadCache))
        assertNull(OfflinePlaybackRoute.cacheKey(DouyinAudioIdentity.uri("7351234567890123456"), true, false, mustNotReadCache))
    }

    @Test fun logoutCannotSelectEitherCacheOnlyRoute() {
        val mustNotReadCache: (String) -> Boolean = { error("Signed-out cache access") }
        for (source in listOf(uri, uri + OfflinePlaybackRoute.SUFFIX)) {
            assertNull(OfflinePlaybackRoute.cacheKey(source, false, false, mustNotReadCache))
        }
    }

    @Test fun ordinaryEntryRejectsUnknownPartialMissingAndLaterTruncatedFiles() {
        val directory = Files.createTempDirectory("melo-offline-route-test").toFile()
        try {
            val file = directory.resolve("audio").apply { writeBytes(byteArrayOf(1, 2, 3, 4)) }
            val spans = listOf(OfflineFileSpan(0, 4, file))
            fun route(length: Long): String? = OfflinePlaybackRoute.cacheKey(uri, true, false) { key ->
                assertEquals(uri, key)
                OfflineFileCoverage.complete(length, spans)
            }
            assertEquals(uri, route(4))
            for (length in listOf(-1L, 0L, 8L)) {
                val error = assertThrows(IOException::class.java) { route(length) }
                assertTrue(error.message!!.contains("离线内容缺失或不完整"))
            }
            file.writeBytes(byteArrayOf(1, 2))
            assertThrows(IOException::class.java) { route(4) }
            assertTrue(file.delete())
            assertThrows(IOException::class.java) { route(4) }
        } finally { directory.deleteRecursively() } // Only this test-created directory.
    }

    @Test fun explicitIncompleteEntryCannotReturnToTheOnlineRoute() {
        val error = assertThrows(IOException::class.java) {
            OfflinePlaybackRoute.cacheKey(uri + OfflinePlaybackRoute.SUFFIX, true, true) { false }
        }
        assertTrue(error.message!!.contains("离线内容缺失或不完整"))
    }

    @Test fun invalidOfflineSourceIsRejectedBeforeCacheLookup() {
        val invalid = listOf(
            "https://www.bilibili.com/video/BV1eZnA6XEy8",
            uri + "&cid=1",
            uri + "#fragment",
            uri.replace("//bilibili", "//account@bilibili"),
        )
        for (source in invalid) {
            assertThrows(IOException::class.java) {
                OfflinePlaybackRoute.cacheKey(source, true, false) { error("Invalid source cache lookup") }
            }
        }
    }
}
