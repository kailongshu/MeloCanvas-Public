import type { Library } from './core/database'
import { isDouyinAudioId } from './core/douyin-audio'
import { isLocalAudioId } from './core/local-audio'
import { loadedLyricVersionText } from './online-lyrics-ranking'

export const lyricsStoragePrefix = 'melo.lyrics.v1:'
export const maxLyricsBytes = 256 * 1024

/** Per-device display choice, independent of individual lyric files and source IDs. */
export const lyricsDisplaySettingsKey = 'melo.lyrics.display.v1'
export interface LyricsDisplayOptions {
	translation: boolean
	romaji: boolean
}
export const defaultLyricsDisplayOptions: Readonly<LyricsDisplayOptions> = {
	translation: true,
	romaji: true,
}
export function readLyricsDisplayOptions(
	storage: Pick<Library, 'setting'>,
): LyricsDisplayOptions {
	const raw = storage.setting(lyricsDisplaySettingsKey)
	if (raw) {
		try {
			const value: unknown = JSON.parse(raw)
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				const options = value as Record<string, unknown>
				if (
					options.version === 1 &&
					typeof options.translation === 'boolean' &&
					typeof options.romaji === 'boolean'
				)
					return {
						translation: options.translation,
						romaji: options.romaji,
					}
			}
		} catch {
			// An invalid local preference must not hide available lyrics.
		}
	}
	return { ...defaultLyricsDisplayOptions }
}
export function writeLyricsDisplayOptions(
	storage: Pick<Library, 'setSetting'>,
	options: LyricsDisplayOptions,
): void {
	storage.setSetting(
		lyricsDisplaySettingsKey,
		JSON.stringify({
			version: 1,
			translation: options.translation,
			romaji: options.romaji,
		}),
	)
}
export interface LyricLine {
	text: string
	atMs: number | null
	endMs?: number
	translation?: string
	romaji?: string
}
export interface ParsedLyrics {
	lines: LyricLine[]
	timed: boolean
	title: string
	artist: string
	fileOffsetMs: number
}
export interface OnlineLyricsMetadata {
	provider: 'netease' | 'qqmusic' | 'kugou'
	remoteId: string | number
	title: string
	artist: string
	lines: LyricLine[]
}
export interface SavedLyrics {
	version: 1
	sourceId: string
	filename: string
	importedAt: number
	raw: string
	offsetMs: number
	online?: OnlineLyricsMetadata
}
export function lyricsIdentity(id: string | undefined): string | null {
	return id &&
		(isLocalAudioId(id) || isDouyinAudioId(id) || /^bilibili:BV[0-9A-Za-z]{10}:[1-9]\d*$/.test(id))
		? id
		: null
}
/** LRC timestamps are milliseconds; plain text never acquires invented timing. */
export function parseLyrics(raw: string): ParsedLyrics {
	if (!raw.trim() || raw.length > maxLyricsBytes || raw.includes('\u0000'))
		throw new Error('请选择非空 UTF-8 LRC 或 TXT 歌词（不超过 256 KiB）')
	let title = '',
		artist = '',
		fileOffsetMs = 0
	const lines: LyricLine[] = []
	for (const original of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
		const line = original.trim()
		const metadata = /^\[(ti|ar|al|by|re|ve|length|offset):([^\]]*)\]$/i.exec(
			line,
		)
		if (metadata) {
			const key = metadata[1].toLowerCase()
			if (key === 'ti') title = metadata[2]
			if (key === 'ar') artist = metadata[2]
			if (key === 'offset' && /^[-+]?\d+$/.test(metadata[2]))
				fileOffsetMs = Math.max(-600000, Math.min(600000, Number(metadata[2])))
			continue
		}
		const timestamps: number[] = []
		let rest = line
		while (true) {
			const match = /^\[(\d{1,4}):([0-5]\d)(?:[.:](\d{1,3}))?\]/.exec(rest)
			if (!match) break
			timestamps.push(
				Number(match[1]) * 60000 +
					Number(match[2]) * 1000 +
					Number((match[3] ?? '').padEnd(3, '0')),
			)
			rest = rest.slice(match[0].length)
		}
		// Preserve unsupported/untimed lines instead of silently deleting a verse.
		if (timestamps.length)
			for (const atMs of timestamps) lines.push({ text: rest, atMs })
		else if (line) lines.push({ text: line, atMs: null })
	}
	if (lines.length > 4000)
		throw new Error('歌词行数过多，请选择不超过 4000 行的文件')
	if (!lines.length || !lines.some((line) => line.text))
		throw new Error('文件中没有可显示的歌词正文')
	const timed = lines.every((line) => line.atMs !== null)
	if (timed) lines.sort((a, b) => a.atMs! - b.atMs!)
	return { lines, timed, title, artist, fileOffsetMs }
}
/** Positive adjustment delays lyrics; LRC offset is conventional early-display correction. */
export function lyricTimeMs(
	line: LyricLine,
	lyrics: ParsedLyrics,
	offsetMs: number,
): number | null {
	return line.atMs === null
		? null
		: Math.max(0, line.atMs - lyrics.fileOffsetMs + offsetMs)
}
export function activeLyric(
	lyrics: ParsedLyrics,
	positionMs: number,
	offsetMs: number,
): number {
	if (!lyrics.timed) return -1
	// Parsed LRC and validated online lyrics are ordered by start time. Upper
	// bound keeps the last duplicate timestamp, including offset-clamped lines.
	let low = 0, high = lyrics.lines.length
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2)
		if (lyricTimeMs(lyrics.lines[middle], lyrics, offsetMs)! > positionMs) high = middle
		else low = middle + 1
	}
	const active = low - 1
	const line = lyrics.lines[active]
	if (
		line?.endMs !== undefined &&
		positionMs >= Math.max(0, line.endMs - lyrics.fileOffsetMs + offsetMs)
	)
		return -1
	return active
}
/** Online lines preserve provider end times and translations, not synthesized LRC ends. */
export function savedLyricsParsed(saved: SavedLyrics): ParsedLyrics {
	if (!saved.online) return parseLyrics(saved.raw)
	return {
		lines: saved.online.lines,
		timed: true,
		title: saved.online.title,
		artist: saved.online.artist,
		fileOffsetMs: 0,
	}
}
function validateOnline(value: unknown): OnlineLyricsMetadata {
	if (!value || typeof value !== 'object') throw new Error('在线歌词记录损坏')
	const v = value as Partial<OnlineLyricsMetadata>
	if (
		!['netease', 'qqmusic', 'kugou'].includes(v.provider ?? '') ||
		!(
			(typeof v.remoteId === 'string' &&
				/^[a-zA-Z0-9_-]{1,128}$/.test(v.remoteId)) ||
			(typeof v.remoteId === 'number' &&
				Number.isSafeInteger(v.remoteId) &&
				v.remoteId > 0)
		) ||
		typeof v.title !== 'string' ||
		v.title.length > 512 ||
		typeof v.artist !== 'string' ||
		v.artist.length > 512 ||
		!Array.isArray(v.lines) ||
		!v.lines.length ||
		v.lines.length > 4000
	)
		throw new Error('在线歌词记录损坏')
	let previous = -1
	const lines = v.lines.map((line) => {
		if (
			!line ||
			typeof line !== 'object' ||
			typeof line.text !== 'string' ||
			line.text.length > 4096 ||
			typeof line.atMs !== 'number' ||
			!Number.isFinite(line.atMs) ||
			line.atMs < previous ||
			line.atMs < 0 ||
			typeof line.endMs !== 'number' ||
			!Number.isFinite(line.endMs) ||
			line.endMs < line.atMs ||
			[line.translation, line.romaji].some(
				(text) =>
					text !== undefined &&
					(typeof text !== 'string' || text.length > 4096),
			)
		)
			throw new Error('在线歌词记录损坏')
		previous = line.atMs
		return {
			text: line.text,
			atMs: line.atMs,
			endMs: line.endMs,
			...(line.translation ? { translation: line.translation } : {}),
			...(line.romaji ? { romaji: line.romaji } : {}),
		}
	})
	if (
		!lines.some((line) => line.text.trim()) ||
		JSON.stringify(lines).length > maxLyricsBytes
	)
		throw new Error('在线歌词记录过大或为空')
	return {
		provider: v.provider!,
		remoteId: v.remoteId,
		title: v.title,
		artist: v.artist,
		lines,
	}
}
export function validateSavedLyrics(
	value: unknown,
	sourceId: string,
): SavedLyrics {
	if (!value || typeof value !== 'object' || !lyricsIdentity(sourceId))
		throw new Error('歌词关联无效')
	const candidate = value as Partial<SavedLyrics>
	if (
		candidate.version !== 1 ||
		candidate.sourceId !== sourceId ||
		typeof candidate.filename !== 'string' ||
		!candidate.filename.trim() ||
		candidate.filename.length > 512 ||
		typeof candidate.raw !== 'string' ||
		typeof candidate.importedAt !== 'number' ||
		!Number.isSafeInteger(candidate.importedAt) ||
		candidate.importedAt < 0 ||
		typeof candidate.offsetMs !== 'number' ||
		!Number.isInteger(candidate.offsetMs) ||
		Math.abs(candidate.offsetMs) > 600000
	)
		throw new Error('本机歌词记录损坏，请重新导入')
	parseLyrics(candidate.raw)
	// Return a known shape; backup imports must not carry arbitrary extra fields.
	return {
		version: 1,
		sourceId,
		filename: candidate.filename,
		raw: candidate.raw,
		importedAt: candidate.importedAt,
		offsetMs: candidate.offsetMs,
		...(candidate.online === undefined
			? {}
			: { online: validateOnline(candidate.online) }),
	}
}
export class LyricsStore {
	constructor(private storage: Pick<Library, 'setting' | 'setSetting'>) {}
	get(sourceId: string): SavedLyrics | null {
		if (!lyricsIdentity(sourceId))
			throw new Error('当前音源没有稳定身份，暂不能关联歌词')
		const raw = this.storage.setting(lyricsStoragePrefix + sourceId)
		return !raw || raw === 'null'
			? null
			: validateSavedLyrics(JSON.parse(raw), sourceId)
	}
	save(value: SavedLyrics) {
		const valid = validateSavedLyrics(value, value.sourceId)
		this.storage.setSetting(
			lyricsStoragePrefix + valid.sourceId,
			JSON.stringify(valid),
		)
	}
}

/** Labels are evidence from titles, not inferred recording identity or match scores. */
export function lyricVersionHints(text: string): string[] {
	const hints: string[] = []
	if (/翻唱|cover/i.test(text)) hints.push('翻唱 / Cover')
	if (/现场|現場|演唱会|演唱會|\blive\b/i.test(text)) hints.push('现场 / Live')
	if (/录音室|studio/i.test(text)) hints.push('录音室 / Studio')
	if (/原唱|original/i.test(text)) hints.push('原唱标注')
	return hints
}
export function reviewLyricsVersion(
	current: { title: string; performer?: string | null },
	candidate: Pick<SavedLyrics, 'filename' | 'raw'> & Partial<Pick<SavedLyrics, 'online'>>,
) {
	const parsed: ParsedLyrics = candidate.online
		? { lines: candidate.online.lines, timed: true, title: candidate.online.title, artist: candidate.online.artist, fileOffsetMs: 0 }
		: parseLyrics(candidate.raw)
	const currentHints = lyricVersionHints(current.title)
	const candidateHints = lyricVersionHints(
		`${loadedLyricVersionText(parsed.title || candidate.filename, candidate.raw, parsed.lines.slice(0, 3).map((line) => line.text))} ${candidate.filename}`,
	)
	const warnings: string[] = []
	if (!current.performer?.trim())
		warnings.push('当前演唱者未知，不能用 UP 主代替演唱者核对。')
	if (!parsed.artist.trim())
		warnings.push('文件未标注演唱者，无法核对演唱版本。')
	if (
		current.performer?.trim() &&
		parsed.artist.trim() &&
		current.performer.trim() !== parsed.artist.trim()
	)
		warnings.push('演唱者标注不同，请核对翻唱与原唱；不会自动改选原唱。')
	if (currentHints.join('|') !== candidateHints.join('|'))
		warnings.push('版本标注不同或缺失，请核对现场 / 录音室及翻唱版本。')
	return { parsed, currentHints, candidateHints, warnings }
}
