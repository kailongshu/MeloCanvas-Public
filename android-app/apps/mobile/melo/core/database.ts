import { DouyinAudioStore, isDouyinAudioId } from './douyin-audio'
import { LocalAudioStore, isLocalAudioId } from './local-audio'
import { sourceId, type Source } from './model'
import {
	douyinLibrarySource,
	isDouyinLibrarySource,
	localLibrarySource,
	isLocalLibrarySource,
	type MusicLibrarySource,
} from './music-library-source'

type Value = string | number | null
export interface Database {
	execSync(sql: string): void
	runSync(sql: string, values: Value[]): unknown
	getAllSync<T>(sql: string, values: Value[]): T[]
	// The caller supplies the SQLite row shape; SQL itself cannot infer T.
	// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
	getFirstSync<T>(sql: string, values: Value[]): T | null
}

export const migrations = [
	`CREATE TABLE sources (
        id TEXT PRIMARY KEY, bvid TEXT NOT NULL, cid INTEGER NOT NULL,
        originalTitle TEXT NOT NULL, uploader TEXT NOT NULL, uploaderId INTEGER NOT NULL,
        performer TEXT, artwork TEXT NOT NULL, duration REAL NOT NULL,
        domain TEXT NOT NULL, audioAvailability TEXT NOT NULL,
        UNIQUE(bvid, cid)
    );
    CREATE TABLE likes (sourceId TEXT PRIMARY KEY REFERENCES sources(id), likedAt INTEGER NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
	`CREATE INDEX likes_recent ON likes(likedAt DESC);`,
	`CREATE TABLE resume_points (
        sourceId TEXT PRIMARY KEY REFERENCES sources(id),
        positionSeconds REAL NOT NULL CHECK(positionSeconds >= 0),
        durationSeconds REAL NOT NULL CHECK(durationSeconds >= 0),
        completed INTEGER NOT NULL CHECK(completed IN (0, 1)),
        updatedAt INTEGER NOT NULL CHECK(updatedAt >= 0),
        CHECK(durationSeconds = 0 OR positionSeconds <= durationSeconds)
    );
    CREATE INDEX resume_points_recent ON resume_points(updatedAt DESC);
    CREATE TABLE playback_sessions (
        mode TEXT PRIMARY KEY CHECK(mode IN ('music', 'listening')),
        currentSourceId TEXT REFERENCES sources(id),
        positionSeconds REAL NOT NULL CHECK(positionSeconds >= 0),
        speed REAL NOT NULL CHECK(speed >= 0.1 AND speed <= 3),
        updatedAt INTEGER NOT NULL CHECK(updatedAt >= 0),
        CHECK(currentSourceId IS NOT NULL OR positionSeconds = 0)
    );
    CREATE TABLE playback_session_items (
        mode TEXT NOT NULL REFERENCES playback_sessions(mode),
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        sourceId TEXT NOT NULL REFERENCES sources(id),
        PRIMARY KEY(mode, ordinal), UNIQUE(mode, sourceId)
    );`,
	`CREATE TABLE playlists (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        createdAt INTEGER NOT NULL CHECK(createdAt >= 0),
        updatedAt INTEGER NOT NULL CHECK(updatedAt >= 0)
    );
    CREATE TABLE playlist_items (
        itemId TEXT PRIMARY KEY NOT NULL,
        playlistId TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        sourceId TEXT NOT NULL REFERENCES sources(id),
        position INTEGER NOT NULL CHECK(position >= 0),
        addedAt INTEGER NOT NULL CHECK(addedAt >= 0),
        UNIQUE(playlistId, position)
    );`,
	`ALTER TABLE playback_sessions ADD COLUMN currentEntryId TEXT;
    UPDATE playback_sessions SET currentEntryId = currentSourceId;
    CREATE TABLE playback_session_items_v5 (
        mode TEXT NOT NULL REFERENCES playback_sessions(mode),
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        entryId TEXT NOT NULL CHECK(length(entryId) > 0),
        sourceId TEXT NOT NULL REFERENCES sources(id),
        PRIMARY KEY(mode, ordinal), UNIQUE(mode, entryId)
    );
    INSERT INTO playback_session_items_v5 (mode, ordinal, entryId, sourceId)
        SELECT mode, ordinal, sourceId, sourceId FROM playback_session_items;
    DROP TABLE playback_session_items;
    ALTER TABLE playback_session_items_v5 RENAME TO playback_session_items;`,
	`CREATE TABLE creators (
        source TEXT NOT NULL CHECK(source = 'bilibili'),
        mid TEXT PRIMARY KEY NOT NULL CHECK(mid GLOB '[1-9]*' AND mid NOT GLOB '*[^0-9]*'),
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        avatar TEXT, bio TEXT,
        fetchedAt INTEGER NOT NULL CHECK(fetchedAt >= 0)
    );
    CREATE TABLE creator_subscriptions (
        profileId TEXT NOT NULL CHECK(length(trim(profileId)) > 0),
        creatorMid TEXT NOT NULL REFERENCES creators(mid),
        scope TEXT NOT NULL CHECK(scope IN ('all', 'music', 'listening')),
        createdAt INTEGER NOT NULL CHECK(createdAt >= 0),
        notifications INTEGER NOT NULL CHECK(notifications = 0),
        origin TEXT NOT NULL CHECK(origin IN ('manual', 'biliImport')),
        PRIMARY KEY(profileId, creatorMid)
    );
    CREATE INDEX creator_subscriptions_recent ON creator_subscriptions(profileId, createdAt DESC, creatorMid);
    CREATE INDEX creator_subscriptions_creator ON creator_subscriptions(creatorMid);`,
	`CREATE TABLE import_tasks (
        taskId TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('bilibili', 'netease', 'qq')),
        originalPlaylistId TEXT NOT NULL,
        taskVersion INTEGER NOT NULL CHECK(taskVersion > 0),
        snapshotJson TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision >= 0),
        createdAt INTEGER NOT NULL CHECK(createdAt >= 0),
        updatedAt INTEGER NOT NULL CHECK(updatedAt >= 0),
        UNIQUE(provider, originalPlaylistId, taskVersion)
    );
    CREATE TABLE import_entries (
        taskId TEXT NOT NULL REFERENCES import_tasks(taskId) ON DELETE CASCADE,
        entryId TEXT NOT NULL,
        originalPosition INTEGER NOT NULL CHECK(originalPosition >= 0),
        selected INTEGER NOT NULL CHECK(selected IN (0, 1)),
        state TEXT NOT NULL CHECK(state IN ('pending', 'needs-review', 'not-found', 'unreadable', 'confirmed')),
        candidatesJson TEXT NOT NULL,
        confirmationCandidateId TEXT,
        confirmedSourceId TEXT REFERENCES sources(id),
        reviewedAt INTEGER CHECK(reviewedAt >= 0),
        PRIMARY KEY(taskId, entryId),
        UNIQUE(taskId, originalPosition),
        CHECK((state = 'confirmed' AND confirmationCandidateId IS NOT NULL AND confirmedSourceId IS NOT NULL)
            OR (state != 'confirmed' AND confirmationCandidateId IS NULL AND confirmedSourceId IS NULL))
    );
    CREATE TABLE import_retry_records (
        taskId TEXT NOT NULL,
        entryId TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK(sequence > 0),
        taskRevision INTEGER NOT NULL CHECK(taskRevision > 0),
        createdAt INTEGER NOT NULL CHECK(createdAt >= 0),
        errorCode TEXT,
        message TEXT NOT NULL,
        PRIMARY KEY(taskId, entryId, sequence),
        FOREIGN KEY(taskId, entryId) REFERENCES import_entries(taskId, entryId) ON DELETE CASCADE
    );
    CREATE INDEX import_tasks_recent ON import_tasks(updatedAt DESC, taskId);`,
	`CREATE TABLE playlist_items_v8 (
        itemId TEXT PRIMARY KEY NOT NULL,
        playlistId TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        sourceId TEXT REFERENCES sources(id),
        position INTEGER NOT NULL CHECK(position >= 0),
        addedAt INTEGER NOT NULL CHECK(addedAt >= 0),
        importTaskId TEXT REFERENCES import_tasks(taskId),
        originJson TEXT,
        reviewJson TEXT,
        UNIQUE(playlistId, position),
        CHECK((importTaskId IS NULL AND originJson IS NULL AND reviewJson IS NULL AND sourceId IS NOT NULL)
            OR (importTaskId IS NOT NULL AND originJson IS NOT NULL AND reviewJson IS NOT NULL))
    );
    INSERT INTO playlist_items_v8(itemId, playlistId, sourceId, position, addedAt)
        SELECT itemId, playlistId, sourceId, position, addedAt FROM playlist_items;
    DROP TABLE playlist_items;
    ALTER TABLE playlist_items_v8 RENAME TO playlist_items;
    CREATE TABLE import_commits (
        commitId TEXT PRIMARY KEY NOT NULL,
        taskId TEXT NOT NULL REFERENCES import_tasks(taskId),
        requestJson TEXT NOT NULL,
        playlistId TEXT NOT NULL,
        taskRevision INTEGER NOT NULL CHECK(taskRevision > 0),
        playlistUpdatedAt INTEGER NOT NULL CHECK(playlistUpdatedAt >= 0),
        committedAt INTEGER NOT NULL CHECK(committedAt >= 0)
    );
    CREATE TABLE import_commit_entries (
        taskId TEXT NOT NULL,
        entryId TEXT NOT NULL,
        commitId TEXT NOT NULL REFERENCES import_commits(commitId),
        requestedItemId TEXT NOT NULL,
        itemId TEXT,
        sourceId TEXT REFERENCES sources(id),
        outcome TEXT NOT NULL CHECK(outcome IN ('added', 'skipped')),
        resolvedSourceId TEXT REFERENCES sources(id),
        resolvedAt INTEGER,
        PRIMARY KEY(taskId, entryId),
        FOREIGN KEY(taskId, entryId) REFERENCES import_entries(taskId, entryId),
        CHECK((outcome = 'added' AND itemId IS NOT NULL) OR (outcome = 'skipped' AND itemId IS NULL AND sourceId IS NOT NULL))
    );
    CREATE INDEX import_commits_task ON import_commits(taskId, taskRevision);
    CREATE INDEX import_commit_entries_commit ON import_commit_entries(commitId);
    CREATE UNIQUE INDEX import_committed_item_identity ON import_commit_entries(itemId) WHERE itemId IS NOT NULL;`,
	`CREATE TABLE video_catalog (
        bvid TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        uploader TEXT NOT NULL CHECK(length(trim(uploader)) > 0),
        uploaderId INTEGER NOT NULL CHECK(uploaderId > 0),
        artwork TEXT NOT NULL,
        fetchedAt INTEGER NOT NULL CHECK(fetchedAt >= 0),
        lastVisitedSourceId TEXT REFERENCES sources(id)
    );
    CREATE TABLE video_catalog_parts (
        bvid TEXT NOT NULL REFERENCES video_catalog(bvid),
        page INTEGER NOT NULL CHECK(page > 0),
        sourceId TEXT NOT NULL REFERENCES sources(id),
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        PRIMARY KEY(bvid, page), UNIQUE(bvid, sourceId)
    );`,
	`CREATE TABLE import_content_reviews (
        taskId TEXT NOT NULL, entryId TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('song','musicCollection','audioDrama','audiobook','knowledge','commentary','other','unknown')),
        reviewedAt INTEGER NOT NULL CHECK(reviewedAt >= 0),
        PRIMARY KEY(taskId, entryId),
        FOREIGN KEY(taskId, entryId) REFERENCES import_entries(taskId, entryId)
    );
    CREATE TABLE saved_video_items (
        itemId TEXT PRIMARY KEY NOT NULL,
        bucket TEXT NOT NULL CHECK(bucket IN ('listening','unclassified')),
        position INTEGER NOT NULL CHECK(position >= 0),
        addedAt INTEGER NOT NULL CHECK(addedAt >= 0),
        bvid TEXT, contentKind TEXT NOT NULL, reviewedAt INTEGER CHECK(reviewedAt >= 0),
        verificationJson TEXT NOT NULL, originJson TEXT NOT NULL,
        importTaskId TEXT NOT NULL REFERENCES import_tasks(taskId),
        CHECK((bucket = 'unclassified' AND contentKind = 'unknown') OR
            (bucket = 'listening' AND contentKind IN ('musicCollection','audioDrama','audiobook','knowledge','commentary','other'))),
        UNIQUE(bucket, position)
    );
    CREATE INDEX saved_video_bucket_bvid ON saved_video_items(bucket, bvid);
    CREATE TABLE import_commits_v10 (
        commitId TEXT PRIMARY KEY NOT NULL,
        taskId TEXT NOT NULL REFERENCES import_tasks(taskId),
        requestJson TEXT NOT NULL, playlistId TEXT,
        taskRevision INTEGER NOT NULL CHECK(taskRevision > 0),
        playlistUpdatedAt INTEGER CHECK(playlistUpdatedAt >= 0),
        committedAt INTEGER NOT NULL CHECK(committedAt >= 0),
        kind TEXT NOT NULL DEFAULT 'playlist' CHECK(kind IN ('playlist','mixed')),
        receiptJson TEXT,
        CHECK((playlistId IS NULL) = (playlistUpdatedAt IS NULL)),
        CHECK((kind = 'playlist' AND playlistId IS NOT NULL AND receiptJson IS NULL)
            OR (kind = 'mixed' AND receiptJson IS NOT NULL))
    );
    INSERT INTO import_commits_v10(commitId,taskId,requestJson,playlistId,taskRevision,playlistUpdatedAt,committedAt)
        SELECT commitId,taskId,requestJson,playlistId,taskRevision,playlistUpdatedAt,committedAt FROM import_commits;
    CREATE TABLE import_commit_entries_v10 (
        taskId TEXT NOT NULL, entryId TEXT NOT NULL,
        commitId TEXT NOT NULL REFERENCES import_commits_v10(commitId),
        requestedItemId TEXT NOT NULL, itemId TEXT,
        sourceId TEXT REFERENCES sources(id),
        outcome TEXT NOT NULL CHECK(outcome IN ('added','skipped')),
        resolvedSourceId TEXT REFERENCES sources(id), resolvedAt INTEGER,
        targetKind TEXT NOT NULL CHECK(targetKind IN ('playlist','listening','unclassified')),
        targetId TEXT NOT NULL CHECK(length(targetId) > 0),
        bvid TEXT, contentKind TEXT, skipKey TEXT,
        PRIMARY KEY(taskId,entryId),
        FOREIGN KEY(taskId,entryId) REFERENCES import_entries(taskId,entryId),
        CHECK((outcome = 'added' AND itemId IS NOT NULL AND skipKey IS NULL) OR
            (outcome = 'skipped' AND itemId IS NULL AND skipKey IS NOT NULL)),
        CHECK((resolvedSourceId IS NULL AND resolvedAt IS NULL) OR
            (targetKind = 'playlist' AND outcome = 'added' AND sourceId IS NULL AND resolvedSourceId IS NOT NULL AND resolvedAt IS NOT NULL AND resolvedAt >= 0)),
        CHECK((targetKind = 'playlist' AND (contentKind IS NULL OR contentKind = 'song') AND
                (outcome = 'added' OR (sourceId IS NOT NULL AND skipKey = sourceId))) OR
            (targetKind IN ('listening','unclassified') AND targetId = 'local' AND contentKind IS NOT NULL AND sourceId IS NULL AND resolvedSourceId IS NULL AND
                (outcome = 'added' OR (bvid IS NOT NULL AND skipKey = bvid)) AND
                ((targetKind = 'unclassified' AND contentKind = 'unknown') OR
                (targetKind = 'listening' AND contentKind IN ('musicCollection','audioDrama','audiobook','knowledge','commentary','other')))))
    );
    INSERT INTO import_commit_entries_v10(taskId,entryId,commitId,requestedItemId,itemId,sourceId,outcome,resolvedSourceId,resolvedAt,targetKind,targetId,skipKey)
        SELECT e.taskId,e.entryId,e.commitId,e.requestedItemId,e.itemId,e.sourceId,e.outcome,e.resolvedSourceId,e.resolvedAt,
            'playlist',c.playlistId,CASE WHEN e.outcome = 'skipped' THEN e.sourceId ELSE NULL END
        FROM import_commit_entries e JOIN import_commits c ON c.commitId = e.commitId;
    DROP TABLE import_commit_entries;
    DROP TABLE import_commits;
    ALTER TABLE import_commits_v10 RENAME TO import_commits;
    ALTER TABLE import_commit_entries_v10 RENAME TO import_commit_entries;
    CREATE INDEX import_commits_task ON import_commits(taskId,taskRevision);
    CREATE INDEX import_commit_entries_commit ON import_commit_entries(commitId);
    CREATE UNIQUE INDEX import_committed_item_identity ON import_commit_entries(itemId) WHERE itemId IS NOT NULL;`,
	`CREATE TABLE import_item_organizations (
        operationId TEXT PRIMARY KEY NOT NULL,
        taskId TEXT NOT NULL, entryId TEXT NOT NULL,
        itemId TEXT NOT NULL UNIQUE,
        requestJson TEXT NOT NULL, receiptJson TEXT NOT NULL,
        taskRevision INTEGER NOT NULL CHECK(taskRevision > 0),
        organizedAt INTEGER NOT NULL CHECK(organizedAt >= 0),
        targetKind TEXT NOT NULL CHECK(targetKind IN ('playlist','listening')),
        targetId TEXT NOT NULL CHECK(length(targetId) > 0),
        contentKind TEXT NOT NULL,
        sourceId TEXT REFERENCES sources(id),
        resolvedSourceId TEXT REFERENCES sources(id),
        resolvedAt INTEGER,
        UNIQUE(taskId,entryId),
        FOREIGN KEY(taskId,entryId) REFERENCES import_commit_entries(taskId,entryId),
        CHECK((targetKind = 'playlist' AND contentKind = 'song') OR
            (targetKind = 'listening' AND targetId = 'local' AND sourceId IS NULL AND
                contentKind IN ('musicCollection','audioDrama','audiobook','knowledge','commentary','other'))),
        CHECK((resolvedSourceId IS NULL AND resolvedAt IS NULL) OR
            (targetKind = 'playlist' AND sourceId IS NULL AND resolvedSourceId IS NOT NULL AND resolvedAt IS NOT NULL AND resolvedAt >= 0))
    );
    CREATE INDEX import_item_organizations_task ON import_item_organizations(taskId,taskRevision);`,
	`CREATE TABLE creator_post_cache_heads (
        cacheKey TEXT NOT NULL,
        mid TEXT NOT NULL CHECK(mid GLOB '[1-9]*' AND mid NOT GLOB '*[^0-9]*'),
        revision INTEGER NOT NULL CHECK(revision > 0),
        lastPage INTEGER NOT NULL CHECK(lastPage > 0),
        more INTEGER NOT NULL CHECK(more IN (0,1)),
        total INTEGER NOT NULL CHECK(total >= 0),
        PRIMARY KEY(cacheKey,mid)
    );
    CREATE TABLE creator_post_cache_pages (
        cacheKey TEXT NOT NULL, mid TEXT NOT NULL,
        page INTEGER NOT NULL CHECK(page > 0),
        fetchedAt INTEGER NOT NULL CHECK(fetchedAt >= 0),
        itemsJson TEXT NOT NULL,
        PRIMARY KEY(cacheKey,mid,page),
        FOREIGN KEY(cacheKey,mid) REFERENCES creator_post_cache_heads(cacheKey,mid)
    );
    CREATE INDEX creator_post_cache_mid ON creator_post_cache_heads(mid);`,
	`ALTER TABLE playlists ADD COLUMN description TEXT NOT NULL DEFAULT '';`,
	`ALTER TABLE playlists ADD COLUMN coverUri TEXT DEFAULT NULL;`,
	`CREATE TABLE playback_sources (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('bilibili', 'local'))
 );
 INSERT INTO playback_sources SELECT id, 'bilibili' FROM sources;
 CREATE TRIGGER register_playback_source AFTER INSERT ON sources BEGIN
    INSERT INTO playback_sources (id, kind) VALUES (NEW.id, 'bilibili');
 END;
 CREATE TRIGGER unregister_playback_source AFTER DELETE ON sources BEGIN
    DELETE FROM playback_sources WHERE id = OLD.id;
 END;
 CREATE TABLE local_audio (
    id TEXT PRIMARY KEY NOT NULL REFERENCES playback_sources(id),
    originalName TEXT NOT NULL, title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    artist TEXT NOT NULL, durationSeconds REAL NOT NULL CHECK(durationSeconds >= 0),
    bytes INTEGER NOT NULL CHECK(bytes > 0), importedAt INTEGER NOT NULL CHECK(importedAt >= 0)
 );
 CREATE TABLE playback_sessions_local (
    mode TEXT PRIMARY KEY CHECK(mode IN ('music', 'listening')),
    currentSourceId TEXT REFERENCES playback_sources(id),
    positionSeconds REAL NOT NULL CHECK(positionSeconds >= 0),
    speed REAL NOT NULL CHECK(speed >= 0.1 AND speed <= 3),
    updatedAt INTEGER NOT NULL CHECK(updatedAt >= 0), currentEntryId TEXT,
    CHECK(currentSourceId IS NOT NULL OR positionSeconds = 0)
 );
 INSERT INTO playback_sessions_local SELECT mode, currentSourceId, positionSeconds, speed, updatedAt, currentEntryId FROM playback_sessions;
 CREATE TABLE playback_session_items_local (
    mode TEXT NOT NULL REFERENCES playback_sessions_local(mode),
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0), entryId TEXT NOT NULL CHECK(length(entryId) > 0),
    sourceId TEXT NOT NULL REFERENCES playback_sources(id),
    PRIMARY KEY(mode, ordinal), UNIQUE(mode, entryId)
 );
 INSERT INTO playback_session_items_local SELECT mode, ordinal, entryId, sourceId FROM playback_session_items;
 DROP TABLE playback_session_items;
 DROP TABLE playback_sessions;
 ALTER TABLE playback_sessions_local RENAME TO playback_sessions;
 ALTER TABLE playback_session_items_local RENAME TO playback_session_items;`,
	`CREATE TABLE likes_music (sourceId TEXT PRIMARY KEY REFERENCES playback_sources(id), likedAt INTEGER NOT NULL);
 INSERT INTO likes_music SELECT sourceId, likedAt FROM likes;
 DROP TABLE likes;
 ALTER TABLE likes_music RENAME TO likes;
 CREATE INDEX likes_recent ON likes(likedAt DESC);
 CREATE TABLE playlist_items_music (
 itemId TEXT PRIMARY KEY NOT NULL,
 playlistId TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
 sourceId TEXT REFERENCES playback_sources(id),
 position INTEGER NOT NULL CHECK(position >= 0),
 addedAt INTEGER NOT NULL CHECK(addedAt >= 0),
 importTaskId TEXT REFERENCES import_tasks(taskId), originJson TEXT, reviewJson TEXT,
 UNIQUE(playlistId, position),
 CHECK((importTaskId IS NULL AND originJson IS NULL AND reviewJson IS NULL AND sourceId IS NOT NULL)
 OR (importTaskId IS NOT NULL AND originJson IS NOT NULL AND reviewJson IS NOT NULL))
 );
 INSERT INTO playlist_items_music SELECT itemId, playlistId, sourceId, position, addedAt, importTaskId, originJson, reviewJson FROM playlist_items;
 DROP TABLE playlist_items;
 ALTER TABLE playlist_items_music RENAME TO playlist_items;`,
	`CREATE TABLE resume_projection_epoch (id INTEGER PRIMARY KEY CHECK(id = 1), generation INTEGER NOT NULL);
 CREATE TABLE resume_projection_grants (sourceId TEXT PRIMARY KEY NOT NULL, generation INTEGER NOT NULL);
 CREATE TABLE resume_projection_session (id INTEGER PRIMARY KEY CHECK(id = 1), generation INTEGER NOT NULL, entriesJson TEXT NOT NULL);`,
	`CREATE TABLE import_tasks_extended (
        taskId TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('bilibili', 'netease', 'qq', 'kugou', 'kuwo', 'qishui')),
        originalPlaylistId TEXT NOT NULL,
        taskVersion INTEGER NOT NULL CHECK(taskVersion > 0),
        snapshotJson TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision >= 0),
        createdAt INTEGER NOT NULL CHECK(createdAt >= 0),
        updatedAt INTEGER NOT NULL CHECK(updatedAt >= 0),
        UNIQUE(provider, originalPlaylistId, taskVersion)
    );
    INSERT INTO import_tasks_extended SELECT * FROM import_tasks;
    DROP TABLE import_tasks;
    ALTER TABLE import_tasks_extended RENAME TO import_tasks;
    CREATE INDEX import_tasks_recent ON import_tasks(updatedAt DESC, taskId);`,
	`CREATE TABLE playback_sources_v2 (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('bilibili', 'local', 'douyin'))
    );
    INSERT INTO playback_sources_v2 SELECT id, kind FROM playback_sources;
    DROP TRIGGER IF EXISTS register_playback_source;
    DROP TRIGGER IF EXISTS unregister_playback_source;
    DROP TABLE playback_sources;
    ALTER TABLE playback_sources_v2 RENAME TO playback_sources;
    CREATE TRIGGER register_playback_source AFTER INSERT ON sources BEGIN
        INSERT INTO playback_sources (id, kind) VALUES (NEW.id, 'bilibili');
    END;
    CREATE TRIGGER unregister_playback_source AFTER DELETE ON sources BEGIN
        DELETE FROM playback_sources WHERE id = OLD.id;
    END;
    CREATE TABLE douyin_audio (
        id TEXT PRIMARY KEY NOT NULL REFERENCES playback_sources(id),
        awemeId TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        artist TEXT NOT NULL,
        artwork TEXT NOT NULL,
        durationSeconds REAL NOT NULL CHECK(durationSeconds >= 0),
        audioUrl TEXT NOT NULL DEFAULT '',
        addedAt INTEGER NOT NULL CHECK(addedAt >= 0)
    );
    CREATE INDEX douyin_audio_recent ON douyin_audio(addedAt DESC);`,
] as const

export function migrate(
	db: Database,
	steps: readonly string[] = migrations,
): void {
	db.execSync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
	const version =
		db.getFirstSync<{ user_version: number }>('PRAGMA user_version', [])
			?.user_version ?? 0
	if (version > steps.length)
		throw new Error('本地数据来自较新版本，请使用新版音绘；原数据已保留。')
	if (version === steps.length) return
	// SQLite's documented table-rebuild procedure: disable outside the transaction,
	// preserve child rows, check all references before commit, then restore enforcement.
	const rebuildImports = steps.slice(version).some(step => step.includes('CREATE TABLE import_tasks_extended') || step.includes('CREATE TABLE playback_sources_v2'))
	if (rebuildImports) db.execSync('PRAGMA foreign_keys = OFF')
	try {
		db.execSync('BEGIN IMMEDIATE')
		for (let index = version; index < steps.length; index++)
			db.execSync(steps[index])
		if (rebuildImports && db.getAllSync('PRAGMA foreign_key_check', []).length)
			throw new Error('导入目录升级发现引用不一致；原数据已保留。')
		db.execSync(`PRAGMA user_version = ${steps.length}`)
		db.execSync('COMMIT')
	} catch (error) {
		try {
			db.execSync('ROLLBACK')
		} catch {
			// SQLite may already have rolled back (for example SQLITE_FULL).
			// Preserve the original write error for diagnosis.
		}
		throw error
	} finally {
		if (rebuildImports) db.execSync('PRAGMA foreign_keys = ON')
	}
}

export class Library {
	constructor(private db: Database) {}

	save(source: Source): void {
		if (
			!/^BV[A-Za-z0-9]{10}$/.test(source.bvid) ||
			!Number.isSafeInteger(source.cid) ||
			source.cid <= 0 ||
			source.id !== sourceId(source.bvid, source.cid)
		)
			throw new Error('音源身份无效')
		this.db.runSync(
			`INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET originalTitle=excluded.originalTitle,
            uploader=excluded.uploader, artwork=excluded.artwork, duration=excluded.duration`,
			[
				source.id,
				source.bvid,
				source.cid,
				source.originalTitle,
				source.uploader,
				source.uploaderId,
				source.performer,
				source.artwork,
				source.duration,
				source.domain,
				source.audioAvailability,
			],
		)
	}

	get(id: string): Source | null {
		return this.db.getFirstSync<Source>('SELECT * FROM sources WHERE id = ?', [
			id,
		])
	}

	getMusic(id: string): MusicLibrarySource | null {
		if (isDouyinAudioId(id)) {
			const audio = new DouyinAudioStore(this.db).get(id)
			return audio ? douyinLibrarySource(audio) : null
		}
		if (!isLocalAudioId(id)) return this.get(id)
		const audio = new LocalAudioStore(this.db).get(id)
		return audio ? localLibrarySource(audio) : null
	}
	saveMusic(source: MusicLibrarySource): void {
		if (isDouyinLibrarySource(source)) {
			new DouyinAudioStore(this.db).upsert({
				id: source.id,
				awemeId: source.awemeId,
				title: source.originalTitle,
				artist: source.performer || source.uploader || '抖音原声',
				artwork: source.artwork,
				durationSeconds: source.duration,
				audioUrl: source.audioUrl,
				addedAt: source.addedAt || Date.now(),
			})
			return
		}
		if (!isLocalLibrarySource(source)) {
			this.save(source)
			return
		}
		if (
			!isLocalAudioId(source.id) ||
			!new LocalAudioStore(this.db).get(source.id)
		)
			throw new Error('本地音频不存在，请重新导入')
	}
	musicLikes(): MusicLibrarySource[] {
		return this.db
			.getAllSync<{ sourceId: string }>(
				'SELECT sourceId FROM likes ORDER BY likedAt DESC, sourceId',
				[],
			)
			.map(({ sourceId: id }) => {
				const source = this.getMusic(id)
				if (!source) throw new Error('喜欢的音源信息暂时无法读取，记录已保留')
				return source
			})
	}

	setLiked(source: MusicLibrarySource, liked: boolean): void {
		this.db.execSync('BEGIN IMMEDIATE')
		try {
			this.saveMusic(source)
			if (liked)
				this.db.runSync(
					'INSERT INTO likes VALUES (?, ?) ON CONFLICT(sourceId) DO NOTHING',
					[source.id, Date.now()],
				)
			else this.db.runSync('DELETE FROM likes WHERE sourceId = ?', [source.id])
			this.db.execSync('COMMIT')
		} catch (error) {
			try {
				this.db.execSync('ROLLBACK')
			} catch {
				// SQLite may already have rolled back (for example SQLITE_FULL).
				// Preserve the original write error for diagnosis.
			}
			throw error
		}
	}

	likes(): Source[] {
		return this.db.getAllSync<Source>(
			'SELECT sources.* FROM sources JOIN likes ON sources.id = likes.sourceId ORDER BY likedAt DESC',
			[],
		)
	}

	sourcesByUploader(mid: string): Source[] {
		const uploaderId = Number(mid)
		if (
			typeof mid !== 'string' ||
			mid.trim() !== mid ||
			!/^[1-9][0-9]*$/.test(mid)
		)
			throw new Error('UP 主 mid 无效')
		if (!Number.isSafeInteger(uploaderId)) return []
		return this.db.getAllSync<Source>(
			'SELECT * FROM sources WHERE uploaderId = ? ORDER BY bvid, cid',
			[uploaderId],
		)
	}

	setting(key: string): string | null {
		return (
			this.db.getFirstSync<{ value: string }>(
				'SELECT value FROM settings WHERE key = ?',
				[key],
			)?.value ?? null
		)
	}

	setSetting(key: string, value: string): void {
		this.db.runSync(
			'INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
			[key, value],
		)
	}
}
