import { ThirdPartyError } from '@/lib/errors'

export type DouyinApiErrorType =
	| 'RequestFailed'
	| 'ResponseFailed'
	| 'NoCookie'
	| 'AuthRequired'
	| 'AudioStreamError'
	| 'ParseError'
	| 'RequestAborted'
	| 'InvalidArgument'

interface DouyinApiErrorDetails {
	message: string
	msgCode?: number
	rawData?: unknown
	type?: DouyinApiErrorType
	cause?: unknown
}

interface DouyinErrorData {
	msgCode: number
	rawData: unknown
}

export class DouyinApiError extends ThirdPartyError {
	readonly data: DouyinErrorData
	readonly type?: DouyinApiErrorType
	constructor({
		message,
		msgCode,
		rawData,
		type,
		cause,
	}: DouyinApiErrorDetails) {
		super(message, {
			vendor: 'Douyin',
			type,
			data: {
				rawData,
				msgCode,
			},
			cause,
		})
		this.data = {
			rawData,
			msgCode: msgCode ?? 0,
		}
		this.type = type
	}
}
