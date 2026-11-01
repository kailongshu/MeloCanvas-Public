import { Orpheus } from '@bbplayer/orpheus'
import * as SecureStore from 'expo-secure-store'

import { configureAccountNetwork, verifyAccount } from './account-api'
import { fetchNativeBilibili } from './account-native-fetch'
import { AccountSession } from './account-session'
import { configureBilibiliAccountTransport } from './bilibili'

// Not part of SQLite, MMKV, diagnostic state or MeloCanvas backup exports.
const key = 'melocanvas.bilibili.account.v1'
const options = {
	keychainService: 'melocanvas.bilibili.account',
	keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}
configureAccountNetwork(fetchNativeBilibili)
export const accountSession = new AccountSession({
	read: () => SecureStore.getItemAsync(key, options),
	write: (cookie) => SecureStore.setItemAsync(key, cookie, options),
	remove: () => SecureStore.deleteItemAsync(key, options),
	verify: verifyAccount,
	setNativeCookie: (cookie) => Orpheus.setBilibiliCookie(cookie),
	setOfflineAccess: (enabled) => Orpheus.setBilibiliOfflineAccess(enabled),
	setGuestAccess: (enabled) => Orpheus.setGuestPlaybackAccess(enabled),
	pause: () => Orpheus.pauseForAccountGate(),
	fetch: fetchNativeBilibili,
})
configureBilibiliAccountTransport({
	fetch: (input, init) =>
		accountSession.getSnapshot().status === 'guest'
			? fetchNativeBilibili(input, init)
			: accountSession.authorizedFetch(input, init),
	generation: accountSession.getGeneration,
	expired: () =>
		accountSession.getSnapshot().status === 'guest'
			? Promise.resolve()
			: accountSession.signOut('expired'),
})

export function watchNativeSessionExpiry(): () => void {
	const subscription = Orpheus.addListener(
		'onBilibiliSessionExpired',
		(event) => {
			// The queued expiry of an old account may arrive after a new sign-in.
			if (Orpheus.getBilibiliSessionGeneration() === event.generation)
				void accountSession.signOut('expired').catch(() => {})
		},
	)
	return () => subscription.remove()
}
