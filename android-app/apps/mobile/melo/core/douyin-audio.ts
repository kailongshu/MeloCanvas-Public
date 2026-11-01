import type { Database } from './database'

export const douyinAwemePattern = /^[1-9][0-9]{5,24}$/

export const isDouyinAudioId = (id: string): boolean =>
	typeof id === 'string' &&
	id.startsWith('douyin:') &&
	douyinAwemePattern.test(id.slice(7))

export function douyinAudioId(awemeId: string): string {
	const trimmed = awemeId.trim()
	if (!douyinAwemePattern.test(trimmed)) throw new Error('抖音音频身份无效')
	return `douyin:${trimmed}`
}

export function douyinAwemeIdFromSource(id: string): string {
	if (!isDouyinAudioId(id)) throw new Error('抖音音频身份无效')
	return id.slice(7)
}

export function douyinAudioUri(id: string): string {
	if (!isDouyinAudioId(id)) throw new Error('抖音音频身份无效')
	return `orpheus://douyin?awemeId=${id.slice(7)}`
}

const backupSecretParam =
	/^(?:cookie|cookies|set-cookie|authorization|password|passwd|sessdata|bili_jct|csrf|csrf_token|api_key|apikey|auth_key|session|session_id|token|accessToken|refreshToken|access_token|refresh_token|secret|clientSecret|client_secret|privateKey|private_key|credentials|sessionToken|session_token|accountGrant|account_grant)$/i

export function sanitizeDouyinArtwork(raw: string): string {
	const trimmed = (raw ?? '').trim()
	if (!trimmed) return ''
	const https = trimmed.startsWith('http://')
		? `https://${trimmed.slice(7)}`
		: trimmed.startsWith('//')
			? `https:${trimmed}`
			: trimmed
	if (!/^https:\/\//i.test(https)) return ''
	try {
		const parsed = new URL(https)
		if (parsed.username || parsed.password) return ''
		for (const key of [...parsed.searchParams.keys()]) {
			if (backupSecretParam.test(key)) parsed.searchParams.delete(key)
		}
		return parsed.toString()
	} catch {
		return ''
	}
}

export interface DouyinAudio {
	id: string
	awemeId: string
	title: string
	artist: string
	artwork: string
	durationSeconds: number
	audioUrl: string
	addedAt: number
}

export class DouyinAudioStore {
	constructor(private db: Database) {}

	list(): DouyinAudio[] {
		return this.db.getAllSync<DouyinAudio>(
			'SELECT * FROM douyin_audio ORDER BY addedAt DESC, id',
			[],
		)
	}

	get(id: string): DouyinAudio | null {
		if (!isDouyinAudioId(id)) return null
		return this.db.getFirstSync<DouyinAudio>(
			'SELECT * FROM douyin_audio WHERE id = ?',
			[id],
		)
	}

	upsert(audio: DouyinAudio): void {
		const expectedId = douyinAudioId(audio.awemeId)
		if (
			audio.id !== expectedId ||
			!audio.title.trim() ||
			!Number.isFinite(audio.durationSeconds) ||
			audio.durationSeconds < 0
		) {
			throw new Error('抖音原声信息无效')
		}
		const addedAt =
			Number.isSafeInteger(audio.addedAt) && audio.addedAt >= 0
				? audio.addedAt
				: Date.now()
		const cleanArtwork = sanitizeDouyinArtwork(audio.artwork)
		const cleanTitle = audio.title.trim()
		const cleanArtist = (audio.artist ?? '').trim() || '抖音原声'
		const cleanAudioUrl = (audio.audioUrl ?? '').trim()

		this.db.execSync('SAVEPOINT douyin_audio_upsert')
		try {
			this.db.runSync(
				"INSERT OR IGNORE INTO playback_sources (id, kind) VALUES (?, 'douyin')",
				[audio.id],
			)
			this.db.runSync(
				`INSERT INTO douyin_audio (id, awemeId, title, artist, artwork, durationSeconds, audioUrl, addedAt)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				   title = excluded.title,
				   artist = excluded.artist,
				   artwork = CASE WHEN excluded.artwork != '' THEN excluded.artwork ELSE douyin_audio.artwork END,
				   durationSeconds = CASE WHEN excluded.durationSeconds > 0 THEN excluded.durationSeconds ELSE douyin_audio.durationSeconds END,
				   audioUrl = CASE WHEN excluded.audioUrl != '' THEN excluded.audioUrl ELSE douyin_audio.audioUrl END`,
				[
					audio.id,
					audio.awemeId.trim(),
					cleanTitle,
					cleanArtist,
					cleanArtwork,
					audio.durationSeconds,
					cleanAudioUrl,
					addedAt,
				],
			)
			this.db.execSync('RELEASE SAVEPOINT douyin_audio_upsert')
		} catch (error) {
			try {
				this.db.execSync('ROLLBACK TO SAVEPOINT douyin_audio_upsert')
				this.db.execSync('RELEASE SAVEPOINT douyin_audio_upsert')
			} catch {
				/* Preserve the write error. */
			}
			throw error
		}
	}

	upsertMany(items: DouyinAudio[]): void {
		if (!items.length) return
		this.db.execSync('SAVEPOINT douyin_audio_batch')
		try {
			for (const item of items) this.upsert(item)
			this.db.execSync('RELEASE SAVEPOINT douyin_audio_batch')
		} catch (error) {
			try {
				this.db.execSync('ROLLBACK TO SAVEPOINT douyin_audio_batch')
				this.db.execSync('RELEASE SAVEPOINT douyin_audio_batch')
			} catch {
				/* Preserve the write error. */
			}
			throw error
		}
	}
}
