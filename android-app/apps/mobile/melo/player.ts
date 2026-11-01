import { PlaybackProgress } from './playback-progress'
import {
	Orpheus,
	PlaybackState,
	type PlaybackSnapshot,
	type FmPlaybackContext,
	type Track,
} from '@bbplayer/orpheus'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'

import type { Library } from './core/database'
import type {
	ListeningLibrary,
	PlaybackMode,
	ResumePoint,
} from './core/listening'
import type { DouyinAudio, DouyinAudioStore } from './core/douyin-audio'
import type { LocalAudioStore } from './core/local-audio'
import { playbackError, type Source } from './core/model'
import type { MusicLibrarySource } from './core/music-library-source'
import type { SessionStore } from './core/sessions'
import type { PlaybackPreparation } from './playback-intent'
import { PlaybackController } from './playbackController'

export function usePlayer(
	library: Library,
	listening: ListeningLibrary,
	sessions: SessionStore,
	localAudio?: LocalAudioStore,
	douyinAudio?: DouyinAudioStore,
) {
	const controller = useMemo(
		() =>
			new PlaybackController(Orpheus, library, listening, sessions, localAudio, douyinAudio),
		[library, listening, sessions, localAudio, douyinAudio],
	)
	const [track, setTrack] = useState<Track | null>(null)
	const [queue, setQueue] = useState<Track[]>([])
	const [queueIsSequential, setQueueIsSequential] = useState(true)
	const [repeatMode, setRepeatMode] = useState(0)
	const [shuffleEntryIds, setShuffleEntryIds] = useState<string[] | null>(null)
	const orderPending = useRef(false)
	const [orderBusy, setOrderBusy] = useState(false)
	const [musicQueueUndo, setMusicQueueUndo] =
		useState<PlaybackSnapshot['musicQueueUndo']>(null)
	const [mode, setMode] = useState<PlaybackMode>('music')
	const [fmContext, setFmContext] = useState<FmPlaybackContext | null>(null)
	const [speed, setSpeedState] = useState(1)
	const [sleepTimer, setSleepTimer] =
		useState<PlaybackSnapshot['sleepTimer']>(null)
	const [resumePoints, setResumePoints] = useState<ResumePoint[]>([])
	const [playing, setPlaying] = useState(false)
	const [progress] = useState(() => new PlaybackProgress())
	const [position, setPosition] = useState(0)
	const [duration, setDuration] = useState(0)
	const [buffering, setBuffering] = useState(false)
	const [switching, setSwitching] = useState(false)
	const [error, setError] = useState('')
	const [errorCause, setErrorCause] = useState<unknown>(null)
	const [syncError, setSyncError] = useState('')
	const [syncCause, setSyncCause] = useState<unknown>(null)
	const [canReturnMusic, setCanReturnMusic] = useState(false)
	const [nativePersistenceError, setNativePersistenceError] = useState<
		string | null
	>(null)
	const [auditionId, setAuditionId] = useState<string | null>(null)
	const alive = useRef(false)
	const syncVersion = useRef(0)
	const operationVersion = useRef(0)
	const fmContextRef = useRef<FmPlaybackContext | null>(null)
	const lastSynced = useRef(0)
	const periodicSyncPending = useRef(false)

	const apply = useCallback(
		(snapshot: PlaybackSnapshot) => {
			if (!alive.current) return
			setTrack(
				snapshot.tracks.find((item) => item.id === snapshot.currentEntryId) ??
					null,
			)
			setQueue(snapshot.tracks)
			setQueueIsSequential(snapshot.shuffleEntryIds == null)
			setRepeatMode(snapshot.repeatMode ?? 0)
			setShuffleEntryIds(snapshot.shuffleEntryIds ?? null)
			setMusicQueueUndo(snapshot.musicQueueUndo ?? null)
			setAuditionId(snapshot.auditionId ?? null)
			setMode(snapshot.mode)
			setFmContext(snapshot.fm ?? null)
			fmContextRef.current = snapshot.fm ?? null
			setSpeedState(snapshot.speed)
			setSleepTimer(snapshot.sleepTimer ?? null)
			setPlaying(snapshot.playing)
			progress.update(snapshot.positionSeconds, snapshot.durationSeconds)
			setPosition(snapshot.positionSeconds)
			setDuration(snapshot.durationSeconds)
			setResumePoints(snapshot.resumePoints)
			setCanReturnMusic(controller.canReturnMusic(snapshot))
			setNativePersistenceError(snapshot.persistenceError ?? null)
			setSyncError(controller.syncError)
			setSyncCause(controller.syncCause)
		},
		[controller, progress],
	)

	const sync = useCallback(
		async (
			receiveFailure?: (cause: unknown) => void,
			owns: () => boolean = () => true,
		) => {
			const version = ++syncVersion.current
			try {
				const snapshot = await controller.sync()
				if (!owns() || version !== syncVersion.current)
					return 'superseded' as const
				lastSynced.current = Date.now()
				apply(snapshot)
				return 'applied' as const
			} catch (cause) {
				if (!alive.current) return 'failed' as const
				if (!owns() || version !== syncVersion.current)
					return 'superseded' as const
				if (receiveFailure) receiveFailure(cause)
				else {
					setError('播放器连接失败，请重新打开应用')
					setErrorCause(cause)
				}
				return 'failed' as const
			}
		},
		[controller, apply],
	)

	const invalidate = useCallback(() => {
		syncVersion.current++
		operationVersion.current++
	}, [])

	useEffect(() => {
		alive.current = true
		Orpheus.restorePlaybackPositionEnabled = true
		Orpheus.autoplayOnStartEnabled = false
		const subscriptions = [
			Orpheus.addListener('onListeningSleepTimerChanged', () => {
				void sync()
			}),
			Orpheus.addListener('onTrackStarted', () => {
				setError('')
				void sync()
			}),
			Orpheus.addListener('onTrackFinished', () => {
				void sync()
			}),
			Orpheus.addListener('onQueueChanged', () => {
				void sync()
			}),
			Orpheus.addListener('onIsPlayingChanged', (event) => {
				setPlaying(event.status)
				void sync()
			}),
			Orpheus.addListener('onPositionUpdate', (event) => {
				progress.update(event.position, event.duration)
				if (!periodicSyncPending.current && Date.now() - lastSynced.current >= 5000) {
					// Reserve this interval before the native read. Slow or failed reads
					// must not enqueue another full snapshot for every progress event.
					lastSynced.current = Date.now()
					periodicSyncPending.current = true
					void sync().finally(() => { periodicSyncPending.current = false })
				}
			}),
			Orpheus.addListener('onPlaybackSpeedChanged', (event) => {
				setSpeedState(event.speed)
				void sync()
			}),
			Orpheus.addListener('onPlaybackStateChanged', (event) => {
				setBuffering(event.state === PlaybackState.BUFFERING)
				void sync()
			}),
			Orpheus.addListener('onPlayerError', (event) => {
				setBuffering(false)
				setErrorCause(event)
				setError(
					playbackError(
						event.platform === 'android'
							? `${event.rootCauseMessage} ${event.message}`
							: event.error,
					),
				)
			}),
		]
		const state = AppState.addEventListener('change', () => {
			void sync()
		})
		void sync()
		return () => {
			alive.current = false
			invalidate()
			void controller.disposePending().catch(() => {})
			subscriptions.forEach((sub) => sub.remove())
			state.remove()
		}
	}, [controller, sync, invalidate, progress])

	async function operation(
		action: () => Promise<PlaybackSnapshot | null>,
		preparation?: PlaybackPreparation,
	) {
		const version = ++operationVersion.current
		const syncAtStart = syncVersion.current
		let finished = false
		setSwitching(true)
		setError('')
		setErrorCause(null)
		try {
			const result = await action()
			if (preparation) {
				await controller.finishPreparation(preparation)
				finished = true
			}
			if (preparation && !(await controller.isPreparationCurrent(preparation)))
				return false
			if (version !== operationVersion.current || !result || !alive.current)
				return false
			if (syncAtStart !== syncVersion.current) {
				// A newer read/event may already have observed native progress, or
				// may have sampled the old queue before commit. Read current state
				// rather than publishing this earlier result or merely skipping it.
				let refreshCause: unknown
				let failureSyncVersion: number | undefined
				const status = await sync((cause) => {
					refreshCause = cause
					failureSyncVersion = syncVersion.current
				})
				if (
					preparation &&
					!(await controller.isPreparationCurrent(preparation))
				)
					return false
				if (version !== operationVersion.current || !alive.current) return false
				if (status === 'failed' && failureSyncVersion === syncVersion.current) {
					setError('播放器连接失败，请重新打开应用')
					setErrorCause(refreshCause)
					return false
				}
				return true
			}
			syncVersion.current++
			apply(result)
			return true
		} catch (cause) {
			if (preparation && !(await controller.isPreparationCurrent(preparation)))
				return false
			if (alive.current && version === operationVersion.current) {
				setErrorCause(cause)
				const message = cause instanceof Error ? cause.message : String(cause)
				setError(
					/[\u4e00-\u9fff]/.test(message) && !message.includes('离线内容缺失或不完整')
						? message
						: playbackError(message),
				)
			}
			return false
		} finally {
			if (preparation && !finished)
				await controller.finishPreparation(preparation)
			if (alive.current && version === operationVersion.current) {
				setSwitching(false)
				setSyncError(controller.syncError)
				setSyncCause(controller.syncCause)
			}
		}
	}

	async function cancelPending() {
		const version = ++operationVersion.current
		await controller.cancelPending()
		if (alive.current && version === operationVersion.current)
			setSwitching(false)
	}

	async function reservePlayback() {
		const version = ++operationVersion.current
		const preparation = await controller.reservePlayback()
		if (alive.current && version === operationVersion.current)
			setSwitching(false)
		return preparation
	}

	async function command(action: () => Promise<void>) {
		const version = ++operationVersion.current
		const owns = () => alive.current && version === operationVersion.current
		setSwitching(false)
		try {
			// Native controls invalidate preparation and act together on Main.
			// Do not insert a separate bridge round-trip before that action.
			await action()
			if (!owns()) return
			// A newer playback intent owns the UI even before its queue commits.
			await sync(undefined, owns)
		} catch (cause) {
			if (!owns()) return
			setError('播放操作失败，请稍后重试')
			setErrorCause(cause)
		}
	}
	async function select(
		index: number | 'next' | 'previous',
		expectedEntryId?: string,
	) {
		if (mode === 'music' && !fmContext && !auditionId && typeof index === 'number') {
			const entryId = expectedEntryId ?? queue[index]?.id
			if (!track || !entryId || switching || orderPending.current) return false
			let selected = false
			await command(async () => {
				await Orpheus.selectMusicQueueEntry(track.id, entryId)
				selected = true
			})
			return selected
		}
		const version = operationVersion.current + 1
		try {
			const preparation = await reservePlayback()
			if (version !== operationVersion.current || !alive.current) return false
			return operation(
				() => controller.select(index, preparation, expectedEntryId),
				preparation,
			)
		} catch (cause) {
			if (alive.current && version === operationVersion.current) {
				setError('播放操作失败，请稍后重试')
				setErrorCause(cause)
			}
			return false
		}
	}

	async function appendFm(
		sources: Source[],
		fmId: string,
		expectedTailEntryId: string,
	) {
		const version = operationVersion.current
		const owns = () =>
			alive.current &&
			version === operationVersion.current &&
			fmContextRef.current?.id === fmId
		try {
			if (!owns()) return false
			const applied = await controller.appendFm(
				sources,
				fmId,
				expectedTailEntryId,
			)
			if (!applied || !owns()) return false
			// Never apply append's captured current snapshot: a newer control may
			// already have moved to another item/session by bridge delivery.
			let failure: unknown
			let failedAt: number | undefined
			const status = await sync((cause) => {
				failure = cause
				failedAt = syncVersion.current
			}, owns)
			if (!owns()) return false
			if (status === 'failed' && failedAt === syncVersion.current) {
				setError('播放器连接失败，请重新打开应用')
				setErrorCause(failure)
				return false
			}
			return true
		} catch (cause) {
			if (owns()) {
				setError(
					cause instanceof Error ? cause.message : '私人 FM 追加失败，请重试',
				)
				setErrorCause(cause)
			}
			return false
		}
	}

	async function setListeningSleepTimer(
		sourceId: string,
		timerMode: 'duration' | 'part' | 'off',
		durationMs?: number,
	): Promise<void> {
		await Orpheus.setListeningSleepTimer(sourceId, timerMode, durationMs)
		let failure: unknown
		const status = await sync((cause) => {
			failure = cause
		})
		if (status === 'failed')
			throw new Error('定时已设置，但状态暂时无法读取，请重新打开面板确认', {
				cause: failure,
			})
	}

	async function mutateMusicQueue(
		action: () => Promise<PlaybackSnapshot>,
		committed: string,
		requireSequential = true,
	): Promise<void> {
		if (
			!track ||
			mode !== 'music' ||
			fmContext ||
			auditionId ||
			switching ||
			(requireSequential && !queueIsSequential)
		)
			throw new Error('当前不是可调整的音乐队列')
		try {
			await action()
		} catch (cause) {
			throw new Error('队列调整失败，请重新打开队列重试', { cause })
		}
		let failure: unknown
		const status = await sync((cause) => {
			failure = cause
		})
		if (status === 'failed')
			throw new Error(`${committed}，但状态暂时无法读取，请重新打开队列确认`, {
				cause: failure,
			})
	}
	async function moveMusicQueueEntryNext(entryId: string): Promise<void> {
		return mutateMusicQueue(
			() =>
				Orpheus.moveMusicQueueEntryNext(
					track?.id ?? '',
					entryId,
					queue.map((item) => item.id),
				),
			'队列已调整',
		)
	}
	async function removeMusicQueueEntry(entryId: string): Promise<void> {
		return mutateMusicQueue(
			() =>
				Orpheus.removeMusicQueueEntry(
					track?.id ?? '',
					entryId,
					queue.map((item) => item.id),
				),
			'条目已移出队列',
			false,
		)
	}
	async function undoMusicQueueRemoval(token: string): Promise<void> {
		return mutateMusicQueue(
			() => Orpheus.undoMusicQueueRemoval(token),
			'移除已撤销',
		)
	}

	const currentIndex = queue.findIndex((item) => item.id === track?.id)
	const playbackOrder = shuffleEntryIds ? 'shuffle' : repeatMode === 1 ? 'repeat-one' : 'sequential'
	const traversal = shuffleEntryIds ?? queue.map((item) => item.id)
	const traversalIndex = traversal.indexOf(track?.id ?? '')
	async function cyclePlaybackOrder() {
		if (!track || mode !== 'music' || fmContext || auditionId || switching || orderPending.current) return
		orderPending.current = true
		setOrderBusy(true)
		try {
			await command(async () => {
				await Orpheus.setMusicPlaybackOrder(
					playbackOrder === 'sequential' ? 'repeat-one' : playbackOrder === 'repeat-one' ? 'shuffle' : 'sequential', track.id,
				)
			})
		} finally {
			orderPending.current = false
			if (alive.current) setOrderBusy(false)
		}
	}
	return {
		track,
		queue,
		currentIndex,
		playbackOrder,
		cyclePlaybackOrder,
		orderBusy,
		canPrevious: traversalIndex >= 0 && (repeatMode !== 0 || traversalIndex > 0),
		canNext: traversalIndex >= 0 && (repeatMode !== 0 || traversalIndex < traversal.length - 1),
		mode,
		auditionId,
		fmContext,
		speed,
		sleepTimer,
		setListeningSleepTimer,
		moveMusicQueueEntryNext,
		removeMusicQueueEntry,
		musicQueueUndo,
		undoMusicQueueRemoval,
		canArrangeMusicQueue:
			mode === 'music' && !fmContext && !auditionId && queueIsSequential,
		canRemoveMusicQueue: mode === 'music' && !fmContext && !auditionId,
		resumePoints,
		playing,
		progress,
		position,
		duration,
		buffering,
		switching,
		error,
		errorCause,
		syncError,
		syncCause,
		canReturnMusic,
		nativePersistenceError,
		playCandidateAudition: (source: Source, preparation: PlaybackPreparation) =>
			operation(
				() => controller.playCandidateAudition(source, preparation),
				preparation,
			),
		endCandidateAudition: (id: string) =>
			operation(() => controller.endCandidateAudition(id)),
		switchMusicPart: (
			source: Source,
			preparation: PlaybackPreparation,
			expectedCurrent?: { entryId: string; sourceId: string },
		) =>
			operation(
				() => controller.switchMusicPart(source, preparation, expectedCurrent),
				preparation,
			),
		playSource: (
			source: Source,
			preparation: PlaybackPreparation,
			targetMode: PlaybackMode = 'music',
			relatedSources?: Source[],
		) =>
			operation(
				() =>
					controller.playSource(
						source,
						preparation,
						targetMode,
						relatedSources,
					),
				preparation,
			),
		playOfflineTrack: (offlineTrack: Track, preparation: PlaybackPreparation) =>
			operation(
				() => controller.playOfflineTrack(offlineTrack, preparation),
				preparation,
			),
		playLocalAudio: (id: string, preparation: PlaybackPreparation) =>
			operation(() => controller.playLocalAudio(id, preparation), preparation),
		playDouyinAudio: (
			items: DouyinAudio[],
			startId: string,
			preparation: PlaybackPreparation,
		) =>
			operation(
				() => controller.playDouyinAudio(items, startId, preparation),
				preparation,
			),
		playPlaylist: (
			entries: { itemId: string; source: MusicLibrarySource }[],
			startItemId: string,
			preparation: PlaybackPreparation,
		) =>
			operation(
				() => controller.playPlaylist(entries, startItemId, preparation),
				preparation,
			),
		playListening: (
			source: Source,
			preparation: PlaybackPreparation,
			relatedSources?: Source[],
		) =>
			operation(
				() =>
					controller.playSource(
						source,
						preparation,
						'listening',
						relatedSources,
					),
				preparation,
			),
		returnToMusic: (preparation: PlaybackPreparation) =>
			operation(() => controller.returnToMusic(preparation), preparation),
		startFm: (sources: Source[], preparation: PlaybackPreparation) =>
			operation(() => controller.startFm(sources, preparation), preparation),
		exitFm: (fmId: string, preparation: PlaybackPreparation) =>
			operation(() => controller.exitFm(fmId, preparation), preparation),
		appendFm,
		reservePlayback,
		isPreparationCurrent: (preparation: PlaybackPreparation) =>
			controller.isPreparationCurrent(preparation),
		cancelPreparation: (preparation: PlaybackPreparation) =>
			controller.cancelPreparation(preparation),
		finishPreparation: (preparation: PlaybackPreparation) =>
			controller.finishPreparation(preparation),
		cancelPending,
		sync,
		toggle: () => command(() => (playing ? Orpheus.pause() : Orpheus.play())),
		next: () => mode === 'music' && !fmContext && !auditionId
			? command(() => Orpheus.skipToNext()) : select('next'),
		previous: () => mode === 'music' && !fmContext && !auditionId
			? command(() => Orpheus.skipToPrevious()) : select('previous'),
		seek: (seconds: number) =>
			command(() =>
				Orpheus.seekTo(
					Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds),
				),
			),
		setSpeed: (value: number) =>
			command(() =>
				Orpheus.setPlaybackSpeed(
					mode === 'music' ? 1 : Math.max(0.1, Math.min(value, 3)),
				),
			),
		retry: () => {
			setError('')
			void command(() => Orpheus.play())
		},
		select,
	}
}
