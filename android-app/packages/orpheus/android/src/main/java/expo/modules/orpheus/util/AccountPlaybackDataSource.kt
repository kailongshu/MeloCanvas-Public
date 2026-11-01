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
            private var isDirectHttp = false
            override fun open(spec: DataSpec): Long {
                val scheme = spec.uri.scheme
                if (scheme == "http" || scheme == "https") {
                    isDirectHttp = true
                    return source.open(spec)
                }
                isDirectHttp = false
                checkSession()
                if (!OrpheusConfig.hasAccountSession() &&
                    LocalAudioIdentity.idFromUri(spec.uri.toString()) == null &&
                    !OfflinePlaybackDataSource.check(context, spec.uri.toString()))
                    throw IOException("Online account verification required")
                val length = source.open(spec)
                checkSession()
                return length
            }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (!isDirectHttp) checkSession()
                val count = source.read(buffer, offset, length)
                checkSession()
                return count
            }
            override fun close() = source.close()
        }
    }
}
