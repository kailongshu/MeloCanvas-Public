import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AppState, BackHandler, useWindowDimensions } from 'react-native'

import {
	accountDiagnosticCode,
	generateLoginQr,
	pollLoginQr,
} from './account-api'
import { accountRuntimeCapabilities } from './account-native-fetch'
import { accountSession, watchNativeSessionExpiry } from './account-runtime'
import { accountTheme } from './account-theme'
import { AccountWelcome } from './account-welcome'
import App from './App'
import { AppearanceSurface } from './appearance-ui'
import { StartupSurface } from './startup-ui'
import { useAppearance } from './useAppearance'

function waitForForeground(signal: AbortSignal): Promise<void> {
	if (signal.aborted || AppState.currentState === 'active')
		return Promise.resolve()
	return new Promise((resolve) => {
		const subscription = AppState.addEventListener('change', (next) => {
			if (next === 'active') done()
		})
		function done() {
			subscription.remove()
			signal.removeEventListener('abort', done)
			resolve()
		}
		signal.addEventListener('abort', done, { once: true })
		if (signal.aborted || AppState.currentState === 'active') done()
	})
}

/** Supports direct guest startup without mandatory Bilibili login, plus optional Bilibili QR login. */
export default function AccountRoot() {
	const appearance = useAppearance()
	const themeKey = useSyncExternalStore(
		accountTheme.subscribe,
		accountTheme.getSnapshot,
	)
	const themeReady = useSyncExternalStore(
		accountTheme.subscribe,
		accountTheme.getReadySnapshot,
	)
	useEffect(() => {
		void accountTheme.restore()
	}, [])
	const state = useSyncExternalStore(
		accountSession.subscribe,
		accountSession.getSnapshot,
	)
	const [bilibiliLoginOpen, setBilibiliLoginOpen] = useState(false)
	const [consent, setConsent] = useState(false)
	const [qr, setQr] = useState('')
	const [message, setMessage] = useState('')
	const [busy, setBusy] = useState(false)
	const [diagnostic, setDiagnostic] = useState('idle')
	const [noticeExpanded, setNoticeExpanded] = useState(false)
	const [diagnosticExpanded, setDiagnosticExpanded] = useState(false)
	const [contentWidth, setContentWidth] = useState<number | null>(null)
	const { width } = useWindowDimensions()
	const active = useRef<AbortController | null>(null)
	const requestVersion = useRef(0)
	const pollInterrupted = useRef(false)
	const cancel = () => {
		requestVersion.current++
		active.current?.abort()
		active.current = null
		setQr('')
		setBusy(false)
		setMessage('')
	}
	const skipToApp = () => {
		cancel()
		setBilibiliLoginOpen(false)
		if (
			state.status !== 'authenticated' &&
			state.status !== 'offline' &&
			state.status !== 'guest'
		) {
			accountSession.enterGuest()
		}
	}
	useEffect(() => {
		const requests = active
		const version = requestVersion
		const unwatch = watchNativeSessionExpiry()
		void accountSession.restore()
		return () => {
			version.current++
			requests.current?.abort()
			unwatch()
		}
	}, [])
	useEffect(() => {
		const subscription = AppState.addEventListener('change', (next) => {
			// Leaving to scan a screenshot in Bilibili is part of login.
			if (next !== 'active') pollInterrupted.current = true
		})
		return () => subscription.remove()
	}, [])
	useEffect(() => {
		if (!bilibiliLoginOpen) return
		const sub = BackHandler.addEventListener('hardwareBackPress', () => {
			skipToApp()
			return true
		})
		return () => sub.remove()
	}, [bilibiliLoginOpen, state.status])
	async function login() {
		cancel()
		const version = requestVersion.current
		const controller = new AbortController()
		active.current = controller
		setBusy(true)
		setMessage('正在生成二维码')
		setDiagnostic('generate-transport')
		let stage = 'generate'
		const expiresAt = Date.now() + 180000
		const expire = () => {
			if (version !== requestVersion.current) return
			cancel()
			setMessage('二维码已过期，请重新生成')
		}
		const current = () => {
			if (version !== requestVersion.current) return false
			if (controller.signal.aborted || Date.now() >= expiresAt) {
				expire()
				return false
			}
			return true
		}
		const timeout = setTimeout(expire, 180000)
		try {
			const code = await generateLoginQr(controller.signal)
			await waitForForeground(controller.signal)
			if (!current()) return
			setQr(code.url)
			setDiagnostic('qr-set')
			stage = 'poll'
			while (current()) {
				await waitForForeground(controller.signal)
				if (!current()) return
				pollInterrupted.current = false
				let result: Awaited<ReturnType<typeof pollLoginQr>>
				try {
					result = await pollLoginQr(code.key, controller.signal)
				} catch (error) {
					if (!current()) return
					if (pollInterrupted.current) continue
					throw error
				}
				await waitForForeground(controller.signal)
				if (!current()) return
				if (result.status === 'success') {
					setQr('')
					stage = 'verify'
					await accountSession.login(result.cookie, controller.signal)
					if (!current()) return
					setMessage('')
					setBilibiliLoginOpen(false)
					return
				}
				if (result.status === 'expired') {
					setMessage('二维码已过期，请重新生成')
					setQr('')
					return
				}
				setMessage(
					result.status === 'scanned'
						? '已扫码，请在 B 站确认登录'
						: '请使用 B 站 App 扫码',
				)
				if (pollInterrupted.current) continue
				await new Promise<void>((resolve) => {
					const timer = setTimeout(done, 2000)
					function done() {
						clearTimeout(timer)
						controller.signal.removeEventListener('abort', done)
						resolve()
					}
					controller.signal.addEventListener('abort', done, { once: true })
				})
			}
		} catch (error) {
			if (current()) {
				setQr('')
				setDiagnostic(
					stage === 'poll'
						? 'poll-failed'
						: stage === 'verify'
							? 'verify-failed'
							: accountDiagnosticCode(error),
				)
				setMessage('登录暂未完成，请按下方诊断阶段定位后重试。')
			}
		} finally {
			clearTimeout(timeout)
			if (version === requestVersion.current) {
				setBusy(false)
				active.current = null
			}
		}
	}
	if (!appearance.ready || !themeReady || state.status === 'checking')
		return (
			<StartupSurface
				mode={appearance.ready ? appearance.mode : 'dark'}
				label={state.status === 'checking' ? '正在准备音绘' : '正在启动'}
			/>
		)
	if (
		!bilibiliLoginOpen &&
		(state.status === 'authenticated' ||
			state.status === 'offline' ||
			state.status === 'guest')
	)
		return (
			<AppearanceSurface mode={appearance.mode}>
				<App
					accountId={state.account?.mid}
					accountAvatar={state.account?.avatar}
					accountName={
						state.status === 'offline'
							? '已绑定账号（离线）'
							: state.status === 'guest'
								? '未登录 B 站（免登录模式）'
								: state.account?.name
					}
					onRequestBilibiliLogin={
						state.status === 'guest'
							? () => {
									setBilibiliLoginOpen(true)
								}
							: undefined
					}
					onReconnect={
						state.status === 'offline'
							? () => {
									void accountSession.restore()
								}
							: undefined
					}
					onSignOut={
						state.status === 'authenticated' || state.status === 'offline'
							? () => {
									cancel()
									setConsent(false)
									setBilibiliLoginOpen(false)
									void accountSession.signOut().catch(() => {})
								}
							: undefined
					}
				/>
			</AppearanceSurface>
		)
	return (
		<AppearanceSurface mode={appearance.mode}>
			<AccountWelcome
				colorMode={appearance.mode}
				themeKey={themeKey}
				width={width}
				contentWidth={contentWidth}
				onContentWidth={setContentWidth}
				checking={false}
				error={state.error}
				recovery={state.status === 'error'}
				consent={consent}
				busy={busy}
				qr={qr}
				message={message}
				noticeExpanded={noticeExpanded}
				diagnosticExpanded={diagnosticExpanded}
				diagnostic={diagnostic}
				capabilities={diagnosticExpanded ? accountRuntimeCapabilities() : ''}
				onToggleNotice={() => setNoticeExpanded((expanded) => !expanded)}
				onToggleDiagnostic={() =>
					setDiagnosticExpanded((expanded) => !expanded)
				}
				onToggleConsent={() => {
					if (consent) cancel()
					setConsent(!consent)
				}}
				onGenerate={() => {
					void login()
				}}
				onCancel={cancel}
				onRetry={() => {
					void accountSession.restore()
				}}
				onClear={() => {
					cancel()
					void accountSession.signOut().catch(() => {})
				}}
				onSkip={skipToApp}
				onExit={() => {
					if (bilibiliLoginOpen) {
						skipToApp()
						return
					}
					cancel()
					BackHandler.exitApp()
				}}
				onQrError={() => {
					const version = requestVersion.current
					void Promise.resolve().then(() => {
						if (version !== requestVersion.current) return
						cancel()
						setDiagnostic('qr-render-failed')
						setMessage('二维码显示失败，请提供下方诊断阶段。')
					})
				}}
			/>
		</AppearanceSurface>
	)
}
