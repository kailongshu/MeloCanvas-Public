import { validateSavedLyrics, lyricsStoragePrefix } from '../lyrics'

import type { Database } from './database'
import type { ImportDirectorySnapshot, ImportReview } from './import-types'
import { directory, reviewValue } from './import-validation'
import { isDouyinAudioId } from './douyin-audio'
import { isLocalAudioId } from './local-audio'
import { parseMusicPreferences } from './music-preferences'
import { playlistItemFromRow, type PlaylistItemRow } from './playlist-import'
import { fenceResumeProjection } from './resume-projection'
import { parseRegistry } from './theme-install-session'

/** This is a portable library catalogue, NOT an audio/theme/account/device backup. */
export const libraryBackupFormat = 'melocanvas.library-catalogue' as const
export const libraryBackupLimits = {
	bytes: 32 * 1024 * 1024,
	rows: 100000,
	cell: 8 * 1024 * 1024,
} as const
const columns = {
	sources:
		'id,bvid,cid,originalTitle,uploader,uploaderId,performer,artwork,duration,domain,audioAvailability',
	creators: 'source,mid,name,avatar,bio,fetchedAt',
	creator_subscriptions:
		'profileId,creatorMid,scope,createdAt,notifications,origin',
	local_audio: 'id,originalName,title,artist,durationSeconds,bytes,importedAt',
	douyin_audio: 'id,awemeId,title,artist,artwork,durationSeconds,addedAt',
	resume_points: 'sourceId,positionSeconds,durationSeconds,completed,updatedAt',
	likes: 'sourceId,likedAt',
	playlists: 'id,name,createdAt,updatedAt,description,coverUri',
	import_tasks:
		'taskId,provider,originalPlaylistId,taskVersion,snapshotJson,revision,createdAt,updatedAt',
	import_entries:
		'taskId,entryId,originalPosition,selected,state,candidatesJson,confirmationCandidateId,confirmedSourceId,reviewedAt',
	import_retry_records:
		'taskId,entryId,sequence,taskRevision,createdAt,errorCode,message',
	playlist_items:
		'itemId,playlistId,sourceId,position,addedAt,importTaskId,originJson,reviewJson',
	import_commits:
		'commitId,taskId,requestJson,playlistId,taskRevision,playlistUpdatedAt,committedAt,kind,receiptJson',
	import_commit_entries:
		'taskId,entryId,commitId,requestedItemId,itemId,sourceId,outcome,resolvedSourceId,resolvedAt,targetKind,targetId,bvid,contentKind,skipKey',
	import_content_reviews: 'taskId,entryId,kind,reviewedAt',
	saved_video_items:
		'itemId,bucket,position,addedAt,bvid,contentKind,reviewedAt,verificationJson,originJson,importTaskId',
	import_item_organizations:
		'operationId,taskId,entryId,itemId,requestJson,receiptJson,taskRevision,organizedAt,targetKind,targetId,contentKind,sourceId,resolvedSourceId,resolvedAt',
	settings: 'key,value',
} as const
export type BackupTable = keyof typeof columns
export type BackupValue = string | number | null
export type BackupRow = Record<string, BackupValue>
export interface LibraryBackup {
	format: typeof libraryBackupFormat
	version: 1
	createdAt: number
	exclusions: typeof exclusions
	tables: Record<BackupTable, BackupRow[]>
}
export const exclusions = [
	'audio-files',
	'theme-packages',
	'custom-covers',
	'native-play-history',
	'playback-queues',
	'offline-download-cache',
	'native-network-policy',
	'recommendation-feedback',
	'accounts-and-credentials',
] as const
const tableNames = Object.keys(columns) as BackupTable[]
const numericColumns = new Set(
	'fetchedAt,notifications,cid,uploaderId,duration,durationSeconds,bytes,importedAt,likedAt,createdAt,updatedAt,taskVersion,revision,originalPosition,selected,reviewedAt,position,addedAt,sequence,taskRevision,playlistUpdatedAt,committedAt,resolvedAt,organizedAt,positionSeconds,completed'.split(
		',',
	),
)
const realColumns = new Set(['duration', 'durationSeconds', 'positionSeconds'])
const nullableColumns = new Set(
	'avatar,bio,performer,coverUri,sourceId,confirmationCandidateId,confirmedSourceId,reviewedAt,errorCode,importTaskId,originJson,reviewJson,playlistId,playlistUpdatedAt,receiptJson,itemId,resolvedSourceId,resolvedAt,bvid,contentKind,skipKey'.split(
		',',
	),
)

const secretKey =
	/^(?:cookie|cookies|set-cookie|authorization|password|passwd|sessdata|bili_jct|csrf|csrf_token|api_key|apikey|auth_key|session|session_id|token|accessToken|refreshToken|access_token|refresh_token|secret|clientSecret|client_secret|privateKey|private_key|credentials|sessionToken|session_token|accountGrant|account_grant)$/i
function utf8Bytes(value: string): number {
	let bytes = 0
	for (const character of value) {
		const code = character.codePointAt(0)!
		bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
	}
	return bytes
}
function fail(): never {
	throw new Error(
		'备份格式无效、包含不支持的数据或超过安全大小限制；当前资料未更改。',
	)
}
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
	if (
		Object.keys(value).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(value, key))
	)
		fail()
}
/** JSON metadata is data, never SQL or instructions. Reject credential-bearing keys/URLs. */
function inspectMetadata(value: unknown, depth = 0): void {
	if (depth > 24) fail()
	if (typeof value === 'string') {
		if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(value)) fail()
		if (/^https?:\/\//i.test(value)) {
			let url: URL
			try {
				url = new URL(value)
			} catch {
				fail()
			}
			if (
				url.username ||
				url.password ||
				[...url.searchParams.keys()].some((key) => secretKey.test(key))
			)
				fail()
		}
	} else if (Array.isArray(value))
		value.forEach((item) => inspectMetadata(item, depth + 1))
	else if (record(value)) {
		for (const [key, item] of Object.entries(value)) {
			if (
				secretKey.test(key) ||
				['__proto__', 'constructor', 'prototype'].includes(key)
			)
				fail()
			inspectMetadata(item, depth + 1)
		}
	}
}
export function parseLibraryBackup(text: string): LibraryBackup {
	// UTF-8 cannot use fewer bytes than UTF-16 code units for valid JSON here.
	if (
		text.length > libraryBackupLimits.bytes ||
		utf8Bytes(text) > libraryBackupLimits.bytes
	)
		fail()
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		fail()
	}
	if (!record(value)) fail()
	exact(value, ['format', 'version', 'createdAt', 'exclusions', 'tables'])
	if (
		value.format !== libraryBackupFormat ||
		value.version !== 1 ||
		!Number.isSafeInteger(value.createdAt) ||
		(value.createdAt as number) < 0 ||
		JSON.stringify(value.exclusions) !== JSON.stringify(exclusions) ||
		!record(value.tables)
	)
		fail()
	if (!Object.hasOwn(value.tables, 'douyin_audio'))
		(value.tables as Record<string, unknown>).douyin_audio = []
	exact(value.tables, tableNames)
	let rowCount = 0
	for (const table of tableNames) {
		const rows = value.tables[table]
		if (!Array.isArray(rows)) fail()
		rowCount += rows.length
		if (rowCount > libraryBackupLimits.rows) fail()
		for (const row of rows) {
			if (!record(row)) fail()
			exact(row, columns[table].split(','))
			if (
				(table === 'likes' || table === 'resume_points') &&
				typeof row.sourceId !== 'string'
			)
				fail()
			for (const [column, cell] of Object.entries(row)) {
				if (cell === null && !nullableColumns.has(column)) fail()
				if (
					cell !== null &&
					numericColumns.has(column) &&
					(typeof cell !== 'number' ||
						cell < 0 ||
						(!realColumns.has(column) && !Number.isSafeInteger(cell)))
				)
					fail()
				if (
					cell !== null &&
					!numericColumns.has(column) &&
					typeof cell !== 'string'
				)
					fail()

				if (
					cell !== null &&
					typeof cell !== 'string' &&
					typeof cell !== 'number'
				)
					fail()
				if (typeof cell === 'number' && !Number.isFinite(cell)) fail()
				if (typeof cell === 'string') {
					if (cell.length > libraryBackupLimits.cell) fail()
					inspectMetadata(cell)
					if (column.endsWith('Json')) {
						let nested: unknown
						try {
							nested = JSON.parse(cell)
						} catch {
							fail()
						}
						inspectMetadata(nested)
					}
				}
			}
		}
	}
	const backup = value as unknown as LibraryBackup
	const tasks = new Map<string, ImportDirectorySnapshot>()
	for (const row of backup.tables.import_tasks) {
		if (typeof row.snapshotJson !== 'string') fail()
		const { snapshot } = directory(
			JSON.parse(row.snapshotJson) as ImportDirectorySnapshot,
		)
		if (
			snapshot.taskId !== row.taskId ||
			snapshot.provider !== row.provider ||
			snapshot.originalPlaylistId !== row.originalPlaylistId ||
			snapshot.taskVersion !== row.taskVersion ||
			tasks.has(snapshot.taskId)
		)
			fail()
		tasks.set(snapshot.taskId, snapshot)
	}
	for (const [taskId, snapshot] of tasks) {
		const entries = backup.tables.import_entries.filter(
			(entry) => entry.taskId === taskId,
		)
		if (entries.length !== snapshot.entries.length) fail()
		for (const original of snapshot.entries) {
			const entry = entries.find(
				(candidate) => candidate.entryId === original.entryId,
			)
			if (
				!entry ||
				entry.originalPosition !== original.originalPosition ||
				typeof entry.candidatesJson !== 'string'
			)
				fail()
			reviewValue({
				state: entry.state,
				candidates: JSON.parse(entry.candidatesJson),
				confirmation:
					entry.confirmationCandidateId === null
						? null
						: {
								candidateId: entry.confirmationCandidateId,
								sourceId: entry.confirmedSourceId,
							},
			} as ImportReview)
		}
	}
	for (const row of backup.tables.playlist_items)
		playlistItemFromRow(row as unknown as PlaylistItemRow)
	const ids = new Set<string>()
	for (const row of backup.tables.sources) {
		if (
			typeof row.bvid !== 'string' ||
			!/^BV[A-Za-z0-9]{10}$/.test(row.bvid) ||
			!Number.isSafeInteger(row.cid) ||
			Number(row.cid) <= 0 ||
			row.id !== `bilibili:${row.bvid}:${row.cid}` ||
			ids.has(row.id)
		)
			fail()
		if (
			!['music', 'unclassified'].includes(String(row.domain)) ||
			row.audioAvailability !== 'unknown'
		)
			fail()
		ids.add(row.id)
	}
	for (const row of backup.tables.local_audio) {
		if (
			Number(row.bytes) <= 0 ||
			typeof row.title !== 'string' ||
			!row.title.trim() ||
			typeof row.originalName !== 'string' ||
			!row.originalName.trim()
		)
			fail()
		if (
			typeof row.id !== 'string' ||
			!isLocalAudioId(row.id) ||
			ids.has(row.id)
		)
			fail()
		ids.add(row.id)
	}
	for (const row of backup.tables.douyin_audio) {
		if (
			typeof row.id !== 'string' ||
			typeof row.awemeId !== 'string' ||
			!isDouyinAudioId(row.id) ||
			row.id !== `douyin:${row.awemeId}` ||
			typeof row.title !== 'string' ||
			!row.title.trim() ||
			ids.has(row.id)
		)
			fail()
		ids.add(row.id)
	}
	for (const row of backup.tables.settings) {
		// Never copy the settings table wholesale: theme registries and future auth settings are excluded.
		if (typeof row.value !== 'string') fail()
		if (row.key === 'reducedMotion') {
			if (!['true', 'false'].includes(row.value)) fail()
		} else if (row.key === 'theme') {
			if (!['modern', 'pastoral', 'anime'].includes(row.value)) fail()
		} else if (row.key === 'theme.state.v1') {
			parseRegistry(row.value)
			inspectMetadata(JSON.parse(row.value))
		} else if (row.key === 'searchHistory.v1') {
			const items: unknown = JSON.parse(row.value)
			if (!Array.isArray(items) || items.length > 30) fail()
			for (const item of items) {
				if (!record(item)) fail()
				exact(item, ['query', 'kind', 'order'])
				if (
					typeof item.query !== 'string' ||
					!item.query.trim() ||
					item.query.length > 4096 ||
					!['all', 'music', 'listening', 'creator', 'douyin'].includes(
						String(item.kind),
					) ||
					!['relevance', 'published'].includes(String(item.order))
				)
					fail()
			}
		} else if (row.key === 'music.preferences.v1') {
			parseMusicPreferences(row.value)
		} else if (
			typeof row.key === 'string' &&
			row.key.startsWith(lyricsStoragePrefix)
		) {
			const data: unknown = JSON.parse(row.value)
			if (!record(data)) fail()
			exact(data, [
				'version',
				'sourceId',
				'filename',
				'importedAt',
				'raw',
				'offsetMs',
				...(Object.hasOwn(data, 'online') ? ['online'] : []),
			])
			validateSavedLyrics(data, row.key.slice(lyricsStoragePrefix.length))
			if (Object.hasOwn(data, 'online')) {
				const online = data.online
				if (!record(online)) fail()
				exact(online, ['provider', 'remoteId', 'title', 'artist', 'lines'])
				if (!Array.isArray(online.lines)) fail()
				// The shared lyric validator bounds and checks these lines first.
				// Keep archive records exact instead of silently dropping extra fields.
				for (const line of online.lines) {
					if (!record(line)) fail()
					exact(line, [
						'text',
						'atMs',
						'endMs',
						...(Object.hasOwn(line, 'translation') ? ['translation'] : []),
						...(Object.hasOwn(line, 'romaji') ? ['romaji'] : []),
					])
				}
			}
		} else fail()
		if (row.key !== 'reducedMotion' && row.key !== 'theme')
			inspectMetadata(JSON.parse(row.value))
	}
	for (const row of backup.tables.playlists)
		if (
			row.coverUri !== null &&
			(typeof row.coverUri !== 'string' ||
				!/^melo-backup-cover:cover-[a-z0-9]+-[a-z0-9]+$/.test(row.coverUri))
		)
			fail()
	return backup
}
export function portableCover(uri: BackupValue): string | null {
	if (uri === null) return null
	if (typeof uri !== 'string') fail()
	if (/^melo-backup-cover:cover-[a-z0-9]+-[a-z0-9]+$/.test(uri)) return uri
	const match =
		/^file:\/\/[^?#]*\/melo-playlist-covers\/(cover-[a-z0-9]+-[a-z0-9]+)$/.exec(
			uri,
		)
	if (!match)
		throw new Error(
			'有自定义封面不在应用私有目录内，完整备份不能安全包含它，请重新选择封面后重试。',
		)
	return `melo-backup-cover:${match[1]}`
}
function captureLibraryBackup(
	db: Database,
	createdAt: number,
	includeThemeRegistry: boolean,
): string {
	const tables = {} as LibraryBackup['tables']
	let totalRows = 0,
		totalBytes = 0
	for (const table of tableNames) {
		const where =
			table === 'settings'
				? includeThemeRegistry
					? " WHERE key IN ('reducedMotion','theme','theme.state.v1','searchHistory.v1','music.preferences.v1') OR key LIKE 'melo.lyrics.v1:%'"
					: " WHERE key IN ('reducedMotion','theme','searchHistory.v1','music.preferences.v1') OR key LIKE 'melo.lyrics.v1:%'"
				: ''
		const names = columns[table].split(',')
		// Bound native->JS allocation before materializing rows; reserve worst-case JSON escaping (6x).
		const size = db.getFirstSync<{ rows: number; bytes: number }>(
			`SELECT COUNT(*) AS rows, COALESCE(SUM(${names.map((name) => `LENGTH(CAST(COALESCE(${name},'') AS BLOB))`).join('+')}),0) AS bytes FROM ${table}${where}`,
			[],
		)
		if (!size) fail()
		totalRows += size.rows
		totalBytes +=
			size.bytes * 6 +
			size.rows * (columns[table].length + names.length * 5 + 2)
		if (
			totalRows > libraryBackupLimits.rows ||
			totalBytes > libraryBackupLimits.bytes
		)
			fail()
		tables[table] = db.getAllSync<BackupRow>(
			`SELECT ${columns[table]} FROM ${table}${where} ORDER BY ${primaryKeys[table].join(',')}`,
			[],
		)
	}

	if (!includeThemeRegistry) {
		const stored = db.getFirstSync<{ value: string }>(
			"SELECT value FROM settings WHERE key = 'theme.state.v1'",
			[],
		)
		if (stored) {
			try {
				const registry = parseRegistry(stored.value)
				if (registry.active.kind === 'builtin') {
					tables.settings = tables.settings.filter((row) => row.key !== 'theme')
					tables.settings.push({ key: 'theme', value: registry.active.key })
				}
			} catch {
				/* Invalid excluded theme packages do not prevent a lightweight rescue. */
			}
		}
	}
	// App-private cover paths are not portable, and their actual assets are not in this format.
	tables.playlists = tables.playlists.map((row) => ({
		...row,
		coverUri: includeThemeRegistry ? portableCover(row.coverUri) : null,
	}))
	const text = JSON.stringify({
		format: libraryBackupFormat,
		version: 1,
		createdAt,
		exclusions,
		tables,
	})
	parseLibraryBackup(text)
	return text
}
export function exportLibraryBackup(
	db: Database,
	createdAt = Date.now(),
	includeThemeRegistry = false,
): string {
	db.execSync('BEGIN')
	try {
		const text = captureLibraryBackup(db, createdAt, includeThemeRegistry)
		db.execSync('COMMIT')
		return text
	} catch (error) {
		try {
			db.execSync('ROLLBACK')
		} catch {
			/* Preserve read error. */
		}
		throw error
	}
}
export function summarizeLibraryBackup(backup: LibraryBackup) {
	return {
		liked: backup.tables.likes.length,
		playlists: backup.tables.playlists.length,
		playlistItems: backup.tables.playlist_items.length,
		pendingItems: backup.tables.playlist_items.filter(
			(row) => row.sourceId === null,
		).length,
		localReferences: backup.tables.local_audio.length,
		importTasks: backup.tables.import_tasks.length,
		createdAt: backup.createdAt,
		exclusions: backup.exclusions,
	}
}
/** Infrastructure only. Safe destination is a NEW, migrated staging DB, never the live DB.
 * No merge/replace policy is implied. Caller must publish no UI until that policy is chosen.
 * SQLite checks all relational/unique/check constraints and rolls back the entire staging write.
 */
export function stageLibraryBackup(
	db: Database,
	text: string,
): ReturnType<typeof summarizeLibraryBackup> {
	const backup = parseLibraryBackup(text)
	db.execSync('BEGIN IMMEDIATE')
	try {
		// Check every application table, not only exported tables: a staging target must be empty.
		const tables = db.getAllSync<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
			[],
		)
		for (const { name } of tables) {
			if (
				!/^[a-z_]+$/.test(name) ||
				db.getFirstSync<{ count: number }>(
					`SELECT COUNT(*) AS count FROM ${name}`,
					[],
				)?.count !== 0
			)
				throw new Error('恢复预检必须使用空白临时资料库，现有资料未更改。')
		}
		for (const table of tableNames) {
			if (table === 'local_audio')
				for (const row of backup.tables.local_audio)
					db.runSync(
						"INSERT INTO playback_sources(id,kind) VALUES (?, 'local')",
						[row.id],
					)
			if (table === 'douyin_audio')
				for (const row of backup.tables.douyin_audio)
					db.runSync(
						"INSERT INTO playback_sources(id,kind) VALUES (?, 'douyin')",
						[row.id],
					)
			const names = columns[table].split(',')
			for (const row of backup.tables[table])
				db.runSync(
					`INSERT INTO ${table} (${columns[table]}) VALUES (${names.map(() => '?').join(',')})`,
					names.map((name) => row[name]),
				)
		}
		if (db.getAllSync('PRAGMA foreign_key_check', []).length !== 0) fail()
		db.execSync('COMMIT')
		return summarizeLibraryBackup(backup)
	} catch (error) {
		try {
			db.execSync('ROLLBACK')
		} catch {
			/* Preserve original failure, including SQLITE_FULL. */
		}
		throw error
	}
}

const primaryKeys: Record<BackupTable, string[]> = {
	sources: ['id'],
	local_audio: ['id'],
	douyin_audio: ['id'],
	creators: ['mid'],
	creator_subscriptions: ['profileId', 'creatorMid'],
	resume_points: ['sourceId'],
	likes: ['sourceId'],
	playlists: ['id'],
	import_tasks: ['taskId'],
	import_entries: ['taskId', 'entryId'],
	import_retry_records: ['taskId', 'entryId', 'sequence'],
	playlist_items: ['itemId'],
	import_commits: ['commitId'],
	import_commit_entries: ['taskId', 'entryId'],
	import_content_reviews: ['taskId', 'entryId'],
	saved_video_items: ['itemId'],
	import_item_organizations: ['operationId'],
	settings: ['key'],
}
export interface BackupMergeResult {
	inserted: number
	keptExisting: number
	skippedGroups: number
}
/** Additive merge only. Existing settings/likes/source metadata win. Conflicting structural
 * playlist/import components stay together and are skipped when already present.
 * Call stageLibraryBackup on a separate temporary DB before invoking this operation.
 */
export function mergeLibraryBackup(
	db: Database,
	text: string,
	resolveCover?: (name: string) => string,
	preview = false,
): BackupMergeResult {
	const backup = parseLibraryBackup(text)
	const result = { inserted: 0, keptExisting: 0, skippedGroups: 0 }
	db.execSync('BEGIN IMMEDIATE')
	try {
		const originalLegacyTheme = db.getFirstSync<{ value: string }>(
			"SELECT value FROM settings WHERE key = 'theme'",
			[],
		)
		const skippedPlaylists = new Set<string>()
		const skippedTasks = new Set<string>()
		for (const row of backup.tables.playlists)
			if (db.getFirstSync('SELECT id FROM playlists WHERE id = ?', [row.id]))
				skippedPlaylists.add(String(row.id))
		for (const row of backup.tables.import_tasks)
			if (
				db.getFirstSync(
					'SELECT taskId FROM import_tasks WHERE taskId = ? OR (provider = ? AND originalPlaylistId = ? AND taskVersion = ?)',
					[row.taskId, row.provider, row.originalPlaylistId, row.taskVersion],
				)
			)
				skippedTasks.add(String(row.taskId))
		// A pending item, its import review and its playlist are one unit. Never transplant
		// half of a component into an existing, potentially edited playlist or task.
		const links = [
			...backup.tables.playlist_items.map((row) => ({
				task: row.importTaskId,
				playlist: row.playlistId,
			})),
			...backup.tables.import_commits.map((row) => ({
				task: row.taskId,
				playlist: row.playlistId,
			})),
			...backup.tables.import_item_organizations
				.filter((row) => row.targetKind === 'playlist')
				.map((row) => ({ task: row.taskId, playlist: row.targetId })),
		]
		let changed = true
		while (changed) {
			changed = false
			for (const link of links) {
				if (link.task === null || link.playlist === null) continue
				const task = String(link.task),
					playlist = String(link.playlist)
				if (skippedTasks.has(task) && !skippedPlaylists.has(playlist)) {
					skippedPlaylists.add(playlist)
					changed = true
				}
				if (skippedPlaylists.has(playlist) && !skippedTasks.has(task)) {
					skippedTasks.add(task)
					changed = true
				}
			}
		}
		result.skippedGroups = skippedPlaylists.size + skippedTasks.size
		for (const table of tableNames) {
			const names = columns[table].split(',')
			const keys = primaryKeys[table]
			for (const original of backup.tables[table]) {
				const row = { ...original }
				if (table === 'playlists' && typeof row.coverUri === 'string') {
					if (!resolveCover)
						throw new Error('完整备份封面尚未绑定当前设备，取消恢复。')
					row.coverUri = resolveCover(
						row.coverUri.slice('melo-backup-cover:'.length),
					)
				}
				const task = row.taskId ?? row.importTaskId
				const playlist = table === 'playlists' ? row.id : row.playlistId
				if (
					(task != null && skippedTasks.has(String(task))) ||
					(playlist != null && skippedPlaylists.has(String(playlist)))
				) {
					result.keptExisting++
					continue
				}
				const existing = db.getFirstSync<BackupRow>(
					`SELECT ${columns[table]} FROM ${table} WHERE ${keys.map((key) => `${key} = ?`).join(' AND ')}`,
					keys.map((key) => row[key]),
				)
				if (existing) {
					if (table === 'settings' && row.key === 'theme.state.v1') {
						const current = parseRegistry(String(existing.value)),
							incoming = parseRegistry(String(row.value))
						const seen = new Set(
							current.installed.map(
								(theme) => `${theme.id}:${theme.archiveSha256}`,
							),
						)
						const additions = incoming.installed.filter(
							(theme) => !seen.has(`${theme.id}:${theme.archiveSha256}`),
						)
						if (additions.length) {
							const merged = JSON.stringify({
								...current,
								revision: current.revision + 1,
								installed: [...current.installed, ...additions],
							})
							parseRegistry(merged)
							db.runSync('UPDATE settings SET value = ? WHERE key = ?', [
								merged,
								row.key,
							])
						}
					}
					if (
						[
							'playlist_items',
							'saved_video_items',
							'import_item_organizations',
						].includes(table) &&
						names.some((key) => row[key] !== existing[key])
					)
						throw new Error(
							'发现同一条目身份指向不同内容，已取消合并，当前资料未更改。',
						)
					result.keptExisting++
					continue
				}
				if (table === 'settings' && row.key === 'theme.state.v1') {
					const legacy = originalLegacyTheme
					if (
						legacy &&
						['modern', 'pastoral', 'anime'].includes(legacy.value)
					) {
						const incoming = parseRegistry(String(row.value))
						row.value = JSON.stringify({
							...incoming,
							active: { kind: 'builtin', key: legacy.value },
							previous: null,
						})
					}
				}
				if (table === 'saved_video_items') {
					const last = db.getFirstSync<{ position: number | null }>(
						'SELECT MAX(position) AS position FROM saved_video_items WHERE bucket = ?',
						[row.bucket],
					)
					row.position = (last?.position ?? -1) + 1
				}
				if (table === 'douyin_audio')
					db.runSync(
						"INSERT OR IGNORE INTO playback_sources(id,kind) VALUES (?, 'douyin')",
						[row.id],
					)
				if (table === 'local_audio')
					db.runSync(
						"INSERT INTO playback_sources(id,kind) VALUES (?, 'local')",
						[row.id],
					)
				db.runSync(
					`INSERT INTO ${table} (${columns[table]}) VALUES (${names.map(() => '?').join(',')})`,
					names.map((name) => row[name]),
				)
				result.inserted++
			}
		}
		if (db.getAllSync('PRAGMA foreign_key_check', []).length !== 0) fail()
		db.execSync(preview ? 'ROLLBACK' : 'COMMIT')
		return result
	} catch (error) {
		try {
			db.execSync('ROLLBACK')
		} catch {
			/* Preserve original failure. */
		}
		throw error
	}
}

/** Replace only this catalogue's supported data. Shared source identity rows and physical
 * files are never removed: active native playback/queues and excluded account data survive.
 */
function writeReplacement(
	db: Database,
	backup: LibraryBackup,
	resolveCover: (name: string) => string,
): void {
	for (let index = tableNames.length - 1; index >= 0; index--) {
		const table = tableNames[index]
		if (table === 'sources' || table === 'local_audio' || table === 'douyin_audio') continue
		if (table === 'settings')
			db.runSync(
				"DELETE FROM settings WHERE key IN ('reducedMotion','theme','theme.state.v1','searchHistory.v1','music.preferences.v1') OR key LIKE 'melo.lyrics.v1:%'",
				[],
			)
		else db.runSync(`DELETE FROM ${table}`, [])
	}
	for (const table of tableNames) {
		const names = columns[table].split(',')
		for (const original of backup.tables[table]) {
			const row = { ...original }
			if (
				(table === 'sources' || table === 'local_audio' || table === 'douyin_audio') &&
				db.getFirstSync(`SELECT id FROM ${table} WHERE id = ?`, [row.id])
			)
				continue
			if (table === 'local_audio')
				db.runSync(
					"INSERT OR IGNORE INTO playback_sources(id,kind) VALUES (?, 'local')",
					[row.id],
				)
			if (table === 'douyin_audio')
				db.runSync(
					"INSERT OR IGNORE INTO playback_sources(id,kind) VALUES (?, 'douyin')",
					[row.id],
				)
			if (table === 'playlists' && typeof row.coverUri === 'string')
				row.coverUri = resolveCover(
					row.coverUri.slice('melo-backup-cover:'.length),
				)
			db.runSync(
				`INSERT INTO ${table} (${columns[table]}) VALUES (${names.map(() => '?').join(',')})`,
				names.map((name) => row[name]),
			)
		}
	}
	if (db.getAllSync('PRAGMA foreign_key_check', []).length !== 0) fail()
}
export function replaceLibraryBackup(
	db: Database,
	text: string,
	resolveCover: (name: string) => string,
): void {
	const backup = parseLibraryBackup(text)
	db.execSync('BEGIN IMMEDIATE')
	try {
		const before = captureLibraryBackup(db, 0, true)
		// The checkpoint and replacement commit together. It remains across app restarts.
		db.execSync(
			'CREATE TABLE IF NOT EXISTS library_backup_recovery (id INTEGER PRIMARY KEY CHECK(id = 1), beforeJson TEXT NOT NULL, afterJson TEXT NOT NULL)',
		)
		writeReplacement(db, backup, resolveCover)
		fenceResumeProjection(db)
		const after = captureLibraryBackup(db, 0, true)
		db.runSync(
			'INSERT INTO library_backup_recovery VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET beforeJson=excluded.beforeJson, afterJson=excluded.afterJson',
			[before, after],
		)
		db.execSync('COMMIT')
	} catch (error) {
		try {
			db.execSync('ROLLBACK')
		} catch {
			/* Original transaction error. */
		}
		throw error
	}
}
export function hasLibraryBackupUndo(db: Database): boolean {
	return (
		!!db.getFirstSync(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'library_backup_recovery'",
			[],
		) &&
		!!db.getFirstSync('SELECT id FROM library_backup_recovery WHERE id = 1', [])
	)
}
export function undoLibraryBackupReplacement(
	db: Database,
	resolveCover: (name: string) => string,
): void {
	db.execSync('BEGIN IMMEDIATE')
	try {
		if (!hasLibraryBackupUndo(db)) throw new Error('没有可撤销的替换恢复。')
		const saved = db.getFirstSync<{ beforeJson: string; afterJson: string }>(
			'SELECT beforeJson,afterJson FROM library_backup_recovery WHERE id = 1',
			[],
		)!
		if (captureLibraryBackup(db, 0, true) !== saved.afterJson)
			throw new Error(
				'替换后资料已发生变化，不能自动撤销以免丢失新修改。当前资料和恢复检查点均保留。',
			)
		writeReplacement(db, parseLibraryBackup(saved.beforeJson), resolveCover)
		fenceResumeProjection(db)
		db.runSync('DELETE FROM library_backup_recovery WHERE id = 1', [])
		db.execSync('COMMIT')
	} catch (error) {
		try {
			db.execSync('ROLLBACK')
		} catch {
			/* Original transaction error. */
		}
		throw error
	}
}
