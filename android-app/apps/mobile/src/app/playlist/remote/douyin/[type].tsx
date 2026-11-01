import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { Appbar, Text, useTheme } from 'react-native-paper'

import ActivityIndicator from '@/components/common/ActivityIndicator'
import { PlaylistHeader } from '@/features/playlist/remote/components/PlaylistHeader'
import { TrackList } from '@/features/playlist/remote/components/RemoteTrackList'
import { useTrackSelection } from '@/features/playlist/remote/hooks/useTrackSelection'
import { PlaylistPageSkeleton } from '@/features/playlist/skeletons/PlaylistSkeleton'
import useAppStore from '@/hooks/stores/useAppStore'
import { useModalStore } from '@/hooks/stores/useModalStore'
import { douyinApi } from '@/lib/api/douyin/api'
import type { DouyinTrack } from '@/types/core/media'
import { addToQueue } from '@/utils/player'
import toast from '@/utils/toast'

export default function DouyinPlaylistPage() {
	const { type } = useLocalSearchParams<{ type: 'favorite' | 'collection' }>()
	const theme = useTheme()
	const router = useRouter()
	const openModal = useModalStore((state) => state.open)

	const hasDouyinCookie = useAppStore((state) => state.hasDouyinCookie())
	const [tracks, setTracks] = useState<DouyinTrack[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [cursor, setCursor] = useState(0)
	const [hasMore, setHasMore] = useState(true)

	const { selected, selectMode, toggle, enterSelectMode } = useTrackSelection()

	const title = type === 'favorite' ? '抖音 · 我的喜欢' : '抖音 · 我的收藏'

	const loadData = useCallback(
		async (isRefresh = false) => {
			if (!hasDouyinCookie) {
				setIsLoading(false)
				setIsRefreshing(false)
				return
			}

			if (isRefresh) {
				setIsRefreshing(true)
			} else {
				setIsLoading(true)
			}

			const currentCursor = isRefresh ? 0 : cursor

			const queryResult =
				type === 'favorite'
					? await douyinApi.getFavoriteList({
							maxCursor: currentCursor,
							count: 20,
						})
					: await douyinApi.getCollectionList({
							cursor: currentCursor,
							count: 20,
						})

			if (queryResult.isErr()) {
				toast.error(`获取抖音数据失败: ${queryResult.error.message}`)
				setIsLoading(false)
				setIsRefreshing(false)
				return
			}

			const { list, maxCursor: nextCursor, cursor: nextCollCursor, hasMore: more } =
				queryResult.value as any

			const newTracks = list.map((item: any) => douyinApi.convertToTrack(item))

			setTracks((prev) => (isRefresh ? newTracks : [...prev, ...newTracks]))
			setCursor(nextCursor ?? nextCollCursor ?? 0)
			setHasMore(more)
			setIsLoading(false)
			setIsRefreshing(false)
		},
		[cursor, hasDouyinCookie, type],
	)

	useEffect(() => {
		loadData(true)
	}, [hasDouyinCookie, type])

	const handlePlayTrack = useCallback((track: DouyinTrack) => {
		void addToQueue({
			tracks: [track],
			playNow: true,
			clearQueue: false,
			playNext: false,
			startFromKey: track.uniqueKey,
		})
	}, [])

	const handlePlayAll = useCallback(() => {
		if (tracks.length === 0) return
		void addToQueue({
			tracks,
			playNow: true,
			clearQueue: true,
			playNext: false,
			startFromKey: tracks[0].uniqueKey,
		})
	}, [tracks])

	return (
		<View style={[styles.container, { backgroundColor: theme.colors.background }]}>
			<Appbar.Header style={{ backgroundColor: theme.colors.background }}>
				<Appbar.BackAction onPress={() => router.back()} />
				<Appbar.Content title={title} />
				<Appbar.Action
					icon='login'
					onPress={() => openModal('DouyinLogin' as any, undefined)}
				/>
			</Appbar.Header>

			{!hasDouyinCookie ? (
				<View style={styles.emptyContainer}>
					<Text variant='bodyLarge' style={styles.emptyText}>
						尚未登录或授权抖音账号
					</Text>
					<Text variant='bodySmall' style={[styles.emptyHint, { color: theme.colors.outline }]}>
						点击右上角登录按钮，扫码或输入手机验证码即可读取收藏
					</Text>
				</View>
			) : isLoading && tracks.length === 0 ? (
				<PlaylistPageSkeleton />
			) : (
				<TrackList
					tracks={tracks as any}
					selectMode={selectMode}
					selected={selected}
					onToggleSelect={toggle}
					onEnterSelectMode={enterSelectMode}
					playTrack={handlePlayTrack as any}
					onEndReached={() => {
						if (!isLoading && hasMore) {
							loadData(false)
						}
					}}
					refreshControl={
						<RefreshControl
							refreshing={isRefreshing}
							onRefresh={() => loadData(true)}
							colors={[theme.colors.primary]}
						/>
					}
					ListHeaderComponent={
						<PlaylistHeader
							title={title}
							description={`已同步 ${tracks.length} 首原声 / 音乐`}
							coverUrl={tracks[0]?.coverUrl}
							trackCount={tracks.length}
							onPlayAll={handlePlayAll}
							isLocal={false}
							id={99999}
						/>
					}
				/>
			)}
		</View>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	emptyContainer: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: 32,
	},
	emptyText: {
		fontSize: 16,
		fontWeight: '600',
		marginBottom: 8,
	},
	emptyHint: {
		textAlign: 'center',
	},
})
