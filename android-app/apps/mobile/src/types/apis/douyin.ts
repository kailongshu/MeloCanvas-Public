export interface DouyinUrlList {
	url_list: string[]
	uri?: string
	width?: number
	height?: number
}

export interface DouyinMusic {
	id: string | number
	mid?: string
	title: string
	author: string
	album?: string
	cover_large?: DouyinUrlList
	cover_medium?: DouyinUrlList
	cover_thumb?: DouyinUrlList
	play_url: DouyinUrlList
	duration: number // 单位：秒
}

export interface DouyinVideo {
	play_addr: DouyinUrlList
	cover: DouyinUrlList
	dynamic_cover?: DouyinUrlList
	duration: number // 单位：毫秒
	ratio?: string
}

export interface DouyinAuthor {
	uid: string
	sec_uid: string
	nickname: string
	avatar_thumb: DouyinUrlList
	signature?: string
}

export interface DouyinAwemeItem {
	aweme_id: string
	desc: string
	create_time: number
	author: DouyinAuthor
	music?: DouyinMusic
	video: DouyinVideo
	statistics?: {
		digg_count: number
		comment_count: number
		collect_count: number
		share_count: number
	}
}

export interface DouyinFavoriteResponse {
	status_code: number
	aweme_list: DouyinAwemeItem[]
	max_cursor: number
	has_more: number
}

export interface DouyinCollectionResponse {
	status_code: number
	aweme_list?: DouyinAwemeItem[]
	items?: DouyinAwemeItem[]
	cursor: number
	has_more: number
}

export interface DouyinSearchResponse {
	status_code: number
	data?: Array<{
		type?: number
		aweme_info?: DouyinAwemeItem
		[key: string]: unknown
	}>
	cursor?: number
	has_more?: number
}

export interface DouyinUserDetailResponse {
	status_code: number
	user?: {
		uid: string
		sec_uid: string
		nickname: string
		signature: string
		avatar_thumb: DouyinUrlList
		favoriting_count?: number
		following_count?: number
		follower_count?: number
	}
}
