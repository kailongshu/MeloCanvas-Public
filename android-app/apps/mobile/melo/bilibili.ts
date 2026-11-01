import he from 'he'
import md5 from 'md5'

import { BilibiliApiError, BilibiliRequestRestrictedError } from './bilibili-request-error'
import {
	parseSearchInput,
	sourceId,
	type SearchItem,
	type Source,
} from './core/model'
import type { SearchOrder } from './search-order'

const headers = {
	'User-Agent':
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
	Referer: 'https://www.bilibili.com/',
}
const mixin = [
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
	33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
	26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
	20, 34, 44, 52,
]
let keys: { key: string; expires: number } | null = null
let guestCookie = ''
interface AccountTransport {
	fetch(this: void, input: string, init: RequestInit): Promise<Response>
	generation(): number
	expired(): Promise<void>
}
let accountTransport: AccountTransport | null = null
/** Bound once by the production account root; tests may exercise the standalone reader. */
export function configureBilibiliAccountTransport(transport: AccountTransport) {
	accountTransport = transport
	keys = null
	guestCookie = ''
}

const extract = (url: unknown): string | null => {
	if (typeof url !== 'string') return null
	let path: string
	try {
		const parsed = new URL(url)
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
		path = parsed.pathname
	} catch {
		return null
	}
	const filename = path.slice(path.lastIndexOf('/') + 1)
	const extension = filename.lastIndexOf('.')
	if (extension <= 0 || extension === filename.length - 1) return null
	const key = filename.slice(0, extension)
	return /^[0-9a-f]{32}$/i.test(key) ? key : null
}

const hasVoucher = (value: unknown) =>
	!!value &&
	typeof value === 'object' &&
	'v_voucher' in value &&
	typeof value.v_voucher === 'string' &&
	!!value.v_voucher

export interface BilibiliRequest<T> {
	result: Promise<T>
	/** Fulfills after the started fetch/json settles, including failure; not socket drain. */
	settled: Promise<void>
}

export function beginBilibiliRequest<T>(
	endpoint: string,
	signal?: AbortSignal,
	nav = false,
): BilibiliRequest<T> {
	if (signal?.aborted)
		return {
			result: Promise.reject(new Error('请求已取消')),
			settled: Promise.resolve(),
		}
	const controller = new AbortController()
	const abort = () => controller.abort()
	let rejectAbort!: () => void
	const aborted = new Promise<never>((_, reject) => {
		rejectAbort = () => reject(new Error('请求已取消'))
	})
	controller.signal.addEventListener('abort', rejectAbort, { once: true })
	signal?.addEventListener('abort', abort)
	const timeout = setTimeout(abort, 15000)
	const accountGeneration = accountTransport?.generation()
	const raw = (async () => {
		const response = await (accountTransport?.fetch ?? fetch)(
			`https://api.bilibili.com${endpoint}`,
			{
				headers: {
					...headers,
					...(guestCookie ? { Cookie: guestCookie } : {}),
				},
				signal: controller.signal,
				credentials: 'omit',
			},
		)
		if (controller.signal.aborted) throw new Error('请求已取消')
		if (response.status === 429 || response.status === 412)
			throw new BilibiliRequestRestrictedError()
		if (!response.ok)
			throw new Error(`网络请求失败（HTTP ${response.status}），请稍后重试`)
		const body: unknown = await response.json()
		if (controller.signal.aborted || signal?.aborted)
			throw new Error('请求已取消')
		if (accountTransport && accountGeneration !== accountTransport.generation())
			throw new Error('账号已变更，请重试')
		if (
			body &&
			typeof body === 'object' &&
			'code' in body &&
			body.code === -101 &&
			!nav &&
			accountTransport
		) {
			await accountTransport.expired()
			throw new Error('登录已失效，请重新扫码')
		}
		const data =
			body && typeof body === 'object' && 'data' in body ? body.data : undefined

		if (
			(body &&
				typeof body === 'object' &&
				'code' in body &&
				typeof body.code === 'number' &&
				[-412, -352, -799].includes(body.code)) ||
			hasVoucher(body) ||
			hasVoucher(data)
		)
			throw new BilibiliRequestRestrictedError()
		if (
			!body ||
			typeof body !== 'object' ||
			Array.isArray(body) ||
			!('code' in body) ||
			typeof body.code !== 'number' ||
			!Number.isInteger(body.code)
		)
			throw new Error('B 站响应异常，请稍后重试')

		if (body.code !== 0 && !nav)
			throw new BilibiliApiError(
				body.code,
				accountTransport
					? `B 站返回 ${body.code}，内容暂不可用`
					: `B 站返回 ${body.code}：${('message' in body && typeof body.message === 'string' && body.message) || '内容暂不可用'}`,
			)
		return ('data' in body ? body.data : undefined) as T
	})()
	const result = (async () => {
		try {
			return await Promise.race([raw, aborted])
		} catch (error) {
			if (controller.signal.aborted && !signal?.aborted)
				throw new Error('请求超时，请检查网络后重试', { cause: error })
			if (signal?.aborted) throw new Error('请求已取消', { cause: error })
			if (error instanceof SyntaxError)
				throw new Error('B 站响应无法读取，请稍后重试', { cause: error })
			if (error instanceof TypeError)
				throw new Error('网络连接失败，请检查网络后重试', { cause: error })
			throw error instanceof Error
				? error
				: new Error('网络连接失败，请重试', { cause: error })
		} finally {
			clearTimeout(timeout)
			signal?.removeEventListener('abort', abort)
			controller.signal.removeEventListener('abort', rejectAbort)
		}
	})()
	return {
		result,
		settled: raw.then(
			() => {},
			() => {},
		),
	}
}

export async function request<T>(
	endpoint: string,
	signal?: AbortSignal,
	nav = false,
): Promise<T> {
	return beginBilibiliRequest<T>(endpoint, signal, nav).result
}

export async function signed(
	params: Record<string, string>,
	signal?: AbortSignal,
): Promise<string> {
	if (!keys || keys.expires < Date.now()) {
		const nav = await request<{
			wbi_img: { img_url: string; sub_url: string }
		}>('/x/web-interface/nav', signal, true)
		const imageKey = extract(nav?.wbi_img?.img_url)
		const subKey = extract(nav?.wbi_img?.sub_url)
		if (!imageKey || !subKey) throw new Error('B 站签名信息暂不可用，请重试')
		// Validate both materials before warming the shared one-hour cache.
		const original = imageKey + subKey
		keys = {
			key: mixin
				.map((index) => original[index])
				.join('')
				.slice(0, 32),
			expires: Date.now() + 3600000,
		}
	}
	const values = { ...params, wts: Math.floor(Date.now() / 1000).toString() }
	const query = Object.keys(values)
		.sort()
		.map(
			(key) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(values[key as keyof typeof values].replace(/[!'()*]/g, ''))}`,
		)
		.join('&')
	return `${query}&w_rid=${md5(query + keys.key)}`
}

const clean = (value: string) => he.decode(value.replace(/<[^>]*>/g, ''))
const artwork = (value: string) =>
	value.startsWith('//') ? `https:${value}` : value.replace(/^http:/, 'https:')
function seconds(value: string | number): number {
	if (typeof value === 'number') return value
	return value.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}
interface Video {
	bvid: string
	cid: number
	title: string
	pic: string
	duration: number
	owner: { name: string; mid: number }
	pages: { cid: number; duration: number }[]
}

export async function sourceDetails(
	bvid: string,
	signal?: AbortSignal,
): Promise<Source> {
	const video = await request<Video>(
		`/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
		signal,
	)
	if (
		!video ||
		typeof video !== 'object' ||
		Array.isArray(video) ||
		video.bvid !== bvid
	)
		throw new Error('返回的视频身份不匹配，请重试')
	const cid = video.pages?.[0]?.cid ?? video.cid
	if (!cid || !video.bvid)
		throw new Error('这条内容没有可用的分 P 信息，请更换音源')
	return {
		id: sourceId(video.bvid, cid),
		bvid: video.bvid,
		cid,
		originalTitle: clean(video.title),
		uploader: video.owner.name,
		uploaderId: video.owner.mid,
		performer: null,
		artwork: artwork(video.pic),
		duration: video.pages?.[0]?.duration ?? video.duration,
		domain: 'unclassified',
		audioAvailability: 'unknown',
	}
}

export async function ensureGuest(signal?: AbortSignal): Promise<void> {
	// This cookie is an anonymous device token obtained in this app, never an account.
	if (!guestCookie) {
		const device = await request<{ b_3: string; b_4: string }>(
			'/x/frontend/finger/spi',
			signal,
		)
		if (!device?.b_3) throw new Error('B 站游客信息暂不可用，请重试')
		guestCookie = `buvid3=${device.b_3}; buvid4=${device.b_4 || ''}`
	}
}

export async function search(
	input: string,
	page = 1,
	signal?: AbortSignal,
	order: SearchOrder = 'relevance',
	rereadIncomplete = true,
): Promise<{ items: SearchItem[]; more: boolean; ketangCount?: number }> {
	const query = parseSearchInput(input)
	if (query.type === 'bv') {
		const source = await sourceDetails(query.bvid, signal)
		return { items: [{ ...source, category: 'BV 精确查找' }], more: false }
	}
	await ensureGuest(signal)
	for (let attempt = 0; attempt < 2; attempt++) {
		const params = await signed(
			{
				keyword: query.keyword,
				search_type: 'video',
				page: String(page),
				page_size: '20',
				...(order === 'published' ? { order: 'pubdate' } : {}),
			},
			signal,
		)
		const data = await request<unknown>(
			`/x/web-interface/wbi/search/type?${params}`,
			signal,
		)
		try {
			return searchPage(data, page)
		} catch (error) {
			// Re-read only an incomplete/inconsistent search payload, never a real
			// empty result, network failure or platform rejection.
			if (
				!rereadIncomplete ||
				attempt === 1 ||
				!(error instanceof SearchResponseError)
			)
				throw error
		}
	}
	throw new SearchResponseError()
}

class SearchResponseError extends Error {
	constructor() {
		super('B 站搜索响应异常，暂时无法确认结果，请稍后重试')
	}
}

function searchPage(data: unknown, page: number) {
	// A successful envelope can contain a risk-control replacement payload.
	// Keep it outside SearchResponseError so it is never automatically re-read.
	if (hasVoucher(data)) throw new BilibiliRequestRestrictedError()
	if (
		!data ||
		typeof data !== 'object' ||
		!('result' in data) ||
		!Array.isArray(data.result) ||
		!('numPages' in data) ||
		typeof data.numPages !== 'number' ||
		!Number.isInteger(data.numPages) ||
		data.numPages < 0
	)
		throw new SearchResponseError()
	// When supplied, page is response ownership, not merely display metadata.
	// A different page (including an empty one) cannot answer this request.
	if (
		'page' in data &&
		(typeof data.page !== 'number' ||
			!Number.isSafeInteger(data.page) ||
			data.page <= 0 ||
			data.page !== page)
	)
		throw new SearchResponseError()
	if (data.result.length === 0 && page <= data.numPages)
		throw new SearchResponseError()
	if (data.result.length > 0 && data.numPages === 0)
		throw new SearchResponseError()
	if (
		'numResults' in data &&
		(typeof data.numResults !== 'number' ||
			!Number.isInteger(data.numResults) ||
			data.numResults < 0 ||
			(data.numResults > 0 && data.numPages === 0) ||
			(data.numResults === 0 && data.result.length > 0))
	)
		throw new SearchResponseError()
	const items: SearchItem[] = []
	let ketangCount = 0
	for (const item of data.result as unknown[]) {
		if (!item || typeof item !== 'object') throw new SearchResponseError()
		if ('type' in item && item.type === 'ketang') {
			ketangCount++
			continue
		}
		if (
			!('bvid' in item) ||
			typeof item.bvid !== 'string' ||
			!item.bvid ||
			!('title' in item) ||
			typeof item.title !== 'string' ||
			!('author' in item) ||
			typeof item.author !== 'string' ||
			!('mid' in item) ||
			typeof item.mid !== 'number' ||
			!('pic' in item) ||
			typeof item.pic !== 'string' ||
			!('duration' in item) ||
			(typeof item.duration !== 'string' && typeof item.duration !== 'number')
		)
			throw new SearchResponseError()
		const duration = seconds(item.duration)
		if (!Number.isFinite(duration) || duration < 0)
			throw new SearchResponseError()
		items.push({
			bvid: item.bvid,
			originalTitle: clean(item.title),
			uploader: item.author,
			uploaderId: item.mid,
			artwork: artwork(item.pic),
			duration,
			category:
				'typename' in item && typeof item.typename === 'string' && item.typename
					? item.typename
					: 'B 站视频',
		})
	}
	return {
		items,
		more: page < data.numPages,
		...(ketangCount ? { ketangCount } : {}),
	}
}
