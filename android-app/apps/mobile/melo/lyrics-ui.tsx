import React, {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'
import { Orpheus } from '@bbplayer/orpheus'
import { BackHandler, Modal, ScrollView, TextInput, View } from 'react-native'

import { getAccountAccess, useAccountAccess } from './account-access'
import type { Library } from './core/database'
import {
	activeLyric,
	defaultLyricsDisplayOptions,
	lyricsIdentity,
	LyricsStore,
	lyricTimeMs,
	readLyricsDisplayOptions,
	reviewLyricsVersion,
	savedLyricsParsed,
	writeLyricsDisplayOptions,
	type LyricsDisplayOptions,
	type SavedLyrics,
} from './lyrics'
import { pickLyrics } from './lyrics-mobile'
import type { OnlineLyricCandidate } from './online-lyrics'
import {
	cacheOnlineLyrics,
	lyricProviderLabels,
	onlineLyricsFailure,
} from './online-lyrics-cache'
import { onlineLyricsService } from './online-lyrics-mobile'
import { lyricCandidateEvidence, lyricSearchTitle, rankLyricCandidates } from './online-lyrics-ranking'
import { PageHeader, SettingsGroup, SettingsRow } from './settings-layout'
import { Button, ControlTarget, T, useTheme, useThemeRendering } from './ui'
import type { PlaybackProgress } from './playback-progress'

export function pushSavedLyricsToNative(saved: SavedLyrics | null): void {
	try {
		if (!saved) {
			void Orpheus.clearOverlays().catch(() => {})
			return
		}
		const parsed = savedLyricsParsed(saved)
		if (!parsed.timed) return
		const adjustmentSeconds = (saved.offsetMs - parsed.fileOffsetMs) / 1000
		void Orpheus.setLyrics({
			lyrics: parsed.lines
				.filter((line) => line.atMs !== null)
				.map((line) => ({
					timestamp: Math.max(0, line.atMs! / 1000 + adjustmentSeconds),
					endTime:
						line.endMs !== undefined && line.endMs !== null
							? Math.max(0, line.endMs / 1000 + adjustmentSeconds)
							: undefined,
					text: line.text,
					translation: line.translation,
					romaji: line.romaji,
				})),
			offset: 0,
		}).catch(() => {})
	} catch {
		/* Best-effort sync to native floating/status-bar/car lyrics. */
	}
}

export function useAutoSyncTrackLyrics(
	library: Pick<Library, 'setting' | 'setSetting'>,
	track: {
		id: string
		sourceId?: string
		title?: string
		artist?: string
		duration?: number
	} | null,
): void {
	const { onlineAllowed } = useAccountAccess()
	const store = useMemo(() => new LyricsStore(library), [library])
	const sourceId = track?.sourceId ?? track?.id ?? ''
	const title = track?.title ?? ''
	const artist = track?.artist ?? ''
	const duration = track?.duration ?? 0

	useEffect(() => {
		if (!sourceId || !lyricsIdentity(sourceId)) return
		let existing: SavedLyrics | null = null
		try {
			existing = store.get(sourceId)
		} catch {
			existing = null
		}
		if (existing) {
			pushSavedLyricsToNative(existing)
			return
		}
		void Orpheus.clearOverlays().catch(() => {})
		if (!onlineAllowed || !title.trim()) return

		const controller = new AbortController()
		void onlineLyricsService
			.match(
				{
					sourceId,
					title,
					performer: artist ? artist.replace(/^UP · /, '') : null,
					durationSeconds: duration,
				},
				{ signal: controller.signal },
			)
			.then((result) => {
				if (controller.signal.aborted || result.sourceId !== sourceId) return
				const cached = cacheOnlineLyrics(result)
				store.save(cached)
				pushSavedLyricsToNative(cached)
			})
			.catch(() => {
				/* Ignore background auto-match miss; user can search manually in LyricsReader. */
			})
		return () => controller.abort()
	}, [store, sourceId, title, artist, duration, onlineAllowed])
}

const noProgressSubscription = () => () => {}

/** A reading section of the existing player, never a second playback controller. */
export function LyricsReader({
	library,
	sourceId,
	title,
	performer,
	uploader,
	position: fallbackPosition,
	progress,
	duration,
	onSeek,
	onClose,
	height,
	bottomInset = 0,
}: {
	library: Pick<Library, 'setting' | 'setSetting'>
	sourceId: string
	title: string
	performer?: string | null
	uploader?: string | null
	position: number
	progress?: PlaybackProgress
	duration: number
	height: number
	bottomInset?: number
	onClose: () => void
	onSeek: (seconds: number) => void
}) {
	const { onlineAllowed, sessionGeneration } = useAccountAccess()
	const theme = useTheme()
	const rendering = useThemeRendering()
	const store = useMemo(() => new LyricsStore(library), [library])
	const [display, setDisplay] = useState<LyricsDisplayOptions>(() => {
		try {
			return readLyricsDisplayOptions(library)
		} catch {
			return { ...defaultLyricsDisplayOptions }
		}
	})
	const [displayError, setDisplayError] = useState('')
	const toggleDisplay = useCallback(
		(part: keyof LyricsDisplayOptions) => {
			const next = { ...display, [part]: !display[part] }
			try {
				writeLyricsDisplayOptions(library, next)
				setDisplay(next)
				setDisplayError('')
			} catch {
				setDisplayError('歌词显示设置保存失败，原选项已保留。')
			}
		},
		[library, display],
	)
	const [query, setQuery] = useState(() => lyricSearchTitle(title))
	const [candidates, setCandidates] = useState<OnlineLyricCandidate[]>([])
	const [onlineStatus, setOnlineStatus] = useState('')
	const [onlineBusy, setOnlineBusy] = useState(false)
	const onlineRequest = useRef<AbortController | null>(null)
	const onlineRevision = useRef(0)
	const cancelOnline = useCallback(() => {
		onlineRequest.current?.abort()
		onlineRequest.current = null
		onlineRevision.current++
	}, [])
	const [toolsOpen, setToolsOpen] = useState(false)
	const [toolPage, setToolPage] = useState<'home' | 'search' | 'display' | 'timing'>('home')
	const [saved, setSaved] = useState<SavedLyrics | null>(null)
	const [pending, setPending] = useState<SavedLyrics | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [following, setFollowing] = useState(true)
	const scroll = useRef<ScrollView>(null)
	const positions = useRef<Record<number, number>>({})
	const mounted = useRef(true)
	const picking = useRef(false)
	const revision = useRef(0)
	const identity = useRef(sourceId)
	const pendingRef = useRef<SavedLyrics | null>(null)
	const pendingAccountGeneration = useRef<number | null>(null)
	const invalidateRequest = useCallback(() => {
		cancelOnline()
		revision.current++
		picking.current = false
		pendingRef.current = null
		pendingAccountGeneration.current = null
	}, [cancelOnline])
	const invalidate = useCallback(() => {
		invalidateRequest()
		setPending(null)
		setBusy(false)
		setError('')
		setOnlineBusy(false)
		setOnlineStatus('')
	}, [invalidateRequest])
	useEffect(() => {
		if (pendingAccountGeneration.current !== null &&
			(!onlineAllowed || pendingAccountGeneration.current !== sessionGeneration)) {
			pendingRef.current = null
			pendingAccountGeneration.current = null
			setPending(null)
		}
	}, [onlineAllowed, sessionGeneration])
	const dismiss = useCallback(() => {
		invalidate()
		onClose()
	}, [invalidate, onClose])
	const back = useCallback(() => {
		invalidate()
		if (pending) return
		if (toolPage !== 'home') setToolPage('home')
		else setToolsOpen(false)
	}, [invalidate, pending, toolPage])
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			invalidateRequest()
		}
	}, [invalidateRequest])
	useLayoutEffect(() => {
		identity.current = sourceId
		invalidate()
		setSaved(null)
		setToolsOpen(false)
		setToolPage('home')
		setFollowing(true)
		setCandidates([])
		setOnlineStatus('')
		positions.current = {}
		try {
			setSaved(store.get(sourceId))
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : '读取歌词失败')
		}
	}, [store, sourceId, invalidate])
	useEffect(() => {
		const subscription = BackHandler.addEventListener(
			'hardwareBackPress',
			() => {
				if (pending || toolsOpen) back()
				else dismiss()
				return true
			},
		)
		return () => subscription.remove()
	}, [toolsOpen, pending, back, dismiss])
	useEffect(() => {
		setQuery(lyricSearchTitle(title))
	}, [sourceId, title])
	const runOnline = useCallback(
		async (
			mode: 'auto' | 'search' | 'load',
			candidate?: OnlineLyricCandidate,
		) => {
			if (
				!mounted.current ||
				!lyricsIdentity(sourceId) ||
				identity.current !== sourceId
			)
				return
			const access = getAccountAccess()
			if (!access.onlineAllowed) { setOnlineStatus('离线模式：可读取已保存歌词，联网后再搜索。'); return }
			cancelOnline()
			revision.current++
			picking.current = false
			pendingRef.current = null
			setPending(null)
			const controller = new AbortController()
			onlineRequest.current = controller
			const request = ++onlineRevision.current
			const isCurrent = () =>
				mounted.current &&
				identity.current === sourceId &&
				!controller.signal.aborted &&
				onlineRevision.current === request &&
				getAccountAccess().onlineAllowed && getAccountAccess().sessionGeneration === access.sessionGeneration
			setOnlineBusy(true)
			setOnlineStatus(mode === 'search' ? '正在搜索歌词…' : '正在匹配歌词…')
			try {
				if (mode === 'search') {
					const result = await onlineLyricsService.search(query, {
						signal: controller.signal,
					})
					if (!isCurrent()) return
					setCandidates(rankLyricCandidates(result.candidates, { sourceId, title: query, performer, durationSeconds: duration }).map((item) => item.candidate))
					setOnlineStatus(
						result.candidates.length
							? '请选择演唱版本；自动匹配不保证准确。'
							: '未找到匹配歌词，请调整歌名。',
					)
					if (result.unavailable.length)
						setOnlineStatus((current) => current + ' 部分歌词来源暂不可用。')
				} else {
					const result =
						mode === 'load' && candidate
							? await onlineLyricsService.load(sourceId, candidate, {
									signal: controller.signal,
								})
							: await onlineLyricsService.match(
									{ sourceId, title, performer, durationSeconds: duration },
									{ signal: controller.signal },
								)
					if (!isCurrent() || result.sourceId !== sourceId) return
					const value = cacheOnlineLyrics(result)
					if (mode === 'load') {
						pendingRef.current = value
						pendingAccountGeneration.current = access.sessionGeneration
						setPending(value)
						setToolsOpen(true)
						setOnlineStatus('核对歌词与演唱版本后确认；原歌词暂时保留。')
						return
					}
					store.save(value)
					setSaved(value)
					setCandidates([])
					setFollowing(true)
					setOnlineStatus(
						`${lyricProviderLabels[result.candidate.source]}，${mode === 'auto' ? '自动匹配，可搜索更正版本' : '已关联当前音源'}`,
					)
				}
			} catch (cause) {
				if (isCurrent()) setOnlineStatus(onlineLyricsFailure(cause))
			} finally {
				if (isCurrent()) setOnlineBusy(false)
			}
		},
		[sourceId, title, performer, duration, query, store, cancelOnline],
	)
	const autoRequest = useRef(runOnline)
	useLayoutEffect(() => { autoRequest.current = runOnline }, [runOnline])
	useEffect(() => {
		try {
			if (!onlineAllowed) {setOnlineBusy(false);setOnlineStatus('离线模式：可读取已保存歌词，联网后再搜索。')}
			else if (!store.get(sourceId)) void autoRequest.current('auto')
		} catch {
			/* The reading error remains visible; search can replace it. */
		}
		return cancelOnline
	}, [sourceId, store, cancelOnline, onlineAllowed, sessionGeneration])
	const parsed = useMemo(
		() => (saved ? savedLyricsParsed(saved) : null),
		[saved],
	)
	const lyricOffset = saved?.offsetMs ?? 0
	useEffect(() => {
		if (saved) pushSavedLyricsToNative(saved)
	}, [saved])
	const activeSnapshot = useCallback(
		() => parsed
			? activeLyric(parsed, (progress?.getSnapshot().position ?? fallbackPosition) * 1000, lyricOffset)
			: -1,
		[parsed, progress, fallbackPosition, lyricOffset],
	)
	// Subscribe to the highlighted line, so progress ticks inside one verse do
	// not rebuild every lyric row. Seeks and timing adjustments still update it.
	const active = useSyncExternalStore(progress?.subscribe ?? noProgressSubscription, activeSnapshot)
	const follow = useCallback(() => {
		if (active >= 0 && positions.current[active] !== undefined)
			scroll.current?.scrollTo({
				y: Math.max(0, positions.current[active] - 80),
				animated: true,
			})
	}, [active])
	useEffect(() => {
		if (following && !toolsOpen) follow()
	}, [follow, toolsOpen, following])
	const persist = (value: SavedLyrics, confirmation = false) => {
		if (!mounted.current || value.sourceId !== identity.current) return
		if (confirmation && pendingRef.current !== value) return
		if (confirmation && value.online) {
			const access = getAccountAccess()
			if (!access.onlineAllowed || access.sessionGeneration !== pendingAccountGeneration.current) {
				pendingRef.current = null
				pendingAccountGeneration.current = null
				setPending(null)
				setError('账号状态已变化，请联网核验后重新选择歌词。原歌词已保留。')
				return
			}
		}
		if (confirmation) pendingRef.current = null
		try {
			store.save(value)
			setSaved(value)
			if (pending) setToolsOpen(false)
			setPending(null)
			setFollowing(true)
			setError('')
			if (confirmation && value.online) {
				setCandidates([])
				setOnlineStatus(`${lyricProviderLabels[value.online.provider]}，已关联当前音源`)
			}
		} catch (cause) {
			if (confirmation) pendingRef.current = value
			setError(cause instanceof Error ? cause.message : '保存失败，请重试')
		}
	}
	const choose = async () => {
		if (picking.current || !mounted.current || identity.current !== sourceId)
			return
		cancelOnline()
		setOnlineBusy(false)
		picking.current = true
		const request = ++revision.current
		const isCurrent = () =>
			mounted.current &&
			revision.current === request &&
			identity.current === sourceId
		pendingRef.current = null
		pendingAccountGeneration.current = null
		setPending(null)
		setBusy(true)
		setError('')
		try {
			const picked = await pickLyrics()
			if (picked && isCurrent()) {
				const candidate: SavedLyrics = {
					version: 1,
					sourceId,
					...picked,
					importedAt: Date.now(),
					offsetMs: 0,
				}
				pendingRef.current = candidate
				setPending(candidate)
			}
		} catch (cause) {
			if (isCurrent())
				setError(cause instanceof Error ? cause.message : '导入失败，请重试')
		} finally {
			if (isCurrent()) {
				picking.current = false
				setBusy(false)
			}
		}
	}
	const review = useMemo(
		() => (pending ? reviewLyricsVersion({ title, performer }, pending) : null),
		[pending, title, performer],
	)
	const preview = review?.parsed
	return (
		<View
			testID='player-lyrics-region'
			style={{ height, marginTop: 8, marginBottom: 24, gap: 8 }}
		>
			<View
				style={{
					flexDirection: 'row',
					alignItems: 'center',
					justifyContent: 'space-between',
				}}
			>
				<ControlTarget
					accessibilityRole='button'
					accessibilityLabel='返回封面'
					onPress={dismiss}
					style={{ minHeight: 48, justifyContent: 'center' }}
				>
					<T
						muted
						size={12}
					>
						‹ 封面
					</T>
				</ControlTarget>
				<T
					muted
					size={12}
				>
					{parsed?.timed ? '同步歌词' : '歌词'}
				</T>
				<ControlTarget
					accessibilityRole='button'
					accessibilityLabel='歌词版本与设置'
					onPress={() => { setToolPage('home'); setToolsOpen(true) }}
					style={{
						minWidth: 48,
						minHeight: 48,
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<T size={22}>⋯</T>
				</ControlTarget>
			</View>
			{!toolsOpen && !!onlineStatus && !saved && <T muted size={12}>{onlineStatus}</T>}
			{parsed && saved ? (
				<ScrollView
					ref={scroll}
					nestedScrollEnabled
					onScrollBeginDrag={() => setFollowing(false)}
					style={{ flex: 1 }}
					contentContainerStyle={{ paddingVertical: 60, gap: 12 }}
				>
					{parsed.lines.map((line, index) => {
						const at = lyricTimeMs(line, parsed, saved.offsetMs)
						const seekable =
							parsed.timed &&
							at !== null &&
							duration > 0 &&
							at <= duration * 1000
						return (
							<View
								// Imported lines never reorder; duplicate text and timestamps are legitimate.
								// oxlint-disable-next-line react/no-array-index-key
								key={index}
								// Measure in scroll-content space, outside theme control wrappers.
								onLayout={(event) => {
									positions.current[index] = event.nativeEvent.layout.y
									if (index === active && following && !toolsOpen) follow()
								}}
							>
								<ControlTarget
									accessibilityRole='button'
									accessibilityLabel={
										seekable
											? `点击返回封面，长按跳到 ${(at / 1000).toFixed(1)} 秒：${line.text || '间奏'}`
											: `点击返回封面：${line.text || '间奏'}`
									}
									onPress={dismiss}
									onLongPress={() => {
										if (seekable) onSeek(at / 1000)
									}}
									style={{
										minHeight: 48,
										justifyContent: 'center',
										paddingHorizontal: 8,
									}}
								>
									<T
										size={index === active ? 20 : 17}
										weight={index === active ? '700' : '400'}
										style={{
											textAlign: 'center',
											color:
												index === active
													? (rendering?.lyricTokens.active ??
														theme.tokens.action.primary)
													: (rendering?.lyricTokens.inactive ??
														theme.tokens.text.secondary),
										}}
									>
										{line.text || '♪'}
									</T>
									{display.translation && !!line.translation?.trim() && (
										<T
											muted
											size={12}
											style={{ textAlign: 'center' }}
										>
											{line.translation}
										</T>
									)}
									{display.romaji && !!line.romaji?.trim() && (
										<T
											muted
											size={11}
											style={{ textAlign: 'center' }}
										>
											{line.romaji}
										</T>
									)}
								</ControlTarget>
							</View>
						)
					})}
				</ScrollView>
			) : (
				<ControlTarget
					accessibilityRole='button'
					accessibilityLabel='点击歌词区域返回封面'
					onPress={dismiss}
					style={{
						flex: 1,
						minHeight: 48,
						justifyContent: 'center',
						alignItems: 'center',
						gap: 16,
					}}
				>
					<T
						muted
						size={14}
					>
						{onlineBusy ? '正在获取歌词…' : '还没有匹配歌词'}
					</T>
					<ControlTarget
						accessibilityRole='button'
						accessibilityLabel='重新匹配歌词'
						onPress={() => {
							void runOnline('auto')
						}}
						style={{ minHeight: 48, justifyContent: 'center' }}
					>
						<T
							size={13}
							style={{ color: theme.tokens.action.primary }}
						>
							重新自动匹配
						</T>
					</ControlTarget>
				</ControlTarget>
			)}
			{parsed && !parsed.timed && (
				<T
					muted
					size={11}
					style={{ textAlign: 'center' }}
				>
					全文歌词，无完整时间戳，不进行同步或跳转
				</T>
			)}
			{parsed?.timed && !following && (
				<ControlTarget
					accessibilityRole='button'
					accessibilityLabel='回到当前'
					onPress={() => {
						setFollowing(true)
						follow()
					}}
					style={{
						minHeight: 48,
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<T
						size={12}
						style={{ color: theme.tokens.action.primary }}
					>
						回到当前 ↓
					</T>
				</ControlTarget>
			)}
			<Modal
				visible={toolsOpen}
				transparent
				animationType='none'
				onRequestClose={back}
			>
				<View
					style={{
						flex: 1,
						justifyContent: 'flex-end',
						backgroundColor: '#00000066',
					}}
				>
					<View
						accessibilityViewIsModal
						style={{
							backgroundColor: theme.tokens.surface.card,
							borderTopLeftRadius: 24,
							borderTopRightRadius: 24,
							padding: 24,
							paddingBottom: bottomInset + 24,
							maxHeight: '85%',
							...(toolPage === 'search' || pending ? { height: '85%' as const } : {}),
							gap: 12,
						}}
					>
						<PageHeader title={pending ? '核对歌词版本' : toolPage === 'search' ? '搜索歌词' : toolPage === 'display' ? '歌词显示' : toolPage === 'timing' ? '调整歌词时间' : '歌词版本与设置'} onBack={back} backLabel='返回歌词上一级' />
						<ScrollView
							key={pending ? 'review' : toolPage}
							keyboardShouldPersistTaps='handled'
							style={{ flexShrink: 1, marginRight: -16 }}
							contentContainerStyle={{ gap: 12, paddingRight: 16 }}
						>

							{pending && preview ? (
								<>
									<T size={13}>{title}</T>
									<T muted size={12}>演唱者：{performer?.trim() || '未知'}</T>
									{!!uploader?.trim() && <T muted size={12}>UP 主：{uploader}（不等同于演唱者）</T>}
									<T size={13}>{pending.online ? '候选歌词' : '候选文件'}，{pending.filename}</T>
									<T
										muted
										size={12}
									>
										当前版本标注，{review?.currentHints.join('、') || '未标注'}
									</T>
									<T
										muted
										size={12}
									>
										候选版本标注，{' '}
										{review?.candidateHints.join('、') || '未标注'}
									</T>
									<T
										muted
										size={12}
									>
										{preview.title || '文件未标注曲名'}，{' '}
										{preview.artist || '未标注演唱者'}
									</T>
									{review?.warnings.map((warning) => (
										<T
											key={warning}
											size={12}
										>
											{warning}
										</T>
									))}
									<T
										muted
										size={12}
									>
										以上仅为来源标注；即使名称相同，也请试听并核对时间轴。
									</T>
									<T size={13}>
										{preview.lines
											.slice(0, 8)
											.map((line) => line.text)
											.join('\n')}
									</T>
									<T
										muted
										size={12}
									>
										请核对演唱、翻唱或现场版本。确认后
										{saved ? '替换此音源的歌词与偏移' : '仅关联此音源'}
										，不自动匹配同名歌曲。
									</T>
									{!pending.online && <Button
										secondary
										onPress={() => {
											void choose()
										}}
									>
										选择其他歌词文件
									</Button>}
								</>
							) : (
								<>
									{toolPage === 'search' && <>
			<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
				<TextInput
					testID='lyrics-song-search'
					accessibilityLabel='搜索歌词歌名'
					placeholder='搜索歌名，纠正歌词版本'
					placeholderTextColor={theme.tokens.text.secondary}
					selectionColor={theme.tokens.action.primary}
					cursorColor={theme.tokens.action.primary}
					value={query}
					onChangeText={(value) => {
						cancelOnline()
						setOnlineBusy(false)
						setCandidates([])
						setOnlineStatus('')
						setQuery(value)
					}}
					onSubmitEditing={() => {
						void runOnline('search')
					}}
					returnKeyType='search'
					style={{ flex: 1, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.tokens.border.subtle, borderRadius: 12, color: theme.tokens.text.primary, backgroundColor: theme.tokens.surface.base }}
				/>
				<Button
					secondary
					disabled={!onlineAllowed || !query.trim() || busy}
					onPress={() => {
						void runOnline('search')
					}}
				>
					搜索歌词
				</Button>
			</View>
			{!!onlineStatus && (
				<T
					muted
					size={11}
				>
					{onlineStatus}
				</T>
			)}
			{!!candidates.length && (
				<View style={{ gap: 8 }}>
					{candidates.map((candidate, index) => (
						<ControlTarget
							key={`${candidate.source}:${candidate.remoteId}`}
							accessibilityRole='button'
							accessibilityLabel={`选择歌词 ${candidate.title} ${candidate.artist} ${lyricProviderLabels[candidate.source]}，${Math.floor(candidate.duration / 60)}:${String(Math.floor(candidate.duration % 60)).padStart(2, '0')}，候选 ${index + 1}`}
							onPress={() => {
								void runOnline('load', candidate)
							}}
							style={{ minHeight: 48, justifyContent: 'center' }}
						>
							<T size={13}>
								{candidate.title}，{candidate.artist || '未知演唱者'}
							</T>
							<T
								muted
								size={11}
							>
								{lyricProviderLabels[candidate.source]}，{' '}
								{Math.floor(candidate.duration / 60)}:
								{String(Math.floor(candidate.duration % 60)).padStart(2, '0')}
									{lyricCandidateEvidence(candidate, { sourceId, title, performer, durationSeconds: duration }).warnings.length ? `，${lyricCandidateEvidence(candidate, { sourceId, title, performer, durationSeconds: duration }).warnings.join('，')}` : ''}
							</T>
						</ControlTarget>
					))}
				</View>
			)}</>}
									{toolPage === 'home' && <SettingsGroup>
										<T muted size={13} style={{ paddingVertical: 12 }}>{title}</T>
										<SettingsRow label='搜索歌词' onPress={() => setToolPage('search')} />
										<SettingsRow label='歌词显示' onPress={() => setToolPage('display')} />
										{saved && parsed?.timed && <SettingsRow label='调整歌词时间' onPress={() => setToolPage('timing')} />}
										<SettingsRow label='导入本地歌词（可选）' disabled={busy || !lyricsIdentity(sourceId)} onPress={() => { void choose() }} />
									</SettingsGroup>}
									{toolPage === 'display' && <>
									<ControlTarget
										accessibilityRole='switch'
										accessibilityLabel='显示歌词翻译'
										accessibilityState={{ checked: display.translation }}
										onPress={() => toggleDisplay('translation')}
										style={{
											minHeight: 48,
											paddingHorizontal: 12,
											flexDirection: 'row',
											alignItems: 'center',
											justifyContent: 'space-between',
											gap: 8,
											borderWidth: 1,
											borderColor: theme.tokens.text.secondary,
											borderRadius: 12,
										}}
									>
										<T size={13}>显示翻译</T>
										<T muted size={12}>{display.translation ? '开启' : '关闭'}</T>
									</ControlTarget>
									<ControlTarget
										accessibilityRole='switch'
										accessibilityLabel='显示歌词罗马音'
										accessibilityState={{ checked: display.romaji }}
										onPress={() => toggleDisplay('romaji')}
										style={{
											minHeight: 48,
											paddingHorizontal: 12,
											flexDirection: 'row',
											alignItems: 'center',
											justifyContent: 'space-between',
											gap: 8,
											borderWidth: 1,
											borderColor: theme.tokens.text.secondary,
											borderRadius: 12,
										}}
									>
										<T size={13}>显示罗马音</T>
										<T muted size={12}>{display.romaji ? '开启' : '关闭'}</T>
									</ControlTarget>
									<T muted size={11}>
										原文始终显示；只展示歌词来源提供的翻译或罗马音，没有对应数据时不生成。
									</T>
									{parsed && (
										<T muted size={11}>
											本曲：{parsed.lines.some((line) => !!line.translation?.trim()) ? '有翻译' : '暂无翻译'}，{' '}
											{parsed.lines.some((line) => !!line.romaji?.trim()) ? '有罗马音' : '暂无罗马音'}
										</T>
									)}
									{!!displayError && (
										<T size={12} style={{ color: theme.tokens.state.error }}>
											{displayError}
										</T>
									)}
									</>}
									{toolPage === 'timing' && saved && parsed ? (
										<>
											<T
												muted
												size={12}
											>
												{saved.online
													? `在线歌词，${lyricProviderLabels[saved.online.provider]}`
													: '本机文件'}{' '}
												，{saved.filename}
												{parsed.title ? `，${parsed.title}` : ''}
												{parsed.artist ? ` / ${parsed.artist}` : ''}
											</T>
											{parsed.timed && (
												<>
													<T
														muted
														size={12}
													>
														时间偏移 {saved.offsetMs > 0 ? '+' : ''}
														{(saved.offsetMs / 1000).toFixed(1)} 秒，
														正值延后歌词，只保存到当前音源
													</T>
													<View
														style={{
															flexDirection: 'row',
															flexWrap: 'wrap',
															gap: 8,
														}}
													>
														<Button
															secondary
															disabled={saved.offsetMs <= -600000}
															onPress={() =>
																persist({
																	...saved,
																	offsetMs: saved.offsetMs - 500,
																})
															}
														>
															提前 0.5 秒
														</Button>
														<Button
															secondary
															disabled={saved.offsetMs >= 600000}
															onPress={() =>
																persist({
																	...saved,
																	offsetMs: saved.offsetMs + 500,
																})
															}
														>
															延后 0.5 秒
														</Button>
														<Button
															secondary
															disabled={saved.offsetMs === 0}
															onPress={() => persist({ ...saved, offsetMs: 0 })}
														>
															重置偏移
														</Button>
													</View>
												</>
											)}
										</>
									) : null}
								</>
							)}
							{!pending && !!error && (
								<T
									size={12}
									style={{ color: theme.tokens.state.error }}
								>
									{error}
								</T>
							)}
						</ScrollView>
						{pending && <View testID='lyrics-review-actions' style={{ gap: 8, paddingTop: 12 }}>
							{!!error && <View accessibilityLiveRegion='polite'><T size={12} style={{ color: theme.tokens.state.error }}>{error}</T></View>}
							<Button testID='lyrics-confirm-candidate' onPress={() => persist(pending, true)}>确认用于当前音源</Button>
							<Button secondary testID='lyrics-cancel-candidate' onPress={invalidate}>取消，不更改</Button>
						</View>}
					</View>
				</View>
			</Modal>
		</View>
	)
}
