import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import type { Creator } from './core/creators'
import type { SearchItem } from './core/model'
import { CreatorSearchResults } from './creator-remote-ui'
import type {
	CreatorSearchSession,
	CreatorSearchState,
} from './creator-search-session'
import type {
	SearchHistory,
	SearchHistoryEntry,
	SearchHistoryState,
} from './search-history'
import type { SearchLocalFollowing } from './search-local-following'
import { canSortSearch } from './search-order'
import { SearchQueryControls } from './search-query-controls'
import { ConfirmationModal } from './theme-dialog'
import {
	musicResults,
	type SearchSession,
	type SearchState,
} from './search-session'
import {
	Button,
	ControlTarget,
	State,
	T,
	useTheme,
	useThemeRendering,
} from './ui'

export interface SearchPageProps {
	query: string
	filter: 'all' | 'music' | 'listening' | 'creator' | 'douyin'
	search: SearchState & Pick<SearchSession, 'retry' | 'loadMore' | 'setOrder'>
	creatorSearch: {
		state: CreatorSearchState
		session: CreatorSearchSession
		following?: SearchLocalFollowing & { refresh: () => void }
	}
	onQueryChange: (query: string) => void
	onFilterChange: (filter: SearchPageProps['filter']) => void
	onSubmit: (value?: string) => void | Promise<void>
	history?: {
		state: SearchHistoryState
		session: Pick<
			SearchHistory,
			'requestClear' | 'cancelClear' | 'confirmClear'
		>
	}
	onSelectHistory?: (entry: SearchHistoryEntry) => void
	onOpenCreator: (creator: Creator) => void
	renderRow: (item: SearchItem, index: number) => React.ReactNode
	douyinContent?: React.ReactNode
}

/** Presentation only. App retains both searches, their lifecycles and submission ownership. */
export function SearchPage({
	query,
	filter,
	search,
	creatorSearch,
	onQueryChange,
	onFilterChange,
	onSubmit,
	onOpenCreator,
	history,
	onSelectHistory,
	renderRow,
	douyinContent,
}: SearchPageProps) {
	const theme = useTheme()
	const rendering = useThemeRendering()
	const c = theme.tokens
	const {
		submitted,
		items: results,
		ketangCount,
		more,
		loading: searching,
		error: searchError,
		failedPage,
		retry: retrySearch,
		loadMore,
	} = search
	const visible = filter === 'music' ? musicResults(results) : results
	const exactVideo =
		!!submitted && !canSortSearch(submitted) && results.length > 0
	return (
		<>
			<T
				size={25}
				weight='700'
				style={{ marginBottom: 12 }}
			>
				搜索
			</T>
			<SearchQueryControls
				query={query}
				onQueryChange={onQueryChange}
				onSubmit={onSubmit}
				placeholder={
					filter === 'creator'
						? 'UP 昵称 / mid:123 / UP 主页链接'
						: filter === 'listening'
							? '视频标题 / UP 主 / BV 号'
							: filter === 'douyin'
								? '抖音关键词 / 粘贴抖音分享口令或短链'
								: '歌曲关键词 / BV 号 / 抖音分享链接'
				}
			/>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={[s.row, { gap: 4 }]}
				style={{ marginVertical: 10 }}
			>
				{(['all', 'music', 'douyin', 'listening', 'creator'] as const).map((value) => {
					const tab = (
						<ControlTarget
							key={value}
							minimumWidthDp={58}
							accessibilityRole='tab'
							accessibilityState={{ selected: filter === value }}
							onPress={() => onFilterChange(value)}
							style={{
								minHeight: 48,
								paddingHorizontal: 10,
								justifyContent: 'center',
								borderBottomWidth: filter === value ? 2 : 0,
								borderBottomColor: c.action.primary,
							}}
						>
							<T
								size={13}
								weight={filter === value ? '700' : '400'}
							>
								{value === 'all'
									? '综合'
									: value === 'music'
										? '音乐分区'
										: value === 'listening'
											? '听视频'
											: value === 'douyin'
												? '抖音原声'
												: 'UP 主'}
							</T>
						</ControlTarget>
					)
					return rendering?.controlRowLayout ? (
						<View
							key={value}
							style={{ width: Math.max(80, rendering.buttonMinTouchDp) }}
						>
							{tab}
						</View>
					) : (
						tab
					)
				})}
			</ScrollView>
			{history && !query.trim() && (
				<View
					testID='search-history'
					style={{ marginBottom: 16 }}
				>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
						}}
					>
						<T
							size={14}
							weight='700'
						>
							最近搜索
						</T>
						{history.state.items.length > 0 && (
							<ControlTarget
								minimumWidthDp={64}
								accessibilityRole='button'
								accessibilityLabel='清空搜索历史'
								onPress={history.session.requestClear}
								style={{
									minHeight: 48,
									justifyContent: 'center',
									alignItems: 'center',
								}}
							>
								<T
									size={12}
									muted
								>
									清空
								</T>
							</ControlTarget>
						)}
					</View>
					{history.state.confirmClear && (
						<ConfirmationModal
							testID='search-history-clear-confirmation'
							title='清空搜索历史？'
							onCancel={history.session.cancelClear}
						>
							<T>确定清空本机搜索历史吗？不会删除音乐、喜欢或歌单。</T>
							<Button
								secondary
								onPress={history.session.cancelClear}
							>
								取消清空
							</Button>
							<Button onPress={history.session.confirmClear}>
								确认清空搜索历史
							</Button>
						</ConfirmationModal>
					)}
					{!!history.state.error && <T muted>{history.state.error}</T>}
					{!history.state.items.length && !history.state.error && (
						<T
							size={12}
							muted
						>
							搜索后会保留在这里，仅存于本机。
						</T>
					)}
					<ScrollView
						horizontal
						showsHorizontalScrollIndicator={false}
						contentContainerStyle={{ gap: 8 }}
					>
						{history.state.items.map((entry) => {
							const kindLabel = {
								all: '综合',
								music: '音乐分区',
								listening: '听视频',
								creator: 'UP 主',
								douyin: '抖音原声',
							}[entry.kind]
							const label = `${entry.query}，${kindLabel}${entry.kind !== 'creator' && entry.kind !== 'douyin' && entry.order === 'published' ? '，最新' : ''}`
							const chip = (
								<ControlTarget
									key={JSON.stringify(entry)}
									minimumWidthDp={96}
									accessibilityRole='button'
									accessibilityLabel={`再次搜索 ${label}`}
									onPress={() => onSelectHistory?.(entry)}
									style={{
										minHeight: 48,
										maxWidth: 240,
										paddingHorizontal: 14,
										paddingVertical: 8,
										justifyContent: 'center',
										borderRadius: 16,
										backgroundColor: c.surface.card,
									}}
								>
									<T
										size={12}
										lines={2}
									>
										{label}
									</T>
								</ControlTarget>
							)
							return rendering?.controlRowLayout ? (
								<View
									key={JSON.stringify(entry)}
									style={{ width: Math.max(180, rendering.buttonMinTouchDp) }}
								>
									{chip}
								</View>
							) : (
								chip
							)
						})}
					</ScrollView>
				</View>
			)}
			{filter !== 'creator' && filter !== 'douyin' && !!submitted && canSortSearch(submitted) && (
				<View
					testID='search-order-controls'
					style={{
						flexDirection: 'row',
						flexWrap: 'wrap',
						gap: 8,
						marginBottom: 12,
					}}
				>
					{(['relevance', 'published'] as const).map((order) => (
						<ControlTarget
							key={order}
							minimumWidthDp={100}
							accessibilityRole='button'
							accessibilityLabel={
								order === 'relevance' ? '相关优先' : '最新发布'
							}
							accessibilityState={{ selected: search.order === order }}
							onPress={() => {
								void search.setOrder(order)
							}}
							style={{
								minHeight: 48,
								paddingHorizontal: 12,
								justifyContent: 'center',
								borderBottomWidth: search.order === order ? 2 : 0,
								borderBottomColor: c.action.primary,
							}}
						>
							<T
								size={12}
								weight={search.order === order ? '700' : '400'}
							>
								{order === 'relevance' ? '相关优先' : '最新发布'}
							</T>
						</ControlTarget>
					))}
				</View>
			)}
			{filter === 'all' &&
				canSortSearch(submitted) &&
				creatorSearch.state.keyword === submitted.trim() && (
					<View
						testID='search-creator-preview'
						style={{ marginBottom: 20 }}
					>
						<CreatorSearchResults
							state={creatorSearch.state}
							session={creatorSearch.session}
							following={creatorSearch.following}
							onOpen={onOpenCreator}
							preview={{
								compact: true,
								onViewAll: () => {
									onQueryChange(creatorSearch.state.keyword)
									onFilterChange('creator')
								},
							}}
						/>
					</View>
				)}
			{filter === 'douyin' ? (
				(douyinContent ?? null)
			) : filter === 'creator' ? (
				<CreatorSearchResults
					state={creatorSearch.state}
					session={creatorSearch.session}
					following={creatorSearch.following}
					onOpen={onOpenCreator}
				/>
			) : (
				<>
					{submitted && (
						<T
							muted
							size={11}
						>
							“{submitted}”，已显示 {visible.length} 条
							{visible.length !== results.length
								? `，已读取 ${results.length} 条`
								: ''}
						</T>
					)}
					{!submitted && !searching && !searchError ? (
						<State
							mascot='search'
							title={filter === 'listening' ? '搜索听视频' : '搜索音乐'}
							message={
								filter === 'listening'
									? '输入视频标题、UP 主关键词，或粘贴 BV 号。'
									: '输入歌名、艺人或 UP 主，也可以粘贴 BV 号。'
							}
						/>
					) : searchError && failedPage === 1 ? (
						<State
							mascot='error'
							title='搜索未完成'
							message={searchError}
							retry={() => {
								void retrySearch()
							}}
						/>
					) : searching && results.length === 0 ? (
						<State
							busy
							mascot='loading'
							title='正在搜索'
						/>
					) : visible.length === 0 ? (
						<State
							mascot='search'
							title={
								results.length > 0
									? '当前筛选没有匹配音源'
									: ketangCount > 0
										? '当前结果没有可展示的视频'
										: '没有找到结果'
							}
							message={
								filter === 'music' && results.length > 0
									? exactVideo
										? '已找到此 BV；它尚未标为音乐分区，可切到听视频试听。'
										: more
											? '已加载的音源未标为音乐分区，可查看全部音源，或继续加载下一页。'
											: '已加载的音源未标为音乐分区，可查看全部音源或换一个词。'
									: results.length === 0 && ketangCount > 0
										? more
											? '已读取的结果仅包含暂不支持的 B 站课程，可继续加载下一页。'
											: '已读取的结果仅包含暂不支持的 B 站课程，可更换关键词或使用完整 BV 号。'
										: '试试更短的关键词，或使用完整 BV 号。'
							}
						/>
					) : (
						<>{visible.map(renderRow)}</>
					)}
					{filter === 'music' && results.length > 0 && visible.length === 0 && (
						<Button
							secondary
							onPress={() => onFilterChange(exactVideo ? 'listening' : 'all')}
						>
							{exactVideo
								? '在听视频中查看此 BV'
								: `查看全部音源（${results.length}）`}
						</Button>
					)}
					{!!searchError && failedPage !== 1 && (
						<State
							title='下一页加载失败'
							message={searchError}
							retry={() => {
								void retrySearch()
							}}
						/>
					)}
					{more && !searchError && (
						<Button
							secondary
							disabled={searching}
							onPress={() => {
								void loadMore()
							}}
						>
							{searching ? '正在加载…' : '加载更多结果'}
						</Button>
					)}
				</>
			)}
		</>
	)
}
const s = StyleSheet.create({
	row: { flexDirection: 'row', alignItems: 'center' },
})
