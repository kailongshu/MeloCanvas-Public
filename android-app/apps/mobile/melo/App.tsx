import { CandidateAuditionPanel } from './candidate-audition-ui'
import { AccountSignOut } from './account-settings-ui'
import { ProfileAvatar } from './profile-avatar'
import { useAppearance } from './useAppearance'
import { AppearanceSetting } from './appearance-ui'
import { StartupContent } from './startup-ui'
import { themeAppearance } from './core/theme-appearance'
import { Orpheus } from '@bbplayer/orpheus'
import Constants from 'expo-constants'
import { openDatabaseSync } from 'expo-sqlite'
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'
import {
	AccessibilityInfo,
	AppState,
	BackHandler,
	FlatList,
	Keyboard,
	Linking,
	Modal,
	Pressable,
	ScrollView,
	StatusBar,
	StyleSheet,
	View,
} from 'react-native'
import {
	SafeAreaProvider,
	initialWindowMetrics,
	useSafeAreaInsets,
} from 'react-native-safe-area-context'

import { AccountFollowingSession } from './account-following-session'
import { AccountFollowingPage } from './account-following-ui'
import { accountSession } from './account-runtime'
import { accountTheme } from './account-theme'
import {
	HomeHeader,
	HomeShortcuts,
	HomeSearchEntry,
	HomeDiscoveryTabs,
	HomeMusicHero,
	HomeLocalFeatures,
	ReducedMotionSetting,
	AppQueueItem,
} from './app-controls'
import { AuthorSupportEntry } from './author-support-ui'
import { search as searchBilibili, sourceDetails } from './bilibili'
import { discoverHeart } from './heart-discovery'
import { BilibiliImportPage } from './bilibili-import-ui'
import {
	type BilibiliPreviewAction,
	type PreviewPlayerIdentity,
} from './bilibili-preview-session'
import { BilibiliContentScopeReader } from './core/bilibili-content-scope'
import { CreatorPostCache } from './core/creator-post-cache'
import { CreatorStore } from './core/creators'
import type { Creator } from './core/creators'
import { Library, migrate } from './core/database'
import { FollowingFeedStore } from './core/following-feed'
import { ImportStore } from './core/imports'
import { ListeningLibrary } from './core/listening'
import {
	DouyinAudioStore,
	isDouyinAudioId,
	type DouyinAudio,
} from './core/douyin-audio'
import { LocalAudioStore } from './core/local-audio'
import type { SearchItem, Source } from './core/model'
import {
	douyinLibrarySource,
	isDouyinLibrarySource,
	localLibrarySource,
	isLocalLibrarySource,
	type MusicLibrarySource,
} from './core/music-library-source'
import {
	MusicPreferencesStore,
	emptyMusicPreferences,
} from './core/music-preferences'
import { PlaylistStore } from './core/playlists'
import { RecommendationStore } from './core/recommendations'
import { SessionStore } from './core/sessions'
import type { ThemeKey } from './core/theme'
import { VideoCatalog } from './core/video-catalog'
import { VideoSaves } from './core/video-saves'
import type { CreatorPostCandidate } from './creator-api'
import { resolveCreatorPost, verifyCreatorPost } from './creator-post-selection'
import { CreatorPostsRead, CreatorProfileRead } from './creator-remote-ui'
import {
	creatorSearchMid,
	creatorSearchTarget,
} from './creator-search-selection'
import { CreatorOverlay } from './creator-ui'
import { FmPage } from './fm-ui'
import { FollowingFeedPage } from './following-feed-ui'
import { HostPlaybackFooter, type HostTab as Tab } from './host-controls'
import { ImportPage } from './import-ui'
import { LibraryBackupEntry } from './library-backup-ui'
import { CollectionMenu, CollectionSongRow } from './library-collection-ui'
import { LibraryPage, type LibraryCollection } from './library-ui'
import { playLikedCollection } from './liked-playback'
import { ListeningLibraryPage } from './listening-library-ui'
import {
	ListeningHome,
	ListeningPlayer,
	ListeningUnavailable,
	type ListeningResume,
} from './listening-ui'
import {
	douyinSession,
	isDouyinShareInput,
	useDouyinSession,
} from './douyin-session'
import {
	DouyinCollectionModal,
	DouyinLoginModal,
	DouyinSearchSection,
} from './douyin-ui'
import { useAutoSyncTrackLyrics } from './lyrics-ui'
import { LocalAudioSection } from './local-audio-ui'
import { MusicPartsPanel, type MusicPartsIdentity } from './music-parts-ui'
import {
	MusicPreferencesDialog,
	PreferenceDiscovery,
} from './music-preferences-ui'
import { MusicQueue } from './music-queue-ui'
import { MusicPlayer, SongRow } from './music-ui'
import { OfflineManager } from './offline-ui'
import { PageScrollHost } from './page-scroll-host'
import {
	PlaybackIntent,
	playMusicIntent,
	type PlaybackRequest,
} from './playback-intent'
import { readPlaybackMetadata } from './playback-metadata'
import { PlaybackNetworkSetting } from './playback-network-ui'
import { usePlayer } from './player'
import { bindPlayerDeepLinks } from './player-deep-link'
import { preparePlaylistPlayback } from './playlist-selection'
import { PlaylistDialogs, PlaylistSourceActions } from './playlist-ui'
import { PrivacyDataEntry } from './privacy-data-ui'
import { RecentMusicSection } from './recent-music-ui'
import { RecommendationPage } from './recommendation-ui'
import { SearchPage } from './search-ui'
import { SettingsGroup, SettingsRow } from './settings-layout'
import { explainPlaybackNotifications, enablePlaybackNotifications, openPlaybackNotificationSettings, showPlaybackNotificationHelp } from './playback-notifications'
import { ThemeLayoutGate } from './theme-layout-gate'
import { ThemeLayoutProbe } from './theme-layout-probe'
import { ThemePackagePanel } from './theme-package-panel'
import { ThemeWorkshop } from './theme-workshop'
import { themeWorkshopBusy } from './theme-workshop-session'
import {
	Backdrop,
	ThemePageArtwork,
	Button,
	Card,
	IconButton,
	State,
	T,
	ThemeRendererProvider,
	time,
} from './ui'
import { useFm } from './use-fm'
import { useBilibiliImports } from './useBilibiliImports'
import { useCreators } from './useCreators'
import { useCreatorSearch } from './useCreatorSearch'
import { useFollowingFeed } from './useFollowingFeed'
import { useImports } from './useImports'
import { useListening } from './useListening'
import { useListeningLibrary } from './useListeningLibrary'
import { usePlaylists } from './usePlaylists'
import { useRecommendations } from './useRecommendations'
import { useSearch } from './useSearch'
import { useSearchHistory } from './useSearchHistory'
import { useThemeCandidateLayout } from './useThemeCandidateLayout'
import {
	useThemeCurrentLayout,
	withCurrentLayoutRestore,
} from './useThemeCurrentLayout'
import { useThemeWorkshop } from './useThemeWorkshop'

type Sheet = 'themes' | 'queue' | 'source' | 'parts' | null
const appVersion =
	Constants.expoConfig?.version ??
	'版本信息暂不可用'

async function resolveSource(
	item: SearchItem | Source,
	signal?: AbortSignal,
): Promise<Source> {
	if ('cid' in item) return item
	return sourceDetails(item.bvid, signal)
}
async function readNativePlayerIdentity(): Promise<PreviewPlayerIdentity> {
	const actual = await Orpheus.getPlaybackSnapshot()
	return {
		mode: actual.mode,
		sourceId: actual.currentSourceId,
		entryId: actual.currentEntryId,
	}
}


export default function App({
	accountName = 'B 站账号',
	accountId,
	accountAvatar,
	onSignOut,
	onRequestBilibiliLogin,
	onReconnect,
}: {
	accountName?: string
	accountId?: string
	accountAvatar?: string
	onSignOut?: () => void
	onReconnect?: () => void
	onRequestBilibiliLogin?: () => void
} = {}) {
	const [result] = useState(() => {
		try {
			const db = openDatabaseSync('melocanvas.db', { useNewConnection: true })
			migrate(db)
			return {
				library: new Library(db),
				listeningLibrary: new ListeningLibrary(db),
				sessionStore: new SessionStore(db),
				localAudioStore: new LocalAudioStore(db),
				douyinAudioStore: new DouyinAudioStore(db),
				playlistStore: new PlaylistStore(db),
				creatorStore: new CreatorStore(db),
				creatorPostCache: new CreatorPostCache(db),
				creatorPostScopes: new BilibiliContentScopeReader(db),
				followingFeedStore: new FollowingFeedStore(db),
				importStore: new ImportStore(db),
				videoCatalog: new VideoCatalog(db),
				videoSaves: new VideoSaves(db),
				recommendationStore: new RecommendationStore(db, () => new Date()),
				musicPreferencesStore: new MusicPreferencesStore(db),
				error: '',
			}
		} catch (error) {
			return {
				library: null,
				listeningLibrary: null,
				sessionStore: null,
				localAudioStore: null,
				douyinAudioStore: null,
				playlistStore: null,
				creatorStore: null,
				creatorPostCache: null,
				creatorPostScopes: null,
				followingFeedStore: null,
				importStore: null,
				videoCatalog: null,
				videoSaves: null,
				recommendationStore: null,
				musicPreferencesStore: null,
				error: error instanceof Error ? error.message : '数据库初始化失败',
			}
		}
	})
	return (
		<SafeAreaProvider initialMetrics={initialWindowMetrics}>
			{result.library &&
			result.listeningLibrary &&
			result.sessionStore &&
			result.localAudioStore &&
			result.douyinAudioStore &&
			result.playlistStore &&
			result.creatorStore &&
			result.creatorPostCache &&
			result.creatorPostScopes &&
			result.followingFeedStore &&
			result.importStore &&
			result.videoCatalog &&
			result.videoSaves &&
			result.recommendationStore &&
			result.musicPreferencesStore ? (
				<Product
					accountName={accountName}
					accountId={accountId}
					accountAvatar={accountAvatar}
					onSignOut={onSignOut}
					onReconnect={onReconnect}
					onRequestBilibiliLogin={onRequestBilibiliLogin}
					library={result.library}
					listeningLibrary={result.listeningLibrary}
					sessionStore={result.sessionStore}
					localAudioStore={result.localAudioStore}
					douyinAudioStore={result.douyinAudioStore}
					playlistStore={result.playlistStore}
					creatorStore={result.creatorStore}
					creatorPostCache={result.creatorPostCache}
					creatorPostScopes={result.creatorPostScopes}
					followingFeedStore={result.followingFeedStore}
					importStore={result.importStore}
					videoCatalog={result.videoCatalog}
					videoSaves={result.videoSaves}
					recommendationStore={result.recommendationStore}
					musicPreferencesStore={result.musicPreferencesStore}
				/>
			) : (
				<View style={{ flex: 1, justifyContent: 'center' }}>
					<State
						title='本地数据暂时无法打开'
						message={`原数据已保留，请重新打开应用或使用较新版本。\n${result.error}`}
					/>
				</View>
			)}
		</SafeAreaProvider>
	)
}

function Product({
	onReconnect,
	accountName,
	accountId,
	accountAvatar,
	onSignOut,
	library,
	listeningLibrary,
	sessionStore,
	localAudioStore,
	douyinAudioStore,
	onRequestBilibiliLogin,
	playlistStore,
	creatorStore,
	creatorPostCache,
	creatorPostScopes,
	followingFeedStore,
	importStore,
	videoCatalog,
	videoSaves,
	recommendationStore,
	musicPreferencesStore,
}: {
	accountName: string
	accountId?: string
	accountAvatar?: string
	onSignOut?: () => void
	onRequestBilibiliLogin?: () => void
	onReconnect?: () => void
	library: Library
	listeningLibrary: ListeningLibrary
	localAudioStore: LocalAudioStore
	douyinAudioStore: DouyinAudioStore
	sessionStore: SessionStore
	playlistStore: PlaylistStore
	creatorStore: CreatorStore
	creatorPostCache: CreatorPostCache
	creatorPostScopes: BilibiliContentScopeReader
	followingFeedStore: FollowingFeedStore
	importStore: ImportStore
	videoCatalog: VideoCatalog
	videoSaves: VideoSaves
	recommendationStore: RecommendationStore
	musicPreferencesStore: MusicPreferencesStore
}) {
	const playerReadingBack = useRef<(() => boolean) | null>(null)
	const biliImportBack = useRef<(() => boolean) | null>(null)
	const videoLibraryBack = useRef<(() => boolean) | null>(null)
	const insets = useSafeAreaInsets()
	const currentLayoutGate = useMemo(() => new ThemeLayoutGate(), [])
	const {
		rootRef: themeLayoutRootRef,
		onRootLayout: onThemeRootLayout,
		bounds: themeRootBounds,
		gate: candidateLayoutGate,
		request: candidateLayoutRequest,
		preparePresentation,
		environmentIdentity,
	} = useThemeCandidateLayout(insets, currentLayoutGate)
	const prepareWithCurrentRestore = useMemo(
		() => withCurrentLayoutRestore(preparePresentation),
		[preparePresentation],
	)
	const workshop = useThemeWorkshop(library, prepareWithCurrentRestore, true)
	const appearance = useAppearance()
	const effectivePresentation = themeAppearance(workshop.state.current, appearance.mode)
	const currentDisplay = useThemeCurrentLayout(
		effectivePresentation,
		currentLayoutGate,
		environmentIdentity,
		appearance.mode,
	)
	const theme = currentDisplay.presentation.theme
	const selection = workshop.state.current.selection
	const themeKey = selection.kind === 'builtin' ? selection.key : null
	useEffect(() => {
		if (
			!workshop.state.loading &&
			workshop.state.installer &&
			!workshop.state.installer.readOnly
		)
			void accountTheme.remember(workshop.state.current.selection)
	}, [workshop.state.current, workshop.state.loading, workshop.state.installer])
	const c = theme.tokens
	const [preferenceInitial] = useState(() => {
		try {
			return { value: musicPreferencesStore.load(), error: '' }
		} catch {
			return {
				value: emptyMusicPreferences(),
				error: '音乐偏好暂时无法读取，原记录已保留。',
			}
		}
	})
	const [musicPreferences, setMusicPreferences] = useState(
		preferenceInitial.value,
	)
	const [preferencesOpen, setPreferencesOpen] = useState(
		!preferenceInitial.error && !preferenceInitial.value.welcomeCompleted,
	)
	const [tab, setTab] = useState<Tab>('home')
	const [profileSettingsOpen, setProfileSettingsOpen] = useState(false)
	const [searchReturnTab, setSearchReturnTab] = useState<Tab | null>(null)
	const playlists = usePlaylists(playlistStore, library)
	const creators = useCreators(
		creatorStore,
		library,
		creatorPostCache,
		creatorPostScopes,
	)
	const accountFollowing = useMemo(
		() => new AccountFollowingSession(creatorStore, accountSession),
		[creatorStore],
	)
	const accountFollowingState = useSyncExternalStore(
		accountFollowing.subscribe,
		accountFollowing.getSnapshot,
	)
	useEffect(() => () => accountFollowing.close(), [accountFollowing])
	const followingFeed = useFollowingFeed(
		followingFeedStore,
		creators.session,
		creatorPostCache,
	)
	const imports = useImports(importStore, library, playlistStore)
	const recommendations = useRecommendations(recommendationStore)
	const biliImports = useBilibiliImports(
		importStore,
		library,

	playlistStore,
		videoCatalog,
		videoSaves,
	)
	const videoLibrary = useListeningLibrary(
		videoSaves,
		videoCatalog,
		biliImports.session.gate,
	)
	const externalImportsVisible =
		imports.state.route !== 'closed' && !imports.state.suspended
	const biliImportsVisible =
		biliImports.state.route !== 'closed' &&
		!biliImports.state.playback.suspended
	const videoLibraryVisible =
		videoLibrary.state.route !== 'closed' &&
		!videoLibrary.state.playback.suspended
	const importsVisible =
		externalImportsVisible || biliImportsVisible || videoLibraryVisible
	const creatorPlayerReturn = useRef(false)
	const [homeChannel, setHomeChannel] = useState<'music' | 'listening'>('music')
	const [listeningLibraryOpen, setListeningLibraryOpen] = useState(false)
	const [offlineOpen, setOfflineOpen] = useState(false)
	const [libraryCollection, setLibraryCollection] =
		useState<LibraryCollection>('root')
	const [collectionOrigin, setCollectionOrigin] = useState<Tab | null>(null)
	const closeLibraryCollection = useCallback(() => {
		setLibraryCollection('root')
		if (collectionOrigin) setTab(collectionOrigin)
		setCollectionOrigin(null)
	}, [collectionOrigin])
	function openLibraryCollection(collection: LibraryCollection) {
		setCollectionOrigin(tab === 'library' ? null : tab)
		playlists.session.close()
		setListeningLibraryOpen(false)
		setLibraryCollection(collection)
		setTab('library')
	}
	const [fullPlayer, setFullPlayerState] = useState(false)
	const playerPresentation = useRef(0)
	const setFullPlayer = useCallback((open: boolean) => {
		playerPresentation.current++
		setFullPlayerState(open)
	}, [])
	const [sheet, setSheet] = useState<Sheet>(null)
	const [musicPartsIdentity, setMusicPartsIdentity] =
		useState<MusicPartsIdentity | null>(null)
	const [likes, setLikes] = useState(() => library.likes())
	const [musicLikes, setMusicLikes] = useState(() => library.musicLikes())
	const [query, setQuery] = useState('')
	const search = useSearch()
	const searchHistory = useSearchHistory(library)
	const { find: runSearch } = search
	const [filter, setFilter] = useState<
		'all' | 'music' | 'listening' | 'creator' | 'douyin'
	>('all')
	const creatorSearch = useCreatorSearch(
		tab === 'search' && (filter === 'creator' || filter === 'all'),
		creatorStore,
		creators.state,
	)
	const [notice, setNotice] = useState('')
	const [savingBv, setSavingBv] = useState('')
	const [sourceRequestBv, setSourceRequestBv] = useState('')
	const [addingBv, setAddingBv] = useState('')
	const [sourceActions, setSourceActions] = useState<
		SearchItem | Source | null
	>(null)
	const pendingAdd = useRef<AbortController | null>(null)
	const pageScroll = useRef<ScrollView | null>(null)
	const sheetScroll = useRef<ScrollView | null>(null)
	const scrollOffsets = useRef(new Map<string, number>())
	const pageKey =
		tab === 'library'
			? `library:${playlists.state.currentId ?? (listeningLibraryOpen ? 'listening' : libraryCollection)}`
			: tab === 'search' && filter === 'creator'
				? 'search:creator'
				: tab === 'search' && filter === 'douyin'
					? 'search:douyin'
				: tab === 'profile' && profileSettingsOpen
					? 'profile:settings'
					: tab
	const busyBv = sourceRequestBv || savingBv || addingBv
	const [playbackIntent] = useState(() => new PlaybackIntent())
	const [reduced, setReduced] = useState(
		() => library.setting('reducedMotion') === 'true',
	)
	const [systemReduced, setSystemReduced] = useState(true)
	const [notifications, setNotifications] = useState(() =>
		Orpheus.areNotificationsEnabled(),
	)
	useEffect(() => {
		if (preferencesOpen) return
		try { explainPlaybackNotifications(library, setNotifications) }
		catch { setNotice('通知设置暂时无法保存，可在设置中开启媒体通知。') }
	}, [library, preferencesOpen])
	const busy = useRef(false)
	const player = usePlayer(
		library,
		listeningLibrary,
		sessionStore,
		localAudioStore,
	douyinAudioStore,
	)
	useAutoSyncTrackLyrics(library, player.track)
	const douyinState = useDouyinSession()
	useEffect(() => {
		void douyinSession.restore()
	}, [])
	const [douyinLoginOpen, setDouyinLoginOpen] = useState(false)
	const [douyinCollectionKind, setDouyinCollectionKind] = useState<
		'favorite' | 'collection' | null
	>(null)
	const [douyinSubmittedQuery, setDouyinSubmittedQuery] = useState('')
	const [douyinSearchRevision, setDouyinSearchRevision] = useState(0)
	const musicLikedIds = useMemo(
		() => new Set(musicLikes.map((source) => source.id)),
		[musicLikes],
	)
	const heartDiscovery = useMemo(() => ({
		discover: async (signal: AbortSignal) => {
			let historyWarning = ''
			const history = await Orpheus.getRecentMusicHistory().catch(() => {
				historyWarning = '最近播放暂时无法读取，本次仅依据歌单和喜欢。'
				return []
			})
			if (signal.aborted) throw new Error('心动查找已取消')
			const batch = await discoverHeart(recommendationStore.heartProfile(history), searchBilibili, sourceDetails, signal)
			return {...batch, message: [historyWarning, batch.message].filter(Boolean).join(' ')}
		},
	}), [recommendationStore])
	const fm = useFm(recommendationStore, playbackIntent, player, heartDiscovery)
	const fmPlayerReturn = useRef(false)
	const metadata = useMemo(
		() =>
			readPlaybackMetadata(
				library,
				listeningLibrary,
				player.track?.sourceId ?? player.track?.id,
				player.resumePoints,
			),
		[
			library,
			listeningLibrary,
			player.track?.sourceId,
			player.track?.id,
			player.resumePoints,
		],
	)
	const current = metadata.current
	const sourceReplacement = useMemo(() => {
		if (sheet !== 'source' || !player.track?.id.startsWith('playlist-item:')) return null
		const itemId = player.track.id.slice('playlist-item:'.length)
		const playlist = playlistStore.list().map(value => playlistStore.get(value.id)).find(value => value?.items.some(item => item.itemId === itemId && item.importOrigin?.provider !== 'bilibili' && !!item.importOrigin))
		return playlist ? { playlistId: playlist.id, itemId } : null
	}, [sheet, player.track, playlistStore])
	const localDataError = metadata.error
	const listening = useListening(
		player,
		current,
		() => setFullPlayer(true),
		setNotice,
		playbackIntent,
	)
	const listeningPartsById = useMemo(() => new Map(listening.parts.map((part) => [part.source.id, part])), [listening.parts])
	const resumeItems = useMemo<ListeningResume[]>(() => metadata.items.map((item) => {
		const part = listeningPartsById.get(item.source.id)
		return { ...item, ...(part ? { part: { page: part.page, title: part.title } } : {}) }
	}), [metadata.items, listeningPartsById])
	const likedBvids = useMemo(() => new Set(likes.map((source) => source.bvid)), [likes])
	const isLiked = useCallback((bvid: string) => likedBvids.has(bvid), [likedBvids])
	useEffect(() => {
		void AccessibilityInfo.isReduceMotionEnabled().then(setSystemReduced)
		const motion = AccessibilityInfo.addEventListener(
			'reduceMotionChanged',
			setSystemReduced,
		)
		const foreground = AppState.addEventListener('change', (state) => {
			if (state === 'active')
				setNotifications(Orpheus.areNotificationsEnabled())
		})
		return () => {
			motion.remove()
			foreground.remove()
		}
	}, [])
	useEffect(() => {
		if (!notice) return
		const timer = setTimeout(() => setNotice(''), 4500)
		return () => clearTimeout(timer)
	}, [notice])
	useEffect(() => {
		if (
			!playlists.state.notice ||
			playlists.state.picker ||
			playlists.state.nameForm
		)
			return
		const timer = setTimeout(playlists.session.clearNotice, 3500)
		return () => clearTimeout(timer)
	}, [
		playlists.state.notice,
		playlists.state.picker,
		playlists.state.nameForm,
		playlists.session,
	])
	useEffect(
		() => () => playlists.session.clearNotice(),
		[tab, filter, homeChannel, fullPlayer, importsVisible, playlists.session],
	)
	useEffect(() => {
		if (tab === 'library') playlists.session.refresh()
	}, [tab, playlists.session])
	useEffect(
		() => () => {
			pendingAdd.current?.abort()
			pendingAdd.current = null
			setAddingBv('')
		},
		[tab],
	)
	useEffect(() => {
		if (fullPlayer) return
		const frame = requestAnimationFrame(() =>
			pageScroll.current?.scrollTo({
				y: scrollOffsets.current.get(pageKey) ?? 0,
				animated: false,
			}),
		)
		return () => cancelAnimationFrame(frame)
	}, [pageKey, fullPlayer])
	const openImportHub = useCallback(() => {
		followingFeed.session.close()
		biliImports.session.close()
		videoLibrary.session.close()
		imports.session.open()
	}, [
		biliImports.session,
		videoLibrary.session,
		imports.session,
		followingFeed.session,
	])
	const closeFm = useCallback(() => {
		fm.session.close()
		if (fmPlayerReturn.current) setFullPlayer(true)
		fmPlayerReturn.current = false
	}, [fm.session, setFullPlayer])
	const closePlayer = useCallback(async () => {
		if (player.auditionId) {
			// Resume the review owner before the native restoration changes source identity.
			imports.session.resumeFromPlayer(
				player.track?.sourceId ?? player.track?.id ?? null,
				player.track?.id ?? null,
			)
			if (await player.endCandidateAudition(player.auditionId))
				setFullPlayer(false)
			return
		}
		const presentation = ++playerPresentation.current,
			isCurrentIntent = playbackIntent.captureCurrent(),
			biliPreview = biliImports.session.preview,
			savedPreview = videoLibrary.session.preview
		if (
			biliPreview.getSnapshot().suspended ||
			savedPreview.getSnapshot().suspended
		) {
			const owner = biliPreview.getSnapshot().suspended
				? biliPreview
				: savedPreview
			await owner.resumeCurrent(readNativePlayerIdentity)
			if (presentation !== playerPresentation.current || !isCurrentIntent())
				return
			if (
				!biliPreview.getSnapshot().suspended &&
				!savedPreview.getSnapshot().suspended
			)
				setFullPlayer(false)
			else setNotice('暂时无法核对当前播放器，请稍后再返回。')
			return
		}
		if (
			imports.state.suspended &&
			imports.session.resumeFromPlayer(
				player.track?.sourceId ?? player.track?.id ?? null,
				player.track?.id ?? null,
			)
		) {
			setFullPlayer(false)
		} else if (creators.state.suspended) {
			setFullPlayer(creatorPlayerReturn.current)
			creators.session.resumeFromPlayer()
		} else setFullPlayer(false)
	}, [
		playbackIntent,
		biliImports.session,
		videoLibrary.session,
		imports.state.suspended,
		imports.session,
		player,
		creators.state.suspended,
		creators.session,
		setFullPlayer,
	])
	useEffect(() => {
		const handler = BackHandler.addEventListener('hardwareBackPress', () => {
			if (sheet) {
				if (sheet === 'themes') workshop.session.close()
				setSheet(null)
				return true
			}
			if (fullPlayer || player.auditionId) {
				if (playerReadingBack.current?.()) return true
				void closePlayer()
				return true
			}
			if (fm.state.open) {
				closeFm()
				return true
			}
			if (followingFeed.state.open) {
				followingFeed.session.close()
				return true
			}
			if (recommendations.state.open) {
				recommendations.session.back()
				return true
			}
			if (biliImports.state.route !== 'closed') {
				if (biliImportBack.current?.()) return true
				if (
					biliImports.state.route === 'folders' ||
					biliImports.state.route === 'task' ||
					biliImports.state.route === 'result'
				)
					openImportHub()
				else biliImports.session.back()
				return true
			}
			if (videoLibrary.state.route !== 'closed') {
				if (videoLibraryBack.current?.()) return true
				videoLibrary.session.back()
				return true
			}
			if (imports.state.route !== 'closed') {
				imports.session.back()
				return true
			}
			if (tab === 'search' && searchReturnTab) {
				setTab(searchReturnTab)
				setSearchReturnTab(null)
				return true
			}
			if (tab === 'library' && playlists.state.currentId) {
				if (playlists.state.editing) playlists.session.setEditing(false)
				else playlists.session.close()
				return true
			}
			if (listeningLibraryOpen) {
				setListeningLibraryOpen(false)
				return true
			}
			if (tab === 'library' && libraryCollection !== 'root') {
				closeLibraryCollection()
				return true
			}
			if (tab === 'home' && homeChannel === 'listening') {
				setHomeChannel('music')
				return true
			}
			if (tab === 'profile' && profileSettingsOpen) {
				setProfileSettingsOpen(false)
				return true
			}
			if (tab !== 'home') {
				setTab('home')
				return true
			}
			return false
		})
		return () => handler.remove()
	}, [
		closePlayer,
		closeLibraryCollection,
		closeFm,
		fm.state.open,
		followingFeed.state.open,
		followingFeed.session,
		openImportHub,
		recommendations.state.open,
		recommendations.session,
		sheet,
		fullPlayer,
		player.auditionId,
		tab,
		profileSettingsOpen,
		listeningLibraryOpen,
		libraryCollection,
		homeChannel,
		searchReturnTab,
		playlists.state.currentId,
		playlists.state.editing,
		playlists.session,
		creators.state.suspended,
		creators.session,
		workshop.session,
		imports.state.route,
		imports.state.suspended,
		player.track?.sourceId,
		player.track?.id,
		imports.session,
		biliImports.state.route,
		biliImports.state.playback.suspended,
		biliImports.session,
		videoLibrary.state.route,
		videoLibrary.state.playback.suspended,
		videoLibrary.session,
		player.mode,
	])
	useEffect(
		() =>
			bindPlayerDeepLinks(Linking, () => {
				followingFeed.session.cancelPending()
				setFullPlayer(true)
			}),
		[setFullPlayer, followingFeed.session],
	)

	async function find(value = query, kind = filter, order = search.order) {
		Keyboard.dismiss()
		if (isDouyinShareInput(value) || kind === 'douyin') {
			setFilter('douyin')
			searchHistory.session.record(value, 'douyin', order)
			creatorSearch.session.cancel()
			setDouyinSubmittedQuery(value.trim())
			setDouyinSearchRevision((rev) => rev + 1)
			return
		}
		searchHistory.session.record(value, kind, order)
		try {
			if (creatorSearchMid(value)) {
				setFilter('creator')
				await creatorSearch.session.find(value)
				return
			}
		} catch (error) {
			setFilter('creator')
			creatorSearch.session.rejectInput(value, error)
			return
		}
		if (kind !== 'creator') {
			let includeCreators = false
			if (kind === 'all') {
				try {
					includeCreators = creatorSearchTarget(value) === 'creator'
				} catch {
					// Video search owns invalid-input feedback; never search UPs for it.
				}
			}
			if (includeCreators) {
				await Promise.all([
					runSearch(value, 1, order),
					creatorSearch.session.find(value),
				])
				return
			}
			creatorSearch.session.cancel()
			await runSearch(value, 1, order)
			return
		}
		try {
			if (creatorSearchTarget(value) === 'video') {
				creatorSearch.session.cancel()
				setFilter('all')
				await runSearch(value, 1, order)
			} else await creatorSearch.session.find(value)
		} catch (error) {
			creatorSearch.session.rejectInput(value, error)
		}
	}
	function openCreator(item: SearchItem | Source) {
		setSourceActions(null)
		setSheet(null)
		try {
			creators.session.openSource(item)
		} catch (error) {
			setNotice(
				error instanceof Error ? error.message : 'UP 主资料暂时无法读取',
			)
		}
	}
	useEffect(() => {
		imports.session.observePlayer(
			player.track?.sourceId ?? player.track?.id ?? null,
			player.track?.id ?? null,
		)
	}, [
		imports.state.suspended,
		imports.session,
		player.track?.sourceId,
		player.track?.id,
	])
	useEffect(() => {
		const hint = {
			mode: player.mode,
			sourceId: player.track?.sourceId ?? player.track?.id ?? null,
			entryId: player.track?.id ?? null,
		}
		void biliImports.session.preview.observeCurrent(
			hint,
			readNativePlayerIdentity,
		)
		void videoLibrary.session.preview.observeCurrent(
			hint,
			readNativePlayerIdentity,
		)
	}, [
		biliImports.session,
		videoLibrary.session,
		biliImports.state.playback.suspended,
		videoLibrary.state.playback.suspended,
		player.mode,
		player.track?.sourceId,
		player.track?.id,
	])
	const visitedSourceId = current?.id,
		visitedBvid = current?.bvid
	useEffect(() => {
		if (player.mode !== 'listening' || !visitedSourceId || !visitedBvid) return
		try {
			if (videoCatalog.get(visitedBvid))
				videoCatalog.recordVisitedPart(visitedBvid, visitedSourceId)
		} catch (error) {
			setNotice(
				error instanceof Error
					? error.message
					: '最后访问分 P 保存失败，原进度保留',
			)
		}
	}, [videoCatalog, player.mode, visitedSourceId, visitedBvid])
	const activateBilibiliPreview: BilibiliPreviewAction = async (
		source,
		mode,
		video,
		own,
	) => {
		let request: PlaybackRequest | null = null
		const ownRequest = (value: PlaybackRequest) => {
			request = value
			own(value)
		}
		const ok =
			mode === 'music'
				? await playMusicIntent(playbackIntent, source, {
						resolve: async (value) => value,
						preparation: player,
						activate: player.playSource,
						onPending: setSourceRequestBv,
						onStarted: () => {},
						onRequest: ownRequest,
					})
				: await listening.start(source, {
						verifiedVideo: video,
						onRequest: ownRequest,
						onStarted: () => {},
						onError: setNotice,
					})
		if (!ok) return null
		const actual = await Orpheus.getPlaybackSnapshot()
		if (!(await (request as PlaybackRequest | null)?.checkCurrent()))
			return null
		return {
			mode: actual.mode,
			sourceId: actual.currentSourceId,
			entryId: actual.currentEntryId,
		}
	}
	function playBilibiliImportPreview() {
		const source = biliImports.session.selectedSource(),
			video = biliImports.state.video
		if (!source || !video) return
		void biliImports.session.preview
			.play(
				source,
				biliImports.session.kind(biliImports.state.entryId!) === 'song'
					? 'music'
					: 'listening',
				video,
				activateBilibiliPreview,
			)
			.then((ok) => {
				if (ok) setFullPlayer(true)
			})
	}
	function playSavedVideo() {
		const source = videoLibrary.session.selectedSource(),
			video = videoLibrary.state.video
		if (!source || !video) return
		void videoLibrary.session.preview
			.play(source, 'listening', video, activateBilibiliPreview)
			.then((ok) => {
				if (ok) setFullPlayer(true)
			})
	}
	function openBilibiliImport() {
		followingFeed.session.close()
		imports.session.close()
		videoLibrary.session.close()
		biliImports.session.open()
	}
	function openBilibiliTask(taskId: string, entryId?: string) {
		followingFeed.session.close()
		imports.session.close()
		videoLibrary.session.close()
		biliImports.session.openTask(taskId)
		if (entryId) biliImports.session.openEntry(entryId)
	}
	function openVideoLibrary(bucket: 'listening' | 'unclassified') {
		followingFeed.session.close()
		imports.session.close()
		biliImports.session.close()
		setTab('library')
		videoLibrary.session.open(bucket)
	}
	function openBilibiliPending(playlistId: string, itemId: string) {
		const item = playlistStore
			.get(playlistId)
			?.items.find((row) => row.itemId === itemId)
		if (!item?.importOrigin || item.importOrigin.provider !== 'bilibili') return
		imports.session.close()
		videoLibrary.session.close()
		biliImports.session.openPending(
			item.importOrigin.taskId,
			item.importOrigin.entryId,
			playlistId,
			itemId,
		)
	}
	function playImportPreview() {
		void imports.session.playPreview(
			(source, ownRequest) =>
				playMusicIntent(playbackIntent, source, {
					resolve: async (value) => value,
					preparation: player,
					activate: player.playCandidateAudition,
					onPending: setSourceRequestBv,
					onStarted: () => {},
					onRequest: (request) =>
						ownRequest(() => {
							request.cancel()
						}, request.isCurrent),
				}),
			() => setFullPlayer(true),
		)
	}
	function openImportedPlaylist(playlistId: string) {
		try {
			if (!playlistStore.get(playlistId))
				throw new Error('本地歌单已删除，导入历史仍保留。')
			imports.session.close()
			biliImports.session.close()
			videoLibrary.session.close()
			setTab('library')
			setListeningLibraryOpen(false)
			playlists.session.open(playlistId)
		} catch (error) {
			imports.session.reportError(error)
		}
	}
	function changeImportedSource(playlistId: string, itemId: string) {
		closeSheet()
		setFullPlayer(false)
		biliImports.session.close()
		setTab('library')
		imports.session.openPlaylistItem(playlistId, itemId)
	}
	function openCreatorSummary(creator: Creator) {
		try {
			creators.session.openSummary(creator)
		} catch (error) {
			setNotice(
				error instanceof Error ? error.message : 'UP 主资料暂时无法读取',
			)
		}
	}
	function playCreatorSource(
		source: Source | CreatorPostCandidate,
		mode: 'music' | 'listening',
	) {
		const candidate = 'queryCreatorMid' in source ? source : null
		const postState = creators.remoteState
		let verifiedPostSource: Source | undefined
		const currentPost = (verifiedSource?: Source) => {
			if (!candidate) throw new Error('投稿身份缺失，请重新选择')
			const post = creators.remote.requirePost(
				candidate,
				postState.visit,
				postState.postFilter,
			)
			if (
				verifiedSource &&
				post.ownerMid !== undefined &&
				post.ownerMid !== verifiedSource.uploaderId.toString()
			)
				throw new Error('投稿的上传者资料已变化，请刷新投稿后重试')
			return post
		}
		let request: PlaybackRequest | null = null
		const onRequest = (value: PlaybackRequest) => {
			request = value
		}
		void creators.session.presentPlayback(
			() =>
				mode === 'music'
					? playMusicIntent(playbackIntent, source, {
							resolve: async (item, signal) => {
								if ('cid' in item) return resolveSource(item, signal)
								const resolved = await resolveCreatorPost(currentPost(), signal)
								currentPost(resolved)
								return resolved
							},
							preparation: player,
							activate: (target, preparation) => {
								if (candidate) currentPost(target)
								return player.playSource(target, preparation)
							},
							onPending: setSourceRequestBv,
							onStarted: () => {},
							onRequest,
						})
					: listening.start(candidate ? currentPost() : source, {
							onStarted: () => {},
							onRequest,
							onError: (message) => {
								throw new Error(message)
							},
							validateVideo: candidate
								? (video) => {
										verifyCreatorPost(currentPost(), video)
										verifiedPostSource = video.parts[0].source
									}
								: undefined,
							validateBeforePlay: candidate
								? () => {
										currentPost(verifiedPostSource)
									}
								: undefined,
						}),
			() => {
				creatorPlayerReturn.current = fullPlayer
				setFullPlayer(true)
			},
			() => {
				request?.cancel()
			},
		)
	}
	async function start(item: SearchItem | Source) {
		try {
			await playMusicIntent(playbackIntent, item, {
				resolve: resolveSource,
				preparation: player,
				activate: (source, preparation) =>
					player.playSource(source, preparation),
				onPending: setSourceRequestBv,
				onStarted: () => setFullPlayer(true),
			})
		} catch (error) {
			setNotice(error instanceof Error ? error.message : '播放失败，请重试')
		}
	}
	function openRecommendations() {
		followingFeed.session.close()
		fm.session.close()
		imports.session.close()
		biliImports.session.close()
		videoLibrary.session.close()
		recommendations.session.open()
	}
	function openFm() {
		followingFeed.session.close()
		imports.session.close()
		biliImports.session.close()
		videoLibrary.session.close()
		recommendations.session.close()
		fmPlayerReturn.current = fullPlayer
		setFullPlayer(false)
		fm.session.open()
	}
	function fmStarted() {
		fmPlayerReturn.current = false
		setFullPlayer(true)
	}
	function fmExited(hasReturnTrack: boolean) {
		fmPlayerReturn.current = false
		setFullPlayer(hasReturnTrack)
	}
	function leaveFm(target: 'search' | 'library') {
		fm.session.close()
		fmPlayerReturn.current = false
		setTab(target)
	}
	function playRecommendation(sourceId: string) {
		void recommendations.session.play(
			sourceId,
			(source, own) =>
				playMusicIntent(playbackIntent, source, {
					resolve: async (value) => value,
					preparation: player,
					activate: player.playSource,
					onPending: setSourceRequestBv,
					onStarted: () => {},
					onRequest: (request) => own(request),
				}),
			() => setFullPlayer(true),
		)
	}
	function openFollowingFeed() {
		imports.session.close()
		biliImports.session.close()
		videoLibrary.session.close()
		recommendations.session.close()
		fm.session.close()
		playlists.session.close()
		setListeningLibraryOpen(false)
		setTab('library')
		followingFeed.session.open()
	}
	function openFollowingCreator(creator?: Creator) {
		if (!followingFeed.session.getSnapshot().open) return
		followingFeed.session.pauseForOverlay()
		try {
			if (creator) creators.session.openSummary(creator)
			else creators.session.openFollowing()
		} catch (error) {
			followingFeed.session.resumeFromOverlay()
			setNotice(
				error instanceof Error ? error.message : 'UP 主资料暂时无法读取',
			)
		}
	}
	function playFollowingPost(bvid: string, mode: 'music' | 'listening') {
		void followingFeed.session.play(
			bvid,
			mode,
			(item, selectedMode, own) => {
				if (selectedMode === 'music')
					return playMusicIntent(playbackIntent, item.post, {
						resolve: resolveCreatorPost,
						preparation: player,
						activate: player.playSource,
						onPending: setSourceRequestBv,
						onStarted: () => {},
						onRequest: own,
					})
				let request: PlaybackRequest | null = null
				return listening.start(item.post, {
					onRequest: (value) => {
						request = value
						own(value)
					},
					onCancelled: () => {
						request?.cancel()
					},
					onStarted: () => {},
					onError: (message) => {
						throw new Error(message)
					},
					validateVideo: (video) => verifyCreatorPost(item.post, video),
				})
			},
			() => setFullPlayer(true),
		)
	}
	async function like(item: SearchItem | Source) {
		if (busy.current) return
		busy.current = true
		setSavingBv(item.bvid)
		try {
			const previous = likes.find((source) => source.bvid === item.bvid)
			const source = previous ?? (await resolveSource(item))
			library.setLiked(source, !previous)
			setLikes(library.likes())
			setMusicLikes(library.musicLikes())
			setNotice(previous ? '已取消喜欢' : '已加入本地喜欢')
		} catch (error) {
			setNotice(
				`保存失败：${error instanceof Error ? error.message : '请重试'}`,
			)
		} finally {
			busy.current = false
			setSavingBv('')
		}
	}
	async function playDouyinQueue(items: DouyinAudio[], startId: string) {
		try {
			await playbackIntent.run({
				preparation: player,
				prepare: async () => ({ items, startId }),
				activate: (target, preparation) =>
					player.playDouyinAudio(target.items, target.startId, preparation),
				onSuccess: () => {
					setDouyinCollectionKind(null)
					setFullPlayer(true)
				},
			})
		} catch (error) {
			setNotice(
				error instanceof Error ? error.message : '抖音原声播放失败，请重试',
			)
		}
	}
	async function playDouyinById(id: string) {
		const saved = douyinAudioStore.get(id)
		if (!saved) {
			setNotice('该抖音原声记录不存在，请重新搜索或提取链接')
			return
		}
		await playDouyinQueue([saved], saved.id)
	}
	function toggleLikeDouyin(audio: DouyinAudio) {
		try {
			douyinAudioStore.upsert(audio)
			const liked = library.musicLikes().some((source) => source.id === audio.id)
			library.setLiked(douyinLibrarySource(audio), !liked)
			setMusicLikes(library.musicLikes())
			setNotice(liked ? '已取消喜欢' : '已加入本地喜欢')
		} catch (error) {
			setNotice(
				`保存失败：${error instanceof Error ? error.message : '请重试'}`,
			)
		}
	}
	function addDouyinToPlaylist(items: DouyinAudio[]) {
		if (!items.length) return
		try {
			douyinAudioStore.upsertMany(items)
			setDouyinCollectionKind(null)
			playlists.session.requestAddSources(items.map(douyinLibrarySource))
		} catch (error) {
			setNotice(error instanceof Error ? error.message : '加入歌单失败，请重试')
		}
	}
	function likeLocal(id: string) {
		if (isDouyinAudioId(id)) {
			try {
				const audio = douyinAudioStore.get(id)
				if (!audio) throw new Error('抖音原声记录不存在，请重新搜索')
				const liked = library.musicLikes().some((source) => source.id === id)
				library.setLiked(douyinLibrarySource(audio), !liked)
				setMusicLikes(library.musicLikes())
				setNotice(liked ? '已取消喜欢' : '已加入本地喜欢')
			} catch (error) {
				setNotice(
					`保存失败：${error instanceof Error ? error.message : '请重试'}`,
				)
			}
			return
		}
		try {
			const audio = localAudioStore.get(id)
			if (!audio) throw new Error('本地音频不存在，请重新导入')
			const liked = library.musicLikes().some((source) => source.id === id)
			library.setLiked(localLibrarySource(audio), !liked)
			setMusicLikes(library.musicLikes())
			setNotice(liked ? '已取消喜欢' : '已加入本地喜欢')
		} catch (error) {
			setNotice(
				`保存失败：${error instanceof Error ? error.message : '请重试'}`,
			)
		}
	}
	function addLocalToPlaylist(id: string) {
		if (isDouyinAudioId(id)) {
			try {
				const audio = douyinAudioStore.get(id)
				if (!audio) throw new Error('抖音原声记录不存在，请重新搜索')
				playlists.session.requestAddSources([douyinLibrarySource(audio)])
			} catch (error) {
				setNotice(error instanceof Error ? error.message : '读取失败，请重试')
			}
			return
		}
		try {
			const audio = localAudioStore.get(id)
			if (!audio) throw new Error('本地音频不存在，请重新导入')
			playlists.session.requestAddSources([localLibrarySource(audio)])
		} catch (error) {
			setNotice(error instanceof Error ? error.message : '读取失败，请重试')
		}
	}
	function musicLibraryRow(source: MusicLibrarySource, _index: number) {
		if (isDouyinLibrarySource(source))
			return (
				<CollectionSongRow
					key={source.id}
					title={source.originalTitle}
					subtitle={`${source.performer || '抖音原声'}，抖音`}
					artwork={source.artwork}
					disabled={player.switching}
					onPlay={() => {
						void playDouyinById(source.id)
					}}
					trailing={
						<CollectionMenu
							label={`${source.originalTitle} 更多操作`}
							actions={[
								{ label: '取消喜欢', onPress: () => likeLocal(source.id) },
								{
									label: '添加到歌单',
									onPress: () => addLocalToPlaylist(source.id),
								},
							]}
						/>
					}
				/>
			)
		if (!isLocalLibrarySource(source))
			return (
				<CollectionSongRow
					key={source.id}
					title={source.originalTitle}
					subtitle={`${source.performer || source.uploader || '未知艺术家'}，B站`}
					artwork={source.artwork}
					disabled={
						busyBv === source.bvid ||
						!!listening.pendingBvid ||
						player.switching
					}
					onPlay={() => {
						void start(source)
					}}
					trailing={
						<CollectionMenu
							label={`${source.originalTitle} 更多操作`}
							actions={[
								{
									label: '取消喜欢',
									onPress: () => {
										void like(source)
									},
									disabled: savingBv === source.bvid,
								},
								{
									label: '添加到歌单',
									onPress: () => {
										void addSourceToPlaylist(source)
									},
									disabled: addingBv === source.bvid,
								},
							]}
						/>
					}
				/>
			)
		return (
			<CollectionSongRow
				key={source.id}
				title={source.originalTitle}
				subtitle={`${source.performer || '未知艺术家'}，本地`}
				artwork={source.artwork}
				disabled={player.switching}
				onPlay={() => {
					void playLocalAudio(source.id)
				}}
				trailing={
					<CollectionMenu
						label={`${source.originalTitle} 更多操作`}
						actions={[
							{ label: '取消喜欢', onPress: () => likeLocal(source.id) },
							{
								label: '添加到歌单',
								onPress: () => addLocalToPlaylist(source.id),
							},
						]}
					/>
				}
			/>
		)
	}

	async function addSourceToPlaylist(item: SearchItem | Source) {
		setSourceActions(null)
		pendingAdd.current?.abort()
		const controller = new AbortController()
		pendingAdd.current = controller
		setAddingBv(item.bvid)
		try {
			const source = await resolveSource(item, controller.signal)
			if (pendingAdd.current === controller && !controller.signal.aborted)
				playlists.session.requestAddSources([source])
		} catch (error) {
			if (pendingAdd.current === controller && !controller.signal.aborted)
				setNotice(
					error instanceof Error ? error.message : '读取音源失败，请重试',
				)
		} finally {
			if (pendingAdd.current === controller) {
				pendingAdd.current = null
				setAddingBv('')
			}
		}
	}
	async function returnToMusic() {
		try {
			await playbackIntent.run({
				preparation: player,
				prepare: async () => {},
				activate: (_, preparation) => player.returnToMusic(preparation),
				onSuccess: () => setFullPlayer(true),
			})
		} catch (error) {
			setNotice(error instanceof Error ? error.message : '返回音乐失败，请重试')
		}
	}
	async function playRecentMusic(id: string) {
		if (isDouyinAudioId(id)) {
			await playDouyinById(id)
			return
		}
		if (id.startsWith('local:')) {
			await playLocalAudio(id)
			return
		}
		try {
			const source = library.get(id)
			if (!source)
				throw new Error(
					'这条播放记录的音源资料暂不可用，记录仍保留。请重新搜索音源。',
				)
			await start(source)
		} catch (error) {
			setNotice(
				error instanceof Error ? error.message : '读取最近播放音源失败，请重试',
			)
		}
	}
	async function playLocalAudio(id: string) {
		try {
			await playbackIntent.run({
				preparation: player,
				prepare: async () => id,
				activate: (target, preparation) =>
					player.playLocalAudio(target, preparation),
				onSuccess: () => setFullPlayer(true),
			})
		} catch (error) {
			setNotice(
				error instanceof Error
					? error.message
					: '本地音频播放失败，请检查文件后重试',
			)
		}
	}
	function playAllLiked() {
		void playLikedCollection(library, playbackIntent, player, () =>
			setFullPlayer(true),
		).catch((error) =>
			setNotice(
				error instanceof Error ? error.message : '播放喜欢的音乐失败，请重试',
			),
		)
	}

	async function playPlaylist(
		playlistId: string,
		startItemId: string,
	): Promise<boolean> {
		try {
			return await playbackIntent.run({
				preparation: player,
				prepare: async () => {
					return preparePlaylistPlayback(

	playlistStore,
						library,
						playlistId,
						startItemId,
					)
				},
				activate: (target, preparation) =>
					player.playPlaylist(target.entries, target.startItemId, preparation),
				onSuccess: () => setFullPlayer(true),
			})
		} catch (error) {
			setNotice(error instanceof Error ? error.message : '播放歌单失败，请重试')
			return false
		}
	}
	function switchTheme(key: ThemeKey) {
		void workshop.session.activateBuiltin(key)
	}
	function closeSheet() {
		if (sheet === 'themes') workshop.session.close()
		setSheet(null)
	}
	async function notificationSettings() {
		try {
			if (notifications) await openPlaybackNotificationSettings()
			else setNotifications(await enablePlaybackNotifications())
		} catch { setNotice('无法打开通知设置，请在系统设置中允许音绘通知。') }
	}
	const openMusicPreferences = () => {
		try {
			setMusicPreferences(musicPreferencesStore.load())
			setPreferencesOpen(true)
		} catch {
			setNotice('音乐偏好暂时无法读取，原记录已保留。')
		}
	}
	const navigateSearch = (
		value?: string,
		mode?: 'music' | 'listening' | 'creator' | 'douyin',
		returnTab?: Tab,
	) => {
		followingFeed.session.close()
		setTab('search')
		setSearchReturnTab(returnTab ?? null)
		setListeningLibraryOpen(false)
		if (mode) setFilter(mode)
		if (value) {
			setQuery(value)
			void find(value, mode ?? filter)
		}
	}
	const row = (item: SearchItem | Source, index: number) => (
		<SongRow
			key={`${item.bvid}-${index}`}
			item={item}
			active={current?.bvid === item.bvid}
			liked={isLiked(item.bvid)}
			busy={busyBv === item.bvid || !!listening.pendingBvid || player.switching}
			onPlay={() => {
				void start(item)
			}}
			onLike={() => {
				void like(item)
			}}
			onListen={
				tab === 'search'
					? () => {
							if (!busy.current) void listening.start(item)
						}
					: undefined
			}
			listeningResult={tab === 'search' && filter === 'listening'}
			onMore={tab === 'search' ? () => setSourceActions(item) : undefined}
		/>
	)

	return (
		<ThemeRendererProvider
			theme={theme}
			adapted={currentDisplay.presentation.adapted}
			allowedImageUris={currentDisplay.presentation.allowedImageUris}
			reducedMotion={reduced || systemReduced}
		>
			<View
				ref={themeLayoutRootRef}
				onLayout={onThemeRootLayout}
				style={{
					flex: 1,
					backgroundColor: c.surface.base,
					paddingTop: insets.top,
				}}
				testID='melocanvas-app'
			>
				<ThemeLayoutProbe
					gate={candidateLayoutGate}
					request={candidateLayoutRequest}
					bounds={themeRootBounds}
					bottomInset={insets.bottom}
					reducedMotion={reduced || systemReduced}
				/>
				<ThemeLayoutProbe
					gate={currentLayoutGate}
					request={currentDisplay.request}
					bounds={themeRootBounds}
					bottomInset={insets.bottom}
					reducedMotion={reduced || systemReduced}
				/>
				<StartupContent
					ready={!workshop.state.loading && !currentDisplay.pending}
					mode={appearance.mode}
				>
				<StatusBar
					barStyle={appearance.mode === 'dark' ? 'light-content' : 'dark-content'}
					backgroundColor={c.surface.base}
				/>
				<Backdrop />
				{preferencesOpen && (
					<MusicPreferencesDialog
						store={musicPreferencesStore}
						initial={musicPreferences}
						firstRun={!musicPreferences.welcomeCompleted}
						onClose={() => setPreferencesOpen(false)}
						onSaved={setMusicPreferences}
						onSearch={() => navigateSearch(undefined, 'music')}
						onImport={openImportHub}
					/>
				)}
				{!!addingBv && (
					<Card style={{ marginHorizontal: 22, marginBottom: 8 }}>
						<View style={[s.row, { gap: 10 }]}>
							<T
								size={12}
								style={{ flex: 1 }}
							>
								正在读取待加入歌单的音源…
							</T>
							<Button
								secondary
								onPress={() => {
									pendingAdd.current?.abort()
									pendingAdd.current = null
									setAddingBv('')
								}}
							>
								取消读取
							</Button>
						</View>
					</Card>
				)}
				{tab !== 'library' &&
					!!playlists.state.notice &&
					!playlists.state.picker &&
					!playlists.state.nameForm && (
						<Card
							style={{
								marginHorizontal: 22,
								marginBottom: 8,
								paddingVertical: 4,
							}}
						>
							<View
								accessibilityLiveRegion='polite'
								style={[s.row, { gap: 10 }]}
							>
								<T
									size={12}
									style={{ flex: 1 }}
								>
									{playlists.state.notice}
								</T>
								<IconButton
									name='close'
									label='关闭歌单操作提示'
									onPress={playlists.session.clearNotice}
								/>
							</View>
						</Card>
					)}
				{!!localDataError && (
					<Card style={{ marginHorizontal: 22, marginBottom: 8 }}>
						<T
							muted
							size={11}
						>
							{localDataError}
						</T>
					</Card>
				)}
				{player.syncError && (
					<Card style={{ marginHorizontal: 22, marginBottom: 8 }}>
						<T
							muted
							size={11}
						>
							{player.syncError}
						</T>
					</Card>
				)}
				{!!player.nativePersistenceError && (
					<Card style={{ marginHorizontal: 22, marginBottom: 8 }}>
						<T
							muted
							size={11}
						>
							播放记录暂存失败，当前音频仍保留；稍后会重试保存。
						</T>
					</Card>
				)}
				{!fullPlayer && player.error && (
					<Card style={{ marginHorizontal: 22, marginBottom: 8 }}>
						<T
							size={12}
							style={{ color: c.state.error }}
						>
							{player.error}
						</T>
					</Card>
				)}
				{!!listening.pendingBvid && (
					<Card style={{ marginHorizontal: 22, marginBottom: 8 }}>
						<View style={[s.row, { justifyContent: 'space-between', gap: 8 }]}>
							<T
								muted
								size={12}
								style={{ flex: 1 }}
							>
								正在读取听视频与分 P…
							</T>
							<Button
								secondary
								onPress={() => {
									void listening.cancel()
								}}
							>
								取消
							</Button>
						</View>
					</Card>
				)}
				{player.auditionId ? (
					<CandidateAuditionPanel
						player={player}
						bottomInset={insets.bottom}
						returnToImport={imports.state.route !== 'closed'}
						onClose={closePlayer}
					/>
				) : fullPlayer && current && player.mode === 'listening' ? (
					<ListeningPlayer
						source={current}
						parts={listening.parts}
						sleepTimer={player.sleepTimer}
						onSleepTimer={player.setListeningSleepTimer}
						onRefreshSleepTimer={player.sync}
						partsLoading={listening.partsLoading}
						partsError={listening.partsError}
						progress={player.progress}
						position={player.position}
						duration={player.duration}
						speed={player.speed}
						playing={player.playing}
						buffering={player.buffering}
						switching={player.switching || !!listening.pendingBvid}
						error={player.error}
						bottomInset={insets.bottom}
						reducedMotion={reduced || systemReduced}
						canReturnMusic={player.canReturnMusic}
						onClose={closePlayer}
						onTheme={() => setSheet('themes')}
						onSource={() => setSheet('source')}
						onCreator={() => openCreator(current)}
						onSeek={player.seek}
						onToggle={() => {
							void player.toggle()
						}}
						onSpeed={(speed) => {
							void player.setSpeed(speed)
						}}
						onPart={(part) => {
							void listening.start(part.source)
						}}
						onRetryParts={listening.retryParts}
						onRetry={player.retry}
						onReturnMusic={() => {
							void returnToMusic()
						}}
						onCancel={() => {
							void listening.cancel()
						}}
					/>
				) : fullPlayer && player.track && player.mode === 'listening' ? (
					<ListeningUnavailable
						title={player.track.title || '正在收听'}
						playing={player.playing}
						canReturnMusic={player.canReturnMusic}
						onClose={closePlayer}
						onToggle={() => {
							void player.toggle()
						}}
						onReturnMusic={() => {
							void returnToMusic()
						}}
					/>
				) : fullPlayer && player.track ? (
					<MusicPlayer
						readingBackRef={playerReadingBack}
						library={library}
						onOffline={() => setOfflineOpen(true)}
						player={player}
						onFm={openFm}
						fmMessage={fm.state.refillMessage}
						current={current}
						localLiked={musicLikes.some(
							(source) => source.id === player.track?.sourceId,
						)}
						onLikeLocal={likeLocal}
						isLiked={isLiked}
						busyBv={busyBv}
						onLike={(source) => {
							void like(source)
						}}
						onClose={closePlayer}
						onTheme={() => setSheet('themes')}
						onSource={() => setSheet('source')}
						onQueue={() => setSheet('queue')}
						onParts={() => {
							if (!current || !player.track || player.mode !== 'music') return
							setMusicPartsIdentity({
								bvid: current.bvid,
								entryId: player.track.id,
								sourceId: current.id,
							})
							setSheet('parts')
						}}
						onNotice={setNotice}
						onNotificationSettings={() => {
							void notificationSettings()
						}}
						notifications={notifications}
						bottomInset={insets.bottom}
					/>
				) : (
					<>
						{externalImportsVisible && (
							<ImportPage
								state={imports.state}
								session={imports.session}
								onPreview={playImportPreview}
								onOpenPlaylist={openImportedPlaylist}
								onBilibili={openBilibiliImport}
								onBilibiliTask={openBilibiliTask}
								playbackBusy={player.switching || !!listening.pendingBvid}
								playbackError={player.error}
							/>
						)}
						{biliImportsVisible && (
							<BilibiliImportPage
								backRef={biliImportBack}
								state={biliImports.state}
								session={biliImports.session}
								onHub={openImportHub}
								onPreview={playBilibiliImportPreview}
								onPlaylist={openImportedPlaylist}
								onPlayPlaylist={(id) => {
									const first = playlistStore
										.get(id)
										?.items.find((item) => item.sourceId !== null)
									if (first) void playPlaylist(id, first.itemId)
								}}
								onLibrary={openVideoLibrary}
								playbackBusy={player.switching || !!listening.pendingBvid}
								playbackError={player.error}
							/>
						)}
						{videoLibraryVisible && (
							<ListeningLibraryPage
								backRef={videoLibraryBack}
								state={videoLibrary.state}
								session={videoLibrary.session}
								onPlay={playSavedVideo}
								onOrigin={openBilibiliTask}
								playbackBusy={player.switching || !!listening.pendingBvid}
								playbackError={player.error}
							/>
						)}
						{fm.state.open && (
							<FmPage
								state={fm.state}
								session={fm.session}
								onClose={closeFm}
								onStart={() => {
									void fm.session.start(fmStarted)
								}}
								onExit={() => {
									void fm.session.exit(fmExited)
								}}
								onPlayer={() => {
									fm.session.close()
									fmStarted()
								}}
								onResume={() => {
									fm.session.close()
									void returnToMusic()
								}}
								onSearch={() => leaveFm('search')}
								onLibrary={() => leaveFm('library')}
								playbackError={player.error}
							/>
						)}
						{recommendations.state.open && (
							<RecommendationPage
								state={recommendations.state}
								session={recommendations.session}
								onPlay={playRecommendation}
							/>
						)}
						{followingFeed.state.open && (
							<FollowingFeedPage
								state={followingFeed.state}
								session={followingFeed.session}
								onCreator={openFollowingCreator}
								onManage={() => openFollowingCreator()}
								onPlay={playFollowingPost}
								onSearch={() => navigateSearch(undefined, 'creator', 'library')}
							/>
						)}
						<PageScrollHost
							style={
								importsVisible ||
								recommendations.state.open ||
								fm.state.open ||
								followingFeed.state.open
									? { display: 'none' }
									: undefined
							}
							key={pageKey}
							scrollRef={pageScroll}
							virtualized={tab === 'library' && !!playlists.state.currentId}
							onScroll={(event) =>
								scrollOffsets.current.set(
									pageKey,
									event.nativeEvent.contentOffset.y,
								)
							}
							scrollEventThrottle={100}
							keyboardShouldPersistTaps='handled'
							testID={`${tab}-page`}
							contentContainerStyle={{
								paddingHorizontal: 20,
								paddingTop: 18,
								paddingBottom: 24,
							}}
						>
							{tab !== 'home' && <ThemePageArtwork profile={tab === 'profile' && !profileSettingsOpen} />}
							{tab === 'home' && (
								<>
									<HomeHeader onThemes={() => setSheet('themes')} />
									<HomeSearchEntry
										channel={homeChannel}
										onPress={() => navigateSearch(undefined, homeChannel)}
									/>
									<HomeDiscoveryTabs
										channel={homeChannel}
										onMusic={() => setHomeChannel('music')}
										onListening={() => setHomeChannel('listening')}
									/>
									{homeChannel === 'listening' ? (
										<ListeningHome
											items={resumeItems.slice(0, 3)}
											onPlay={(source) => {
												void listening.start(source)
											}}
											onSearch={() => navigateSearch(undefined, 'listening')}
											busy={!!listening.pendingBvid || player.switching}
											error={localDataError}
										/>
									) : (
										<>
											<HomeShortcuts
												onLikes={() => {
													openLibraryCollection('likes')
												}}
												onRecent={() => {
													openLibraryCollection('recent')
												}}
												onLocal={() => {
													openLibraryCollection('local')
												}}
												onOffline={() => setOfflineOpen(true)}
											/>
											<HomeLocalFeatures
												onRecommendations={openRecommendations}
												onFm={openFm}
											/>
											<Card style={{ marginTop: 14 }}>
												<View
													style={{
														flexDirection: 'row',
														alignItems: 'center',
														justifyContent: 'space-between',
														gap: 8,
													}}
												>
													<View style={{ flex: 1, gap: 2 }}>
														<T weight='700'>抖音原声 · 同步歌词</T>
														<T
															size={12}
															muted
														>
															粘贴分享链接免登录提取原声后台听歌，或登录同步喜欢与收藏
														</T>
													</View>
													<Button
														secondary
														onPress={() => setDouyinLoginOpen(true)}
													>
														{douyinState.status === 'authenticated'
															? douyinState.nickname || '抖音已连接'
															: '抖音登录'}
													</Button>
												</View>
												<View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
													<Button
														onPress={() =>
															navigateSearch(undefined, 'douyin', 'home')
														}
													>
														提取链接 / 搜原声
													</Button>
													<Button
														secondary
														onPress={() => setDouyinCollectionKind('favorite')}
													>
														抖音喜欢
													</Button>
													<Button
														secondary
														onPress={() =>
															setDouyinCollectionKind('collection')
														}
													>
														抖音收藏
													</Button>
												</View>
											</Card>
											{likes.length > 0 && (
												<>
													<T
														size={18}
														weight='700'
														style={{ marginTop: 25 }}
													>
														我喜欢的
													</T>
													{likes.slice(0, 2).map(row)}
												</>
											)}
											<T
												size={18}
												weight='700'
												style={{ marginTop: 25, marginBottom: 13 }}
											>
												继续探索
											</T>
											<T
												muted
												size={12}
												style={{ marginBottom: 13 }}
											>
												试试这些关键词
											</T>
											<View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
												{['周杰伦 晴天', 'ヨルシカ ただ君に晴れ', '纯音乐'].map(
													(value) => (
														<Button
															key={value}
															secondary
															onPress={() => navigateSearch(value)}
														>
															{value}
														</Button>
													),
												)}
											</View>
											<View style={{ marginTop: 14 }}>
												<HomeMusicHero onPress={() => navigateSearch()} />
												<PreferenceDiscovery
													preferences={musicPreferences}
													onEdit={openMusicPreferences}
													onSearch={(seed) => navigateSearch(seed, 'music')}
													onPlay={(item) => {
														void start(item)
													}}
												/>
											</View>
										</>
									)}
								</>
							)}
							{tab === 'search' && (
								<SearchPage
									query={query}
									filter={filter}
									search={search}
									creatorSearch={creatorSearch}
									onQueryChange={setQuery}
									onFilterChange={setFilter}
									onSubmit={find}
									history={searchHistory}
									onSelectHistory={(entry) => {
										setQuery(entry.query)
										setFilter(entry.kind)
										void find(entry.query, entry.kind, entry.order)
									}}
									onOpenCreator={openCreatorSummary}
									renderRow={row}
									douyinContent={
										<DouyinSearchSection
											submittedQuery={douyinSubmittedQuery}
											searchRevision={douyinSearchRevision}
											likedIds={musicLikedIds}
											playbackBusy={
												player.switching || !!listening.pendingBvid
											}
											currentSourceId={
												player.track?.sourceId ?? player.track?.id ?? null
											}
											onOpenLogin={() => setDouyinLoginOpen(true)}
											onPlayQueue={(items, startId) => {
												void playDouyinQueue(items, startId)
											}}
											onToggleLike={toggleLikeDouyin}
											onAddToPlaylist={addDouyinToPlaylist}
										/>
									}
								/>
							)}
							{tab === 'library' && (
								<LibraryPage
									onOffline={() => setOfflineOpen(true)}
									collection={libraryCollection}
									collectionBackLabel={collectionOrigin === 'profile' ? '返回我的' : collectionOrigin === 'home' ? '返回发现' : '返回音乐库'}
									onCollectionChange={(collection) => collection === 'root' ? closeLibraryCollection() : setLibraryCollection(collection)}
									recentMusic={
										<RecentMusicSection
											embedded
											onPlay={(id) => {
												void playRecentMusic(id)
											}}
											playbackBusy={player.switching || !!listening.pendingBvid}
										/>
									}
									localAudio={
										<LocalAudioSection
											store={localAudioStore}
											likedIds={musicLikes.map((source) => source.id)}
											onToggleLiked={likeLocal}
											onAddToPlaylist={addLocalToPlaylist}
											playbackBusy={player.switching}
											onPlay={(id) => {
												void playLocalAudio(id)
											}}
										/>
									}
									playlistState={playlists.state}
									playlistSession={playlists.session}
									onPlaylistBack={() => {
										if (playlists.state.editing)
											playlists.session.setEditing(false)
										else playlists.session.close()
									}}
									onPlaylistSearch={() =>
										navigateSearch(undefined, 'music', 'library')
									}
									onPlayPlaylist={playPlaylist}
									onPlayLiked={playAllLiked}
									playbackBusy={player.switching || !!listening.pendingBvid}
									currentEntryId={player.track?.id ?? null}
									bottomInset={insets.bottom}
									reducedMotion={reduced || systemReduced}
									listeningOpen={listeningLibraryOpen}
									onListeningOpenChange={setListeningLibraryOpen}
									resumeItems={resumeItems}
									onPlayListening={(source) => {
										void listening.start(source)
									}}
									localDataError={localDataError}
									onFindListening={() => navigateSearch(undefined, 'listening')}
									onFindMusic={() => navigateSearch(undefined, 'music')}
									onOpenFollowing={creators.session.openFollowing}
									onOpenFollowingFeed={openFollowingFeed}
									onImport={openImportHub}
									onOpenVideoSaves={openVideoLibrary}
									onReviewBilibiliPending={openBilibiliPending}
									onChangeSource={changeImportedSource}
									likes={musicLikes}
									renderLikedSource={musicLibraryRow}
								/>
							)}
							{tab === 'profile' && (
								<>
									<View
										style={{
											flexDirection: 'row',
											alignItems: 'center',
											marginBottom: 20,
											gap: 10,
										}}
									>
										{profileSettingsOpen && (
											<IconButton
												name='back'
												label='返回我的'
												onPress={() => setProfileSettingsOpen(false)}
											/>
										)}
										<T
											variant='title'
											style={{ flex: 1 }}
										>
											{profileSettingsOpen ? '设置' : '我的音绘'}
										</T>
										{!profileSettingsOpen && (
											<IconButton
												name='info'
												label='打开设置'
												onPress={() => setProfileSettingsOpen(true)}
											/>
										)}
									</View>
									{!profileSettingsOpen ? (
										<>
											<View
												style={{
													flexDirection: 'row',
													gap: 14,
													alignItems: 'center',
													marginBottom: 24,
												}}
											>
												<ProfileAvatar key={accountId} library={library} accountId={accountId} accountAvatar={accountAvatar} onNotice={setNotice} />
												<View style={{ flex: 1 }}>
													<T variant='section'>{accountName}</T>
													<T variant='caption'>音乐库与播放记录保存在本机</T>
												</View>
											</View>
											{onRequestBilibiliLogin && (
												<View style={{ marginBottom: 18 }}>
													<Button
														secondary
														onPress={onRequestBilibiliLogin}
													>
														登录 B 站账号（可选，解锁 B 站在线播放）
													</Button>
												</View>
											)}
											<SettingsGroup title='抖音原声'>
												<SettingsRow
													label='抖音账号'
													value={
														douyinState.status === 'authenticated'
															? douyinState.nickname || '已连接'
															: '未登录'
													}
													onPress={() => setDouyinLoginOpen(true)}
												/>
												<SettingsRow
													label='抖音 · 我的喜欢'
													onPress={() => setDouyinCollectionKind('favorite')}
												/>
												<SettingsRow
													label='抖音 · 我的收藏'
													onPress={() => setDouyinCollectionKind('collection')}
												/>
												<SettingsRow
													label='提取抖音分享链接 / 搜索原声'
													onPress={() =>
														navigateSearch(undefined, 'douyin', 'profile')
													}
												/>
											</SettingsGroup>
											<SettingsGroup title='关注'>
												<SettingsRow
													label='关注的 UP 主'
													onPress={creators.session.openFollowing}
												/>
												<SettingsRow
													label='从 B 站选择导入关注'
													onPress={() => void accountFollowing.open()}
												/>
											</SettingsGroup>
											<SettingsGroup title='本机音乐'>
												<SettingsRow
													label='下载与离线'
													onPress={() => setOfflineOpen(true)}
												/>
												<SettingsRow
													label='本地音乐'
													onPress={() => {
														openLibraryCollection('local')
													}}
												/>
												<SettingsRow
													label='最近播放'
													onPress={() => {
														openLibraryCollection('recent')
													}}
												/>
											</SettingsGroup>
											<SettingsGroup title='应用'>
												<SettingsRow
													label='设置'
													onPress={() => setProfileSettingsOpen(true)}
												/>

											</SettingsGroup>
										</>
									) : (
										<>
											<SettingsGroup title='播放'>
												<PlaybackNetworkSetting />
												<SettingsRow
													label='媒体通知与锁屏'
													detail={
														notifications
															? '通知已允许；锁屏显示需在系统中单独开启'
															: '开启后可在通知栏查看歌曲、暂停和切歌'
													}
													onPress={() => void notificationSettings()}
												/>
												<SettingsRow
													label='锁屏没有音乐卡片？'
													detail='常见问题 · 通知权限与锁屏显示的区别'
													onPress={showPlaybackNotificationHelp}
												/>
											</SettingsGroup>
											<SettingsGroup title='显示'>
												<AppearanceSetting appearance={appearance} />
												<ReducedMotionSetting
													value={reduced}
													onValueChange={(value) => {
														try {
															library.setSetting('reducedMotion', String(value))
															setReduced(value)
														} catch {
															setNotice('设置保存失败')
														}
													}}
												/>
												<SettingsRow
													label='主题工坊'
													value={theme.name}
													onPress={() => setSheet('themes')}
												/>
											</SettingsGroup>
											<SettingsGroup title='本机数据'>
												<SettingsRow
													label='音乐偏好'
													onPress={openMusicPreferences}
												/>
												<PrivacyDataEntry
													store={musicPreferencesStore}
													onPreferences={openMusicPreferences}
													onSearchHistory={() =>
														navigateSearch(undefined, undefined, 'profile')
													}
													onRecentMusic={() => {
														playlists.session.close()
														setListeningLibraryOpen(false)
														openLibraryCollection('recent')
													}}
													onRecommendations={openRecommendations}
												/>
												<LibraryBackupEntry
													onRestored={() => {
														setPreferencesOpen(false)
														setMusicPreferences(musicPreferencesStore.load())
														searchHistory.session.reload()
														void player.sync()
														setLikes(library.likes())
														setMusicLikes(library.musicLikes())
														playlists.session.refresh()
													}}
												/>
											</SettingsGroup>
											<SettingsGroup title='账号与应用'>
												{onReconnect && (
													<SettingsRow
														label='联网验证账号'
														onPress={onReconnect}
													/>
												)}
												<SettingsRow
													label='抖音账号连接'
													value={
														douyinState.status === 'authenticated'
															? douyinState.nickname || '已连接'
															: '未登录'
													}
													onPress={() => setDouyinLoginOpen(true)}
												/>
												{onRequestBilibiliLogin && (
													<SettingsRow
														label='登录 B 站账号（可选）'
														detail='当前为免登录模式；登录后可播放 B 站在线音源'
														onPress={onRequestBilibiliLogin}
													/>
												)}
												{onSignOut && <AccountSignOut onSignOut={onSignOut} />}
												<AuthorSupportEntry />
											</SettingsGroup>
											<T variant='caption'>
												MeloCanvas {appVersion}，内部体验版{'\n'}基于 BBPlayer
												/ Orpheus，MIT
											</T>
										</>
									)}
								</>
							)}
						</PageScrollHost>
						<HostPlaybackFooter
							mini={
								player.track
									? {
											mode: player.mode,
											title: player.track.title,
											artist: player.track.artist,
											artwork: player.track.artwork,
											playing: player.playing,
											buffering: player.buffering,
											error: player.error,
											progress: player.progress,
											position: player.position,
											duration: player.duration,
											onOpen: () => {
												followingFeed.session.cancelPending()
												setFullPlayer(true)
											},
											onToggle: () => {
												void player.toggle()
											},
											onQueue: () => setSheet('queue'),
										}
									: null
							}
							tab={tab}
							bottomInset={insets.bottom}
							onNavigate={(destination) => {
								setCollectionOrigin(null)
								setLibraryCollection('root')
								imports.session.close()
								biliImports.session.close()
								videoLibrary.session.close()
								recommendations.session.close()
								fm.session.close()
								followingFeed.session.close()
								setListeningLibraryOpen(false)
								setProfileSettingsOpen(false)
								setTab(destination)
							}}
						/>
					</>
				)}
				<PlaylistSourceActions
					item={sourceActions}
					onClose={() => setSourceActions(null)}
					onCreator={openCreator}
					onAdd={(item) => {
						void addSourceToPlaylist(item)
					}}
					onListen={(item) => {
						setSourceActions(null)
						void listening.start(item)
					}}
					bottomInset={insets.bottom}
					reducedMotion={reduced || systemReduced}
				/>
				<CreatorOverlay
					remoteProfile={
						creators.remoteReady &&
						creators.remoteState.mid === creators.state.creator?.mid ? (
							<CreatorProfileRead
								state={creators.remoteState}
								session={creators.remote}
							/>
						) : undefined
					}
					remotePosts={
						creators.remoteReady &&
						creators.remoteState.mid === creators.state.creator?.mid ? (
							<CreatorPostsRead
								state={creators.remoteState}
								session={creators.remote}
								playbackBusy={creators.state.playbackBusy}
								onPlay={playCreatorSource}
							/>
						) : undefined
					}
					state={creators.state}
					session={creators.session}
					playbackError={player.error}
					onPlay={playCreatorSource}
					onOpenSpace={(url) => Linking.openURL(url)}
					topInset={insets.top}
					bottomInset={insets.bottom}
					reducedMotion={reduced || systemReduced}
				/>
				<PlaylistDialogs
					state={playlists.state}
					session={playlists.session}
					bottomInset={insets.bottom}
					reducedMotion={reduced || systemReduced}
					onSearch={() => navigateSearch(undefined, 'music', 'library')}
				/>
				<Modal
					visible={sheet !== null}
					transparent
					animationType={reduced || systemReduced ? 'none' : 'fade'}
					onRequestClose={closeSheet}
				>
					<View
						style={{
							flex: 1,
							justifyContent: 'flex-end',
							backgroundColor: '#101b1666',
						}}
					>
						<Pressable
							accessibilityRole='button'
							accessibilityLabel='关闭浮层'
							style={StyleSheet.absoluteFill}
							onPress={closeSheet}
						/>
						<View
							style={{
								backgroundColor: c.surface.base,
								borderTopLeftRadius: 25,
								borderTopRightRadius: 25,
								padding: 22,
								paddingBottom: insets.bottom + 22,
								maxHeight: '88%',
								height: sheet === 'queue' ? '88%' : undefined,
							}}
						>
							<View
								style={[
									s.row,
									{ justifyContent: 'space-between', marginBottom: 12 },
								]}
							>
								<T
									size={21}
									weight='700'
									style={{ flex: 1, minWidth: 0 }}
								>
									{sheet === 'themes'
										? '主题工坊'
										: sheet === 'source'
											? '音源信息'
											: sheet === 'parts'
												? '切换分 P'
												: `${player.mode === 'listening' ? '分 P 队列' : '当前队列'}，${player.queue.length}`}
								</T>
								<IconButton
									name='close'
									label='关闭面板'
									onPress={closeSheet}
								/>
							</View>
							<PageScrollHost
								virtualized={sheet === 'queue'}
								scrollRef={sheetScroll}
								keyboardShouldPersistTaps='handled'
								style={{ marginRight: -14 }}
								contentContainerStyle={{ paddingRight: 14 }}
							>
								{sheet === 'parts' && musicPartsIdentity ? (
									<MusicPartsPanel
										key={`${musicPartsIdentity.entryId}:${musicPartsIdentity.sourceId}`}
										identity={musicPartsIdentity}
										player={player}
										intent={playbackIntent}
										catalog={videoCatalog}
										gate={biliImports.session.gate}
										onClose={closeSheet}
										onNotice={setNotice}
									/>
								) : sheet === 'source' &&
								  isDouyinAudioId(
										player.track?.sourceId ?? player.track?.id ?? '',
								  ) ? (
									<View style={{ gap: 12 }}>
										<T
											size={18}
											weight='600'
										>
											{player.track?.title || '抖音原声'}
										</T>
										<T>创作者 / 歌手：{player.track?.artist || '抖音原声'}</T>
										<T muted>
											来源：抖音原声，作品 ID{' '}
											{(player.track?.sourceId ?? player.track?.id ?? '').slice(
												7,
											)}
										</T>
										<T muted>
											时长：{time(player.duration || player.track?.duration || 0)}
										</T>
										<T muted>
											已提取纯音频流后台播放，播放时自动从在线歌词库匹配并同步歌词。
										</T>
									</View>
								) : sheet === 'source' ? (
									<View style={{ gap: 12 }}>
										<T
											size={18}
											weight='600'
										>
											{current?.originalTitle || player.track?.title}
										</T>
										<T>上传者：{current?.uploader}</T>
										{sourceReplacement && <Button onPress={() => changeImportedSource(sourceReplacement.playlistId, sourceReplacement.itemId)}>更换音源</Button>}
										{current && (
											<Button
												secondary
												onPress={() => openCreator(current)}
											>
												查看 UP 主主页
											</Button>
										)}
										{player.mode === 'music' && (
											<T muted>歌手与录音版本：尚未核对</T>
										)}
										<T muted>来源：Bilibili，{current?.bvid}</T>
										<T muted>
											CID：{current?.cid}，时长 {time(current?.duration ?? 0)}
										</T>
										<T muted>
											{player.mode === 'listening'
												? '保留原视频与分 P 信息。使用独立音轨收听，不下载视频流。'
												: '保留原始视频信息。标题与 UP 主不等于经过确认的歌曲版本或表演者。'}
										</T>
									</View>
								) : sheet === 'themes' ? (
									<ThemeWorkshop
										colorMode={appearance.mode}
										themeKey={themeKey}
										mode={player.mode}
										onSelect={switchTheme}
										disabled={
											themeWorkshopBusy(workshop.state) ||
											!!workshop.state.installer?.readOnly ||
											!workshop.state.installer
										}
									>
										<ThemePackagePanel
											colorMode={appearance.mode}
											state={workshop.state}
											display={currentDisplay}
											session={workshop.session}
											reducedMotion={reduced || systemReduced}
										/>
									</ThemeWorkshop>
								) : sheet === 'queue' && player.canRemoveMusicQueue ? (
									<MusicQueue
										canMoveNext={player.canArrangeMusicQueue}
										key={JSON.stringify([
											player.track?.id,
											player.queue.map((item) => item.id),
										])}
										tracks={player.queue}
										currentEntryId={player.track?.id ?? null}
										switching={player.switching}
										onMoveNext={player.moveMusicQueueEntryNext}
										onRemove={player.removeMusicQueueEntry}
										undo={player.musicQueueUndo}
										onUndo={player.undoMusicQueueRemoval}
										onRefresh={player.sync}
										onSelect={(index, entryId) => {
											void player.select(index, entryId).then((success) => {
												if (success) setSheet(null)
											})
										}}
									/>
								) : sheet === 'queue' ? (
									<FlatList
										data={player.queue}
										keyExtractor={(item) => item.id}
										initialNumToRender={12}
										maxToRenderPerBatch={8}
										windowSize={5}
										keyboardShouldPersistTaps='handled'
										renderItem={({ item, index }) => (
										<AppQueueItem
											key={item.id}
											index={index}
											selected={item.id === player.track?.id}
											mode={player.mode}
											label={
												player.mode === 'listening'
													? `分 P ${index + 1} ${listeningPartsById.get(item.id)?.title ?? '信息待读取'}`
													: `队列第${index + 1}项 ${item.title}`
											}
											title={
												player.mode === 'listening'
													? (listeningPartsById.get(item.id)?.title ?? '分 P 信息待读取')
													: item.title
											}
											artist={item.artist}
											artwork={item.artwork}
											onPress={() => {
												void player.select(index).then((success) => {
													if (success) setSheet(null)
												})
											}}
										/>
									)} />
								) : null}
							</PageScrollHost>
						</View>
					</View>
				</Modal>
				<Modal
					visible={accountFollowingState.open}
					animationType='slide'
					onRequestClose={() => {
						if (accountFollowingState.review) accountFollowing.cancelReview()
						else accountFollowing.close()
					}}
				>
					<View
						style={{
							flex: 1,
							paddingTop: insets.top,
							backgroundColor: c.surface.base,
						}}
					>
						<Backdrop />
						<AccountFollowingPage
							state={accountFollowingState}
							session={accountFollowing}
							onImported={() => creators.session.refresh()}
						/>
					</View>
				</Modal>
				<OfflineManager
					visible={offlineOpen}
					onClose={() => setOfflineOpen(false)}
					track={
						!player.auditionId && player.mode === 'music' ? player.track : null
					}
					bottomInset={insets.bottom}
					onPlay={async (track) => {
						const success = await playbackIntent.run({
							preparation: player,
							prepare: async () => track,
							activate: (target, preparation) =>
								player.playOfflineTrack(target, preparation),
							onSuccess: () => setFullPlayer(true),
						})
						if (!success)
							throw new Error('离线播放未开始，请检查内容完整性后重试')
					}}
				/>
				<DouyinLoginModal
					visible={douyinLoginOpen}
					onClose={() => setDouyinLoginOpen(false)}
					onNotice={setNotice}
				/>
				<DouyinCollectionModal
					visible={douyinCollectionKind !== null}
					kind={douyinCollectionKind}
					likedIds={musicLikedIds}
					playbackBusy={player.switching || !!listening.pendingBvid}
					currentSourceId={player.track?.sourceId ?? player.track?.id ?? null}
					onClose={() => setDouyinCollectionKind(null)}
					onOpenLogin={() => setDouyinLoginOpen(true)}
					onPlayQueue={(items, startId) => {
						void playDouyinQueue(items, startId)
					}}
					onToggleLike={toggleLikeDouyin}
					onAddToPlaylist={addDouyinToPlaylist}
				/>
				{!!notice && (
					<View
						pointerEvents='none'
						accessibilityLiveRegion='polite'
						style={{
							position: 'absolute',
							bottom: fullPlayer ? insets.bottom + 24 : insets.bottom + 135,
							left: 24,
							right: 24,
							borderRadius: 13,
							padding: 14,
							backgroundColor: c.text.primary,
						}}
					>
						<T
							size={12}
							style={{ color: c.surface.base, textAlign: 'center' }}
						>
							{notice}
						</T>
					</View>
				)}
				</StartupContent>
			</View>
		</ThemeRendererProvider>
	)
}

const s = StyleSheet.create({
	row: { flexDirection: 'row', alignItems: 'center' },
})
