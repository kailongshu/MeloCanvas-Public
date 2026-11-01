import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { fetch } from 'react-native-nitro-fetch'

import useAppStore, { serializeCookieObject } from '@/hooks/stores/useAppStore'
import { DouyinApiError } from '@/lib/errors/thirdparty/douyin'

export interface DouyinReqResponse<T> {
	status_code: number
	data?: T
	[key: string]: unknown
}

const toRequestError = (error: unknown) => {
	if (error instanceof Error && error.name === 'AbortError') {
		return new DouyinApiError({
			message: '请求被取消',
			type: 'RequestAborted',
			cause: error,
		})
	}

	return new DouyinApiError({
		message: `请求失败: ${error instanceof Error ? error.message : String(error)}`,
		type: 'RequestFailed',
		cause: error,
	})
}

class DouyinApiClient {
	private baseUrl = 'https://www.douyin.com'

	/**
	 * 核心请求方法，使用 neverthrow 进行封装
	 */
	public request = <T>({
		endpoint,
		options = {},
		fullUrl,
		skipCookie,
	}: {
		endpoint: string
		options?: RequestInit
		fullUrl?: string
		skipCookie?: boolean
	}): ResultAsync<T, DouyinApiError> => {
		const url = fullUrl ?? `${this.baseUrl}${endpoint}`
		const cookieList = useAppStore.getState().douyinCookie
		const cookie =
			cookieList && !skipCookie ? serializeCookieObject(cookieList) : ''

		const defaultHeaders = {
			Cookie: cookie,
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			Referer: 'https://www.douyin.com/',
			Accept: 'application/json, text/plain, */*',
		}

		const mergedHeaders = {
			...defaultHeaders,
			...(options.headers as Record<string, string>),
		}

		return ResultAsync.fromPromise(
			fetch(url, {
				...options,
				headers: mergedHeaders,
			}),
			toRequestError,
		).andThen((response) => {
			if (!response.ok) {
				return errAsync(
					new DouyinApiError({
						message: `HTTP 错误: ${response.status}`,
						type: 'ResponseFailed',
						msgCode: response.status,
					}),
				)
			}

			return ResultAsync.fromPromise(
				response.json() as Promise<T>,
				(error) =>
					new DouyinApiError({
						message: `JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`,
						type: 'ParseError',
						cause: error,
					}),
			)
		})
	}

	/**
	 * 解析短链接并追踪 302 重定向拿到真实落地页 URL
	 */
	public resolveRedirect = (
		shortUrl: string,
	): ResultAsync<string, DouyinApiError> => {
		return ResultAsync.fromPromise(
			fetch(shortUrl, {
				method: 'GET',
				redirect: 'follow',
				headers: {
					'User-Agent':
						'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
				},
			}).then((res) => res.url),
			(error) =>
				new DouyinApiError({
					message: `解析短链接失败: ${error instanceof Error ? error.message : String(error)}`,
					type: 'RequestFailed',
					cause: error,
				}),
		)
	}
}

export const douyinClient = new DouyinApiClient()
