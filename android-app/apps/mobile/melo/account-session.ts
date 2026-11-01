/** Account credentials are private to this boundary; public snapshots never contain them. */
export class AccountSessionError extends Error {
	readonly name = 'AccountSessionError'
	constructor(
		readonly code:
			| 'signed-out'
			| 'stale-session'
			| 'expired'
			| 'network'
			| 'storage'
			| 'invalid-response',
	) {
		super(
			{
				'signed-out': '请先在「我的音绘」登录 B 站账号后再播放 B 站音源',
				'stale-session': '账号已变更，请重试',
				expired: 'B 站登录已失效，请重新扫码',
				network: '账号连接失败，请稍后重试',
				storage: '无法安全保存或清除登录状态，请重试',
				'invalid-response': '登录响应无法验证，请重试',
			}[code],
		)
	}
}
export interface AccountIdentity {
	mid: string
	name: string
	avatar?: string
}
export interface AccountSnapshot {
	status:
		| 'checking'
		| 'guest'
		| 'signed-out'
		| 'authenticated'
		| 'offline'
		| 'error'
	generation: number
	account: AccountIdentity | null
	error: string | null
	reason: AccountSessionError['code'] | null
}
export interface AccountDependencies {
	read(): Promise<string | null>
	write(cookie: string): Promise<void>
	remove(): Promise<void>
	verify(cookie: string, signal: AbortSignal): Promise<AccountIdentity>
	setNativeCookie(cookie: string): void
	setOfflineAccess(enabled: boolean): void
	setGuestAccess?(enabled: boolean): void
	pause(): Promise<unknown>
	fetch(input: string, init: RequestInit): Promise<Response>
}
export class AccountSession {
	private cookie = ''
	private state: AccountSnapshot = {
		status: 'checking',
		generation: 0,
		account: null,
		error: null,
		reason: null,
	}
	private listeners = new Set<() => void>()
	private pending = new Set<AbortController>()
	private writes: Promise<void> = Promise.resolve()
	constructor(private readonly deps: AccountDependencies) {}
	getSnapshot = (): AccountSnapshot => this.state
	getGeneration = (): number => this.state.generation
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
	private emit(
		status: AccountSnapshot['status'],
		account: AccountIdentity | null = null,
		error: string | null = null,
		reason: AccountSessionError['code'] | null = null,
	) {
		this.state = { ...this.state, status, account, error, reason }
		this.listeners.forEach((listener) => listener())
	}
	private invalidate() {
		this.state = { ...this.state, generation: this.state.generation + 1 }
		this.cookie = ''
		this.pending.forEach((controller) => controller.abort())
		this.pending.clear()
		this.deps.setNativeCookie('')
		this.deps.setOfflineAccess(false)
		this.deps.setGuestAccess?.(false)
		void this.deps.pause().catch(() => {})
	}
	private async serialized(action: () => Promise<void>) {
		const next = this.writes.then(action, action)
		this.writes = next.catch(() => {})
		return next
	}
	private ensure(generation: number) {
		if (generation !== this.state.generation)
			throw new AccountSessionError('stale-session')
	}
	enterGuest(): void {
		this.invalidate()
		this.deps.setGuestAccess?.(true)
		this.emit('guest', null, null, null)
	}
	async restore(): Promise<void> {
		this.invalidate()
		const generation = this.state.generation
		this.emit('checking')
		let storedCookie: string | null = null
		try {
			await this.deps.pause()
			const cookie = await this.serialRead()
			storedCookie = cookie
			this.ensure(generation)
			if (!cookie) {
				this.deps.setGuestAccess?.(true)
				this.emit('guest', null, null, null)
				return
			}
			await this.activate(cookie, generation, false)
		} catch (error) {
			if (generation !== this.state.generation) return
			if (
				error instanceof AccountSessionError &&
				error.code === 'network' &&
				storedCookie
			) {
				this.deps.setOfflineAccess(true)
				this.emit(
					'offline',
					null,
					'当前仅可播放本地及已下载歌曲；B 站在线功能需重新核验账号',
					'network',
				)
				return
			}
			if (error instanceof AccountSessionError && error.code === 'expired') {
				await this.signOut('expired')
				return
			}
			// Do not block entering MeloCanvas if Bilibili verification fails
			this.deps.setGuestAccess?.(true)
			this.emit(
				'guest',
				null,
				'B 站登录状态暂未验证，已进入免登录模式',
				error instanceof AccountSessionError ? error.code : 'storage',
			)
		}
	}
	private async serialRead() {
		await this.writes
		return this.deps.read()
	}
	async login(cookie: string, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new AccountSessionError('stale-session')
		this.invalidate()
		const generation = this.state.generation
		this.emit('checking')
		const abort = () => {
			if (generation === this.state.generation)
				void this.signOut().catch(() => {})
		}
		signal?.addEventListener('abort', abort, { once: true })
		try {
			await this.deps.pause()
			await this.serialized(async () => {
				this.ensure(generation)
				await this.deps.remove()
			})
			this.ensure(generation)
			await this.activate(cookie, generation, true)
		} catch (error) {
			if (generation !== this.state.generation)
				throw new AccountSessionError('stale-session')
			this.deps.setGuestAccess?.(true)
			this.emit(
				'error',
				null,
				error instanceof AccountSessionError
					? error.message
					: '登录无法完成，请重试',
				error instanceof AccountSessionError ? error.code : 'storage',
			)
			throw error instanceof AccountSessionError
				? error
				: new AccountSessionError('storage')
		} finally {
			signal?.removeEventListener('abort', abort)
		}
	}
	private async activate(cookie: string, generation: number, persist: boolean) {
		if (!cookie || cookie.length > 16000 || /[\r\n]/.test(cookie))
			throw new AccountSessionError('invalid-response')
		const controller = new AbortController()
		this.pending.add(controller)
		let account: AccountIdentity
		try {
			account = await this.deps.verify(cookie, controller.signal)
		} finally {
			this.pending.delete(controller)
		}
		this.ensure(generation)
		await this.serialized(async () => {
			this.ensure(generation)
			if (persist) await this.deps.write(cookie)
			this.ensure(generation)
			this.deps.setNativeCookie(cookie)
			this.cookie = cookie
			this.emit('authenticated', account)
		})
	}
	async signOut(reason?: 'expired'): Promise<void> {
		this.invalidate()
		const generation = this.state.generation
		this.deps.setGuestAccess?.(true)
		this.emit(
			'guest',
			null,
			reason ? 'B 站登录已失效，如需播放 B 站音源请重新扫码' : null,
			reason ?? null,
		)
		try {
			await Promise.all([
				this.deps.pause(),
				this.serialized(() => this.deps.remove()),
			])
		} catch {
			if (generation === this.state.generation)
				this.emit('error', null, '无法清除保存的登录状态，请重试退出')
			throw new AccountSessionError('storage')
		}
	}
	/** Only this method attaches the private account cookie, to one fixed API origin. */
	async authorizedFetch(
		input: string,
		init: RequestInit = {},
	): Promise<Response> {
		const url = new URL(input)
		if ((init.method && init.method !== 'GET') || init.body)
			throw new AccountSessionError('invalid-response')
		if (
			url.origin !== 'https://api.bilibili.com' ||
			url.username ||
			url.password
		)
			throw new AccountSessionError('invalid-response')
		if (this.state.status !== 'authenticated' || !this.cookie)
			throw new AccountSessionError('signed-out')
		const generation = this.state.generation
		const controller = new AbortController()
		const abort = () => controller.abort()
		if (init.signal?.aborted) controller.abort()
		init.signal?.addEventListener('abort', abort, { once: true })
		this.pending.add(controller)
		try {
			const headers = new Headers(init.headers)
			headers.set('Cookie', this.cookie)
			const response = await this.deps.fetch(input, {
				...init,
				headers,
				credentials: 'omit',
				redirect: 'error',
				signal: controller.signal,
			})
			this.ensure(generation)
			if (response.status === 401) {
				await this.signOut('expired')
				throw new AccountSessionError('expired')
			}
			return response
		} catch (error) {
			this.ensure(generation)
			throw error instanceof AccountSessionError
				? error
				: new AccountSessionError('network')
		} finally {
			this.pending.delete(controller)
			init.signal?.removeEventListener('abort', abort)
		}
	}
}
