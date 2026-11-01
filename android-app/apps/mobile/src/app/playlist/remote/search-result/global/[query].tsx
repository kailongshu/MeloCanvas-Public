import { useLocalSearchParams, useRouter } from 'expo-router'
import { decode } from 'he'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { Appbar, SegmentedButtons, Text, useTheme } from 'react-native-paper'

import ActivityIndicator from '@/components/common/ActivityIndicator'
import { PlaylistError } from '@/features/playlist/remote/components/PlaylistError'
import { TrackList } from '@/features/playlist/remote/components/RemoteTrackList'
import { useTrackSelection } from '@/features/playlist/remote/hooks/useTrackSelection'
import { SearchUserHeader } from '@/features/playlist/remote/search-result/components/SearchUserHeader'
import { useSearchInteractions } from '@/features/playlist/remote/search-result/hooks/useSearchInteractions'
import {
	PlaylistTrackListSkeleton,
	TrackListItemSkeletonGroup,
} from '@/features/playlist/skeletons/PlaylistSkeleton'
import { useSearchResults } from '@/hooks/queries/bilibili/search'
import { useScreenTransitionReady } from '@/hooks/router/useScreenTransitionReady'
import { useModalStore } from '@/hooks/stores/useModalStore'
import { useDoubleTapScrollToTop } from '@/hooks/ui/useDoubleTapScrollToTop'
import { douyinApi } from '@/lib/api/douyin/api'
import { analyticsService } from '@/lib/services/analyticsService'
import type { BilibiliSearchVideo } from '@/types/apis/bilibili'
import type { BilibiliTrack, DouyinTrack, Track } from '@/types/core/media'
import { formatMMSSToSeconds } from '@/utils/time'
import toast from '@/utils/toast'

const mapApiItemToTrack = (apiItem: BilibiliSearchVideo): BilibiliTrack => {
	return {
		id: apiItem.aid,
		uniqueKey: `bilibili::${apiItem.bvid}`,
		source: 'bilibili',
		title: apiItem.title.replace(/<em[^>]*>|<\/em>/g, ''),
		artist: {
			id: apiItem.mid,
			name: apiItem.author,
			remoteId: apiItem.mid.toString(),
			source: 'bilibili',
			createdAt: new Date(apiItem.senddate),
			updatedAt: new Date(apiItem.senddate),
		},
		coverUrl: `https:${apiItem.pic}`,
		duration: apiItem.duration ? formatMMSSToSeconds(apiItem.duration) : 0,
		createdAt: new Date(apiItem.senddate),
		updatedAt: new Date(apiItem.senddate),
		titleHtml: apiItem.title,
		bilibiliMetadata: {
			bvid: apiItem.bvid,
			cid: null,
			isMultiPage: false,
			videoIsValid: true,
		},
	}
}

export default function SearchResultsPage() {
	const isListReady = useScreenTransitionReady()
	const { colors } = useTheme()
	const { query } = useLocalSearchParams<{ query: string }>()
	const router = useRouter()

	const [source, setSource] = useState<'bilibili' | 'douyin'>('bilibili')
	const [douyinTracks, setDouyinTracks] = useState<DouyinTrack[]>([])
	const [isDouyinLoading, setIsDouyinLoading] = useState(false)

	const { selected, selectMode, toggle, enterSelectMode } = useTrackSelection()
	const selection = useMemo(
		() => ({
			active: selectMode,
			selected,
			toggle,
			enter: enterSelectMode,
		}),
		[selectMode, selected, toggle, enterSelectMode],
	)
	const [refreshing, setRefreshing] = useState(false)
	const openModal = useModalStore((state) => state.open)

	const { listRef, handleDoubleTap } = useDoubleTapScrollToTop()

	const {
		data: searchData,
		isPending: isPendingSearchData,
		isError: isErrorSearchData,
		hasNextPage,
		isFetchingNextPage,
		refetch,
		fetchNextPage,
	} = useSearchResults(query)

	const searchDouyin = useCallback(async () => {
		if (!query) return
		setIsDouyinLoading(true)
		const res = await douyinApi.search({ keyword: query })
		if (res.isErr()) {
			toast.error(`抖音搜索失败: ${res.error.message}`)
			setIsDouyinLoading(false)
			return
		}
		const mapped = res.value.map((item) => douyinApi.convertToTrack(item))
		setDouyinTracks(mapped)
		setIsDouyinLoading(false)
	}, [query])

	useEffect(() => {
		if (source === 'douyin' && douyinTracks.length === 0) {
			searchDouyin()
		}
	}, [source, douyinTracks.length, searchDouyin])

	useEffect(() => {
		if (query) {
			void analyticsService.logSearch('global')
		}
	}, [query])

	const { trackMenuItems, playTrack } = useSearchInteractions()

	const uniqueBiliSearchData = useMemo(() => {
		if (!searchData?.pages) {
			return []
		}

		const allTracks = searchData.pages.flatMap((page) => page.result)
		const uniqueMap = new Map(
			allTracks.map((track) => [
				track.bvid,
				{
					...track,
					title: decode(track.title),
				},
			]),
		)
		const uniqueTracks = [...uniqueMap.values()]
		return uniqueTracks.map(mapApiItemToTrack)
	}, [searchData])

	const currentTracks: Track[] =
		source === 'bilibili' ? uniqueBiliSearchData : douyinTracks

	if (!isListReady) {
		return <PlaylistTrackListSkeleton animate={isListReady} />
	}

	if (source === 'bilibili' && isErrorSearchData) {
		return <PlaylistError text='加载失败' />
	}

	return (
		<View style={[styles.container, { backgroundColor: colors.background }]}>
			<Appbar.Header elevated>
				<Appbar.Content
					title={
						selectMode
							? `已选择\u2009${selected.size}\u2009首`
							: `搜索\u2009-\u2009${query}`
					}
					onPress={handleDoubleTap}
				/>
				{selectMode ? (
					<>
						<Appbar.Action
							icon='playlist-plus'
							onPress={() => {
								const payloads = []
								for (const id of selected) {
									const track = currentTracks.find((t) => t.id === id)
									if (track) {
										payloads.push({
											track,
											artist: track.artist!,
										})
									}
								}
								openModal('BatchAddTracksToLocalPlaylist', {
									payloads,
								})
							}}
						/>
					</>
				) : (
					<Appbar.BackAction onPress={() => router.back()} />
				)}
			</Appbar.Header>

			<View style={styles.segmentContainer}>
				<SegmentedButtons
					value={source}
					onValueChange={(val) => setSource(val as 'bilibili' | 'douyin')}
					buttons={[
						{ value: 'bilibili', label: 'B 站音源' },
						{ value: 'douyin', label: '抖音原声 / 音乐' },
					]}
				/>
			</View>

			<View style={styles.listContainer}>
				<TrackList
					listRef={listRef}
					tracks={currentTracks}
					playTrack={playTrack as any}
					trackMenuItems={trackMenuItems as any}
					selection={selection}
					onEndReached={
						source === 'bilibili' && hasNextPage
							? () => fetchNextPage()
							: undefined
					}
					hasNextPage={source === 'bilibili' ? hasNextPage : false}
					isFetchingNextPage={
						source === 'bilibili' ? isFetchingNextPage : isDouyinLoading
					}
					ListHeaderComponent={
						source === 'bilibili' ? <SearchUserHeader query={query} /> : null
					}
					refreshControl={
						<RefreshControl
							refreshing={refreshing}
							onRefresh={async () => {
								setRefreshing(true)
								if (source === 'bilibili') {
									await refetch()
								} else {
									await searchDouyin()
								}
								setRefreshing(false)
							}}
							colors={[colors.primary]}
							progressViewOffset={50}
						/>
					}
					ListEmptyComponent={
						(source === 'bilibili' && isPendingSearchData) ||
						(source === 'douyin' && isDouyinLoading) ? (
							<View>
								<View style={styles.videoLoadingRow}>
									<Text
										variant='titleMedium'
										style={[
											styles.videoSectionTitle,
											{ color: colors.onSurface },
										]}
									>
										{source === 'bilibili' ? '相关视频' : '搜索抖音原声'}
									</Text>
									<ActivityIndicator
										size='small'
										style={{ marginLeft: 8 }}
									/>
								</View>
								<TrackListItemSkeletonGroup
									count={10}
									animate
								/>
							</View>
						) : (
							<Text
								style={[
									styles.emptyListText,
									{ color: colors.onSurfaceVariant },
								]}
							>
								没有找到与&thinsp;&ldquo;{query}&rdquo;&thinsp;相关的内容
							</Text>
						)
					}
				/>
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	segmentContainer: {
		paddingHorizontal: 16,
		paddingVertical: 8,
	},
	listContainer: {
		flex: 1,
	},
	emptyListText: {
		paddingVertical: 32,
		textAlign: 'center',
	},
	videoLoadingRow: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 16,
		marginTop: 18,
		marginBottom: 4,
	},
	videoSectionTitle: {
		fontWeight: 'bold',
	},
})
