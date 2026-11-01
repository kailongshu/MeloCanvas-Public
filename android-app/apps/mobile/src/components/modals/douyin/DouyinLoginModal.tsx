import { useCallback, useRef, useState } from 'react'
import { Dimensions, StyleSheet, View } from 'react-native'
import { Dialog, Divider, IconButton, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper'
import { WebView } from 'react-native-webview'

import Button from '@/components/common/Button'
import useAppStore, { serializeCookieObject } from '@/hooks/stores/useAppStore'
import { useModalStore } from '@/hooks/stores/useModalStore'
import { douyinApi } from '@/lib/api/douyin/api'
import toast from '@/utils/toast'

const { height: SCREEN_HEIGHT } = Dimensions.get('window')

// 注入脚本：监听 document.cookie 中的 sessionid / passport 登录凭证
const INJECTED_JAVASCRIPT = `
(function() {
	function checkCookie() {
		var cookie = document.cookie || '';
		if (cookie.indexOf('sessionid') !== -1 || cookie.indexOf('passport_csrf_token') !== -1) {
			window.ReactNativeWebView.postMessage(JSON.stringify({
				type: 'DOUYIN_COOKIE_FOUND',
				cookie: cookie
			}));
		}
	}
	setInterval(checkCookie, 1500);
	checkCookie();
})();
true;
`

export default function DouyinLoginModal() {
	const theme = useTheme()
	const modalClose = useModalStore((state) => state.close)
	const close = useCallback(() => modalClose('DouyinLogin' as any), [modalClose])

	const currentDouyinCookie = useAppStore((state) => state.douyinCookie)
	const setDouyinCookie = useAppStore((state) => state.setDouyinCookie)
	const clearDouyinCookie = useAppStore((state) => state.clearDouyinCookie)
	const setDouyinUserInfo = useAppStore((state) => state.setDouyinUserInfo)

	const [mode, setMode] = useState<'webview' | 'manual'>('webview')
	const [manualCookie, setManualCookie] = useState(
		currentDouyinCookie ? serializeCookieObject(currentDouyinCookie) : '',
	)
	const [isLoading, setIsLoading] = useState(false)
	const webViewRef = useRef<WebView>(null)

	const handleSaveCookie = (cookieString: string) => {
		const res = setDouyinCookie(cookieString)
		if (res.isErr()) {
			toast.error(`Cookie 解析失败: ${res.error.message}`)
			return false
		}

		toast.success('抖音登录凭证已保存')
		close()
		return true
	}

	const handleMessage = (event: { nativeEvent: { data: string } }) => {
		try {
			const data = JSON.parse(event.nativeEvent.data)
			if (data.type === 'DOUYIN_COOKIE_FOUND' && data.cookie) {
				handleSaveCookie(data.cookie)
			}
		} catch {
			// 忽略非 JSON 消息
		}
	}

	const handleManualSubmit = () => {
		const trimmed = manualCookie.trim()
		if (!trimmed) {
			clearDouyinCookie()
			toast.info('抖音 Cookie 已清空')
			close()
			return
		}
		handleSaveCookie(trimmed)
	}

	return (
		<Dialog
			visible
			onDismiss={close}
			style={[
				styles.dialog,
				mode === 'webview' && styles.dialogWebView,
				{ backgroundColor: theme.colors.elevation.level3 },
			]}
		>
			<View style={styles.header}>
				<Dialog.Title style={styles.title}>抖音网页登录 / 授权</Dialog.Title>
				<IconButton icon='close' size={20} onPress={close} />
			</View>

			<View style={styles.segmentedContainer}>
				<SegmentedButtons
					value={mode}
					onValueChange={(val) => setMode(val as 'webview' | 'manual')}
					buttons={[
						{ value: 'webview', label: '扫码 / 短信登录' },
						{ value: 'manual', label: '手动填 Cookie' },
					]}
				/>
			</View>

			<Dialog.Content style={styles.content}>
				{mode === 'webview' ? (
					<View style={styles.webViewContainer}>
						<Text variant='bodySmall' style={styles.hint}>
							请在下方页面直接进行抖音扫码或短信验证码登录，登录完成后会自动捕获凭证。
						</Text>
						<WebView
							ref={webViewRef}
							source={{ uri: 'https://www.douyin.com/' }}
							userAgent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
							injectedJavaScript={INJECTED_JAVASCRIPT}
							onMessage={handleMessage}
							style={styles.webView}
							javaScriptEnabled
							domStorageEnabled
							sharedCookiesEnabled
							thirdPartyCookiesEnabled
						/>
					</View>
				) : (
					<View style={styles.manualContainer}>
						<Text variant='bodySmall' style={styles.hint}>
							从浏览器控制台复制抖音网页版（douyin.com）的 Cookie 粘贴到下方：
						</Text>
						<TextInput
							mode='outlined'
							multiline
							numberOfLines={6}
							placeholder='sessionid=...; passport_csrf_token=...'
							value={manualCookie}
							onChangeText={setManualCookie}
							style={styles.textInput}
						/>
					</View>
				)}
			</Dialog.Content>

			{mode === 'manual' && (
				<Dialog.Actions>
					<Button onPress={close}>取消</Button>
					<Button onPress={handleManualSubmit}>保存</Button>
				</Dialog.Actions>
			)}
		</Dialog>
	)
}

const styles = StyleSheet.create({
	dialog: {
		borderRadius: 16,
		maxHeight: '90%',
	},
	dialogWebView: {
		height: SCREEN_HEIGHT * 0.75,
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingRight: 8,
	},
	title: {
		fontSize: 18,
		fontWeight: '600',
	},
	segmentedContainer: {
		paddingHorizontal: 20,
		marginBottom: 8,
	},
	content: {
		flex: 1,
		paddingHorizontal: 16,
	},
	webViewContainer: {
		flex: 1,
	},
	hint: {
		marginBottom: 8,
		opacity: 0.7,
	},
	webView: {
		flex: 1,
		borderRadius: 8,
	},
	manualContainer: {
		paddingVertical: 8,
	},
	textInput: {
		marginTop: 8,
		fontSize: 12,
	},
})
