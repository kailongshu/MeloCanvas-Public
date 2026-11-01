import { Image } from 'expo-image'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, View } from 'react-native'
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
	const [qrCode, setQrCode] = useState('')
	const [qrLoading, setQrLoading] = useState(false)
	const [qrHint, setQrHint] = useState('正在生成抖音登录二维码…')
	const mountedRef = useRef(false)

	const loadQr = useCallback(async () => {
		setQrLoading(true)
		setQrHint('正在生成抖音登录二维码…')
		try {
			const res = await douyinSession.fetchLoginQr()
			if (!mountedRef.current) return
			if (res.qrcode) {
				setQrCode(res.qrcode)
				setQrHint('请使用抖音 App 扫码登录')
			} else {
				setQrHint('未能自动生成二维码，可点击刷新或使用下方手机号验证码登录')
			}
		} finally {
			if (mountedRef.current) setQrLoading(false)
		}
	}, [])

	useEffect(() => {
		mountedRef.current = visible
		if (!visible) {
			setQrCode('')
			setQrLoading(false)
			return
		}
		if (state.status !== 'authenticated') {
			void loadQr()
		}
		return () => {
			mountedRef.current = false
		}
	}, [visible, state.status, loadQr])

	useEffect(() => {
		if (!visible || state.status === 'authenticated') return
		let active = true
		const timer = setInterval(() => {
			void douyinSession.pollLoginQr().then((res) => {
				if (!active) return
				if (res.authenticated) {
					onNotice('抖音扫码登录成功')
					onClose()
					return
				}
				if (res.qrcode) {
					setQrCode(res.qrcode)
				}
				if (res.status === 'scanned') {
					setQrHint('已扫码，请在手机抖音上点击确认登录')
				} else if (res.status === 'expired') {
					setQrHint('二维码已过期，正在自动刷新…')
					void loadQr()
				} else if (res.qrcode) {
					setQrHint('请使用抖音 App 扫码登录')
				}
			})
		}, 1400)
		return () => {
			active = false
			clearInterval(timer)
		}
	}, [visible, state.status, loadQr, onClose, onNotice])

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
					? `当前已连接抖音账号${state.nickname ? `（${state.nickname}）` : ''}，可直接同步「抖音收藏 · 音乐」。`
					: '直接用抖音 App 扫描下方二维码即可连接；若只有单台手机，可点击下方「手机号验证码登录」。'}
			</T>
			{!!state.error && (
				<T
					size={13}
					style={{ color: c.state.error }}
				>
					{state.error}
				</T>
			)}
			{state.status !== 'authenticated' && (
				<View
					style={{
						alignItems: 'center',
						justifyContent: 'center',
						paddingVertical: 12,
						paddingHorizontal: 14,
						borderRadius: 16,
						backgroundColor: c.surface.tinted,
						gap: 10,
					}}
				>
					<View
						style={{
							width: 204,
							height: 204,
							borderRadius: 14,
							backgroundColor: '#FFFFFF',
							alignItems: 'center',
							justifyContent: 'center',
							padding: 8,
						}}
					>
						{qrCode ? (
							<Image
								source={{ uri: qrCode }}
								style={{ width: 188, height: 188 }}
								contentFit='contain'
							/>
						) : (
							<View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 12 }}>
								{qrLoading && (
									<ActivityIndicator
										size='small'
										color='#111827'
									/>
								)}
								<T
									size={12}
									style={{ color: '#374151', textAlign: 'center' }}
								>
									{qrLoading ? '正在获取抖音二维码…' : '点击下方「刷新二维码」重试'}
								</T>
							</View>
						)}
					</View>
					<T
						size={12}
						weight='600'
						style={{ textAlign: 'center' }}
					>
						{qrHint}
					</T>
					<Button
						secondary
						disabled={qrLoading || state.busy}
						onPress={() => {
							void loadQr()
						}}
					>
						{qrLoading ? '正在刷新二维码…' : '刷新二维码'}
					</Button>
				</View>
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
					? '正在打开登录窗口…'
					: state.status === 'authenticated'
						? '切换账号 / 重新登录抖音'
						: '手机号验证码登录（纯净小窗）'}
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
					常规使用直接扫码或用手机号验证码即可；仅当网络受限时，可从电脑浏览器复制抖音
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
		if (!visible) return
		const token = ++requestSeq.current
		setLoading(true)
		setError('')
		try {
			const res = await douyinSession.fetchCollections('0', 20)
			if (requestSeq.current !== token) return
			setItems(res.items)
			setCursor(res.nextCursor)
			setHasMore(res.hasMore)
		} catch (err) {
			if (requestSeq.current !== token) return
			setError(
				err instanceof Error && err.message
					? err.message
					: '读取抖音音乐收藏失败，请确认已登录抖音账号',
			)
		} finally {
			if (requestSeq.current === token) setLoading(false)
		}
	}, [visible])

	const loadNextPage = useCallback(async () => {
		if (!visible || !hasMore || loading || loadingMore) return
		const token = requestSeq.current
		setLoadingMore(true)
		setError('')
		try {
			const res = await douyinSession.fetchCollections(cursor, 20)
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
	}, [cursor, hasMore, loading, loadingMore, visible])

	useEffect(() => {
		if (visible) {
			setItems([])
			setCursor('0')
			setHasMore(false)
			void loadInitial()
		}
	}, [visible, douyinState.status, loadInitial])

	if (!visible) return null

	const title = '抖音 · 音乐收藏'

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
										登录抖音后即可直接读取你「收藏 -> 音乐」板块里的全部音乐与原声并在后台听歌。
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
								title='暂时无法读取音乐收藏'
								message={error}
								retry={() => {
									void loadInitial()
								}}
							/>
						) : (
							<State
								mascot='empty'
								title='暂无收藏的抖音音乐'
								message={
									douyinState.status === 'authenticated'
										? '在抖音 App 中收藏音乐或原声（收藏 -> 音乐）后，点击刷新即可同步播放。'
										: '请先登录抖音账号以同步「收藏 -> 音乐」列表。'
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
							支持直接搜索歌曲 / 原声关键词，或粘贴抖音分享口令（v.douyin.com）提取音频，播放时自动联网同步歌词。
						</T>
					</View>
				</View>
				<Button
					secondary
					onPress={onOpenLogin}
				>
					{douyinState.status === 'authenticated'
						? `抖音账号已连接${douyinState.nickname ? `（${douyinState.nickname}）` : ''}`
						: '扫码 / 手机号连接抖音账号（同步音乐收藏）'}
				</Button>
			</Card>

			{!submittedQuery.trim() ? (
				<State
					mascot='search'
					title='搜索或提取抖音原声'
					message='在上方输入框输入歌曲 / 原声关键词搜索，或直接粘贴抖音分享链接提取音频。'
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
					message='请尝试更换关键词，或直接从抖音点击「分享 -> 复制链接」粘贴到这里提取音频。'
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
								: `“${submittedQuery.trim()}”，已找到 ${items.length} 条结果`}
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
