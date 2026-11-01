package expo.modules.orpheus.util

import android.content.Context
import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import expo.modules.orpheus.OrpheusConfig
import java.io.IOException

/** Wrap outside local and both cache routes: a cache hit is not an account grant. */
@UnstableApi
object AccountPlaybackDataSource {
    fun factory(context: Context, inner: DataSource.Factory): DataSource.Factory = DataSource.Factory {
        object : DataSource {
            private val generation = OrpheusConfig.accountGeneration()
            private val source = inner.createDataSource()
            private fun checkSession() {
                try { OrpheusConfig.requirePlaybackAccess(generation) }
                catch (_: IllegalStateException) { throw IOException("Bilibili account login required") }
            }
            override fun addTransferListener(listener: TransferListener) = source.addTransferListener(listener)
            override fun getUri(): Uri? = source.uri
            override fun getResponseHeaders(): Map<String, List<String>> = source.responseHeaders
            private var bypassGate = false
            override fun open(spec: DataSpec): Long {
                val uriStr = spec.uri.toString()
                val scheme = spec.uri.scheme
                if (scheme == "http" || scheme == "https") {
                    bypassGate = true
                    return source.open(spec)
                }
                bypassGate = false
                checkSession()
                if (!OrpheusConfig.hasAccountSession() && !OrpheusConfig.hasGuestAccess() &&
                    LocalAudioIdentity.idFromUri(uriStr) == null &&
                    DouyinAudioIdentity.idFromUri(uriStr) == null &&
                    !OfflinePlaybackDataSource.check(context, uriStr))
                    throw IOException("Online account verification required")
                val length = source.open(spec)
                checkSession()
                return length
            }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (!bypassGate) checkSession()
                val count = source.read(buffer, offset, length)
                if (!bypassGate) checkSession()
                return count
            }
            override fun close() = source.close()
        }
    }
}
