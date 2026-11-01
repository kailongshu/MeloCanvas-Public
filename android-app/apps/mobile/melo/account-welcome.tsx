import React, { useEffect, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Modal,
	ScrollView,
	StatusBar,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
} from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import {
	initialWindowMetrics,
	SafeAreaProvider,
	SafeAreaView,
} from 'react-native-safe-area-context'

import { AccountWelcomeArt } from './account-welcome-art'
import { ConfirmationModal } from './theme-dialog'
import { accountUsageNotice } from './app-information'
import { AuthorSupportEntry } from './author-support-ui'
import { builtInThemes, type ThemeKey } from './core/theme'
import { cosmosTheme, type ColorMode } from './core/theme-appearance'
import {
	Backdrop,
	Artwork,
	Button,
	Card,
	ControlTarget,
	Icon,
	shape,
	T,
	ThemeProvider,
} from './ui'

export { accountUsageNotice } from './app-information'

export interface AccountWelcomeProps {
	colorMode?: ColorMode
	themeKey: ThemeKey
	width: number
	contentWidth: number | null
	checking: boolean
	error: string | null
	recovery: boolean
	consent: boolean
	busy: boolean
	qr: string
	message: string
	noticeExpanded: boolean
	diagnosticExpanded: boolean
	diagnostic: string
	capabilities: string
	onToggleNotice: () => void
	onToggleDiagnostic: () => void
	onToggleConsent: () => void
	onGenerate: () => void
	onCancel: () => void
	onRetry: () => void
	onClear: () => void
	onExit: () => void
	onSkip?: () => void
	onQrError: () => void
	onContentWidth: (width: number) => void
}

/** Presentation only; the account gate still owns every login/recovery action. */
export function AccountWelcome(props: AccountWelcomeProps) {
	const [confirmClear, setConfirmClear] = useState(false)
	const scroll = useRef<ScrollView>(null)
	const { fontScale } = useWindowDimensions()
	const stage = props.checking
		? 'checking'
		: props.qr
			? 'qr'
			: props.busy
				? 'generating'
				: props.recovery
					? 'recovery'
					: 'welcome'
	useEffect(() => {
		scroll.current?.scrollTo({ y: 0, animated: false })
	}, [stage])
	const theme = props.colorMode === 'dark' ? cosmosTheme : builtInThemes[props.themeKey]
	const c = theme.tokens
	const padding = Math.min(24, Math.max(12, props.width * 0.06))
	const contentWidth = Math.min(
		props.contentWidth ?? 440,
		440,
		props.width - padding * 2,
	)
	const qrSize = Math.max(1, Math.min(180, Math.floor(contentWidth - 60)))
	const compact = props.checking || props.recovery || props.busy || !!props.qr
	const canGenerate = props.consent && !props.busy && !props.checking
	if (props.checking) return (
		<ThemeProvider value={theme}>
			<SafeAreaProvider initialMetrics={initialWindowMetrics}>
				<SafeAreaView style={{ flex: 1, backgroundColor: c.surface.base, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
					<StatusBar barStyle={props.colorMode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={c.surface.base} />
					<T size={28} weight='700'>音绘</T>
					<ActivityIndicator accessibilityLabel='正在验证账号' color={c.action.primary} />
					<T muted size={13}>正在验证已保存账号…</T>
				</SafeAreaView>
			</SafeAreaProvider>
		</ThemeProvider>
	)
	const message =
		props.message === '登录暂未完成，请按下方诊断阶段定位后重试。'
			? '登录未完成，请检查网络后重试。需要帮助时，可展开连接诊断。'
			: props.message === '二维码显示失败，请提供下方诊断阶段。'
				? '二维码显示失败，请重新生成。连接诊断中保留了失败阶段。'
				: props.message
	const consentControl = (
		<View style={s.consentRow}>
			<ControlTarget
				testID='account-login-consent'
				accessibilityRole='checkbox'
				accessibilityLabel='我已阅读使用须知，同意在本机保存账号会话'
				accessibilityState={{ checked: props.consent }}
				onPress={props.onToggleConsent}
				style={s.checkboxTarget}
			>
				<View
					style={[
						s.checkbox,
						{
							borderColor: props.consent ? c.action.primary : c.border.strong,
							backgroundColor: props.consent
								? c.surface.tinted
								: c.surface.card,
						},
					]}
				>
					{props.consent && (
						<Icon
							name='check'
							size={15}
							color={c.action.primary}
						/>
					)}
				</View>
			</ControlTarget>
			<View style={s.consentCopy}>
				<ControlTarget
					testID='account-usage-disclosure'
					accessibilityRole='button'
					accessibilityLabel={
						props.noticeExpanded ? '收起使用须知' : '展开使用须知'
					}
					accessibilityState={{ expanded: props.noticeExpanded }}
					onPress={props.onToggleNotice}
					style={s.noticeLink}
				>
					<T
						size={12}
						style={{ textDecorationLine: 'underline' }}
					>
						我已阅读使用须知与账号说明
					</T>
				</ControlTarget>
				<T
					muted
					size={12}
				>
					{props.qr
						? '已同意保存会话，可点选框撤回。'
						: '勾选后同意在本机保存账号会话。'}
				</T>
			</View>
		</View>
	)
	const generateControl = (
		<ControlTarget
			testID='account-login-generate'
			accessibilityRole='button'
			disabled={!canGenerate}
			accessibilityState={{ disabled: !canGenerate }}
			accessibilityLiveRegion={props.qr ? 'polite' : 'none'}
			onPress={() => {
				if (canGenerate) props.onGenerate()
			}}
			style={({ pressed }) =>
				props.qr
					? s.qrStatus
					: [
							shape(theme.components.button),
							s.primary,
							{
								backgroundColor: c.action.primary,
								opacity: canGenerate ? (pressed ? 0.86 : 1) : 0.48,
								...(props.themeKey === 'modern' ? { borderRadius: 28 } : {}),
								...(props.themeKey === 'anime'
									? {
											transform: [{ skewX: '-2deg' }],
											boxShadow: ['3px 3px 0', c.border.strong].join(' '),
										}
									: {}),
							},
						]
			}
		>
			<T
				size={props.qr ? 13 : 14}
				weight='600'
				style={{ color: props.qr ? c.text.primary : c.text.inverse }}
			>
				{props.busy
					? props.qr
						? message || '等待扫码确认'
						: '正在生成二维码…'
					: message
						? '重新生成登录二维码'
						: '用 B 站扫码登录'}
			</T>
			{!props.qr && !props.busy && (
				<Icon
					name='arrow'
					size={17}
					color={c.text.inverse}
				/>
			)}
		</ControlTarget>
	)
	return (
		<ThemeProvider value={theme}>
			{confirmClear && <ConfirmationModal title='清除保存的登录状态？' onCancel={() => setConfirmClear(false)}>
				<T>清除后需要重新登录，本机音乐和歌单会保留。</T>
				<Button secondary onPress={() => setConfirmClear(false)}>取消</Button>
				<Button disabled={props.busy} onPress={() => { setConfirmClear(false); props.onClear() }}>确认清除登录状态</Button>
			</ConfirmationModal>}
			<SafeAreaProvider initialMetrics={initialWindowMetrics}>
				<SafeAreaView style={[s.screen, { backgroundColor: c.surface.base }]}>
					<StatusBar
						barStyle={props.colorMode === 'dark' ? 'light-content' : 'dark-content'}
						backgroundColor={c.surface.base}
					/>
					<Backdrop />
					<ScrollView
						ref={scroll}
						testID='account-welcome-scroll'
						contentContainerStyle={{
							flexGrow: 1,
							paddingHorizontal: padding,
							paddingVertical: 24,
						}}
					>
						<View
							key={fontScale}
							testID='account-welcome-content'
							onLayout={(event) => {
								if (event.nativeEvent.layout.width > 0)
									props.onContentWidth(event.nativeEvent.layout.width)
							}}
							style={s.content}
						>
							<View style={s.brand}>
								<View
									importantForAccessibility='no-hide-descendants'
									accessibilityElementsHidden
									style={[
										s.brandMark,
										shape(theme.components.card),
										{ backgroundColor: c.action.primary },
										props.themeKey === 'anime' && {
											transform: [{ rotate: '-5deg' }],
										},
									]}
								>
									<Text
										allowFontScaling={false}
										style={[s.brandLetter, { color: c.text.inverse }]}
									>
										m
									</Text>
								</View>
								<View style={{ flex: 1, minWidth: 0, gap: 1 }}>
									<T
										size={22}
										weight='700'
									>
										音绘
									</T>
									<T
										muted
										size={11}
										style={{ letterSpacing: 1 }}
									>
										MeloCanvas
									</T>
								</View>
							</View>
							{!compact && (props.colorMode === 'dark' ? <Artwork size={180} style={{ alignSelf: 'center', borderRadius: 18 }} /> : (
								<AccountWelcomeArt
									themeKey={props.themeKey}
									width={contentWidth}
								/>
							))}
							<View style={{ gap: 10, paddingTop: compact ? 12 : 0 }}>
								<T
									variant='title'
									size={26}
									style={{ lineHeight: 37 }}
								>
									{props.checking || props.recovery
										? '欢迎回来，\n继续你的音乐。'
										: compact
											? '扫码，\n连接你的音乐。'
											: '把喜欢的声音，\n留在身边。'}
								</T>
								<T
									muted
									size={13}
								>
									{props.checking
										? '正在核验本机保存的 B 站账号，完成后继续收听。'
										: props.recovery
											? '可以重试账号验证，或重新扫码登录。'
											: compact
												? '使用 B 站 App 扫码，并在手机上确认登录。'
												: '音乐与听视频，都在音绘。\n登录 B 站，开始收听。'}
								</T>
							</View>
							{props.error && (
								<View accessibilityRole='alert'>
									<T
										size={13}
										style={{ color: c.state.error }}
									>
										{props.error}
									</T>
								</View>
							)}
							{props.checking ? (
								<View
									accessibilityLiveRegion='polite'
									style={s.checking}
								>
									<ActivityIndicator
										color={c.action.primary}
										accessibilityLabel='正在验证账号'
									/>
									<T size={14}>正在验证已保存账号…</T>
									<T
										muted
										size={12}
									>
										验证完成后再进入音乐库。
									</T>
								</View>
							) : (
								<View style={{ gap: 12 }}>
									{props.qr ? (
										<Card style={{ padding: 18, gap: 4, alignItems: 'center' }}>
											<View
												testID='account-login-qr'
												accessible
												accessibilityRole='image'
												accessibilityLabel='B站登录二维码，请使用B站App扫码'
												style={s.qrSurface}
											>
												<QRCode
													value={props.qr}
													size={qrSize}
													color='#111111'
													backgroundColor='#FFFFFF'
													onError={props.onQrError}
												/>
											</View>
											{generateControl}
											<T
												muted
												size={11}
											>
												二维码过期后可重新生成
											</T>
										</Card>
									) : null}
									{props.busy && !!props.qr && (
										<Button
											secondary
											testID='account-login-cancel'
											onPress={props.onCancel}
										>
											取消本次登录
										</Button>
									)}
									{consentControl}
									{!props.qr && generateControl}
									{props.onSkip && (
										<Button
											secondary
											testID='account-login-skip'
											disabled={props.busy}
											onPress={props.onSkip}
										>
											暂不登录 B 站，直接进入音绘
										</Button>
									)}
									{message && !props.qr && (
										<View accessibilityLiveRegion='polite'>
											<T size={13}>{message}</T>
										</View>
									)}
									{props.busy && !props.qr && (
										<Button
											secondary
											testID='account-login-cancel'
											onPress={props.onCancel}
										>
											取消本次登录
										</Button>
									)}
									<T
										muted
										size={11}
										style={{ textAlign: 'center' }}
									>
										无需输入密码 · 会话仅存本机
									</T>
									{props.recovery && (
										<View style={{ gap: 10 }}>
											<Button
												secondary
												testID='account-login-retry'
												disabled={props.busy}
												onPress={props.onRetry}
											>
												重新验证已保存账号
											</Button>
											<Button
												secondary
												testID='account-login-clear'
												disabled={props.busy}
												onPress={() => setConfirmClear(true)}
											>
												清除保存的登录状态
											</Button>
										</View>
									)}
								</View>
							)}
							<T
								muted
								size={12}
							>
								可选绑定 B 站账号；不登录 B 站也可直接使用抖音原声、在线歌词与本地音乐。
							</T>
							<View style={s.footer}>
								<View style={s.footerRow}>
									<ControlTarget
										testID='account-login-exit'
										accessibilityRole='button'
										onPress={props.onExit}
										style={s.footerAction}
									>
										<T
											muted
											size={12}
										>
											不同意并退出
										</T>
									</ControlTarget>
									<ControlTarget
										testID='account-diagnostic-disclosure'
										accessibilityRole='button'
										accessibilityLabel={
											props.diagnosticExpanded ? '收起连接诊断' : '展开连接诊断'
										}
										accessibilityState={{ expanded: props.diagnosticExpanded }}
										onPress={props.onToggleDiagnostic}
										style={[s.footerAction, { alignItems: 'flex-end' }]}
									>
										<T
											muted
											size={12}
											style={{ alignSelf: 'stretch', textAlign: 'right' }}
										>
											登录遇到问题？
										</T>
									</ControlTarget>
								</View>
								{props.diagnosticExpanded && (
									<View
										testID='account-connection-diagnostic'
										style={{ gap: 8 }}
									>
										<T
											muted
											size={12}
										>
											诊断阶段：{props.diagnostic}
										</T>
										<T
											muted
											size={12}
										>
											运行能力：{props.capabilities}
										</T>
									</View>
								)}
								<View
									style={{
										width: 24,
										borderTopWidth: 1,
										borderColor: c.border.subtle,
										marginVertical: 6,
									}}
								/>
								<T
									muted
									size={11}
								>
									非官方 B 站客户端
								</T>
							</View>
						</View>
					</ScrollView>
					{props.noticeExpanded && (
						<Modal
							transparent
							animationType='fade'
							onRequestClose={props.onToggleNotice}
						>
							<View style={s.modalShade}>
								<View
									accessibilityViewIsModal
									style={[s.noticeSheet, { backgroundColor: c.surface.card }]}
								>
									<T variant='section'>使用须知与账号说明</T>
									<ScrollView
										testID='account-usage-notice'
										style={{ flexShrink: 1 }}
										contentContainerStyle={{ gap: 14 }}
									>
										<AuthorSupportEntry />
										{accountUsageNotice.map((paragraph) => (
											<T
												key={paragraph}
												muted
												size={13}
											>
												{paragraph}
											</T>
										))}
									</ScrollView>
									<Button
										secondary
										onPress={props.onToggleNotice}
									>
										我知道了
									</Button>
								</View>
							</View>
						</Modal>
					)}
				</SafeAreaView>
			</SafeAreaProvider>
		</ThemeProvider>
	)
}

const s = StyleSheet.create({
	screen: { flex: 1 },
	content: {
		width: '100%',
		maxWidth: 440,
		alignSelf: 'center',
		flexGrow: 1,
		gap: 20,
	},
	brand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
	brandMark: {
		width: 40,
		height: 40,
		alignItems: 'center',
		justifyContent: 'center',
	},
	brandLetter: {
		fontFamily: 'serif',
		fontSize: 36,
		lineHeight: 40,
		fontStyle: 'italic',
		fontWeight: '900',
		marginRight: 3,
		marginTop: -3,
	},
	consentRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
	checkboxTarget: {
		minHeight: 56,
		minWidth: 48,
		alignItems: 'center',
		justifyContent: 'center',
	},
	checkbox: {
		width: 21,
		height: 21,
		borderWidth: 1,
		borderRadius: 5,
		alignItems: 'center',
		justifyContent: 'center',
	},
	consentCopy: { flex: 1, minWidth: 0 },
	noticeLink: { minHeight: 48, justifyContent: 'center' },
	primary: {
		minHeight: 52,
		paddingVertical: 14,
		paddingHorizontal: 20,
		flexDirection: 'row',
		justifyContent: 'center',
		alignItems: 'center',
		gap: 12,
	},
	qrStatus: {
		minHeight: 48,
		alignItems: 'center',
		justifyContent: 'center',
		opacity: 1,
	},
	qrSurface: {
		padding: 12,
		backgroundColor: '#FFFFFF',
		alignSelf: 'center',
		borderRadius: 8,
	},
	checking: { alignItems: 'center', gap: 14, paddingVertical: 30 },
	footer: { marginTop: 'auto', paddingTop: 6, gap: 8 },
	footerRow: { flexDirection: 'row', gap: 12 },
	footerAction: {
		flex: 1,
		minWidth: 0,
		minHeight: 48,
		justifyContent: 'center',
	},
	modalShade: {
		flex: 1,
		justifyContent: 'flex-end',
		backgroundColor: '#14182077',
	},
	noticeSheet: {
		maxHeight: '88%',
		width: '100%',
		maxWidth: 520,
		alignSelf: 'center',
		borderTopLeftRadius: 24,
		borderTopRightRadius: 24,
		padding: 24,
		paddingBottom: 32,
		gap: 20,
	},
})
