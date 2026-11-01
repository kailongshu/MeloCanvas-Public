import { Orpheus } from '@bbplayer/orpheus'
import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'

import {
	douyinAudioId,
	douyinAwemePattern,
	sanitizeDouyinArtwork,
	type DouyinAudio,
} from './core/douyin-audio'

const DOUYIN_COOKIE_KEY = 'melocanvas.douyin.account.v1'
const DOUYIN_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
	keychainService: 'melocanvas.douyin.account',
	keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

export type DouyinSessionStatus = 'checking' | 'signed-out' | 'authenticated'

export interface DouyinSessionState {
	status: DouyinSessionStatus
	nickname: string
	secUid: string
	busy: boolean
	error: string
}

export function isDouyinShareInput(text: string): boolean {
	const trimmed = text.trim()
	if (!trimmed) return false
	return (
		/(?:v\.douyin\.com|douyin\.com\/(?:video|note|share)|douyin\.com\/\?[^#\s]*modal_id=|iesdouyin\.com|复制打开抖音|打开抖音)/i.test(
			trimmed,
		) || /^douyin:[1-9][0-9]{5,24}$/i.test(trimmed)
	)
}

function cleanCookie(raw: string): string {
	return raw.replace(/[\r\n]+/g, '').trim()
}

function safeParseDouyinJson(raw: string): Record<string, unknown> {
	const trimmed = raw.trim()
	if (!trimmed.startsWith('{')) {
		throw new Error('抖音接口返回格式异常，请稍后重试或重新登录抖音')
	}
	const quotedLongIds = trimmed.replace(
		/("(?:aweme_id|max_cursor|min_cursor|cursor)"\s*:\s*)(-?\d{15,})/g,
		'$1"$2"',
	)
	const parsed: unknown = JSON.parse(quotedLongIds)
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('抖音接口数据为空')
	}
	return parsed as Record<string, unknown>
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function firstHttpsFromUrlList(holder: unknown): string {
	const obj = asObject(holder)
	const list = obj?.url_list
	if (!Array.isArray(list)) return ''
	for (const entry of list) {
		if (typeof entry !== 'string') continue
		const trimmed = entry.trim()
		if (!trimmed) continue
		const normalized = trimmed.startsWith('http://')
			? `https://${trimmed.slice(7)}`
			: trimmed.startsWith('//')
				? `https:${trimmed}`
				: trimmed
		if (normalized.startsWith('https://')) return normalized
	}
	return ''
}

export function normalizeAwemeToAudio(
	raw: unknown,
	addedAt = Date.now(),
): DouyinAudio | null {
	const unwrapped = asObject(raw)
	if (!unwrapped) return null
	const aweme = asObject(unwrapped.aweme_info) ?? unwrapped
	const awemeId = String(aweme.aweme_id ?? aweme.awemeId ?? '').trim()
	if (!douyinAwemePattern.test(awemeId)) return null

	const music = asObject(aweme.music)
	const video = asObject(aweme.video)
	const author = asObject(aweme.author)

	const musicUrl = firstHttpsFromUrlList(music?.play_url)
	const videoUrl = firstHttpsFromUrlList(video?.play_addr).replace(
		'/playwm/',
		'/play/',
	)
	const playAddr = asObject(video?.play_addr)
	const videoUri =
		typeof playAddr?.uri === 'string' ? playAddr.uri.trim() : ''
	const fallbackUri =
		videoUri && !videoUri.startsWith('http')
			? `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(videoUri)}&ratio=720p&line=0`
			: ''
	const directAudioUrl =
		typeof aweme.audioUrl === 'string' && aweme.audioUrl.startsWith('https://')
			? aweme.audioUrl.trim()
			: ''

	const audioUrl = directAudioUrl || musicUrl || videoUrl || fallbackUri

	const rawArtwork =
		(typeof aweme.artwork === 'string' ? aweme.artwork : '') ||
		firstHttpsFromUrlList(music?.cover_large) ||
		firstHttpsFromUrlList(music?.cover_medium) ||
		firstHttpsFromUrlList(video?.cover) ||
		firstHttpsFromUrlList(author?.avatar_thumb)
	const artwork = sanitizeDouyinArtwork(rawArtwork)

	const desc =
		typeof aweme.desc === 'string'
			? aweme.desc.replace(/\s+/g, ' ').trim()
			: ''
	const musicTitle =
		typeof music?.title === 'string' ? music.title.trim() : ''
	const directTitle =
		typeof aweme.title === 'string' ? aweme.title.trim() : ''
	const title =
		directTitle ||
		(musicTitle &&
		!musicTitle.endsWith('创作的原声') &&
		!musicTitle.startsWith('@')
			? musicTitle
			: desc
				? desc.slice(0, 80)
				: musicTitle || `抖音原声 ${awemeId}`)

	const musicAuthor =
		typeof music?.author === 'string' ? music.author.trim() : ''
	const authorName =
		typeof author?.nickname === 'string' ? author.nickname.trim() : ''
	const directArtist =
		typeof aweme.artist === 'string' ? aweme.artist.trim() : ''
	const artist = directArtist || musicAuthor || authorName || '抖音创作者'

	const directDuration = Number(aweme.duration ?? aweme.durationSeconds ?? 0)
	const musicDuration = Number(music?.duration ?? 0)
	const videoDuration = Number(video?.duration ?? 0)
	let durationSeconds = 0
	if (Number.isFinite(directDuration) && directDuration > 0) {
		durationSeconds =
			directDuration > 36000 ? directDuration / 1000 : directDuration
	} else if (Number.isFinite(musicDuration) && musicDuration > 0) {
		durationSeconds =
			musicDuration > 36000 ? musicDuration / 1000 : musicDuration
	} else if (Number.isFinite(videoDuration) && videoDuration > 0) {
		durationSeconds =
			videoDuration > 1000 ? videoDuration / 1000 : videoDuration
	}

	return {
		id: douyinAudioId(awemeId),
		awemeId,
		title,
		artist,
		artwork,
		durationSeconds: Math.max(0, durationSeconds),
		audioUrl,
		addedAt,
	}
}

function registerAudioStreams(items: DouyinAudio[]): void {
	const streams = items
		.filter((item) => item.audioUrl.startsWith('https://'))
		.map((item) => ({ awemeId: item.awemeId, audioUrl: item.audioUrl }))
	if (!streams.length) return
	try {
		Orpheus.douyinRegisterStreams(JSON.stringify(streams))
	} catch {
		/* Best-effort native stream cache warmup; DataSource also re-resolves on demand. */
	}
}

export class DouyinSession {
	private state: DouyinSessionState = {
		status: 'checking',
		nickname: '',
		secUid: '',
		busy: false,
		error: '',
	}
	private listeners = new Set<() => void>()
	private restored = false

	getSnapshot = () => this.state

	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	private update(patch: Partial<DouyinSessionState>) {
		this.state = { ...this.state, ...patch }
		for (const listener of this.listeners) listener()
	}

	async restore(): Promise<void> {
		if (this.restored) return
		this.restored = true
		try {
			const saved = cleanCookie(
				(await SecureStore.getItemAsync(
					DOUYIN_COOKIE_KEY,
					DOUYIN_STORE_OPTIONS,
				)) ?? '',
			)
			if (!saved) {
				this.update({
					status: 'signed-out',
					nickname: '',
					secUid: '',
					busy: false,
					error: '',
				})
				return
			}
			Orpheus.setDouyinCookie(saved)
			this.update({
				status: 'authenticated',
				busy: false,
				error: '',
			})
			void this.refreshProfile()
		} catch {
			this.update({
				status: 'signed-out',
				nickname: '',
				secUid: '',
				busy: false,
				error: '',
			})
		}
	}

	async loginWithWebView(): Promise<boolean> {
		this.update({ busy: true, error: '' })
		try {
			const captured = cleanCookie(await Orpheus.openDouyinLogin())
			if (!captured) {
				this.update({
					busy: false,
					status:
						this.state.status === 'authenticated'
							? 'authenticated'
							: 'signed-out',
				})
				return false
			}
			await SecureStore.setItemAsync(
				DOUYIN_COOKIE_KEY,
				captured,
				DOUYIN_STORE_OPTIONS,
			)
			Orpheus.setDouyinCookie(captured)
			this.update({
				status: 'authenticated',
				busy: false,
				error: '',
			})
			void this.refreshProfile()
			return true
		} catch (error) {
			this.update({
				busy: false,
				error:
					error instanceof Error && error.message
						? error.message
						: '打开抖音登录窗口失败',
			})
			return false
		}
	}

	async loginWithManualCookie(rawCookie: string): Promise<boolean> {
		const cleaned = cleanCookie(rawCookie)
		if (!cleaned || !cleaned.includes('=')) {
			this.update({ error: '请输入有效的抖音 Cookie（需包含 sessionid 等字段）' })
			return false
		}
		this.update({ busy: true, error: '' })
		try {
			await SecureStore.setItemAsync(
				DOUYIN_COOKIE_KEY,
				cleaned,
				DOUYIN_STORE_OPTIONS,
			)
			Orpheus.setDouyinCookie(cleaned)
			this.update({
				status: 'authenticated',
				busy: false,
				error: '',
			})
			void this.refreshProfile()
			return true
		} catch (error) {
			this.update({
				busy: false,
				error:
					error instanceof Error && error.message
						? error.message
						: '保存抖音 Cookie 失败',
			})
			return false
		}
	}

	async signOut(): Promise<void> {
		try {
			await SecureStore.deleteItemAsync(
				DOUYIN_COOKIE_KEY,
				DOUYIN_STORE_OPTIONS,
			)
		} catch {
			/* Ignore SecureStore deletion errors on sign-out. */
		}
		try {
			Orpheus.clearDouyinCookie()
		} catch {
			/* Ignore native cookie cleanup errors. */
		}
		this.update({
			status: 'signed-out',
			nickname: '',
			secUid: '',
			busy: false,
			error: '',
		})
	}

	async refreshProfile(): Promise<void> {
		try {
			const raw = await Orpheus.douyinApiRequest(
				'/aweme/v1/web/query/user/?aid=6383',
			)
			if (!raw.trim().startsWith('{')) return
			const data = safeParseDouyinJson(raw)
			const user = asObject(data.user) ?? asObject(data.user_info) ?? data
			const secUid =
				typeof user.sec_uid === 'string'
					? user.sec_uid.trim()
					: typeof data.user_uid === 'string'
						? data.user_uid.trim()
						: ''
			const nickname =
				typeof user.nickname === 'string' ? user.nickname.trim() : ''
			if (secUid || nickname) {
				this.update({
					secUid: secUid || this.state.secUid,
					nickname: nickname || this.state.nickname,
				})
			}
		} catch {
			/* Profile nickname is optional display metadata; never invalidate login on failure. */
		}
	}

	async resolveShare(textOrUrl: string): Promise<DouyinAudio> {
		const raw = await Orpheus.douyinResolveShare(textOrUrl)
		const parsed = safeParseDouyinJson(raw)
		const audio = normalizeAwemeToAudio(parsed)
		if (!audio) throw new Error('未能解析该抖音分享链接中的原声')
		registerAudioStreams([audio])
		return audio
	}

	async search(
		keyword: string,
		offset = 0,
		count = 18,
	): Promise<{ items: DouyinAudio[]; hasMore: boolean; nextOffset: number }> {
		const trimmed = keyword.trim()
		if (!trimmed) return { items: [], hasMore: false, nextOffset: 0 }
		if (isDouyinShareInput(trimmed)) {
			const resolved = await this.resolveShare(trimmed)
			return { items: [resolved], hasMore: false, nextOffset: 1 }
		}

		const endpoint = `/aweme/v1/web/search/item/?keyword=${encodeURIComponent(trimmed)}&count=${count}&offset=${offset}&search_source=normal_search&query_correct_type=1&is_filter_search=0&aid=6383`
		const raw = await Orpheus.douyinApiRequest(endpoint)
		const res = safeParseDouyinJson(raw)
		const statusCode = Number(res.status_code ?? 0)
		if (statusCode !== 0 && !Array.isArray(res.data) && !Array.isArray(res.aweme_list)) {
			const msg =
				typeof res.status_msg === 'string' && res.status_msg
					? res.status_msg
					: '抖音搜索需要完成账号登录验证，请先登录抖音或直接粘贴分享链接'
			throw new Error(msg)
		}

		const candidates: unknown[] = Array.isArray(res.data)
			? res.data
			: Array.isArray(res.aweme_list)
				? res.aweme_list
				: []
		const seen = new Set<string>()
		const items: DouyinAudio[] = []
		const now = Date.now()
		for (const entry of candidates) {
			const audio = normalizeAwemeToAudio(entry, now)
			if (!audio || seen.has(audio.id)) continue
			seen.add(audio.id)
			items.push(audio)
		}
		registerAudioStreams(items)
		const hasMore = Boolean(res.has_more === 1 || res.has_more === true)
		const nextCursor = Number(res.cursor ?? offset + count)
		return {
			items,
			hasMore: hasMore && items.length > 0,
			nextOffset: Number.isFinite(nextCursor) && nextCursor > offset ? nextCursor : offset + count,
		}
	}

	async fetchFavorites(
		maxCursor = '0',
		count = 20,
	): Promise<{ items: DouyinAudio[]; nextCursor: string; hasMore: boolean }> {
		if (!this.state.secUid) {
			await this.refreshProfile()
		}
		const secQuery = this.state.secUid
			? `&sec_user_id=${encodeURIComponent(this.state.secUid)}`
			: ''
		const endpoint = `/aweme/v1/web/aweme/favorite/?aid=6383&count=${count}&max_cursor=${encodeURIComponent(maxCursor)}${secQuery}`
		const raw = await Orpheus.douyinApiRequest(endpoint)
		const res = safeParseDouyinJson(raw)
		if (Number(res.status_code ?? 0) !== 0 && !Array.isArray(res.aweme_list)) {
			const msg =
				typeof res.status_msg === 'string' && res.status_msg
					? res.status_msg
					: '暂时无法读取抖音「我的喜欢」，请确认已登录抖音账号'
			throw new Error(msg)
		}
		const list = Array.isArray(res.aweme_list) ? res.aweme_list : []
		const now = Date.now()
		const items: DouyinAudio[] = []
		const seen = new Set<string>()
		for (const entry of list) {
			const audio = normalizeAwemeToAudio(entry, now)
			if (!audio || seen.has(audio.id)) continue
			seen.add(audio.id)
			items.push(audio)
		}
		registerAudioStreams(items)
		const nextCursor = String(res.max_cursor ?? '0')
		const hasMore =
			Boolean(res.has_more === 1 || res.has_more === true) &&
			nextCursor !== '0' &&
			items.length > 0
		return { items, nextCursor, hasMore }
	}

	async fetchCollections(
		cursor = '0',
		count = 20,
	): Promise<{ items: DouyinAudio[]; nextCursor: string; hasMore: boolean }> {
		const postSpec = `POST:/aweme/v1/web/aweme/listcollection/?aid=6383|count=${count}&cursor=${encodeURIComponent(cursor)}`
		let raw = ''
		try {
			raw = await Orpheus.douyinApiRequest(postSpec)
		} catch {
			raw = ''
		}
		if (!raw.trim().startsWith('{')) {
			raw = await Orpheus.douyinApiRequest(
				`/aweme/v1/web/aweme/listcollection/?aid=6383&count=${count}&cursor=${encodeURIComponent(cursor)}`,
			)
		}
		const res = safeParseDouyinJson(raw)
		if (
			Number(res.status_code ?? 0) !== 0 &&
			!Array.isArray(res.aweme_list) &&
			!Array.isArray(res.items)
		) {
			const msg =
				typeof res.status_msg === 'string' && res.status_msg
					? res.status_msg
					: '暂时无法读取抖音「我的收藏」，请确认已登录抖音账号'
			throw new Error(msg)
		}
		const list = Array.isArray(res.aweme_list)
			? res.aweme_list
			: Array.isArray(res.items)
				? res.items
				: []
		const now = Date.now()
		const items: DouyinAudio[] = []
		const seen = new Set<string>()
		for (const entry of list) {
			const obj = asObject(entry)
			const candidate = obj?.aweme ?? obj?.aweme_info ?? entry
			const audio = normalizeAwemeToAudio(candidate, now)
			if (!audio || seen.has(audio.id)) continue
			seen.add(audio.id)
			items.push(audio)
		}
		registerAudioStreams(items)
		const nextCursor = String(res.cursor ?? res.max_cursor ?? '0')
		const hasMore =
			Boolean(res.has_more === 1 || res.has_more === true) &&
			nextCursor !== '0' &&
			items.length > 0
		return { items, nextCursor, hasMore }
	}
}

export const douyinSession = new DouyinSession()

export function useDouyinSession(): DouyinSessionState {
	return useSyncExternalStore(
		douyinSession.subscribe,
		douyinSession.getSnapshot,
		douyinSession.getSnapshot,
	)
}
