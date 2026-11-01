import { isDouyinAudioId } from './douyin-audio'
import { validateSourceId, type PlaybackMode } from './listening'
import { isLocalAudioId } from './local-audio'

export interface QueueEntry {
	entryId: string
	sourceId: string
}

export function playlistEntryId(itemId: string): string {
	if (typeof itemId !== 'string' || !itemId || itemId.trim() !== itemId)
		throw new Error('歌单条目身份无效')
	return `playlist-item:${itemId}`
}

export function validateQueueEntry(
	entry: QueueEntry,
	mode: PlaybackMode,
): void {
	if (isLocalAudioId(entry.sourceId) || isDouyinAudioId(entry.sourceId)) {
		if (
			mode === 'music' &&
			(entry.entryId === entry.sourceId ||
				(entry.entryId.startsWith('playlist-item:') &&
					playlistEntryId(entry.entryId.slice('playlist-item:'.length)) ===
						entry.entryId))
		)
			return
		throw new Error('该音频仅用于音乐播放队列')
	}
	validateSourceId(entry.sourceId)
	if (entry.entryId === entry.sourceId) return
	// A direct music occurrence keeps its original ID when selecting another P.
	if (mode === 'music' && entry.entryId.startsWith('bilibili:')) {
		validateSourceId(entry.entryId)
		if (entry.entryId.split(':')[1] === entry.sourceId.split(':')[1]) return
	}
	if (
		mode === 'music' &&
		typeof entry.entryId === 'string' &&
		entry.entryId.startsWith('playlist-item:') &&
		playlistEntryId(entry.entryId.slice('playlist-item:'.length)) ===
			entry.entryId
	)
		return
	throw new Error('播放队列条目身份无效')
}
