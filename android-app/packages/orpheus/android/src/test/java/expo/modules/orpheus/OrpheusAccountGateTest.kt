package expo.modules.orpheus

import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class OrpheusAccountGateTest {
    @After fun clear() { OrpheusConfig.bilibiliCookie = null }

    @Test fun absentOrBlankSessionIsClosed() {
        for (value in listOf(null, "", "   ")) {
            OrpheusConfig.bilibiliCookie = value
            assertFalse(OrpheusConfig.hasAccountSession())
            assertThrows(IllegalStateException::class.java) { OrpheusConfig.requireAccountSession() }
        }
    }

    @Test fun sessionGenerationRejectsOldAccountWork() {
        OrpheusConfig.bilibiliCookie = "fixture-account-a"
        val first = OrpheusConfig.accountGeneration()
        OrpheusConfig.requireAccountSession(first)
        OrpheusConfig.bilibiliCookie = "fixture-account-b"
        assertTrue(OrpheusConfig.hasAccountSession())
        assertThrows(IllegalStateException::class.java) { OrpheusConfig.requireAccountSession(first) }
        OrpheusConfig.requireAccountSession(OrpheusConfig.accountGeneration())
    }

    @Test fun logoutAndReloginCannotReviveOldLoadable() {
        OrpheusConfig.bilibiliCookie = "fixture-account-a"
        val first = OrpheusConfig.accountGeneration()
        OrpheusConfig.bilibiliCookie = ""
        assertThrows(IllegalStateException::class.java) { OrpheusConfig.requireAccountSession(first) }
        OrpheusConfig.bilibiliCookie = "fixture-account-a"
        assertThrows(IllegalStateException::class.java) { OrpheusConfig.requireAccountSession(first) }
    }

    @Test fun unchangedValidatedSessionDoesNotInvalidatePlayback() {
        OrpheusConfig.bilibiliCookie = "fixture-account-a"
        val first = OrpheusConfig.accountGeneration()
        OrpheusConfig.bilibiliCookie = "fixture-account-a"
        assertEquals(first, OrpheusConfig.accountGeneration())
    }

    @Test fun rejectionMessageContainsNoAccountMaterial() {
        OrpheusConfig.bilibiliCookie = "fixture-account-a"
        val first = OrpheusConfig.accountGeneration()
        OrpheusConfig.bilibiliCookie = "fixture-account-b"
        val error = assertThrows(IllegalStateException::class.java) { OrpheusConfig.requireAccountSession(first) }
        assertEquals("Bilibili account login required", error.message)
    }
    @Test fun lateExpiryCannotClearNewAccountOrEmitEvent() {
        val events = mutableListOf<Long>()
        val listener: (Long) -> Unit = { events.add(it) }
        OrpheusConfig.addExpiredListener(listener)
        try {
            OrpheusConfig.bilibiliCookie = "fixture-account-a"
            val oldGeneration = OrpheusConfig.captureAccountGeneration("fixture-account-a")
            OrpheusConfig.bilibiliCookie = "fixture-account-b"
            val newGeneration = OrpheusConfig.captureAccountGeneration("fixture-account-b")
            assertFalse(OrpheusConfig.expireIfCurrent("fixture-account-a", oldGeneration))
            assertTrue(OrpheusConfig.hasAccountSession())
            assertTrue(events.isEmpty())
            assertTrue(OrpheusConfig.expireIfCurrent("fixture-account-b", newGeneration))
            assertFalse(OrpheusConfig.hasAccountSession())
            assertEquals(listOf(OrpheusConfig.accountGeneration()), events)
            assertFalse(OrpheusConfig.expireIfCurrent("fixture-account-b", newGeneration))
            assertEquals(1, events.size)
        } finally { OrpheusConfig.removeExpiredListener(listener) }
    }

    @Test fun offlineGrantIsNotOnlineAccountPermissionAndLogoutRevokesIt() {
        OrpheusConfig.bilibiliCookie = null
        OrpheusConfig.setOfflineAccess(true)
        assertTrue(OrpheusConfig.hasPlaybackAccess())
        assertFalse(OrpheusConfig.hasAccountSession())
        OrpheusConfig.requirePlaybackAccess()
        assertThrows(IllegalStateException::class.java) { OrpheusConfig.requireAccountSession() }
        val owner = OrpheusConfig.accountGeneration()
        OrpheusConfig.bilibiliCookie = ""
        assertFalse(OrpheusConfig.hasPlaybackAccess())
        assertThrows(IllegalStateException::class.java) { OrpheusConfig.requirePlaybackAccess(owner) }
    }
    @Test fun newOnlineSessionRevokesOfflineGrant() {
        OrpheusConfig.bilibiliCookie = null
        OrpheusConfig.setOfflineAccess(true)
        val offlineOwner = OrpheusConfig.accountGeneration()
        OrpheusConfig.bilibiliCookie = "fixture-account-a"
        OrpheusConfig.requireAccountSession()
        assertThrows(IllegalStateException::class.java) { OrpheusConfig.requirePlaybackAccess(offlineOwner) }
        OrpheusConfig.bilibiliCookie = null
        assertFalse(OrpheusConfig.hasPlaybackAccess())
    }

    @Test fun oldExpiryCannotClearReloggedIdenticalCookie() {
        OrpheusConfig.bilibiliCookie = "fixture-account-a"
        val oldGeneration = OrpheusConfig.captureAccountGeneration("fixture-account-a")
        OrpheusConfig.bilibiliCookie = null
        OrpheusConfig.bilibiliCookie = "fixture-account-a"
        val newGeneration = OrpheusConfig.captureAccountGeneration("fixture-account-a")
        assertNotEquals(oldGeneration, newGeneration)
        assertFalse(OrpheusConfig.expireIfCurrent("fixture-account-a", oldGeneration))
        OrpheusConfig.requireAccountSession(newGeneration)
        assertThrows(IllegalStateException::class.java) { OrpheusConfig.captureAccountGeneration("fixture-account-b") }
        OrpheusConfig.bilibiliCookie = null
        OrpheusConfig.setGuestAccess(true)
        assertTrue(OrpheusConfig.hasPlaybackAccess())
        assertFalse(OrpheusConfig.hasAccountSession())
        OrpheusConfig.requirePlaybackAccess()
        assertThrows(IllegalStateException::class.java) { OrpheusConfig.requireAccountSession() }
        val guestGen = OrpheusConfig.captureOnlineOrGuestGeneration(null)
        assertTrue(OrpheusConfig.hasGuestAccess())
        OrpheusConfig.requireOnlineOrGuestSession(guestGen)
        OrpheusConfig.bilibiliCookie = "fixture-account-a"
        assertThrows(IllegalStateException::class.java) { OrpheusConfig.requirePlaybackAccess(guestGen) }
    }

}
