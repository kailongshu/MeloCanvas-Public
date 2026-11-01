import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { DouyinApiError } from '@/lib/errors/thirdparty/douyin'
import type {
	DouyinAwemeItem,
	DouyinCollectionResponse,
	DouyinFavoriteResponse,
	DouyinSearchResponse,
	DouyinUserDetailResponse,
} from '@/types/apis/douyin'
import type { DouyinTrack } from '@/types/core/media'

import { douyinClient } from './client'

export class DouyinApi {
	/**
	 * 搜索抖音视频与音乐
	 */
	search({
		keyword,
		count = 20,
		offset = 0,
	}: {
		keyword: string
		count?: number
		offset?: number
	}): ResultAsync<DouyinAwemeItem[], DouyinApiError> {
		const endpoint = `/aweme/v1/web/search/item/?keyword=${encodeURIComponent(keyword)}&count=${count}&offset=${offset}&search_source=switch_tab&aid=6383`
		return douyinClient
			.request<DouyinSearchResponse>({ endpoint })
			.map((res) => {
				const list: DouyinAwemeItem[] = []
				if (Array.isArray(res.data)) {
					for (const item of res.data) {
						if (item.aweme_info) {
							list.push(item.aweme_info)
						}
					}
				}
				return list
			})
	}

	/**
	 * 获取指定视频/原声详情
	 */
	getAwemeDetail(awemeId: string): ResultAsync<DouyinAwemeItem, DouyinApiError> {
		const endpoint = `/aweme/v1/web/aweme/detail/?aweme_id=${awemeId}&aid=6383`
		return douyinClient
			.request<{ aweme_detail?: DouyinAwemeItem }>({ endpoint })
			.andThen((res) => {
				if (!res.aweme_detail) {
					return errAsync(
						new DouyinApiError({
							message: '未获取到作品详情',
							type: 'ResponseFailed',
						}),
					)
				}
				return okAsync(res.aweme_detail)
			})
	}

	/**
	 * 获取用户的“喜欢”列表（支持指定 secUserId 或当前登录用户）
	 */
	getFavoriteList({
		secUserId,
		maxCursor = 0,
		count = 20,
	}: {
		secUserId?: string
		maxCursor?: number
		count?: number
	}): ResultAsync<
		{ list: DouyinAwemeItem[]; maxCursor: number; hasMore: boolean },
		DouyinApiError
	> {
		const secParam = secUserId ? `&sec_user_id=${secUserId}` : ''
		const endpoint = `/aweme/v1/web/aweme/favorite/?count=${count}&max_cursor=${maxCursor}&aid=6383${secParam}`
		return douyinClient
			.request<DouyinFavoriteResponse>({ endpoint })
			.map((res) => ({
				list: res.aweme_list ?? [],
				maxCursor: res.max_cursor ?? 0,
				hasMore: Boolean(res.has_more),
			}))
	}

	/**
	 * 获取当前登录用户的“收藏夹”列表
	 */
	getCollectionList({
		cursor = 0,
		count = 20,
	}: {
		cursor?: number
		count?: number
	} = {}): ResultAsync<
		{ list: DouyinAwemeItem[]; cursor: number; hasMore: boolean },
		DouyinApiError
	> {
		const endpoint = `/aweme/v1/web/aweme/listcollection/?count=${count}&cursor=${cursor}&aid=6383`
		return douyinClient
			.request<DouyinCollectionResponse>({ endpoint })
			.map((res) => {
				const list = res.aweme_list ?? res.items ?? []
				return {
					list,
					cursor: res.cursor ?? 0,
					hasMore: Boolean(res.has_more),
				}
			})
	}

	/**
	 * 获取用户信息
	 */
	getUserProfile(secUserId: string): ResultAsync<DouyinUserDetailResponse, DouyinApiError> {
		const endpoint = `/aweme/v1/web/user/profile/other/?sec_user_id=${secUserId}&aid=6383`
		return douyinClient.request<DouyinUserDetailResponse>({ endpoint })
	}

	/**
	 * 从分享文案中提取 URL 并解析
	 */
	parseShareText(text: string): { url: string | null } {
		const match = text.match(/(https?:\/\/[^\s]+)/i)
		return { url: match ? match[1] : null }
	}

	/**
	 * 将抖音 Aweme 转换为播放器通用的 DouyinTrack
	 */
	convertToTrack(aweme: DouyinAwemeItem): DouyinTrack {
		const audioUrl =
			aweme.music?.play_url?.url_list?.[0] ||
			aweme.video?.play_addr?.url_list?.[0] ||
			''

		const videoUrl = aweme.video?.play_addr?.url_list?.[0] || ''

		const coverUrl =
			aweme.music?.cover_large?.url_list?.[0] ||
			aweme.music?.cover_medium?.url_list?.[0] ||
			aweme.video?.cover?.url_list?.[0] ||
			null

		// 歌曲标题：优先取 music.title，如果没有取视频描述
		const title = aweme.music?.title?.trim() || aweme.desc?.trim() || '抖音原声'
		// 歌手：优先取 music.author，如果没有取作者昵称
		const artistName =
			aweme.music?.author?.trim() || aweme.author?.nickname?.trim() || '未知歌手'

		const duration = aweme.music?.duration
			? aweme.music.duration
			: Math.round((aweme.video?.duration || 0) / 1000)

		return {
			id: Number(aweme.aweme_id.slice(-8)) || Date.now(),
			uniqueKey: `douyin:${aweme.aweme_id}`,
			title,
			source: 'douyin',
			coverUrl,
			duration,
			createdAt: new Date(aweme.create_time * 1000),
			updatedAt: new Date(),
			artist: {
				id: Number(aweme.author?.uid?.slice(-8)) || 0,
				name: artistName,
				avatarUrl: aweme.author?.avatar_thumb?.url_list?.[0] || null,
				signature: aweme.author?.signature || null,
				source: 'douyin',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			douyinMetadata: {
				awemeId: aweme.aweme_id,
				musicId: aweme.music?.id ? String(aweme.music.id) : undefined,
				secUid: aweme.author?.sec_uid,
				authorName: artistName,
				audioUrl,
				videoUrl,
				desc: aweme.desc || '',
			},
		}
	}
}

export const douyinApi = new DouyinApi()
