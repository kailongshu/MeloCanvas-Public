package expo.modules.orpheus

/** Process-local account material only. Secure persistence is owned by the app. */
object OrpheusConfig {
    private var cookie: String? = null
    private var generation = 0L
    private var offlineAccess = false
    private var guestAccess = false
    private val expiredListeners = java.util.concurrent.CopyOnWriteArrayList<(Long) -> Unit>()

    fun addExpiredListener(listener: (Long) -> Unit) { expiredListeners.add(listener) }
    fun removeExpiredListener(listener: (Long) -> Unit) { expiredListeners.remove(listener) }

    /** A late failure for account A must never clear account B. */
    fun expireIfCurrent(expectedCookie: String?, expectedGeneration: Long): Boolean {
        val expiredGeneration = synchronized(this) {
            if (expectedCookie == null || cookie == null || cookie != expectedCookie || generation != expectedGeneration) return false
            cookie = null
            offlineAccess = false
            guestAccess = false
            ++generation
        }
        expiredListeners.forEach { it(expiredGeneration) }
        return true
    }

    var bilibiliCookie: String?
        @Synchronized get() = cookie
        @Synchronized set(value) {
            val next = value?.takeIf { it.isNotBlank() }
            if (next != cookie || offlineAccess || guestAccess) {
                cookie = next
                offlineAccess = false
                guestAccess = false
                generation++
            }
        }

    /** Granted by JS only after restoring a previously verified session while offline. */
    @Synchronized fun setOfflineAccess(enabled: Boolean) {
        val next = enabled && cookie == null
        if (next != offlineAccess) {
            offlineAccess = next
            if (next) guestAccess = false
            generation++
        }
    }

    /** Granted when user enters MeloCanvas without Bilibili login (guest / Douyin mode). */
    @Synchronized fun setGuestAccess(enabled: Boolean) {
        val next = enabled && cookie == null
        if (next != guestAccess) {
            guestAccess = next
            if (next) offlineAccess = false
            generation++
        }
    }

    @Synchronized fun hasPlaybackAccess(): Boolean = cookie != null || offlineAccess || guestAccess
    @Synchronized fun requirePlaybackAccess(expectedGeneration: Long? = null) {
        check((cookie != null || offlineAccess || guestAccess) && (expectedGeneration == null || expectedGeneration == generation)) {
            "Bilibili account login required"
        }
    }
    /** Snapshot the generation only if the supplied request Cookie still owns this session. */
    @Synchronized fun captureAccountGeneration(expectedCookie: String?): Long {
        check(expectedCookie != null && cookie != null && expectedCookie == cookie) {
            "Bilibili account login required"
        }
        return generation
    }
    @Synchronized fun hasGuestAccess(): Boolean = guestAccess
    @Synchronized fun captureOnlineOrGuestGeneration(expectedCookie: String?): Long {
        if (expectedCookie == null && guestAccess && cookie == null) return generation
        return captureAccountGeneration(expectedCookie)
    }
    @Synchronized fun requireOnlineOrGuestSession(expectedGeneration: Long? = null) {
        if (guestAccess && cookie == null) {
            requirePlaybackAccess(expectedGeneration)
            return
        }
        requireAccountSession(expectedGeneration)
    }
    @Synchronized fun hasAccountSession(): Boolean = cookie != null
    @Synchronized fun accountGeneration(): Long = generation
    @Synchronized fun requireAccountSession(expectedGeneration: Long? = null) {
        check(cookie != null && (expectedGeneration == null || expectedGeneration == generation)) {
            "Bilibili account login required"
        }
    }
}
