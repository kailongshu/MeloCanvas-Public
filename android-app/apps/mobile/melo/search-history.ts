import type { SearchOrder } from './search-order'

export type SearchHistoryKind = 'all' | 'music' | 'listening' | 'creator' | 'douyin'
export interface SearchHistoryEntry {
	query: string
	kind: SearchHistoryKind
	order: SearchOrder
}
export interface SearchHistoryState {
	items: SearchHistoryEntry[]
	confirmClear: boolean
	error: string
}
export const SEARCH_HISTORY_KEY = 'searchHistory.v1'
const kinds = new Set<SearchHistoryKind>([
	'all',
	'music',
	'listening',
	'creator',
	'douyin',
])
function valid(value: unknown): value is SearchHistoryEntry {
	if (!value || typeof value !== 'object') return false
	const item = value as SearchHistoryEntry
	return (
		typeof item.query === 'string' &&
		!!item.query.trim() &&
		kinds.has(item.kind) &&
		(item.order === 'relevance' || item.order === 'published')
	)
}
function key(item: SearchHistoryEntry) {
	// BV identifiers are case-sensitive; internal whitespace is also meaningful.
	return JSON.stringify([item.query, item.kind, item.order])
}
function normalize(items: unknown[]): SearchHistoryEntry[] {
	const seen = new Set<string>()
	const result: SearchHistoryEntry[] = []
	for (const item of items) {
		if (!valid(item)) continue
		const entry = {
			query: item.query.trim(),
			kind: item.kind,
			order: item.order,
		}
		const identity = key(entry)
		if (seen.has(identity)) continue
		seen.add(identity)
		result.push(entry)
		if (result.length === 30) break
	}
	return result
}

/** Uses the app's synchronous SQLite settings adapter. No deferred writes/read hydration
 * can replay a pre-clear snapshot. Network operations never own this store. */
export class SearchHistory {
	private state: SearchHistoryState = {
		items: [],
		confirmClear: false,
		error: '',
	}
	private listeners = new Set<() => void>()
	private reloadPending = false
	constructor(
		private storage: {
			setting: (key: string) => string | null
			setSetting: (key: string, value: string) => void
		},
	) {
		this.reload()
	}
	/** Reconcile external SQLite restore/undo before the next history write. */
	reload = () => {
		try {
			const raw = this.storage.setting(SEARCH_HISTORY_KEY)
			const parsed: unknown = raw ? JSON.parse(raw) : []
			if (!Array.isArray(parsed)) throw new Error('Invalid history')
			this.reloadPending = false
			this.update({ items: normalize(parsed), confirmClear: false, error: '' })
		} catch {
			this.reloadPending = true
			this.update({
				error: '本机搜索历史暂时无法读取，搜索仍可使用。',
				confirmClear: false,
			})
		}
	}
	getSnapshot = () => this.state
	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
	private update(change: Partial<SearchHistoryState>) {
		this.state = { ...this.state, ...change }
		for (const listener of this.listeners) listener()
	}
	record = (query: string, kind: SearchHistoryKind, order: SearchOrder) => {
		if (!query.trim()) return
		if (this.reloadPending) {
			this.reload()
			if (this.reloadPending) return
		}
		const items = normalize([{ query, kind, order }, ...this.state.items])
		let error = ''
		try {
			this.storage.setSetting(SEARCH_HISTORY_KEY, JSON.stringify(items))
		} catch {
			error = '搜索历史暂未保存到本机，搜索仍可使用。'
		}
		this.update({ items, error })
	}
	requestClear = () => {
		this.update({ confirmClear: true })
	}
	cancelClear = () => {
		this.update({ confirmClear: false })
	}
	confirmClear = () => {
		if (!this.state.confirmClear) return
		try {
			this.storage.setSetting(SEARCH_HISTORY_KEY, '[]')
			this.update({ items: [], confirmClear: false, error: '' })
		} catch {
			this.update({
				confirmClear: false,
				error: '搜索历史清空失败，原记录仍保留。请重试。',
			})
		}
	}
}
