import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'

import type { Library } from './core/database'
import { isDouyinAudioId } from './core/douyin-audio'
import { isLocalAudioId } from './core/local-audio'
import type { SearchItem, Source } from './core/model'
import {
	MusicTransportControls,
	hostPlayerHorizontalPaddingDp,
} from './host-controls'
import { LyricsReader } from './lyrics-ui'
import { MusicPlayerMenu } from './music-player-menu'
import type { usePlayer } from './player'
import { Progress } from './progress'
import {
	Artwork,
	Button,
	Card,
	ControlRow,
	ControlTarget,
	IconButton,
	MascotArt,
	PlayerBackdrop,
	T,
	time,
	useTheme,
	useBuiltInVisuals,
} from './ui'
export function MusicPlayer({
	library,
	readingBackRef,
	player,
	current,
	isLiked,
	busyBv,
	onLike,
	localLiked = false,
	onLikeLocal,
	onClose,
	onTheme,
	onSource,
	onParts,
	onOffline,
	onQueue,
	onNotice,
	onNotificationSettings,
	notifications,
	bottomInset,
	onFm,
	fmMessage,
}: {
	library: Pick<Library, 'setting' | 'setSetting'>
	readingBackRef?: { current: (() => boolean) | null }
	player: ReturnType<typeof usePlayer>
	current: Source | null
	isLiked: (bvid: string) => boolean
	busyBv: string
	onLike: (source: Source) => void
	localLiked?: boolean
	onLikeLocal?: (id: string) => void
	onClose: () => void
	onTheme: () => void
	onSource: () => void
	onParts?: () => void
	onOffline?: () => void
	onQueue: () => void
	onNotice: (message: string) => void
	onNotificationSettings: () => void
	notifications: boolean
	bottomInset: number
	onFm: () => void
	fmMessage: string
}) {
	const [lyricsOpen, setLyricsOpen] = useState(false)
	const scroll = useRef<ScrollView | null>(null)
	const [seeking, setSeeking] = useState(false)
	const mounted = useRef(true)
	useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
	const onDragChange = useCallback((dragging: boolean) => {
		if (!mounted.current) return
		scroll.current?.setNativeProps({ scrollEnabled: !dragging })
		setSeeking(dragging)
	}, [])
	useEffect(() => {
		if (!readingBackRef) return
		readingBackRef.current = lyricsOpen
			? () => {
					setLyricsOpen(false)
					return true
				}
			: null
		return () => {
			readingBackRef.current = null
		}
	}, [lyricsOpen, readingBackRef])
	const theme = useTheme()
	const c = theme.tokens
	const visual = useBuiltInVisuals()
	const { width, height, fontScale } = useWindowDimensions()
	const coverSize = Math.max(
		1,
		Math.min(width - 72, 320, height * (fontScale > 1.2 ? 0.27 : 0.4)),
	)
	const lyricsHeight = visual
		? Math.max(260, Math.min(420, height * 0.42)) * Math.max(1, fontScale)
		: coverSize
	if (!player.track) return null
	const douyinId = isDouyinAudioId(player.track.sourceId ?? '')
		? player.track.sourceId
		: null
	const localId = isLocalAudioId(player.track.sourceId ?? '')
		? player.track.sourceId
		: null
	return (
		<ScrollView
			ref={scroll}
			scrollEnabled={!seeking}
			testID='player-page'
			contentContainerStyle={{
				paddingHorizontal: hostPlayerHorizontalPaddingDp,
				flexGrow: 1,
				paddingBottom: bottomInset + 28,
			}}
		>
			<PlayerBackdrop />
			<View
				style={[s.row, { justifyContent: 'space-between', marginBottom: 16 }]}
			>
				<IconButton
					name='down'
					label={lyricsOpen ? '返回播放器封面' : '收起播放器'}
					onPress={() => (lyricsOpen ? setLyricsOpen(false) : onClose())}
				/>
				<View style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, flex: 1 }}>
					{(player.playing || player.buffering || player.error) && <MascotArt state={player.error ? 'error' : player.buffering ? 'loading' : 'playing'} size={44} />}
					<T
						size={13}
						muted
						style={{ flexShrink: 1, textAlign: 'center' }}
					>
						{player.fmContext ? '私人 FM' : player.error ? '播放遇到问题' : player.buffering ? '正在缓冲' : player.playing ? '正在播放' : '已暂停'}
					</T>
				</View>
				<MusicPlayerMenu
					key={player.track.id}
					local={!!(localId || douyinId)}
					bvid={current?.bvid ?? ''}
					fm={!!player.fmContext}
					notifications={notifications}
					bottomInset={bottomInset}
					onSource={onSource}
					onParts={onParts}
					onOffline={onOffline}
					onTheme={onTheme}
					onFm={onFm}
					onNotificationSettings={onNotificationSettings}
				/>
			</View>
			{lyricsOpen ? (
				<LyricsReader
					height={lyricsHeight}
					bottomInset={bottomInset}
					onClose={() => setLyricsOpen(false)}
					key={player.track.sourceId ?? player.track.id}
					library={library}
					sourceId={player.track.sourceId ?? player.track.id}
					title={
						current && current.id === player.track.sourceId
							? current.originalTitle
							: (player.track.title ?? '当前音源')
					}
					performer={
						current && current.id === player.track.sourceId
							? current.performer
							: (player.track.artist ?? null)
					}
					uploader={
						current && current.id === player.track.sourceId
							? current.uploader
							: null
					}
					progress={player.progress}
					position={player.position}
					duration={player.duration || player.track.duration || 0}
					onSeek={(value) => {
						void player.seek(value)
					}}
				/>
			) : (
				<View style={{ alignItems: 'center', marginTop: 20, marginBottom: 30 }}>
					<ControlTarget
						accessibilityRole='button'
						accessibilityLabel='点击封面查看歌词'
						onPress={() => setLyricsOpen(true)}
						style={{ width: coverSize, height: coverSize }}
					>
						<View
							testID='player-cover-shadow'
							style={{
								width: coverSize,
								height: coverSize,
								borderRadius: visual
									? 12
									: theme.components.playerFrame === 'arch'
										? 180
										: 12,
								borderBottomLeftRadius: visual
									? 12
									: theme.components.playerFrame === 'arch'
										? 8
										: 12,
								borderBottomRightRadius: visual
									? 12
									: theme.components.playerFrame === 'arch'
										? 8
										: 12,
								boxShadow: visual?.softCover
									? `0px 14px 28px ${c.text.primary}18`
									: undefined,
							}}
						>
							<View
								style={[
									{
										width: coverSize,
										height: coverSize,
										padding:
											!visual && theme.components.playerFrame === 'tilted'
												? 6
												: 0,
										backgroundColor: c.surface.card,
										borderWidth:
											!visual && theme.components.playerFrame === 'tilted'
												? 1.5
												: 0,
										borderColor: c.border.strong,
										borderRadius: visual
											? 12
											: theme.components.playerFrame === 'arch'
												? 180
												: 12,
										borderBottomLeftRadius: visual
											? 12
											: theme.components.playerFrame === 'arch'
												? 8
												: 12,
										borderBottomRightRadius: visual
											? 12
											: theme.components.playerFrame === 'arch'
												? 8
												: 12,
										overflow: 'hidden',
										transform:
											!visual && theme.components.playerFrame === 'tilted'
												? [{ rotate: '-3deg' }]
												: [],
										boxShadow: visual
											? undefined
											: `8px 10px 0 ${c.border.subtle}`,
									},
								]}
							>
								<Artwork
									uri={player.track.artwork}
									fit='cover'
									style={{
										width: '100%',
										height: '100%',
										borderRadius:
											theme.components.playerFrame === 'stacked' ? 12 : 0,
									}}
								/>
							</View>
						</View>
					</ControlTarget>
				</View>
			)}
			<View style={s.row}>
				<View style={{ flex: 1 }}>
					<T
						size={23}
						weight='700'
						lines={2}
					>
						{player.track.title || 'B 站音源'}
					</T>
					<T
						muted
						size={12}
						style={{ marginTop: 7 }}
					>
						{current ? `UP · ${current.uploader}` : player.track.artist}
					</T>
				</View>
				<IconButton
					name='heart'
					label={
						((localId ?? douyinId) ? localLiked : current && isLiked(current.bvid))
							? '取消喜欢当前音源'
							: '喜欢当前音源'
					}
					active={
						(localId ?? douyinId) ? localLiked : current ? isLiked(current.bvid) : false
					}
					disabled={((localId ?? douyinId) ? !onLikeLocal : !current) || !!busyBv}
					onPress={() => {
						if (localId ?? douyinId) onLikeLocal?.((localId ?? douyinId)!)
						else if (current) onLike(current)
					}}
				/>
			</View>
			<T
				muted
				size={11}
				style={{ marginTop: 10 }}
			>
				{localId ? '本地音乐' : douyinId ? '抖音原声' : 'Bilibili'}
			</T>
			<Progress
				key={player.track.id}
				onDragChange={onDragChange}
				progress={player.progress}
				position={player.position}
				duration={player.duration || player.track.duration || 0}
				disabled={player.switching}
				onSeek={player.seek}
			/>
			{player.error ? (
				<Card style={{ marginBottom: 16 }}>
					<T style={{ color: c.state.error }}>{player.error}</T>
					<View style={{ marginTop: 12 }}>
						<Button onPress={player.retry}>重试音频</Button>
					</View>
				</Card>
			) : player.buffering ? (
				<T
					muted
					style={{ textAlign: 'center', marginBottom: 12 }}
				>
					正在缓冲…
				</T>
			) : null}
			<MusicTransportControls
				playing={player.playing}
				previousDisabled={player.switching || !player.canPrevious}
				nextDisabled={player.switching || !player.canNext}
				playbackOrder={player.playbackOrder}
				orderDisabled={player.switching || player.orderBusy || !!player.auditionId}
				onOrderInfo={() => {
					if (player.fmContext) onNotice('私人 FM 按推荐顺序播放')
					else void player.cyclePlaybackOrder()
				}}
				onPrevious={() => {
					void player.previous()
				}}
				onToggle={() => {
					void player.toggle()
				}}
				onNext={() => {
					void player.next()
				}}
				onQueue={() => onQueue()}
			/>
			{player.fmContext && (
				<View style={{ marginTop: 12, gap: 8 }}>
					{!!fmMessage && (
						<T
							size={12}
							muted
						>
							{fmMessage}
						</T>
					)}
				</View>
			)}

			{!lyricsOpen && (
				<ControlTarget
					accessibilityRole='button'
					accessibilityLabel='展开歌词'
					onPress={() => setLyricsOpen(true)}
					style={{
						minHeight: 48,
						alignItems: 'center',
						justifyContent: 'center',
						marginTop: 12,
					}}
				>
					<T
						muted
						size={12}
					>
						歌词　›
					</T>
				</ControlTarget>
			)}
		</ScrollView>
	)
}
export function SongRow({
	item,
	liked,
	busy,
	active,
	onPlay,
	onLike,
	onListen,
	onMore,
	listeningResult,
}: {
	item: SearchItem | Source
	liked: boolean
	busy: boolean
	active: boolean
	onPlay: () => void
	onLike: () => void
	onListen?: () => void
	onMore?: () => void
	listeningResult: boolean
}) {
	const t = useTheme()
	return (
		<ControlRow
			controlMinWidthsDp={[listeningResult ? 164 : 116, 48]}
			gapDp={10}
			style={[
				s.row,
				{
					paddingVertical: 13,
					gap: 10,
					borderBottomWidth: 1,
					borderBottomColor: t.tokens.border.subtle,
				},
			]}
		>
			<ControlTarget
				minimumWidthDp={listeningResult ? 164 : 116}
				minimumHeightDp={62}
				accessibilityRole='button'
				accessibilityLabel={`${listeningResult ? '收听' : '播放'} ${item.originalTitle}`}
				disabled={busy}
				onPress={listeningResult ? onListen : onPlay}
				style={[s.row, { flex: 1, gap: 11, minHeight: 62 }]}
			>
				<Artwork
					uri={item.artwork}
					size={listeningResult ? undefined : 57}
					fit={listeningResult ? 'contain' : 'cover'}
					style={{
						...(listeningResult ? { width: 104, height: 59 } : {}),
						borderRadius: t.components.card === 'comic' ? 5 : 11,
					}}
				/>
				<View style={{ flex: 1, gap: 4 }}>
					<T
						size={14}
						weight='600'
						lines={2}
						style={active ? { color: t.tokens.action.primary } : undefined}
					>
						{item.originalTitle}
					</T>
					<T
						muted
						size={11}
						lines={1}
					>
						{busy ? '正在读取音源…' : `UP · ${item.uploader}`}
					</T>
					<T
						muted
						size={10}
					>
						{time(item.duration)}
					</T>
				</View>
			</ControlTarget>
			{listeningResult ? (
				<View>
					<IconButton
						name='play'
						label={`以听视频收听 ${item.originalTitle}`}
						onPress={onListen ?? onPlay}
						disabled={busy}
					/>
					{onMore && (
						<RowMore
							title={item.originalTitle}
							onPress={onMore}
							disabled={busy}
						/>
					)}
				</View>
			) : (
				<View>
					<IconButton
						name='heart'
						label={`${liked ? '取消喜欢' : '喜欢'} ${item.originalTitle}`}
						active={liked}
						disabled={busy}
						onPress={onLike}
					/>
					{onMore ? (
						<RowMore
							title={item.originalTitle}
							onPress={onMore}
							disabled={busy}
						/>
					) : (
						onListen && (
							<ControlTarget
								fixedWidth
								accessibilityRole='button'
								accessibilityLabel={`以听视频开启 ${item.originalTitle}`}
								disabled={busy}
								onPress={onListen}
								style={{
									minWidth: 48,
									minHeight: 48,
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								<T
									size={10}
									style={{ color: t.tokens.action.primary }}
								>
									听视频
								</T>
							</ControlTarget>
						)
					)}
				</View>
			)}
		</ControlRow>
	)
}
function RowMore({
	title,
	onPress,
	disabled,
}: {
	title: string
	onPress: () => void
	disabled: boolean
}) {
	const theme = useTheme()
	return (
		<ControlTarget
			fixedWidth
			accessibilityRole='button'
			accessibilityLabel={`更多音源操作 ${title}`}
			onPress={onPress}
			disabled={disabled}
			style={{
				minWidth: 48,
				minHeight: 48,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<T
				size={10}
				style={{ color: theme.tokens.action.primary }}
			>
				更多
			</T>
		</ControlTarget>
	)
}
const s = StyleSheet.create({
	row: { flexDirection: 'row', alignItems: 'center' },
})
