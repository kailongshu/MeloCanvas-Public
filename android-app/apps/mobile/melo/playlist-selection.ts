import type { Library } from './core/database'
import {
	isDouyinLibrarySource,
	isLocalLibrarySource,
	type MusicLibrarySource as Source,
} from './core/music-library-source'
import type {
	PlaylistEntry,
	PlaylistDetail,
	PlaylistItem,
	PlaylistStore,
} from './core/playlists'
import { importEntryDescription, importProviderName } from './import-display'

export type PlaylistDetailFilter = 'all' | 'pending'

export const isPlaylistDetailFiltered = (
	query: string,
	filter: PlaylistDetailFilter,
) => !!query.trim() || filter !== 'all'

/** Search actual metadata only; local filenames never include private directories. */
function playlistSourceSearchText(source: Source): string {
	return [
		source.originalTitle,
		source.performer,
		source.uploader,
		source.bvid,
		isDouyinLibrarySource(source) ? source.awemeId : null,
		isLocalLibrarySource(source)
			? source.originalName.split(/[\\/]/).pop()
			: null,
	]
		.filter(Boolean)
		.join(' ')
}

/** Filtering is a view: it neither changes source identity nor the picker's selection. */
export function selectPlaylistPickerSources(
	sources: readonly Source[],
	query: string,
) {
	const keyword = query.trim().toLowerCase()
	return sources.filter((source) =>
		playlistSourceSearchText(source).toLowerCase().includes(keyword),
	)
}

/** A display view only: retain every occurrence and its original playlist position. */
export function selectPlaylistDetailItems(
	detail: PlaylistDetail | null,
	sources: ReadonlyMap<string, Source | null>,
	query: string,
	filter: PlaylistDetailFilter,
) {
	const keyword = query.trim().toLowerCase()
	return (detail?.items ?? [])
		.filter((item) => {
			if (filter === 'pending' && item.sourceId !== null) return false
			if (!keyword) return true
			const source = item.sourceId === null ? null : sources.get(item.sourceId)
			const description = playlistItemDescription(item, source)
			const original =
				item.sourceId === null && item.importOrigin
					? importEntryDescription(
							item.importOrigin,
							item.importOrigin.provider,
						)
					: null
			return [
				description.title,
				description.subtitle,
				description.status,
				source ? playlistSourceSearchText(source) : null,
				original?.title,
				original?.artists,
				original?.album,
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(keyword)
		})
		.map((item) => ({ item, index: item.position }))
}

const text = (value: unknown): string =>
	typeof value === 'string' && value.trim() ? value : ''

export function playlistPlaybackCounts(items: PlaylistItem[]) {
	const playable = items.filter((item) => item.sourceId !== null)
	return {
		playableCount: playable.length,
		pendingCount: items.length - playable.length,
		firstPlayableItemId: playable[0]?.itemId ?? null,
	}
}

/** Original platform metadata is display evidence, never a fabricated Bilibili Source. */
export function playlistItemDescription(
	item: PlaylistItem,
	source: Source | null | undefined,
) {
	if (item.sourceId !== null && (!item.importOrigin || item.importOrigin.provider === 'bilibili'))
		return {
			title: source?.originalTitle ?? '音源资料暂不可用',
			subtitle: source
				? isLocalLibrarySource(source)
					? `本地音频，${source.performer || '未知艺术家'}`
					: isDouyinLibrarySource(source)
						? `抖音原声 · ${source.performer || source.uploader || '未知艺术家'}`
					: `UP：${source.uploader}`
				: '条目已保留，可稍后重试',
			status: null,
		}
	const original = item.importOrigin?.originalMetadata
	const track = original?.track
	const data =
		track && typeof track === 'object' && !Array.isArray(track)
			? track
			: original
	const title =
		text(data?.name) ||
		text(data?.title) ||
		text(data?.originalTitle) ||
		(item.importOrigin?.originalEntryId
			? `原平台条目 ${item.importOrigin.originalEntryId}`
			: '原条目信息待读取')
	const artists = data?.ar ?? data?.singer ?? data?.artists
	const names = Array.isArray(artists)
		? artists
				.map((artist) =>
					typeof artist === 'string'
						? text(artist)
						: artist && typeof artist === 'object' && !Array.isArray(artist)
							? text(artist.name)
							: '',
				)
				.filter(Boolean)
				.join(' / ')
		: text(artists)
	const album = data?.al ?? data?.album
	const albumName =
		typeof album === 'object' && album !== null && !Array.isArray(album)
			? text(album.name)
			: text(album)
	const subtitle =
		[names, albumName].filter(Boolean).join('，') || '原平台条目信息已保留'
	const state = item.review?.state
	return {
		title,
		subtitle,
		status: item.sourceId !== null ? null :
			state === 'not-found'
				? '待匹配，尚未找到音源'
				: state === 'unreadable'
					? '待匹配，暂时无法读取'
					: state === 'needs-review'
						? '未匹配，点击查找音源'
						: '未匹配，点击查找音源',
	}
}

/** Preserve every occurrence, including repeat sources, before any native replacement. */
export function preparePlaylistPlayback(
	store: Pick<PlaylistStore, 'get'>,
	library: Pick<Library, 'getMusic'>,
	playlistId: string,
	startItemId: string,
): { entries: PlaylistEntry[]; startItemId: string; pendingCount: number } {
	const playlist = store.get(playlistId)
	if (!playlist) throw new Error('这张歌单已不存在，请返回音乐库')
	if (!playlist.items.length) throw new Error('这张歌单还没有音源')
	const start = playlist.items.find((item) => item.itemId === startItemId)
	if (!start) throw new Error('所选条目已变更，请重新打开歌单')
	if (start.sourceId === null)
		throw new Error('这项内容尚待匹配音源，暂时不能播放')
	const entries: PlaylistEntry[] = []
	for (const [index, item] of playlist.items.entries()) {
		if (item.sourceId === null) continue
		const source = library.getMusic(item.sourceId)
		if (!source)
			throw new Error(
				`歌单第 ${index + 1} 项的音源信息暂时无法读取，原播放已保留`,
			)
		entries.push({ itemId: item.itemId, source })
	}
	return {
		entries,
		startItemId,
		pendingCount: playlist.items.length - entries.length,
	}
}

/** Current per-occurrence evidence, not a live remote playlist association. */
export function playlistImportSummary(items: readonly PlaylistItem[]): string {
	const present = new Set(
		items.flatMap((item) =>
			item.importOrigin ? [item.importOrigin.provider] : [],
		),
	)
	const names = (['netease', 'qq', 'bilibili', 'kugou', 'kuwo', 'qishui'] as const)
		.filter((provider) => present.has(provider))
		.map(importProviderName)
	return names.length ? `导入条目来源：${names.join(' / ')}，本地副本` : ''
}
