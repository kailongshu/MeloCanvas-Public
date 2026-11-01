import type { DouyinAudio } from './douyin-audio'
import type { LocalAudio } from './local-audio'
import type { Source } from './model'

export interface LocalLibrarySource {
	kind: 'local'
	id: string
	originalTitle: string
	uploader: string
	performer: string
	artwork: string
	duration: number
	originalName: string
	bvid?: never
}

export interface DouyinLibrarySource {
	kind: 'douyin'
	id: string
	awemeId: string
	originalTitle: string
	uploader: string
	performer: string
	artwork: string
	duration: number
	audioUrl: string
	addedAt: number
	bvid?: never
}

export type MusicLibrarySource =
	| Source
	| LocalLibrarySource
	| DouyinLibrarySource

export const isLocalLibrarySource = (
	source: MusicLibrarySource,
): source is LocalLibrarySource => 'kind' in source && source.kind === 'local'

export const isDouyinLibrarySource = (
	source: MusicLibrarySource,
): source is DouyinLibrarySource => 'kind' in source && source.kind === 'douyin'

export const localLibrarySource = (audio: LocalAudio): LocalLibrarySource => ({
	kind: 'local',
	id: audio.id,
	originalTitle: audio.title,
	uploader: audio.artist,
	performer: audio.artist,
	artwork: '',
	duration: audio.durationSeconds,
	originalName: audio.originalName,
})

export const douyinLibrarySource = (
	audio: DouyinAudio,
): DouyinLibrarySource => ({
	kind: 'douyin',
	id: audio.id,
	awemeId: audio.awemeId,
	originalTitle: audio.title,
	uploader: audio.artist,
	performer: audio.artist,
	artwork: audio.artwork,
	duration: audio.durationSeconds,
	audioUrl: audio.audioUrl,
	addedAt: audio.addedAt,
})
