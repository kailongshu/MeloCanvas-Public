import type {
	PlaybackSessionSnapshot,
	PlaybackReplacementResult,
	PlaybackSnapshot,
	Track,
} from '@bbplayer/orpheus'

import type { Library } from './core/database'
import type {
	ListeningLibrary,
	PlaybackMode,
	ResumePoint,
} from './core/listening'
import {
	douyinAudioUri,
	type DouyinAudio,
	type DouyinAudioStore,
} from './core/douyin-audio'
import { validateSourceId } from './core/listening'
import {
	localAudioUri,
	type LocalAudio,
	type LocalAudioStore,
} from './core/local-audio'
import {
	sourceId as bilibiliSourceId,
	sourceUri,
	type Source,
} from './core/model'
import {
	isDouyinLibrarySource,
	isLocalLibrarySource,
	type MusicLibrarySource,
} from './core/music-library-source'
import { playlistEntryId, type QueueEntry } from './core/queue'
import type { PlaybackSession, SessionStore } from './core/sessions'
import type { PlaybackPreparation } from './playback-intent'

export interface PlaybackNative {
	getPlaybackSnapshot(): Promise<PlaybackSnapshot>
	switchMusicPart?(
		track: Track,
		expectedCurrentEntryId: string,
		expectedSourceId: string,
		preparationToken: number,
	): Promise<PlaybackReplacementResult>
	startCandidateAudition?(
		track: Track,
		token: number,
	): Promise<PlaybackSnapshot>
	endCandidateAudition?(auditionId: string): Promise<PlaybackSnapshot>
	replacePlayback(
		tracks: Track[],
		currentEntryId: string,
		positionSeconds: number,
		speed: number,
		shouldPlay: boolean,
		mode: PlaybackMode,
		preparationToken: number,
		fmContextId?: string | null,
	): Promise<{ previous: PlaybackSessionSnapshot; current: PlaybackSnapshot }>
	replaceListeningPlayback?(
		tracks: Track[],
		currentEntryId: string,
		positionSeconds: number,
		speed: number,
		shouldPlay: boolean,
		preparationToken: number,
		listeningResumeOverrides: Record<string, number>,
	): Promise<{ previous: PlaybackSessionSnapshot; current: PlaybackSnapshot }>
	startFm(
		tracks: Track[],
		preparationToken: number,
	): Promise<PlaybackReplacementResult>
	exitFm(
		fmId: string,
		preparationToken: number,
	): Promise<PlaybackReplacementResult>
	appendFm(
		tracks: Track[],
		fmId: string,
		expectedTailEntryId: string,
	): Promise<{ applied: boolean; current: PlaybackSnapshot }>
	cancelPlaybackReplacement(): Promise<number>
	isPlaybackReplacementCurrent(token: number): Promise<boolean>
	cancelPlaybackReplacementIfCurrent(token: number): Promise<boolean>
	finishPlaybackPreparationIfCurrent(token: number): Promise<boolean>
	douyinRegisterStreams?(streamsJson: string): void
}

const trackFor = (source: Source, entryId = source.id): Track => ({
	id: entryId,
	sourceId: source.id,
	url: sourceUri(source),
	title: source.originalTitle,
	artist: `UP · ${source.uploader}`,
	artwork: source.artwork,
	duration: source.duration,
})

const sessionFor = (snapshot: PlaybackSessionSnapshot): PlaybackSession => ({
	mode: snapshot.mode,
	entries: snapshot.tracks.map((track) => ({
		entryId: track.id,
		sourceId: track.sourceId ?? track.id,
	})),
	currentEntryId: snapshot.currentEntryId,
	currentSourceId: snapshot.currentSourceId,
	positionSeconds: snapshot.currentSourceId ? snapshot.positionSeconds : 0,
	speed: snapshot.speed,
	updatedAt: snapshot.updatedAt,
})

const unreadableStorageMessage =
	'播放记录无法读取，原记录已保留；暂时无法恢复或更换播放队列。'
const storageUnreadable = (snapshot: PlaybackSnapshot): boolean =>
	'sessionStorageUnreadable' in snapshot &&
	snapshot.sessionStorageUnreadable === true

function requireReadableStorage(snapshot: PlaybackSnapshot): void {
	if (storageUnreadable(snapshot)) throw new Error(unreadableStorageMessage)
}

/** Native owns the active session; SQLite is a repairable copy and stores the inactive queue. */
export class PlaybackController {
	private reservation: Promise<PlaybackPreparation> | null = null
	// Order SQLite projections by reads, not native wall-clock timestamps.
	private syncVersion = 0
	syncError = ''
	syncCause: unknown = null

	constructor(
		private native: PlaybackNative,
		private library: Pick<Library, 'save' | 'get'>,
		private listening: Pick<
			ListeningLibrary,
			'getResumePoint' | 'saveResumePoint'
		> &
			Partial<
				Pick<
					ListeningLibrary,
					| 'projectionGeneration'
					| 'beginResumeActivation'
					| 'canProjectResume'
					| 'grantResumeProjection'
					| 'authorizeResumeSession'
					| 'observeResumeSession'
				>
			>,
		private sessions: Pick<SessionStore, 'getSession' | 'saveSession'>,
		private localAudio?: Pick<LocalAudioStore, 'get'>,
		private douyinAudio?: Pick<DouyinAudioStore, 'get' | 'upsert' | 'upsertMany'>,
	) {}

	reconcile(snapshot: PlaybackSnapshot): void {
		if (snapshot.auditionId) return
		if (storageUnreadable(snapshot)) {
			this.syncError = unreadableStorageMessage
			this.syncCause = null
			return
		}
		try {
			if (snapshot.mode === 'listening')
				this.listening.observeResumeSession?.(
					snapshot.tracks.map((track) => ({
						entryId: track.id,
						sourceId: track.sourceId ?? track.id,
					})),
					snapshot.currentSourceId,
				)
			for (const session of [snapshot.inactiveSession, snapshot])
				if (session && (session.mode !== 'music' || !snapshot.fm))
					this.sessions.saveSession(sessionFor(session))
			if (snapshot.fm?.manualMusic)
				this.sessions.saveSession(sessionFor(snapshot.fm.manualMusic))
			for (const point of snapshot.resumePoints) {
				if (this.listening.canProjectResume?.(point.sourceId) === false)
					continue
				const saved = this.listening.getResumePoint(point.sourceId)
				if (
					saved &&
					saved.updatedAt > point.updatedAt &&
					!(this.listening.projectionGeneration?.() ?? 0)
				)
					continue
				this.listening.saveResumePoint({
					...point,
					positionSeconds:
						point.durationSeconds > 0
							? Math.min(point.positionSeconds, point.durationSeconds)
							: point.positionSeconds,
				})
			}
			this.syncError = ''
			this.syncCause = null
		} catch (cause) {
			this.syncCause = cause
			this.syncError =
				'播放状态已保留，但续听记录保存失败；返回应用时会重试同步。'
		}
	}

	sync(): Promise<PlaybackSnapshot> {
		return this.readForProjection()
	}

	private async readForProjection(
		preparation?: PlaybackPreparation,
	): Promise<PlaybackSnapshot> {
		const version = ++this.syncVersion
		const generation = this.listening.projectionGeneration?.()
		const snapshot = await this.native.getPlaybackSnapshot()
		if (preparation && !(await this.isPreparationCurrent(preparation)))
			return snapshot
		if (
			version === this.syncVersion &&
			generation === this.listening.projectionGeneration?.()
		)
			this.reconcile(snapshot)
		return snapshot
	}

	/** A committed result may predate controls/events received during token checks. */
	private async syncCommittedPlayback(
		preparation: PlaybackPreparation,
	): Promise<void> {
		const version = this.syncVersion + 1
		try {
			await this.readForProjection(preparation)
		} catch (cause) {
			if (version !== this.syncVersion) return
			try {
				if (!(await this.isPreparationCurrent(preparation))) return
			} catch {
				return
			}
			if (version !== this.syncVersion) return
			this.syncCause = cause
			this.syncError =
				'播放状态已保留，但续听记录保存失败；返回应用时会重试同步。'
		}
	}

	private savedSession(mode: PlaybackMode): PlaybackSession | null {
		try {
			return this.sessions.getSession(mode)
		} catch (cause) {
			this.syncCause = cause
			this.syncError =
				'播放状态已保留，但暂存记录读取失败；返回应用时会重试同步。'
			return null
		}
	}

	private resumePoint(
		snapshot: PlaybackSnapshot,
		sourceId: string,
	): ResumePoint | null {
		const nativePoint = snapshot.resumePoints.find(
			(point) => point.sourceId === sourceId,
		)
		try {
			if (nativePoint && this.listening.canProjectResume?.(sourceId) !== false)
				return nativePoint
			return this.listening.getResumePoint(sourceId)
		} catch (cause) {
			this.syncCause = cause
			this.syncError =
				'播放状态已保留，但续听记录读取失败；返回应用时会重试同步。'
			return null
		}
	}

	canReturnMusic(snapshot: PlaybackSnapshot): boolean {
		if (snapshot.auditionId) return false
		if (storageUnreadable(snapshot)) return false
		const nativeMusic =
			snapshot.mode === 'music'
				? snapshot
				: snapshot.inactiveSession?.mode === 'music'
					? snapshot.inactiveSession
					: null
		if (nativeMusic)
			return (
				!!nativeMusic.currentEntryId &&
				nativeMusic.tracks.some(
					(item) => item.id === nativeMusic.currentEntryId,
				)
			)
		if (snapshot.fm) return false
		try {
			const saved = this.sessions.getSession('music')
			return (
				!!saved?.currentEntryId &&
				saved.entries.some((entry) => entry.entryId === saved.currentEntryId)
			)
		} catch {
			return false
		}
	}

	async cancelPending(): Promise<void> {
		await this.native.cancelPlaybackReplacement()
	}

	async reservePlayback(): Promise<PlaybackPreparation> {
		const reservation = this.native
			.cancelPlaybackReplacement()
			.then((token) => ({ token }))
		this.reservation = reservation
		return reservation
	}
	async disposePending(): Promise<void> {
		const reservation = this.reservation
		this.reservation = null
		if (reservation) await this.cancelPreparation(await reservation)
	}
	isPreparationCurrent(preparation: PlaybackPreparation): Promise<boolean> {
		return this.native.isPlaybackReplacementCurrent(preparation.token)
	}
	async cancelPreparation(preparation: PlaybackPreparation): Promise<void> {
		await this.native.cancelPlaybackReplacementIfCurrent(preparation.token)
	}
	async finishPreparation(preparation: PlaybackPreparation): Promise<void> {
		try {
			await this.native.finishPlaybackPreparationIfCurrent(preparation.token)
		} catch (cause) {
			try {
				if (await this.isPreparationCurrent(preparation)) {
					this.syncCause = cause
					this.syncError = '播放状态已保留，但播放准备清理失败；请重试播放。'
				}
			} catch {
				/* An obsolete/unreachable cleanup cannot replace the original result. */
			}
		}
	}

	private async replace(
		tracks: Track[],
		currentEntryId: string,
		position: number,
		speed: number,
		mode: PlaybackMode,
		preparation: PlaybackPreparation,
		fmContextId: string | null = null,
	): Promise<PlaybackSnapshot | null> {
		if (!(await this.isPreparationCurrent(preparation))) return null
		let generation = this.listening.projectionGeneration?.()
		let projectionRevoked = false
		const listeningResumeOverrides: Record<string, number> = {}
		if (mode === 'listening' && generation) {
			for (const track of tracks) {
				const sourceId = track.sourceId ?? track.id
				const point = this.listening.getResumePoint(sourceId)
				const restored = point && !point.completed ? point.positionSeconds : 0
				listeningResumeOverrides[sourceId] =
					track.duration && track.duration > 0
						? Math.min(restored, track.duration)
						: restored
			}
		}
		try {
			const restoredListening =
				mode === 'listening' && Object.keys(listeningResumeOverrides).length > 0
			if (restoredListening && !this.native.replaceListeningPlayback)
				throw new Error('请更新原生播放器后再使用恢复的续听队列。')
			if (restoredListening && generation) {
				generation =
					this.listening.beginResumeActivation?.(generation) ?? generation
				this.syncVersion++
				projectionRevoked = true
			}
			const result = restoredListening
				? await this.native.replaceListeningPlayback!(
						tracks,
						currentEntryId,
						position,
						speed,
						true,
						preparation.token,
						listeningResumeOverrides,
					)
				: await this.native.replacePlayback(
						tracks,
						currentEntryId,
						position,
						speed,
						true,
						mode,
						preparation.token,
						fmContextId,
					)
			if (!(await this.isPreparationCurrent(preparation))) return null
			// Only a successful explicit listening activation owns future resume writes.
			// Restore/undo during the native await revokes this older activation.
			if (
				mode === 'listening' &&
				generation !== undefined &&
				generation === this.listening.projectionGeneration?.()
			) {
				const selected = tracks.find((track) => track.id === currentEntryId)
				if (selected) {
					this.syncVersion++
					this.listening.authorizeResumeSession?.(
						tracks.map((track) => ({
							entryId: track.id,
							sourceId: track.sourceId ?? track.id,
						})),
						selected.sourceId ?? selected.id,
						generation,
					)
				}
			}
			// Native committed both active and inactive together. SQLite failure is a separate warning.
			await this.syncCommittedPlayback(preparation)
			if (!(await this.isPreparationCurrent(preparation))) return null
			return result.current
		} catch (cause) {
			if (
				!(await this.isPreparationCurrent(preparation)) ||
				String(cause).includes('PlaybackReplacementCancelled')
			)
				return null
			if (projectionRevoked)
				throw new Error(
					`续听资料保持保护；请重新选择听视频后继续记录进度。${String(cause)}`,
					{ cause },
				)
			throw cause
		}
	}

	async playCandidateAudition(
		source: Source,
		preparation: PlaybackPreparation,
	): Promise<PlaybackSnapshot | null> {
		if (!this.native.startCandidateAudition)
			throw new Error('请更新原生播放器后再使用隔离试听。')
		if (!(await this.isPreparationCurrent(preparation))) return null
		const snapshot = await this.readForProjection(preparation)
		requireReadableStorage(snapshot)
		if (!(await this.isPreparationCurrent(preparation))) return null
		try {
			// Candidate metadata is intentionally not saved to Library, likes, playlists or sessions.
			const result = await this.native.startCandidateAudition(
				trackFor(source),
				preparation.token,
			)
			if (!(await this.isPreparationCurrent(preparation))) return null
			return result
		} catch (cause) {
			if (
				!(await this.isPreparationCurrent(preparation)) ||
				String(cause).includes('PlaybackReplacementCancelled')
			)
				return null
			throw cause
		}
	}

	async endCandidateAudition(auditionId: string): Promise<PlaybackSnapshot> {
		if (!this.native.endCandidateAudition)
			throw new Error('原生播放器暂不支持结束隔离试听。')
		const snapshot = await this.native.endCandidateAudition(auditionId)
		// Read through the generation-aware projection path, never replay a captured resume snapshot.
		await this.readForProjection()
		return snapshot
	}

	/** Replace one current music occurrence; native retains its latest transport and queue state. */
	async switchMusicPart(
		source: Source,
		preparation: PlaybackPreparation,
		expectedCurrent?: QueueEntry,
	): Promise<PlaybackSnapshot | null> {
		if (!(await this.isPreparationCurrent(preparation))) return null
		validateSourceId(source.id)
		if (source.id !== bilibiliSourceId(source.bvid, source.cid))
			throw new Error('分 P 音源身份不一致，请重新加载当前视频。')
		const active = await this.readForProjection(preparation)
		if (!(await this.isPreparationCurrent(preparation))) return null
		requireReadableStorage(active)
		if (active.mode !== 'music') throw new Error('请在音乐模式下切换分 P。')
		if (active.auditionId) throw new Error('请先结束候选试听，再切换分 P。')
		if (active.fm) throw new Error('请先退出 FM，再切换分 P。')
		const current = active.tracks.find(
			(track) => track.id === active.currentEntryId,
		)
		if (!current || !active.currentSourceId)
			throw new Error('当前播放条目已变化，请重新选择分 P。')
		if (
			(current.sourceId ?? current.id) !== active.currentSourceId ||
			(expectedCurrent &&
				(expectedCurrent.entryId !== current.id ||
					expectedCurrent.sourceId !== active.currentSourceId))
		)
			throw new Error('当前播放条目已变化，请重新选择分 P。')
		validateSourceId(active.currentSourceId)
		if (active.currentSourceId.split(':')[1] !== source.bvid)
			throw new Error('只能切换当前视频的同一 BV 分 P。')
		if (active.currentSourceId === source.id) return active
		if (!this.native.switchMusicPart)
			throw new Error('请更新原生播放器后再切换音乐分 P。')
		// Metadata precedes the native ID projection, as in normal music playback.
		this.library.save(source)
		if (!(await this.isPreparationCurrent(preparation))) return null
		const target = trackFor(source, current.id)
		// A cache-only queue must never silently become an online request.
		if (current.url.split('?')[1]?.split('&').includes('meloOffline=1'))
			target.url += '&meloOffline=1'
		try {
			const result = await this.native.switchMusicPart(
				target,
				current.id,
				active.currentSourceId,
				preparation.token,
			)
			if (!(await this.isPreparationCurrent(preparation))) return null
			await this.syncCommittedPlayback(preparation)
			if (!(await this.isPreparationCurrent(preparation))) return null
			return result.current
		} catch (cause) {
			if (
				!(await this.isPreparationCurrent(preparation)) ||
				String(cause).includes('PlaybackReplacementCancelled')
			)
				return null
			throw cause
		}
	}

	async playSource(
		source: Source,
		preparation: PlaybackPreparation,
		mode: PlaybackMode = 'music',
		relatedSources?: Source[],
	): Promise<PlaybackSnapshot | null> {
		if (!(await this.isPreparationCurrent(preparation))) return null
		// Metadata commits before native exposes IDs; these writes never change the live player.
		const sources = relatedSources ? [...relatedSources] : [source]
		if (!sources.some((item) => item.id === source.id)) sources.unshift(source)
		const unique = [...new Map(sources.map((item) => [item.id, item])).values()]
		for (const item of unique) this.library.save(item)
		if (!(await this.isPreparationCurrent(preparation))) return null
		const active = await this.readForProjection(preparation)
		if (!(await this.isPreparationCurrent(preparation))) return null
		requireReadableStorage(active)
		// A manual click while FM exists starts from the frozen manual queue,
		// never from the active/inactive FM music side or a stale SQLite backup.
		const manual = mode === 'music' && !!active.fm
		const sameActive = active.mode === mode && !manual
		const nativeSaved = manual
			? active.fm!.manualMusic
			: active.inactiveSession?.mode === mode
				? active.inactiveSession
				: null
		const saved = nativeSaved
			? sessionFor(nativeSaved)
			: sameActive
				? sessionFor(active)
				: manual
					? null
					: this.savedSession(mode)
		let tracks: Track[]
		if (relatedSources) tracks = unique.map((item) => trackFor(item))
		else if (
			mode === 'listening' &&
			!(sameActive
				? active.tracks.some((item) => (item.sourceId ?? item.id) === source.id)
				: saved?.entries.some((entry) => entry.sourceId === source.id))
		)
			tracks = [trackFor(source)]
		else if (sameActive) {
			tracks = [...active.tracks]
			if (!tracks.some((item) => (item.sourceId ?? item.id) === source.id))
				tracks.push(trackFor(source))
		} else if (saved) {
			tracks = nativeSaved?.tracks
				? [...nativeSaved.tracks]
				: saved.entries.map((entry) => this.sourceTrack(entry))
			if (!tracks.some((item) => (item.sourceId ?? item.id) === source.id))
				tracks.push(trackFor(source))
		} else tracks = [trackFor(source)]
		const selected =
			tracks.find(
				(item) =>
					item.id ===
						(sameActive ? active.currentEntryId : saved?.currentEntryId) &&
					(item.sourceId ?? item.id) === source.id,
			) ?? tracks.find((item) => (item.sourceId ?? item.id) === source.id)!
		const point = this.resumePoint(active, source.id)
		const position =
			sameActive &&
			(mode === 'music' ||
				this.listening.canProjectResume?.(source.id) !== false) &&
			active.currentEntryId === selected.id &&
			(mode === 'music' || !point?.completed)
				? active.positionSeconds
				: mode === 'listening' && point && !point.completed
					? point.positionSeconds
					: 0
		const speed =
			mode === 'music'
				? 1
				: active.mode === mode
					? active.speed
					: (saved?.speed ?? 1)
		return this.replace(tracks, selected.id, position, speed, mode, preparation)
	}

	async playOfflineTrack(
		track: Track,
		preparation: PlaybackPreparation,
	): Promise<PlaybackSnapshot | null> {
		if (!(await this.isPreparationCurrent(preparation))) return null
		if (
			!track.sourceId?.startsWith('bilibili:') ||
			!track.url.endsWith('&meloOffline=1')
		)
			throw new Error('离线音源身份无效')
		const active = await this.readForProjection(preparation)
		if (!(await this.isPreparationCurrent(preparation))) return null
		requireReadableStorage(active)
		// Keep the real source identity; the native cache-only route revalidates at open without an HTTP fallback.
		return this.replace(
			[{ ...track, id: track.sourceId }],
			track.sourceId,
			0,
			1,
			'music',
			preparation,
		)
	}

	async playLocalAudio(
		id: string,
		preparation: PlaybackPreparation,
	): Promise<PlaybackSnapshot | null> {
		if (!(await this.isPreparationCurrent(preparation))) return null
		const audio = this.localAudio?.get(id)
		if (!audio) throw new Error('本地音频不存在，请重新导入')
		const active = await this.readForProjection(preparation)
		if (!(await this.isPreparationCurrent(preparation))) return null
		requireReadableStorage(active)
		return this.replace([localTrack(audio)], id, 0, 1, 'music', preparation)
	}

	async playDouyinAudio(
		items: DouyinAudio[],
		startId: string,
		preparation: PlaybackPreparation,
	): Promise<PlaybackSnapshot | null> {
		if (!(await this.isPreparationCurrent(preparation))) return null
		if (!items.length) throw new Error('没有可播放的抖音原声')
		const seen = new Set<string>()
		const unique: DouyinAudio[] = []
		for (const item of items) {
			if (!seen.has(item.id)) {
				seen.add(item.id)
				unique.push(item)
			}
		}
		this.douyinAudio?.upsertMany(unique)
		const streams = unique
			.filter((item) => item.audioUrl)
			.map((item) => ({ awemeId: item.awemeId, audioUrl: item.audioUrl }))
		if (streams.length) {
			this.native.douyinRegisterStreams?.(JSON.stringify(streams))
		}
		const tracks = unique.map((item) => douyinTrack(item))
		const selected = tracks.find((t) => t.id === startId) ?? tracks[0]
		const active = await this.readForProjection(preparation)
		if (!(await this.isPreparationCurrent(preparation))) return null
		requireReadableStorage(active)
		return this.replace(tracks, selected.id, 0, 1, 'music', preparation)
	}

	async playPlaylist(
		entries: { itemId: string; source: MusicLibrarySource }[],
		startItemId: string,
		preparation: PlaybackPreparation,
	): Promise<PlaybackSnapshot | null> {
		if (!(await this.isPreparationCurrent(preparation))) return null
		if (!entries.length) throw new Error('歌单没有可播放条目')
		const tracks = entries.map(({ itemId, source }) =>
			isLocalLibrarySource(source)
				? this.localPlaylistTrack(source.id, playlistEntryId(itemId))
				: isDouyinLibrarySource(source)
					? this.douyinPlaylistTrack(source, playlistEntryId(itemId))
				: trackFor(source, playlistEntryId(itemId)),
		)
		if (new Set(tracks.map((track) => track.id)).size !== tracks.length)
			throw new Error('歌单条目身份重复')
		const currentEntryId = playlistEntryId(startItemId)
		if (!tracks.some((track) => track.id === currentEntryId))
			throw new Error('起播条目不在歌单中')
		for (const entry of entries)
			if (isDouyinLibrarySource(entry.source)) {
				const s = entry.source
				this.douyinAudio?.upsert({
					id: s.id,
					awemeId: s.awemeId,
					title: s.originalTitle,
					artist: s.performer || s.uploader || '抖音原声',
					artwork: s.artwork,
					durationSeconds: s.duration,
					audioUrl: s.audioUrl,
					addedAt: s.addedAt || Date.now(),
				})
				if (s.audioUrl) {
					this.native.douyinRegisterStreams?.(
						JSON.stringify([{ awemeId: s.awemeId, audioUrl: s.audioUrl }]),
					)
				}
			} else if (!isLocalLibrarySource(entry.source)) {
				this.library.save(entry.source)
			}
		if (!(await this.isPreparationCurrent(preparation))) return null
		const active = await this.readForProjection(preparation)
		if (!(await this.isPreparationCurrent(preparation))) return null
		requireReadableStorage(active)
		return this.replace(tracks, currentEntryId, 0, 1, 'music', preparation)
	}

	private localPlaylistTrack(id: string, entryId: string): Track {
		const audio = this.localAudio?.get(id)
		if (!audio) throw new Error('本地音频不存在，请重新导入')
		return localTrack(audio, entryId)
	}

	private douyinPlaylistTrack(
		source: Extract<MusicLibrarySource, { kind: 'douyin' }>,
		entryId: string,
	): Track {
		const saved = this.douyinAudio?.get(source.id)
		return douyinTrack(
			saved ?? {
				id: source.id,
				awemeId: source.awemeId,
				title: source.originalTitle,
				artist: source.performer || source.uploader || '抖音原声',
				artwork: source.artwork,
				durationSeconds: source.duration,
				audioUrl: source.audioUrl,
				addedAt: source.addedAt,
			},
			entryId,
		)
	}

	private sourceTrack(entry: QueueEntry): Track {
		const source = this.library.get(entry.sourceId)
		if (!source) {
			const audio = this.localAudio?.get(entry.sourceId)
			if (audio) return localTrack(audio, entry.entryId)
			const douyin = this.douyinAudio?.get(entry.sourceId)
			if (douyin) return douyinTrack(douyin, entry.entryId)
			throw new Error('暂存队列的音源信息不存在，请重新打开内容')
		}
		return trackFor(source, entry.entryId)
	}

	async returnToMusic(
		preparation: PlaybackPreparation,
	): Promise<PlaybackSnapshot | null> {
		const active = await this.readForProjection(preparation)
		if (!(await this.isPreparationCurrent(preparation))) return null
		requireReadableStorage(active)
		if (active.mode === 'music') return active
		const nativeSaved =
			active.inactiveSession?.mode === 'music' ? active.inactiveSession : null
		const saved = nativeSaved
			? sessionFor(nativeSaved)
			: active.fm
				? null
				: this.savedSession('music')
		if (!saved?.currentEntryId || saved.entries.length === 0)
			throw new Error('还没有暂存的音乐队列，请先选择音乐')
		return this.replace(
			nativeSaved?.tracks ??
				saved.entries.map((entry) => this.sourceTrack(entry)),
			saved.currentEntryId,
			saved.positionSeconds,
			1,
			'music',
			preparation,
			active.fm?.id ?? null,
		)
	}

	async select(
		index: number | 'next' | 'previous',
		preparation: PlaybackPreparation,
		expectedEntryId?: string,
	): Promise<PlaybackSnapshot | null> {
		const snapshot = await this.readForProjection(preparation)
		if (!(await this.isPreparationCurrent(preparation))) return null
		requireReadableStorage(snapshot)
		// Resolve transport direction in the native snapshot, never against a stale
		// UI index while a queue move/removal is waiting for its projection read.
		const currentIndex = snapshot.tracks.findIndex(
			(item) => item.id === snapshot.currentEntryId,
		)
		const targetIndex =
			typeof index === 'number'
				? index
				: currentIndex < 0
					? -1
					: currentIndex + (index === 'next' ? 1 : -1)
		const track =
			expectedEntryId === undefined
				? snapshot.tracks[targetIndex]
				: snapshot.tracks.find((item) => item.id === expectedEntryId)
		if (!track) return null
		const point = this.resumePoint(snapshot, track.sourceId ?? track.id)
		const position =
			snapshot.mode === 'listening' && point && !point.completed
				? point.positionSeconds
				: 0
		return this.replace(
			snapshot.tracks,
			track.id,
			position,
			snapshot.speed,
			snapshot.mode,
			preparation,
			snapshot.mode === 'music' ? (snapshot.fm?.id ?? null) : null,
		)
	}

	private fmTracks(sources: Source[], max: number): Track[] {
		if (!Array.isArray(sources) || sources.length < 1 || sources.length > max)
			throw new Error('私人 FM 没有有效候选或候选数量超限')
		const seen = new Set<string>()
		for (const source of sources) {
			if (
				!source ||
				typeof source.bvid !== 'string' ||
				source.bvid.length !== 12 ||
				!/^BV[A-Za-z0-9]{10}$/.test(source.bvid) ||
				!Number.isSafeInteger(source.cid) ||
				source.cid <= 0 ||
				source.id !== `bilibili:${source.bvid}:${source.cid}` ||
				seen.has(source.id)
			)
				throw new Error('私人 FM 音源身份无效或重复')
			seen.add(source.id)
		}
		for (const source of sources) this.library.save(source)
		return sources.map((source) => trackFor(source))
	}

	private async fmReplacement(
		preparation: PlaybackPreparation,
		action: () => Promise<PlaybackReplacementResult>,
	): Promise<PlaybackSnapshot | null> {
		let finished = false
		try {
			if (!(await this.isPreparationCurrent(preparation))) return null
			const result = await action()
			await this.finishPreparation(preparation)
			finished = true
			if (!(await this.isPreparationCurrent(preparation))) return null
			await this.syncCommittedPlayback(preparation)
			if (!(await this.isPreparationCurrent(preparation))) return null
			return result.current
		} catch (cause) {
			if (
				!(await this.isPreparationCurrent(preparation)) ||
				String(cause).includes('PlaybackReplacementCancelled')
			)
				return null
			throw cause
		} finally {
			if (!finished) await this.finishPreparation(preparation)
		}
	}

	startFm(
		sources: Source[],
		preparation: PlaybackPreparation,
	): Promise<PlaybackSnapshot | null> {
		return this.fmReplacement(preparation, async () => {
			const tracks = this.fmTracks(sources, 50)
			if (!(await this.isPreparationCurrent(preparation)))
				throw new Error('PlaybackReplacementCancelled')
			return this.native.startFm(tracks, preparation.token)
		})
	}

	exitFm(
		fmId: string,
		preparation: PlaybackPreparation,
	): Promise<PlaybackSnapshot | null> {
		return this.fmReplacement(preparation, () => {
			if (!fmId || typeof fmId !== 'string')
				throw new Error('私人 FM 会话身份无效')
			return this.native.exitFm(fmId, preparation.token)
		})
	}

	async appendFm(
		sources: Source[],
		fmId: string,
		expectedTailEntryId: string,
	): Promise<boolean> {
		if (
			typeof fmId !== 'string' ||
			!fmId ||
			typeof expectedTailEntryId !== 'string' ||
			!expectedTailEntryId
		)
			throw new Error('私人 FM 追加位置无效')
		const tracks = this.fmTracks(sources, 50)
		const result = await this.native.appendFm(tracks, fmId, expectedTailEntryId)
		// The returned snapshot may already be obsolete by JS delivery. The hook
		// reads current native state under its existing sync ordering instead.
		return result.applied
	}
}

function douyinTrack(audio: DouyinAudio, entryId = audio.id): Track {
	return {
		id: entryId,
		sourceId: audio.id,
		url: douyinAudioUri(audio.id),
		title: audio.title,
		artist: audio.artist || '抖音原声',
		artwork: audio.artwork,
		duration: audio.durationSeconds,
	}
}

function localTrack(audio: LocalAudio, entryId = audio.id): Track {
	return {
		id: entryId,
		sourceId: audio.id,
		url: localAudioUri(audio.id),
		title: audio.title,
		artist: audio.artist || '未知艺术家',
		duration: audio.durationSeconds,
	}
}
