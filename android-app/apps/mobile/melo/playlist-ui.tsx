import React, { useMemo, useState } from 'react'
import { useThemeDialog } from './theme-dialog'
import {
	FlatList,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
	useWindowDimensions,
} from 'react-native'

import type { SearchItem, Source as BiliSource } from './core/model'
import {
	isDouyinLibrarySource,
	isLocalLibrarySource,
	type MusicLibrarySource as Source,
} from './core/music-library-source'
import { playlistEntryId } from './core/queue'
import { usePlaylistScroll } from './playlist-scroll'
import {
	isPlaylistDetailFiltered,
	playlistItemDescription,
	playlistPlaybackCounts,
	selectPlaylistDetailItems,
	selectPlaylistPickerSources,
} from './playlist-selection'
import type { PlaylistSession, PlaylistState } from './playlist-session'
import { ThemeTextInput } from './theme-input'
import {
	Artwork,
	Button,
	Card,
	ControlRow,
	ControlTarget,
	Icon,
	IconButton,
	State,
	MascotArt,
	T,
	shape,
	time,
	useTheme,
	useThemeRendering,
} from './ui'

interface PlaylistViewProps {
	state: PlaylistState
	session: PlaylistSession
}

function PlaylistCover({ uri, size, gallery = false }: { uri?: string | null; size: number; gallery?: boolean }) {
	const theme = useTheme()
	return uri ? (
		<Artwork
			uri={uri}
			size={size}
			fit={gallery ? 'cover' : 'contain'}
			style={gallery ? { borderRadius: 12 } : shape(theme.components.card)}
		/>
	) : (
		<View
			style={[
				gallery ? { borderRadius: 12 } : shape(theme.components.card),
				{
					width: size,
					height: size,
					alignItems: 'center',
					justifyContent: 'center',
					backgroundColor: theme.tokens.surface.tinted,
					borderWidth: theme.components.card === 'comic' ? 1.5 : 1,
					borderColor: theme.tokens.border.strong,
				},
			]}
		>
			<Icon
				name='library'
				size={size > 70 ? 36 : 26}
				color={theme.tokens.action.primary}
			/>
		</View>
	)
}

function PlaylistItemTarget({
	interactive,
	minimumWidthDp,
	minimumHeightDp,
	...props
}: React.ComponentProps<typeof ControlTarget> & { interactive: boolean }) {
	const target = interactive ? (
		<ControlTarget
			{...props}
			minimumWidthDp={minimumWidthDp}
			minimumHeightDp={minimumHeightDp}
		/>
	) : (
		<Pressable {...props} />
	)
	// A disabled shell may contain its own live review button, with its own bounds.
	return interactive ? (
		<ControlRow
			controlMinWidthsDp={[minimumWidthDp ?? 48]}
			single
			style={[styles.row, { flex: 1, minWidth: 0, gap: 9 }]}
		>
			{target}
		</ControlRow>
	) : (
		<View style={[styles.row, { flex: 1, minWidth: 0, gap: 9 }]}>{target}</View>
	)
}

function PlaylistPendingReview({ onPress }: { onPress: () => void }) {
	const rendering = useThemeRendering()
	const button = (
		<Button
			secondary
			onPress={onPress}
		>
			匹配此条目
		</Button>
	)
	return rendering?.controlRowLayout ? (
		<ControlRow
			controlMinWidthsDp={[48]}
			single
			style={{ width: '100%' }}
		>
			{button}
		</ControlRow>
	) : (
		button
	)
}

export function PlaylistLibrarySection({ state, session }: PlaylistViewProps) {
	const theme = useTheme(),
		viewport = useWindowDimensions(),
		rendering = useThemeRendering()
	const [availableWidth, setAvailableWidth] = useState(0)
	const columns = !rendering?.controlRowLayout && viewport.fontScale < 1.35 ? 2 : 1
	const tileSize = Math.max(
		48,
		((availableWidth || viewport.width - 40) - (columns - 1) * 14) / columns,
	)
	return (
		<View
			testID='playlist-library-section'
			style={{ marginTop: 12 }}
		>
			<View
				style={[
					styles.row,
					{ justifyContent: 'space-between', marginBottom: 4 },
				]}
			>
				<T
					size={18}
					weight='700'
				>
					我的歌单
				</T>
				<ControlTarget
					fixedWidth
					accessibilityRole='button'
					accessibilityLabel='新建本地歌单'
					onPress={() => session.requestName('create')}
					style={styles.textAction}
				>
					<T
						size={12}
						style={{ color: theme.tokens.action.primary }}
					>
						新建
					</T>
				</ControlTarget>
			</View>
			{!!state.error && !state.nameForm && (
				<PlaylistError
					message={state.error}
					onRetry={session.refresh}
				/>
			)}
			{!!state.notice && (
				<Card style={{ marginBottom: 12 }}>
					<T size={12}>{state.notice}</T>
				</Card>
			)}
			<View
				onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
				style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}
			>
				{state.playlists.map(
					({ playlist, count, pendingCount, artwork, importSummary }) => (
						<ControlTarget
							key={playlist.id}
							testID={'playlist-' + playlist.id}
							accessibilityRole='button'
							accessibilityLabel={`打开歌单 ${playlist.name}，${count}个${pendingCount ? '条目' : '音源'}`}
							onPress={() => session.open(playlist.id)}
							minimumWidthDp={48}
							style={{ width: tileSize, minWidth: 0, paddingBottom: 6, gap: 7 }}
						>
							<PlaylistCover
								uri={artwork}
								size={tileSize}
								gallery
							/>
							<T
								size={14}
								weight='600'
								lines={2}
							>
								{playlist.name}
							</T>
							<T
								muted
								size={11}
							>
								{count} {pendingCount ? '项' : '首'}
								{pendingCount ? `，${pendingCount} 项待匹配` : ''}
							</T>
							{!!importSummary && (
								<T
									muted
									size={11}
									lines={2}
								>
									{importSummary}
								</T>
							)}
						</ControlTarget>
					),
				)}
			</View>
			{!state.playlists.length && !state.error && (
				<View style={{ gap: 12 }}>
					<MascotArt state='empty' size={112} />
					<T muted>暂无歌单，新建歌单或导入已有收藏。</T>
					<Button secondary onPress={() => session.requestName('create')}>新建歌单</Button>
				</View>
			)}
		</View>
	)
}

export function PlaylistDetailPage({
	state,
	session,
	onBack,
	onSearch,
	onPlay,
	onReviewBilibiliPending,
	onChangeSource,
	playbackBusy,
	currentEntryId,
	bottomInset,
	reducedMotion,
}: PlaylistViewProps & {
	onBack: () => void
	onSearch: () => void
	onPlay: (playlistId: string, startItemId: string) => Promise<boolean>
	onReviewBilibiliPending?: (playlistId: string, itemId: string) => void
	onChangeSource?: (playlistId: string, itemId: string) => void
	playbackBusy: boolean
	currentEntryId: string | null
	bottomInset: number
	reducedMotion: boolean
}) {
	const theme = useTheme()
	const c = theme.tokens
	const [menu, setMenu] = useState(false)
	const [songMenu, setSongMenu] = useState<string | null>(null)
	const confirmation = useThemeDialog()
	const detail = state.detail
	const counts = useMemo(
		() => playlistPlaybackCounts(detail?.items ?? []),
		[detail],
	)
	const filtered = isPlaylistDetailFiltered(
		state.detailQuery,
		state.detailFilter,
	)
	const visibleItems = useMemo(
		() =>
			selectPlaylistDetailItems(
				detail,
				state.sources,
				state.detailQuery,
				state.detailFilter,
			),
		[detail, state.sources, state.detailQuery, state.detailFilter],
	)
	const selectedIds = useMemo(
		() => new Set(state.selectedItemIds),
		[state.selectedItemIds],
	)
	const hiddenSelectedCount = useMemo(
		() =>
			selectedIds.size -
			visibleItems.reduce(
				(count, { item }) => count + Number(selectedIds.has(item.itemId)),
				0,
			),
		[selectedIds, visibleItems],
	)
	const { onHeaderLayout, ...scroll } = usePlaylistScroll(
		session,
		state.detailViewToken,
		visibleItems,
	)
	const firstSourceId = useMemo(
		() => detail?.items.find((item) => item.sourceId !== null)?.sourceId,
		[detail],
	)
	const [playError, setPlayError] = useState('')
	async function play(itemId: string) {
		if (!detail) return
		setPlayError('')
		try {
			await onPlay(detail.id, itemId)
		} catch (error) {
			setPlayError(
				error instanceof Error ? error.message : '播放未完成，请重试',
			)
		}
	}
	const renderItem = ({
		item: { item, index },
	}: {
		item: (typeof visibleItems)[number]
	}) => {
		const source =
			item.sourceId === null ? null : state.sources.get(item.sourceId)
		const description = playlistItemDescription(item, source)
		const selected = selectedIds.has(item.itemId)
		const canChange = !!onChangeSource && !!item.importOrigin && item.importOrigin.provider !== 'bilibili'
		const active =
			item.sourceId !== null && currentEntryId === playlistEntryId(item.itemId)
		return (
			<View
				key={item.itemId}
				testID={`playlist-item-${item.itemId}`}
				style={{
					paddingVertical: 11,
					borderBottomWidth: 1,
					borderBottomColor: c.border.subtle,
				}}
			>
				<View style={{ flexDirection: 'row', alignItems: 'center' }}>
				<PlaylistItemTarget
					interactive={state.editing || !!source || canChange}
					minimumWidthDp={(state.editing ? 140 : 134) + (active ? 28 : 0)}
					minimumHeightDp={62}
					accessibilityRole={state.editing ? 'checkbox' : 'button'}
					accessibilityLabel={`${state.editing ? '选择' : item.sourceId === null ? '' : '播放'}歌单第${index + 1}项 ${description.title}${description.status ? `，${description.status}` : ''}`}
					accessibilityState={{
						checked: state.editing ? selected : undefined,
						selected: active,
						disabled: !state.editing && ((!source && !canChange) || playbackBusy),
					}}
					disabled={!state.editing && ((!source && !canChange) || playbackBusy)}
					onPress={() =>
						state.editing
							? session.toggleItem(item.itemId)
							: !source && canChange ? onChangeSource(item.playlistId, item.itemId) : void play(item.itemId)
					}
					style={[styles.row, { flex: 1, gap: 10, minHeight: 62 }]}
				>
					{state.editing ? (
						<View
							style={{
								width: 24,
								height: 24,
								alignItems: 'center',
								justifyContent: 'center',
								borderWidth: 1,
								borderRadius: 5,
								borderColor: selected ? c.action.primary : c.border.strong,
								backgroundColor: selected ? c.surface.tinted : c.surface.card,
							}}
						>
							{selected && (
								<Icon
									name='check'
									size={18}
									color={c.action.primary}
								/>
							)}
						</View>
					) : (
						<T
							muted
							size={13}
							style={{ minWidth: 18 }}
						>
							{String(index + 1).padStart(2, '0')}
						</T>
					)}
					<PlaylistCover
						uri={source?.artwork}
						size={48}
					/>
					<View style={{ flex: 1, gap: 4 }}>
						<T
							size={16}
							weight='600'
							lines={2}
							style={active ? { color: c.action.primary } : undefined}
						>
							{description.title}
						</T>
						<T
							muted
							size={13}
							lines={1}
						>
							{description.subtitle}
						</T>
						{description.status && (
							<T
								muted
								size={13}
							>
								{description.status}
							</T>
						)}

					</View>
					{active && (
						<Icon
							name='play'
							size={18}
							color={c.action.primary}
						/>
					)}
				</PlaylistItemTarget>
				{canChange && !state.editing && <ControlTarget fixed accessibilityRole='button' accessibilityLabel={`歌曲菜单 ${description.title}`} onPress={() => setSongMenu(item.itemId)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><T size={22}>⋯</T></ControlTarget>}
				</View>
				{item.sourceId === null &&
					item.importOrigin?.provider === 'bilibili' &&
					onReviewBilibiliPending &&
					!state.editing && (
						<View
							testID='playlist-pending-review'
							style={{ marginTop: 10 }}
						>
							<PlaylistPendingReview
								onPress={() =>
									onReviewBilibiliPending(item.playlistId, item.itemId)
								}
							/>
						</View>
					)}
				{state.editing && !filtered && (
					<ControlRow
						controlMinWidthsDp={[48, 48]}
						gapDp={10}
						style={[styles.row, { justifyContent: 'flex-end', gap: 10 }]}
					>
						<ControlTarget
							fixedWidth
							accessibilityRole='button'
							accessibilityLabel={`上移歌单第${index + 1}项`}
							disabled={!index}
							accessibilityState={{ disabled: !index }}
							onPress={() => session.move(item.itemId, -1)}
							style={[styles.textAction, { opacity: index ? 1 : 0.4 }]}
						>
							<T size={13}>上移</T>
						</ControlTarget>
						<ControlTarget
							fixedWidth
							accessibilityRole='button'
							accessibilityLabel={`下移歌单第${index + 1}项`}
							disabled={index === (detail?.items.length ?? 0) - 1}
							accessibilityState={{
								disabled: index === (detail?.items.length ?? 0) - 1,
							}}
							onPress={() => session.move(item.itemId, 1)}
							style={[
								styles.textAction,
								{
									opacity: index === (detail?.items.length ?? 0) - 1 ? 0.4 : 1,
								},
							]}
						>
							<T size={13}>下移</T>
						</ControlTarget>
					</ControlRow>
				)}
			</View>
		)
	}
	return (
		<View
			testID='playlist-detail-page'
			style={{ flex: 1 }}
		>
			{confirmation.dialog}
			<FlatList
				{...scroll}
				key={state.currentId ?? 'closed'}
				testID='playlist-detail-list'
				data={visibleItems}
				keyExtractor={({ item }) => item.itemId}
				renderItem={renderItem}
				extraData={state}
				initialNumToRender={16}
				maxToRenderPerBatch={12}
				windowSize={7}
				removeClippedSubviews={false}
				keyboardShouldPersistTaps='handled'
				contentContainerStyle={{
					paddingHorizontal: 20,
					paddingTop: 18,
					paddingBottom: 24,
				}}
				ListHeaderComponent={
					<View onLayout={onHeaderLayout}>
						<View
							style={[
								styles.row,
								{ justifyContent: 'space-between', marginBottom: 12 },
							]}
						>
							<IconButton
								name='back'
								label='返回音乐库'
								onPress={onBack}
							/>
							<T
								size={16}
								weight='600'
							>
								歌单
							</T>
							<ControlTarget
								fixedWidth
								accessibilityRole='button'
								accessibilityLabel='歌单更多操作'
								disabled={!detail}
								onPress={() => setMenu(true)}
								style={styles.textAction}
							>
								<T size={13}>更多</T>
							</ControlTarget>
						</View>
						{detail ? (
							<>
								<View style={[styles.row, { gap: 16 }]}>
									<PlaylistCover
										uri={
											detail.coverUri ??
											(firstSourceId
												? state.sources.get(firstSourceId)?.artwork
												: null)
										}
										size={94}
									/>
									<View style={{ flex: 1 }}>
										<T
											size={22}
											weight='700'
											style={{ marginVertical: 5 }}
										>
											{detail.name}
										</T>
										{!!detail.description && (
											<T
												muted
												size={13}
												style={{ marginBottom: 8 }}
											>
												{detail.description}
											</T>
										)}
										<T
											muted
											size={13}
										>
											{counts.pendingCount
												? `${detail.items.length} 首，${counts.pendingCount} 首未匹配`
												: `${detail.items.length} 首`}
										</T>
									</View>
								</View>
								<ControlRow
									controlMinWidthsDp={[48, 48]}
									gapDp={10}
									style={[
										styles.row,
										{
											gap: 10,
											marginTop: 16,
											marginBottom: 16,
										},
									]}
								>
									<View style={{ flex: 1 }}>
										<Button
											disabled={!counts.playableCount || playbackBusy}
											onPress={() => {
												if (counts.firstPlayableItemId)
													void play(counts.firstPlayableItemId)
											}}
										>
											{counts.pendingCount
												? '播放全部'
												: filtered
													? '播放歌单全部'
													: '播放全部'}
										</Button>
									</View>
									<View>
										<Button
											secondary
											onPress={() => session.openAdd()}
										>
											添加音源
										</Button>
									</View>
								</ControlRow>
								{!!state.error &&
									!state.nameForm &&
									!state.picker &&
									!state.deleting && (
										<PlaylistError
											message={state.error}
											onRetry={session.refresh}
										/>
									)}
								{!!playError && (
									<Card style={{ marginBottom: 12 }}>
										<T
											size={13}
											style={{ color: c.state.error }}
										>
											{playError}
										</T>
									</Card>
								)}
								{(!!state.notice || state.undoAvailable) && (
									<Card style={{ marginBottom: 12 }}>
										<T size={13}>{state.notice || '本次移除可以撤销'}</T>
										{state.undoAvailable && (
											<View style={{ marginTop: 12 }}>
												<Button
													secondary
													onPress={session.undoRemove}
												>
													撤销本次移除
												</Button>
											</View>
										)}
									</Card>
								)}
								<View
									testID='playlist-detail-filters'
									style={{ gap: 10, marginBottom: 12 }}
								>
									<ThemeTextInput
										testID='playlist-detail-search-input'
										accessibilityLabel='搜索歌单条目'
										value={state.detailQuery}
										onChangeText={session.setDetailQuery}
										placeholder='搜索标题、艺人、UP 或 BV'
										placeholderTextColor={c.text.secondary}
										style={[
											shape(theme.components.input),
											{
												minHeight: 48,
												paddingHorizontal: 14,
												borderWidth: 1,
												borderColor: c.border.strong,
												backgroundColor: c.surface.card,
												color: c.text.primary,
												fontSize: 14,
											},
										]}
									/>
									<ControlRow
										controlMinWidthsDp={[72, 96]}
										gapDp={8}
										style={[styles.row, { gap: 8 }]}
									>
										{(['all', 'pending'] as const).map((filter) => (
											<ControlTarget
												key={filter}
												accessibilityRole='tab'
												accessibilityLabel={`歌单条目筛选：${filter === 'all' ? '全部' : '待匹配'}`}
												accessibilityState={{
													selected: state.detailFilter === filter,
												}}
												onPress={() => session.setDetailFilter(filter)}
												style={[
													shape(theme.components.button),
													{
														flex: 1,
														minHeight: 48,
														padding: 10,
														alignItems: 'center',
														justifyContent: 'center',
														backgroundColor:
															state.detailFilter === filter
																? c.surface.tinted
																: c.surface.card,
														borderWidth: 1,
														borderColor: c.border.subtle,
													},
												]}
											>
												<T size={13}>{filter === 'all' ? '全部' : '待匹配'}</T>
											</ControlTarget>
										))}
									</ControlRow>
									{filtered && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
<T muted size={13}>{visibleItems.length} 首符合筛选</T>
<ControlTarget fixedWidth minimumWidthDp={96} accessibilityRole='button' accessibilityLabel='清除歌单筛选' onPress={session.clearDetailFilters} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }}><T size={13} style={{ color: c.action.primary }}>清除筛选</T></ControlTarget>
</View>}
									{filtered && state.editing && (
										<T
											muted
											size={13}
										>
											筛选中暂不能排序，请先清除筛选。
										</T>
									)}
								</View>
								<View style={[styles.row, { justifyContent: 'space-between' }]}>
									<T
										muted
										size={13}
									>
										{state.editing
											? `已选 ${state.selectedItemIds.length} 项${hiddenSelectedCount ? `，筛选外 ${hiddenSelectedCount} 项` : ''}`
											: `歌曲 ${detail.items.length}`}
									</T>
									<ControlTarget
										fixedWidth
										accessibilityRole='button'
										accessibilityLabel={
											state.editing ? '完成歌单管理' : '管理歌单条目'
										}
										onPress={() => session.setEditing(!state.editing)}
										style={styles.textAction}
									>
										<T
											size={13}
											style={{ color: c.action.primary }}
										>
											{state.editing ? '完成' : '管理'}
										</T>
									</ControlTarget>
								</View>
								{state.editing && hiddenSelectedCount > 0 && (
									<T
										muted
										size={13}
										style={{ marginBottom: 8 }}
									>
										移除所选会同时移除筛选外的已选条目。
									</T>
								)}
								{state.editing && (
									<ControlRow
										controlMinWidthsDp={[48, 48, 48]}
										style={[
											styles.row,
											{ justifyContent: 'space-between', marginBottom: 8 },
										]}
									>
										<ControlTarget
											fixedWidth
											accessibilityRole='button'
											accessibilityLabel={
												filtered ? '全选全部筛选结果' : '全选歌单全部条目'
											}
											onPress={session.selectAll}
											style={styles.textAction}
										>
											<T size={13}>{filtered ? '全选全部筛选结果' : '全选'}</T>
										</ControlTarget>
										<ControlTarget
											fixedWidth
											accessibilityRole='button'
											accessibilityLabel='清空歌单条目选择'
											onPress={session.clearSelection}
											style={styles.textAction}
										>
											<T size={13}>清空选择</T>
										</ControlTarget>
										<ControlTarget
											fixedWidth
											accessibilityRole='button'
											accessibilityLabel={`移除所选${state.selectedItemIds.length}项`}
											accessibilityState={{
												disabled: !state.selectedItemIds.length,
											}}
											disabled={!state.selectedItemIds.length}
											onPress={() => confirmation.show(
												`移除所选 ${state.selectedItemIds.length} 首歌曲？`,
												'将从这张歌单移除所选条目，包括筛选外已选的歌曲。音频文件和喜欢会保留。',
												[{ text: '取消', style: 'cancel' }, { text: '移除', style: 'destructive', onPress: () => { session.removeSelected() } }],
												{ cancelable: true },
											)}
											style={[
												styles.textAction,
												{ opacity: state.selectedItemIds.length ? 1 : 0.4 },
											]}
										>
											<T
												size={13}
												style={{ color: c.state.error }}
											>
												移除所选 {state.selectedItemIds.length} 项
											</T>
										</ControlTarget>
									</ControlRow>
								)}
							</>
						) : null}
					</View>
				}
				ListEmptyComponent={
					detail ? (
						<State
							mascot={detail.items.length ? 'search' : 'empty'}
							title={
								detail.items.length
									? '没有符合条件的条目'
									: '把第一段喜欢的声音放进来'
							}
							message={
								detail.items.length
									? '试试其他关键词，或清除筛选查看整张歌单。'
									: '可以从已喜欢的音源中挑选，或去搜索更多内容。'
							}
						/>
					) : (
						<State
							mascot='error'
							title='这张歌单暂时无法打开'
							message={state.error || '请返回音乐库，重新选择歌单。'}
							retry={session.refresh}
						/>
					)
				}
				ListFooterComponent={
					detail && !detail.items.length ? (
						<Button
							secondary
							onPress={onSearch}
						>
							去搜索音源
						</Button>
					) : null
				}
			/>

			{songMenu && detail && <PlaylistModal title='歌曲操作' onClose={() => setSongMenu(null)} bottomInset={bottomInset} reducedMotion={reducedMotion}>
				<MenuAction label='更换音源' onPress={() => { const itemId = songMenu; setSongMenu(null); onChangeSource?.(detail.id, itemId) }} />
			</PlaylistModal>}
			{menu && (
				<PlaylistModal
					title='歌单操作'
					onClose={() => setMenu(false)}
					bottomInset={bottomInset}
					reducedMotion={reducedMotion}
				>
					<MenuAction
						label='编辑封面'
						onPress={() => {
							setMenu(false)
							session.requestCover()
						}}
					/>
					<MenuAction
						label='编辑简介'
						onPress={() => {
							setMenu(false)
							session.requestName('description')
						}}
					/>
					<MenuAction
						label='重命名歌单'
						onPress={() => {
							setMenu(false)
							session.requestName('rename')
						}}
					/>
					<MenuAction
						label='复制为新歌单'
						onPress={() => {
							setMenu(false)
							session.requestName('copy')
						}}
					/>
					<MenuAction
						label='删除歌单'
						onPress={() => {
							setMenu(false)
							session.requestDelete()
						}}
					/>
				</PlaylistModal>
			)}
		</View>
	)
}

function PlaylistError({
	message,
	onRetry,
}: {
	message: string
	onRetry?: () => void
}) {
	const theme = useTheme()
	return (
		<Card style={{ marginBottom: 12 }}>
			<T
				size={12}
				style={{ color: theme.tokens.state.error }}
			>
				{message}
			</T>
			{onRetry && (
				<View style={{ marginTop: 10 }}>
					<Button
						secondary
						onPress={onRetry}
					>
						重新读取歌单
					</Button>
				</View>
			)}
		</Card>
	)
}

function MenuAction({
	label,
	onPress,
}: {
	label: string
	onPress: () => void
}) {
	return (
		<ControlTarget
			minimumHeightDp={54}
			accessibilityRole='button'
			accessibilityLabel={label}
			onPress={onPress}
			style={{ minHeight: 54, justifyContent: 'center' }}
		>
			<T>{label}</T>
		</ControlTarget>
	)
}

function PlaylistModal({
	title,
	onClose,
	children,
	bottomInset = 0,
	reducedMotion = true,
}: React.PropsWithChildren<{
	title: string
	onClose: () => void
	bottomInset?: number
	reducedMotion?: boolean
}>) {
	const theme = useTheme()
	return (
		<Modal
			transparent
			visible
			animationType={reducedMotion ? 'none' : 'fade'}
			onRequestClose={onClose}
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
					accessibilityLabel='关闭歌单面板'
					style={StyleSheet.absoluteFill}
					onPress={onClose}
				/>
				<View
					style={{
						backgroundColor: theme.tokens.surface.base,
						maxHeight: '88%',
						padding: 22,
						paddingBottom: bottomInset + 22,
						borderTopLeftRadius: 25,
						borderTopRightRadius: 25,
					}}
				>
					<View
						style={[
							styles.row,
							{ justifyContent: 'space-between', marginBottom: 12 },
						]}
					>
						<T
							size={21}
							weight='700'
							style={{ flex: 1 }}
						>
							{title}
						</T>
						<IconButton
							name='close'
							label='关闭歌单面板'
							onPress={onClose}
						/>
					</View>
					{children}
				</View>
			</View>
		</Modal>
	)
}

export function PlaylistSourceActions({
	item,
	onClose,
	onAdd,
	onListen,
	onCreator,
	bottomInset,
	reducedMotion,
}: {
	item: SearchItem | BiliSource | null
	onClose: () => void
	onAdd: (item: SearchItem | BiliSource) => void
	onListen: (item: SearchItem | BiliSource) => void
	onCreator: (item: SearchItem | BiliSource) => void
	bottomInset: number
	reducedMotion: boolean
}) {
	if (!item) return null
	return (
		<PlaylistModal
			title='音源操作'
			onClose={onClose}
			bottomInset={bottomInset}
			reducedMotion={reducedMotion}
		>
			<T
				weight='600'
				lines={3}
			>
				{item.originalTitle}
			</T>
			<T
				muted
				size={12}
				style={{ marginVertical: 10 }}
			>
				UP，{item.uploader}
			</T>
			<MenuAction
				label='查看 UP 主主页'
				onPress={() => onCreator(item)}
			/>
			<MenuAction
				label='加入本地歌单'
				onPress={() => onAdd(item)}
			/>
			<MenuAction
				label='以听视频开启'
				onPress={() => onListen(item)}
			/>
		</PlaylistModal>
	)
}

export function PlaylistDialogs({
	state,
	session,
	bottomInset,
	reducedMotion,
	onSearch,
}: PlaylistViewProps & {
	bottomInset: number
	reducedMotion: boolean
	onSearch: () => void
}) {
	const theme = useTheme()
	const c = theme.tokens
	const field = [
		shape(theme.components.input),
		{
			backgroundColor: c.surface.card,
			borderWidth: 1,
			borderColor: c.border.strong,
			minHeight: 50,
			paddingHorizontal: 14,
			color: c.text.primary,
			fontSize: 14,
		},
	]
	if (state.coverForm) {
		const first = state.detail?.items.find(
			(item) => item.sourceId !== null,
		)?.sourceId
		const automatic = first ? state.sources.get(first)?.artwork : null
		return (
			<PlaylistModal
				title='编辑封面'
				onClose={session.closeSheet}
				bottomInset={bottomInset}
				reducedMotion={reducedMotion}
			>
				<PlaylistCover
					uri={state.coverForm.uri ?? automatic}
					size={140}
				/>
				<T
					muted
					size={12}
					style={{ marginVertical: 12 }}
				>
					选择本地图片后预览，保存才会更改本机歌单。自动封面使用首项音源图片。
				</T>
				{!!state.error && <PlaylistError message={state.error} />}
				<View style={{ gap: 10 }}>
					<Button
						secondary
						disabled={state.coverForm.busy}
						onPress={session.pickCover}
					>
						选择本地图片
					</Button>
					<Button
						secondary
						disabled={state.coverForm.busy}
						onPress={session.useAutomaticCover}
					>
						恢复自动封面
					</Button>
					<Button
						disabled={state.coverForm.busy}
						onPress={session.saveCover}
					>
						{state.coverForm.busy ? '正在处理图片…' : '保存歌单封面'}
					</Button>
				</View>
			</PlaylistModal>
		)
	}

	if (state.nameForm)
		return (
			<PlaylistModal
				title={
					state.nameForm.kind === 'from-likes'
						? '喜欢另存为歌单'
						: state.nameForm.kind === 'description'
							? '编辑简介'
							: state.nameForm.kind === 'create'
								? '新建歌单'
								: state.nameForm.kind === 'rename'
									? '重命名歌单'
									: '复制为新歌单'
				}
				onClose={session.closeSheet}
				bottomInset={bottomInset}
				reducedMotion={reducedMotion}
			>
				<T
					muted
					size={12}
					style={{ marginBottom: 9 }}
				>
					{state.nameForm.kind === 'description' ? '歌单简介' : '歌单名称'}
				</T>
				<ThemeTextInput
					accessibilityLabel={
						state.nameForm.kind === 'description' ? '歌单简介' : '歌单名称'
					}
					testID={
						state.nameForm.kind === 'description'
							? 'playlist-description-input'
							: 'playlist-name-input'
					}
					value={state.nameForm.value}
					onChangeText={session.setName}
					placeholder={
						state.nameForm.kind === 'description'
							? '输入歌单简介（选填）'
							: '输入歌单名称'
					}
					placeholderTextColor={c.text.secondary}
					maxLength={state.nameForm.kind === 'description' ? undefined : 40}
					multiline={state.nameForm.kind === 'description'}
					autoFocus
					style={field}
					onSubmitEditing={
						state.nameForm.kind === 'description' ? undefined : session.saveName
					}
					returnKeyType='done'
				/>
				<View style={{ marginTop: 14, gap: 12 }}>
					{!!state.error && <PlaylistError message={state.error} />}
					<Button
						onPress={session.saveName}
						disabled={
							state.nameForm.kind !== 'description' &&
							!state.nameForm.value.trim()
						}
					>
						{state.nameForm.kind === 'from-likes'
							? '保存为独立歌单'
							: state.nameForm.kind === 'description'
								? '保存歌单简介'
								: state.nameForm.kind === 'create'
									? '创建歌单'
									: '保存歌单名称'}
					</Button>
				</View>
			</PlaylistModal>
		)
	if (state.deleting)
		return (
			<PlaylistModal
				title='删除这张歌单？'
				onClose={session.closeSheet}
				bottomInset={bottomInset}
				reducedMotion={reducedMotion}
			>
				<T
					size={13}
					style={{ marginBottom: 18 }}
				>
					只删除本地「{state.detail?.name}
					」及其中条目，喜欢、音源与正在播放的队列保留。
				</T>
				{!!state.error && <PlaylistError message={state.error} />}
				<Button onPress={session.confirmDelete}>确认删除歌单</Button>
			</PlaylistModal>
		)
	if (state.targetSources)
		return (
			<PlaylistModal
				title='加入哪张歌单？'
				onClose={session.closeSheet}
				bottomInset={bottomInset}
				reducedMotion={reducedMotion}
			>
				<ScrollView keyboardShouldPersistTaps='handled'>
					<T
						muted
						size={12}
						style={{ marginBottom: 12 }}
					>
						保留所选音源，加入你指定的本地歌单。
					</T>
					{state.playlists.map(({ playlist, count }) => (
						<MenuAction
							key={playlist.id}
							label={`${playlist.name}，${count} 项`}
							onPress={() => session.selectTarget(playlist.id)}
						/>
					))}
					{!state.playlists.length && !state.error && (
						<T
							muted
							size={12}
						>
							还没有本地歌单，可以先新建一张。
						</T>
					)}
					{!!state.error && <PlaylistError message={state.error} />}
					<MenuAction
						label='新建歌单并继续添加'
						onPress={() => session.requestName('create')}
					/>
				</ScrollView>
			</PlaylistModal>
		)
	const picker = state.picker
	if (!picker) return null
	const visible = selectPlaylistPickerSources(picker.sources, picker.query)
	return (
		<PlaylistModal
			title={`添加到「${state.detail?.name ?? '歌单'}」`}
			onClose={session.closeSheet}
			bottomInset={bottomInset}
			reducedMotion={reducedMotion}
		>
			<ThemeTextInput
				accessibilityLabel='搜索待添加的音源'
				value={picker.query}
				onChangeText={session.setPickerQuery}
				placeholder='搜索待添加的音源'
				placeholderTextColor={c.text.secondary}
				style={field}
			/>
			<FlatList
				key={picker.query}
				testID='playlist-picker-list'
				keyboardShouldPersistTaps='handled'
				style={{ flexShrink: 1, marginTop: 12 }}
				data={visible}
				keyExtractor={(source) => source.id}
				initialNumToRender={12}
				maxToRenderPerBatch={12}
				windowSize={5}
				removeClippedSubviews={false}
				extraData={picker.selectedSourceIds}
				renderItem={({ item: source }) => (
					<PickerSource
						source={source}
						selected={picker.selectedSourceIds.includes(source.id)}
						onPress={() => session.toggleSource(source.id)}
					/>
				)}
				ListHeaderComponent={
					<T
						muted
						size={11}
						style={{ marginBottom: 6 }}
					>
						只添加明确勾选的音源，筛选不会清空选择。显示 {visible.length} /{' '}
						{picker.sources.length} 项。
					</T>
				}
				ListEmptyComponent={
					<State
						title={
							picker.sources.length
								? '没有匹配的待添加音源'
								: '先找到想留下的声音'
						}
						message={
							picker.sources.length
								? '换个关键词，已勾选的内容仍会保留。'
								: '从搜索结果的更多菜单可以直接加入歌单，也可以先喜欢音源再回来挑选。'
						}
					/>
				}
				ListFooterComponent={
					!picker.sources.length ? (
						<Button
							secondary
							onPress={() => {
								session.closeSheet()
								onSearch()
							}}
						>
							去搜索音源
						</Button>
					) : null
				}
			/>

			<T
				muted
				size={11}
				style={{ marginTop: 14, marginBottom: 5 }}
			>
				重复音源的处理方式
			</T>
			{(
				[
					['keep-all', '保留重复条目'],
					['skip-existing-source', '跳过歌单已有音源'],
				] as const
			).map(([policy, label]) => (
				<ControlTarget
					minimumWidthDp={78}
					key={policy}
					accessibilityRole='radio'
					accessibilityLabel={label}
					accessibilityState={{ checked: picker.duplicatePolicy === policy }}
					onPress={() => session.setDuplicatePolicy(policy)}
					style={[styles.row, { gap: 10, minHeight: 48 }]}
				>
					<View
						style={{
							width: 20,
							height: 20,
							borderRadius: 12,
							borderWidth: 1,
							borderColor:
								picker.duplicatePolicy === policy
									? c.action.primary
									: c.border.strong,
							alignItems: 'center',
							justifyContent: 'center',
						}}
					>
						{picker.duplicatePolicy === policy && (
							<View
								style={{
									width: 10,
									height: 10,
									borderRadius: 6,
									backgroundColor: c.action.primary,
								}}
							/>
						)}
					</View>
					<T size={12}>{label}</T>
				</ControlTarget>
			))}
			{!!state.error && <PlaylistError message={state.error} />}
			<Button
				disabled={!picker.selectedSourceIds.length || !picker.duplicatePolicy}
				onPress={session.appendSelected}
			>
				添加所选 {picker.selectedSourceIds.length} 项
			</Button>
		</PlaylistModal>
	)
}

function PickerSource({
	source,
	selected,
	onPress,
}: {
	source: Source
	selected: boolean
	onPress: () => void
}) {
	const theme = useTheme()
	return (
		<ControlTarget
			minimumWidthDp={138}
			minimumHeightDp={76}
			accessibilityRole='checkbox'
			accessibilityLabel={`选择音源 ${source.originalTitle}`}
			accessibilityState={{ checked: selected }}
			onPress={onPress}
			style={[
				styles.row,
				{
					gap: 10,
					minHeight: 76,
					paddingVertical: 10,
					borderBottomWidth: 1,
					borderBottomColor: theme.tokens.border.subtle,
				},
			]}
		>
			<View
				style={{
					width: 24,
					height: 24,
					borderRadius: 5,
					borderWidth: 1,
					borderColor: selected
						? theme.tokens.action.primary
						: theme.tokens.border.strong,
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				{selected && (
					<Icon
						name='check'
						color={theme.tokens.action.primary}
						size={18}
					/>
				)}
			</View>
			<PlaylistCover
				uri={source.artwork}
				size={46}
			/>
			<View style={{ flex: 1 }}>
				<T
					size={13}
					lines={2}
				>
					{source.originalTitle}
				</T>
				<T
					muted
					size={10}
				>
					{isLocalLibrarySource(source) ? '本地音频' : isDouyinLibrarySource(source) ? '抖音原声' : 'UP'}，{' '}
					{source.uploader || '未知艺术家'}，{time(source.duration)}
				</T>
			</View>
		</ControlTarget>
	)
}

const styles = StyleSheet.create({
	row: { flexDirection: 'row', alignItems: 'center' },
	textAction: {
		minWidth: 48,
		minHeight: 48,
		alignItems: 'center',
		justifyContent: 'center',
	},
})
