import { useSyncExternalStore } from 'react'
import { accountSession } from './account-runtime'
/** Public eligibility only; credentials never cross into lyrics/UI adapters. */
export function getAccountAccess(): { onlineAllowed: boolean; sessionGeneration: number } {
	const state = accountSession.getSnapshot()
	return {
		onlineAllowed: state.status === 'authenticated' || state.status === 'guest',
		sessionGeneration: state.generation,
	}
}
export function useAccountAccess(): { onlineAllowed: boolean; sessionGeneration: number } {
	const state = useSyncExternalStore(accountSession.subscribe, accountSession.getSnapshot)
	return {
		onlineAllowed: state.status === 'authenticated' || state.status === 'guest',
		sessionGeneration: state.generation,
	}
}
