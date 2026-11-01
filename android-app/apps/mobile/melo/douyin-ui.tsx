import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Modal, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { DouyinAudio } from './core/douyin-audio'
import {
	douyinSession,
	isDouyinShareInput,
	useDouyinSession,
} from './douyin-session'
import { PageHeader, SettingsDetails } from './settings-layout'
import { ConfirmationModal } from './theme-dialog'
import { ThemeTextInput } from './theme-input'
import {
	Artwork,
	Backdrop,
	Button,
	Card,
	ControlTarget,
	IconButton,
	State,
	T,
	time,
	useTheme,
} from './ui'

export function DouyinAudioRow({
	item,
	allItems,
	liked,
	playing,
	disabled,
	onPlayQueue,
	onToggleLike,
	onAddToPlaylist,
}: {
	item: DouyinAudio
	allItems: DouyinAudio[]
	liked: boolean
	playing: boolean
	disabled?: boolean
	onPlayQueue: (items: DouyinAudio[], startId: string) => void
	onToggleLike: (item: DouyinAudio) => void
	onAddToPlaylist: (items: DouyinAudio[]) => void
}) {
	const c = useTheme().tokens
	return (
		<Card
			style={{
				marginBottom: 10,
				borderColor: playing ? c.action.primary : c.border.subtle,
			}}
		>
			<View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
				<ControlTarget
					accessibilityRole='button'
					accessibilityLabel={`播放抖音原声 ${item.title}`}
					disabled={disabled}
					onPress={() => onPlayQueue(allItems, item.id)}
					style={{
						flex: 1,
						flexDirection: 'row',
						alignItems: 'center',
						gap: 12,
						minWidth: 0,
					}}
				>
					<Artwork
						uri={item.artwork}
						size={52}
						style={{ borderRadius: 10 }}
					/>
					<View style={{ flex: 1, minWidth: 0, gap: 3 }}>
						<T
							weight={playing ? '700' : '600'}
							lines={2}
							style={playing ? { color: c.action.primary } : undefined}
						>
							{item.title}
						</T>
						<T
							size={12}
							muted
							lines={1}
						>
							{item.artist || '抖音原声'}
							{item.durationSeconds > 0
								? ` · ${time(item.durationSeconds)}`
								: ''}
							{playing ? ' · 正在播放' : ''}
						</T>
					</View>
				</ControlTarget>
				<IconButton
					name='heart'
					label={liked ? '取消喜欢' : '加入我喜欢'}
					active={liked}
					onPress={() => onToggleLike(item)}
				/>
				<ControlTarget
					minimumWidthDp={54}
					accessibilityRole='button'
					accessibilityLabel={`将 ${item.title} 加入歌单`}
					onPress={() => onAddToPlaylist([item])}
					style={{
						minHeight: 48,
						paddingHorizontal: 10,
						justifyContent: 'center',
						alignItems: 'center',
						borderRadius: 10,
						backgroundColor: c.surface.tinted,
					}}
				>
					<T
						size={12}
						weight='600'
						style={{ color: c.action.primary }}
					>
						+歌单
					</T>
				</ControlTarget>
			</View>
		</Card>
	)
}

export function DouyinLoginModal({
	visible,
	onClose,
	onNotice,
}: {
	visible: boolean
	onClose: () => void
	onNotice: (text: string) => void
}) {
	const c = useTheme().tokens
	const state = useDouyinSession()
	const [manualCookie, setManualCookie] = useState('')

	if (!visible) return null

	return (
		<ConfirmationModal
			testID='douyin-login-modal'
			title='抖音账号连接'
			onCancel={onClose}
		>
			<T
				size={13}
				muted
			>
				{state.status === 'authenticated'
					? `当前已连接抖音账号${state.nickname ? `（${state.nickname}）` : ''}，可直接同步「我的喜欢」与「我的收藏」。`
					: '登录后可同步抖音「我的喜欢」「我的收藏」并进行关键词搜索。粘贴抖音分享链接提取原声免登录也可直接使用。'}
			</T>
			{!!state.error && (
				<T
					size={13}
					style={{ color: c.state.error }}
				>
					{state.error}
				</T>
			)}
			<Button
				disabled={state.busy}
				onPress={() => {
					void douyinSession.loginWithWebView().then((ok) => {
						if (ok) {
							onNotice('抖音账号已连接')
							onClose()
						}
					})
				}}
			>
				{state.busy
					? '正在打开抖音登录…'
					: state.status === 'authenticated'
						? '重新扫码 / 手机号登录抖音'
						: '扫码 / 手机号验证码登录抖音'}
			</Button>
			{state.status === 'authenticated' && (
				<Button
					secondary
					disabled={state.busy}
					onPress={() => {
						void douyinSession.signOut().then(() => {
							onNotice('已退出抖音账号')
						})
					}}
				>
					退出抖音账号
				</Button>
			)}
			<SettingsDetails title='登录遇到问题？展开备用手动填 Cookie'>
				<T
					size={12}
					muted
				>
					常规使用只需点击上方扫码或手机号登录；仅当内置网页被拦截时，才可从电脑浏览器复制抖音
					Cookie 粘贴到此处作为备用方案。
				</T>
				<ThemeTextInput
					value={manualCookie}
					onChangeText={setManualCookie}
					placeholder='粘贴包含 sessionid=... 的 Cookie（选填备用）'
					autoCapitalize='none'
					autoCorrect={false}
					multiline
					style={{
						minHeight: 72,
						paddingHorizontal: 12,
						paddingVertical: 10,
						borderRadius: 12,
						borderWidth: 1,
						borderColor: c.border.subtle,
						backgroundColor: c.surface.base,
						color: c.text.primary,
						textAlignVertical: 'top',
					}}
				/>
				<Button
					secondary
					disabled={state.busy || !manualCookie.trim()}
					onPress={() => {
						void douyinSession.loginWithManualCookie(manualCookie).then((ok) => {
							if (ok) {
								setManualCookie('')
								onNotice('已保存备用抖音 Cookie')
								onClose()
							}
						})
					}}
				>
					保存备用 Cookie
				</Button>
			</SettingsDetails>
			<Button
				secondary
				onPress={onClose}
			>
				关闭
			</Button>
		</ConfirmationModal>
	)
}

export function DouyinCollectionModal({
	visible,
	kind,
	likedIds,
	playbackBusy,
	currentSourceId,
	onClose,
	onOpenLogin,
	onPlayQueue,
	onToggleLike,
	onAddToPlaylist,
}: {
	visible: boolean
	kind: 'favorite' | 'collection' | null
	likedIds: ReadonlySet<string>
	playbackBusy: boolean
	currentSourceId: string | null
	onClose: () => void
	onOpenLogin: () => void
	onPlayQueue: (items: DouyinAudio[], startId: string) => void
	onToggleLike: (item: DouyinAudio) => void
	onAddToPlaylist: (items: DouyinAudio[]) => void
}) {
	const c = useTheme().tokens
	const insets = useSafeAreaInsets()
	const douyinState = useDouyinSession()
	const [items, setItems] = useState<DouyinAudio[]>([])
	const [cursor, setCursor] = useState('0')
	const [hasMore, setHasMore] = useState(false)
	const [loading, setLoading] = useState(false)
	const [loadingMore, setLoadingMore] = useState(false)
	const [error, setError] = useState('')
	const requestSeq = useRef(0)

	const loadInitial = useCallback(async () => {
		if (!kind) return
		const token = ++requestSeq.current
		setLoading(true)
		setError('')
		try {
			const res =
				kind === 'favorite'
					? await douyinSession.fetchFavorites('0', 20)
					: await douyinSession.fetchCollections('0', 20)
			if (requestSeq.current !== token) return
			setItems(res.items)
			setCursor(res.nextCursor)
			setHasMore(res.hasMore)
		} catch (err) {
			if (requestSeq.current !== token) return
			setError(
				err instanceof Error && err.message
					? err.message
					: '读取抖音列表失败，请确认已登录抖音账号',
			)
		} finally {
			if (requestSeq.current === token) setLoading(false)
		}
	}, [kind])

	const loadNextPage = useCallback(async () => {
		if (!kind || !hasMore || loading || loadingMore) return
		const token = requestSeq.current
		setLoadingMore(true)
		setError('')
		try {
			const res =
				kind === 'favorite'
					? await douyinSession.fetchFavorites(cursor, 20)
					: await douyinSession.fetchCollections(cursor, 20)
			if (requestSeq.current !== token) return
			setItems((prev) => {
				const seen = new Set(prev.map((item) => item.id))
				const merged = [...prev]
				for (const item of res.items) {
					if (!seen.has(item.id)) {
						seen.add(item.id)
						merged.push(item)
					}
				}
				return merged
			})
			setCursor(res.nextCursor)
			setHasMore(res.hasMore)
		} catch (err) {
			if (requestSeq.current === token) {
				setError(
					err instanceof Error && err.message
						? err.message
						: '加载下一页失败，请重试',
				)
			}
		} finally {
			if (requestSeq.current === token) setLoadingMore(false)
		}
	}, [cursor, hasMore, kind, loading, loadingMore])

	useEffect(() => {
		if (visible && kind) {
			setItems([])
			setCursor('0')
			setHasMore(false)
			void loadInitial()
		}
	}, [visible, kind, douyinState.status, loadInitial])

	if (!visible || !kind) return null

	const title = kind === 'favorite' ? '抖音 · 我的喜欢' : '抖音 · 我的收藏'

	return (
		<Modal
			visible
			animationType='slide'
			onRequestClose={onClose}
		>
			<View
				style={{
					flex: 1,
					backgroundColor: c.surface.base,
					paddingTop: insets.top,
					paddingBottom: insets.bottom,
				}}
			>
				<Backdrop />
				<PageHeader
					title={title}
					onBack={onClose}
				/>
				<FlatList
					data={items}
					keyExtractor={(item) => item.id}
					contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
					ListHeaderComponent={
						<View style={{ gap: 10, marginBottom: 14 }}>
							{douyinState.status !== 'authenticated' && (
								<Card>
									<T weight='600'>尚未登录抖音账号</T>
									<T
										size={12}
										muted
									>
										登录抖音后即可同步「我的喜欢」与「我的收藏」，提取视频原声并在后台听歌。
									</T>
									<Button onPress={onOpenLogin}>扫码 / 手机号登录抖音</Button>
								</Card>
							)}
							<View
								style={{
									flexDirection: 'row',
									flexWrap: 'wrap',
									gap: 8,
									alignItems: 'center',
								}}
							>
								{items.length > 0 && (
									<>
										<Button
											disabled={playbackBusy}
											onPress={() => onPlayQueue(items, items[0].id)}
										>
											{`播放全部（${items.length}）`}
										</Button>
										<Button
											secondary
											onPress={() => onAddToPlaylist(items)}
										>
											全部加歌单
										</Button>
									</>
								)}
								<Button
									secondary
									disabled={loading}
									onPress={() => {
										void loadInitial()
									}}
								>
									{loading ? '刷新中…' : '刷新'}
								</Button>
							</View>
						</View>
					}
					renderItem={({ item }) => (
						<DouyinAudioRow
							item={item}
							allItems={items}
							liked={likedIds.has(item.id)}
							playing={currentSourceId === item.id}
							disabled={playbackBusy}
							onPlayQueue={onPlayQueue}
							onToggleLike={onToggleLike}
							onAddToPlaylist={onAddToPlaylist}
						/>
					)}
					ListEmptyComponent={
						loading ? (
							<State
								busy
								mascot='loading'
								title={`正在同步${title}`}
							/>
						) : error ? (
							<State
								mascot='error'
								title='暂时无法读取列表'
								message={error}
								retry={() => {
									void loadInitial()
								}}
							/>
						) : (
							<State
								mascot='empty'
								title={`暂无${kind === 'favorite' ? '喜欢' : '收藏'}的抖音作品`}
								message={
									douyinState.status === 'authenticated'
										? '在抖音点赞或收藏音乐视频后，点击刷新即可同步原声。'
										: '请先登录抖音账号以同步你的喜欢与收藏列表。'
								}
							/>
						)
					}
					ListFooterComponent={
						<View style={{ gap: 10, marginTop: 8 }}>
							{!!error && items.length > 0 && (
								<State
									title='加载更多未完成'
									message={error}
									retry={() => {
										void loadNextPage()
									}}
								/>
							)}
							{hasMore && (
								<Button
									secondary
									disabled={loadingMore}
									onPress={() => {
										void loadNextPage()
									}}
								>
									{loadingMore ? '正在加载…' : '加载更多'}
								</Button>
							)}
						</View>
					}
				/>
			</View>
		</Modal>
	)
}

export function DouyinSearchSection({
	submittedQuery,
	searchRevision,
	likedIds,
	playbackBusy,
	currentSourceId,
	onOpenLogin,
	onPlayQueue,
	onToggleLike,
	onAddToPlaylist,
}: {
	submittedQuery: string
	searchRevision: number
	likedIds: ReadonlySet<string>
	playbackBusy: boolean
	currentSourceId: string | null
	onOpenLogin: () => void
	onPlayQueue: (items: DouyinAudio[], startId: string) => void
	onToggleLike: (item: DouyinAudio) => void
	onAddToPlaylist: (items: DouyinAudio[]) => void
}) {
	const douyinState = useDouyinSession()
	const [items, setItems] = useState<DouyinAudio[]>([])
	const [nextOffset, setNextOffset] = useState(0)
	const [hasMore, setHasMore] = useState(false)
	const [loading, setLoading] = useState(false)
	const [loadingMore, setLoadingMore] = useState(false)
	const [error, setError] = useState('')
	const seqRef = useRef(0)

	const runSearch = useCallback(async (keyword: string) => {
		const trimmed = keyword.trim()
		if (!trimmed) {
			setItems([])
			setHasMore(false)
			setNextOffset(0)
			setError('')
			return
		}
		const token = ++seqRef.current
		setLoading(true)
		setError('')
		try {
			const res = await douyinSession.search(trimmed, 0, 18)
			if (seqRef.current !== token) return
			setItems(res.items)
			setHasMore(res.hasMore)
			setNextOffset(res.nextOffset)
		} catch (err) {
			if (seqRef.current !== token) return
			setError(
				err instanceof Error && err.message
					? err.message
					: '抖音原声提取或搜索未完成，请重试',
			)
		} finally {
			if (seqRef.current === token) setLoading(false)
		}
	}, [])

	useEffect(() => {
		void runSearch(submittedQuery)
	}, [submittedQuery, searchRevision, runSearch])

	const loadMore = async () => {
		const trimmed = submittedQuery.trim()
		if (!trimmed || !hasMore || loading || loadingMore) return
		const token = seqRef.current
		setLoadingMore(true)
		setError('')
		try {
			const res = await douyinSession.search(trimmed, nextOffset, 18)
			if (seqRef.current !== token) return
			setItems((prev) => {
				const seen = new Set(prev.map((item) => item.id))
				const merged = [...prev]
				for (const item of res.items) {
					if (!seen.has(item.id)) {
						seen.add(item.id)
						merged.push(item)
					}
				}
				return merged
			})
			setHasMore(res.hasMore)
			setNextOffset(res.nextOffset)
		} catch (err) {
			if (seqRef.current === token) {
				setError(
					err instanceof Error && err.message
						? err.message
						: '加载更多结果失败，请重试',
				)
			}
		} finally {
			if (seqRef.current === token) setLoadingMore(false)
		}
	}

	const isShare = isDouyinShareInput(submittedQuery)

	return (
		<View style={{ gap: 10 }}>
			<Card>
				<View
					style={{
						flexDirection: 'row',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: 10,
					}}
				>
					<View style={{ flex: 1, gap: 3 }}>
						<T weight='600'>抖音原声提取与搜索</T>
						<T
							size={12}
							muted
						>
							支持直接粘贴抖音分享口令 / 短链（v.douyin.com）免登录提取原声后台播放，播放时自动联网同步歌词。
						</T>
					</View>
				</View>
				<Button
					secondary
					onPress={onOpenLogin}
				>
					{douyinState.status === 'authenticated'
						? `抖音账号已连接${douyinState.nickname ? `（${douyinState.nickname}）` : ''}`
						: '登录抖音账号（解锁关键词搜索与喜欢/收藏）'}
				</Button>
			</Card>

			{!submittedQuery.trim() ? (
				<State
					mascot='search'
					title='搜索或提取抖音原声'
					message='在上方输入框粘贴抖音分享文本 / 短链，或输入抖音歌曲与视频关键词后点搜索。'
				/>
			) : loading && items.length === 0 ? (
				<State
					busy
					mascot='loading'
					title={isShare ? '正在解析抖音分享原声…' : '正在搜索抖音原声…'}
				/>
			) : error && items.length === 0 ? (
				<State
					mascot='error'
					title={isShare ? '分享链接解析未完成' : '抖音搜索未完成'}
					message={error}
					retry={() => {
						void runSearch(submittedQuery)
					}}
				/>
			) : items.length === 0 ? (
				<State
					mascot='search'
					title='未找到匹配的抖音原声'
					message='你可以直接从抖音点击「分享 -> 复制链接」粘贴到这里提取音频，或先登录抖音账号再试。'
				/>
			) : (
				<>
					<View
						style={{
							flexDirection: 'row',
							flexWrap: 'wrap',
							alignItems: 'center',
							justifyContent: 'space-between',
							gap: 8,
						}}
					>
						<T
							size={12}
							muted
						>
							{isShare
								? '已提取抖音分享原声'
								: `“${submittedQuery.trim()}”，已找到 ${items.length} 条抖音原声`}
						</T>
						<View style={{ flexDirection: 'row', gap: 8 }}>
							<Button
								disabled={playbackBusy}
								onPress={() => onPlayQueue(items, items[0].id)}
							>
								{items.length === 1 ? '立即播放原声' : '播放全部'}
							</Button>
							{items.length > 1 && (
								<Button
									secondary
									onPress={() => onAddToPlaylist(items)}
								>
									全部加歌单
								</Button>
							)}
						</View>
					</View>

					{items.map((item) => (
						<DouyinAudioRow
							key={item.id}
							item={item}
							allItems={items}
							liked={likedIds.has(item.id)}
							playing={currentSourceId === item.id}
							disabled={playbackBusy}
							onPlayQueue={onPlayQueue}
							onToggleLike={onToggleLike}
							onAddToPlaylist={onAddToPlaylist}
						/>
					))}

					{!!error && items.length > 0 && (
						<State
							title='下一页加载未完成'
							message={error}
							retry={() => {
								void loadMore()
							}}
						/>
					)}
					{hasMore && !error && (
						<Button
							secondary
							disabled={loadingMore}
							onPress={() => {
								void loadMore()
							}}
						>
							{loadingMore ? '正在加载…' : '加载更多结果'}
						</Button>
					)}
				</>
			)}
		</View>
	)
}
