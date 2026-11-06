import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyChange } from '@/db/changes';
import { inTransaction, laterThanBefore, listMoments, type Moment } from '@/db/moments';
import { localDateKey } from '@/lib/dates';

// 사진첩 탭의 앨범. 기본 앨범('모든 순간')은 행이 없고 남긴 기록 전체를 보여준다.
// 사용자가 만든 앨범은 albums 행이고, album_moments가 기록을 가리키기만 한다.
// 한 기록이 여러 앨범에 들어가도 사진·기록은 하나다.
//
// kind 'custom'은 기기 사진첩의 앨범, 'cloud'는 안전 사진첩의 안전 앨범이다.
// 안전 앨범에 담은 기록만 사진을 Cloud에 올린다 (lib/cloud/photos.ts). 화질은 앨범마다 고른다:
// 'original'은 원본과 표시용을 함께, 'display'는 표시용(긴 변 1600px)만 올려 용량을 아낀다.

export const ALL_ALBUM_ID = 'all';
export const ALL_ALBUM_TITLE = '나의 순간들';
/** 안전 사진첩의 기본 보기. 행이 없고 Cloud에 사진이 있거나 안전 앨범에 담은 기록 전체다. */
export const CLOUD_ALL_ALBUM_ID = 'cloud-all';
export const CLOUD_ALL_ALBUM_TITLE = '안전 보관한 모든 사진';
export const ALBUM_TITLE_MAX = 40;

export type AlbumKind = 'custom' | 'cloud';
export type PhotoQuality = 'original' | 'display';

export function isBuiltInAlbum(id: string) {
  return id === ALL_ALBUM_ID || id === CLOUD_ALL_ALBUM_ID;
}

// 안전 사진첩에 보이는 기록 (moments 별칭 m). 앨범에서 뺐어도 이미 올린 사진은 Cloud에 남아 있으므로 함께 보여준다.
const IN_CLOUD = `(m.display_uploaded = 1 OR m.original_uploaded = 1 OR EXISTS (
  SELECT 1 FROM album_moments cam JOIN albums ca ON ca.id = cam.album_id
  WHERE cam.moment_id = m.id AND cam.deleted_at IS NULL AND ca.deleted_at IS NULL AND ca.kind = 'cloud'))`;

export type AlbumSummary = {
  id: string;
  title: string;
  count: number;
  startAt: string | null;
  endAt: string | null;
  coverMode: 'latest' | 'photo' | 'design';
  coverEmoji: string | null;
  /** 최신 기록 또는 직접 고른 표지 사진. */
  cover: Moment | null;
  /** 안전 앨범만 값이 있다. */
  photoQuality: PhotoQuality | null;
  sourceAlbumId: string | null;
};

const SYNC_PENDING = "sync_state = CASE sync_state WHEN 'synced' THEN 'pending' ELSE sync_state END";

/** 기본 앨범 + 사용자가 만든 앨범(만든 순서). kind 'cloud'면 안전 사진첩의 기본 보기와 안전 앨범. */
export async function listAlbums(db: SQLiteDatabase, kind: AlbumKind = 'custom'): Promise<AlbumSummary[]> {
  // 데이터가 바뀔 때마다 다시 읽으므로 기록 전체를 읽지 않고 수와 표지만 가져온다.
  const where = kind === 'cloud' ? `m.deleted_at IS NULL AND ${IN_CLOUD}` : 'm.deleted_at IS NULL';
  const total = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM moments m WHERE ${where}`);
  const latest = await db.getFirstAsync<Moment>(
    `SELECT * FROM moments m WHERE ${where} ORDER BY taken_at DESC, created_at DESC LIMIT 1`,
  );
  const totalRange = await db.getFirstAsync<{ start_at: string | null; end_at: string | null }>(
    `SELECT MIN(taken_at) AS start_at, MAX(taken_at) AS end_at FROM moments m WHERE ${where}`,
  );
  const albums = await listCustomAlbums(db, kind);
  // 앨범마다 최근 기록 한 행 + 그 앨범의 기록 수
  const covers = await db.getAllAsync<Moment & { cover_album_id: string; album_count: number; album_start_at: string; album_end_at: string }>(
    `SELECT * FROM (
       SELECT m.*, am.album_id AS cover_album_id,
         ROW_NUMBER() OVER (PARTITION BY am.album_id ORDER BY m.taken_at DESC, m.created_at DESC) AS album_rank,
         COUNT(*) OVER (PARTITION BY am.album_id) AS album_count,
         MIN(m.taken_at) OVER (PARTITION BY am.album_id) AS album_start_at,
         MAX(m.taken_at) OVER (PARTITION BY am.album_id) AS album_end_at
       FROM albums a JOIN album_moments am ON am.album_id = a.id
       JOIN moments m ON m.id = am.moment_id
       WHERE a.kind = ? AND a.deleted_at IS NULL AND am.deleted_at IS NULL AND m.deleted_at IS NULL
     ) WHERE album_rank = 1`,
    kind,
  );
  const selectedCovers = albums.some((album) => album.cover_mode === 'photo')
    ? await db.getAllAsync<Moment & { cover_album_id: string }>(
        `SELECT m.*, a.id AS cover_album_id FROM albums a
         JOIN album_moments am ON am.album_id = a.id AND am.moment_id = a.cover_moment_id AND am.deleted_at IS NULL
         JOIN moments m ON m.id = a.cover_moment_id
         WHERE a.kind = ? AND a.deleted_at IS NULL AND a.cover_mode = 'photo' AND m.deleted_at IS NULL`,
        kind,
      )
    : [];
  const coverOf = new Map(covers.map((cover) => [cover.cover_album_id, cover]));
  const selectedCoverOf = new Map(selectedCovers.map((cover) => [cover.cover_album_id, cover]));
  return [
    {
      id: kind === 'cloud' ? CLOUD_ALL_ALBUM_ID : ALL_ALBUM_ID,
      title: kind === 'cloud' ? CLOUD_ALL_ALBUM_TITLE : ALL_ALBUM_TITLE,
      count: total?.count ?? 0,
      startAt: totalRange?.start_at ?? null,
      endAt: totalRange?.end_at ?? null,
      coverMode: 'latest',
      coverEmoji: null,
      cover: latest,
      photoQuality: null,
      sourceAlbumId: null,
    },
    ...albums.map((album) => {
      const cover = coverOf.get(album.id) ?? null;
      return {
        ...album,
        count: cover?.album_count ?? 0,
        startAt: cover?.album_start_at ?? null,
        endAt: cover?.album_end_at ?? null,
        cover: album.cover_mode === 'photo' ? selectedCoverOf.get(album.id) ?? cover : cover,
        coverMode: album.cover_mode,
        coverEmoji: album.cover_emoji,
        photoQuality: album.photo_quality,
        sourceAlbumId: album.source_album_id,
      };
    }),
  ];
}

type AlbumRow = {
  id: string;
  title: string;
  cover_mode: AlbumSummary['coverMode'];
  cover_emoji: string | null;
  photo_quality: PhotoQuality | null;
  source_album_id: string | null;
};

/** 사용자가 만든 앨범 (만든 순서). 기본은 기기 앨범, kind 'cloud'면 안전 앨범. */
export function listCustomAlbums(db: SQLiteDatabase, kind: AlbumKind = 'custom') {
  return db
    .getAllAsync<AlbumRow>(
      `SELECT id, title, cover_mode, cover_emoji, photo_quality, source_album_id FROM albums
       WHERE deleted_at IS NULL AND kind = ? ORDER BY created_at`,
      kind,
    )
    .catch(async (error: unknown) => {
      // Fast Refresh 중에는 SQLiteProvider가 다시 마운트되지 않아 새 마이그레이션이 아직 실행되지 않을 수 있다.
      // 그때도 목록 화면은 기존 최신 사진 표지로 연다. 다음 전체 새로고침에서 마이그레이션이 적용된다.
      if (!String(error).includes('no such column')) throw error;
      const legacy = await db.getAllAsync<{ id: string; title: string }>(
        'SELECT id, title FROM albums WHERE deleted_at IS NULL AND kind = ? ORDER BY created_at',
        kind,
      );
      return legacy.map(
        (album): AlbumRow => ({ ...album, cover_mode: 'latest', cover_emoji: null, photo_quality: null, source_album_id: null }),
      );
    });
}

export async function setAlbumCover(
  db: SQLiteDatabase,
  id: string,
  cover: { mode: AlbumSummary['coverMode']; momentId?: string | null; emoji?: string | null },
) {
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE albums SET cover_mode = ?, cover_moment_id = ?, cover_emoji = ?,
       updated_at = ${laterThanBefore('?')}, ${SYNC_PENDING} WHERE id = ? AND deleted_at IS NULL`,
    cover.mode,
    cover.mode === 'photo' ? (cover.momentId ?? null) : null,
    cover.mode === 'design' ? (cover.emoji ?? '✨') : null,
    now,
    id,
  );
  notifyChange();
}

/** 앨범 이름. 기본 앨범이거나 없는(지워진) 앨범이면 기본 이름/null. */
export async function getAlbumTitle(db: SQLiteDatabase, id: string) {
  if (id === ALL_ALBUM_ID) return ALL_ALBUM_TITLE;
  if (id === CLOUD_ALL_ALBUM_ID) return CLOUD_ALL_ALBUM_TITLE;
  const row = await db.getFirstAsync<{ title: string }>(
    'SELECT title FROM albums WHERE id = ? AND deleted_at IS NULL',
    id,
  );
  return row?.title ?? null;
}

export type AlbumInfo = {
  id: string;
  title: string;
  kind: AlbumKind;
  photoQuality: PhotoQuality | null;
  /** 연결한 기기 앨범의 이름. 그 앨범이 지워졌으면 null. */
  sourceAlbumTitle: string | null;
  /** 이 기기 앨범을 연결한 안전 앨범 */
  linkedCloudAlbumId: string | null;
};

/** 앨범 화면에 쓰는 정보. 기본 앨범도 돌려주고, 없는(지워진) 앨범이면 null. */
export async function getAlbum(db: SQLiteDatabase, id: string): Promise<AlbumInfo | null> {
  if (isBuiltInAlbum(id)) {
    const cloud = id === CLOUD_ALL_ALBUM_ID;
    return {
      id,
      title: cloud ? CLOUD_ALL_ALBUM_TITLE : ALL_ALBUM_TITLE,
      kind: cloud ? 'cloud' : 'custom',
      photoQuality: null,
      sourceAlbumTitle: null,
      linkedCloudAlbumId: null,
    };
  }
  const row = await db.getFirstAsync<{
    title: string;
    kind: AlbumKind;
    photo_quality: PhotoQuality | null;
    source_title: string | null;
    linked_id: string | null;
  }>(
    `SELECT a.title, a.kind, a.photo_quality,
       (SELECT s.title FROM albums s WHERE s.id = a.source_album_id AND s.deleted_at IS NULL) AS source_title,
       (SELECT c.id FROM albums c WHERE c.source_album_id = a.id AND c.kind = 'cloud' AND c.deleted_at IS NULL
        ORDER BY c.created_at LIMIT 1) AS linked_id
     FROM albums a WHERE a.id = ? AND a.deleted_at IS NULL`,
    id,
  );
  if (!row) return null;
  return {
    id,
    title: row.title,
    kind: row.kind === 'cloud' ? 'cloud' : 'custom',
    photoQuality: row.kind === 'cloud' ? (row.photo_quality ?? 'original') : null,
    sourceAlbumTitle: row.source_title,
    linkedCloudAlbumId: row.linked_id,
  };
}

/** 앨범의 기록. 사진첩과 같은 순서(최근 기록부터). */
export function listAlbumMoments(db: SQLiteDatabase, id: string) {
  if (id === ALL_ALBUM_ID) return listMoments(db);
  if (id === CLOUD_ALL_ALBUM_ID) {
    return db.getAllAsync<Moment>(
      `SELECT * FROM moments m WHERE m.deleted_at IS NULL AND ${IN_CLOUD} ORDER BY m.taken_at DESC, m.created_at DESC`,
    );
  }
  return db.getAllAsync<Moment>(
    `SELECT m.* FROM album_moments am JOIN moments m ON m.id = am.moment_id
     WHERE am.album_id = ? AND am.deleted_at IS NULL AND m.deleted_at IS NULL
     ORDER BY m.taken_at DESC, m.created_at DESC`,
    id,
  );
}

/** 앨범을 만든다. cloud를 주면 안전 앨범이다. */
export async function createAlbum(
  db: SQLiteDatabase,
  title: string,
  cloud?: { quality: PhotoQuality; sourceAlbumId?: string | null },
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO albums (id, kind, title, photo_quality, source_album_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    cloud ? 'cloud' : 'custom',
    title,
    cloud?.quality ?? null,
    cloud?.sourceAlbumId ?? null,
    now,
    now,
  );
  notifyChange();
  return id;
}

/**
 * 기기 앨범을 안전 보관에 연결한다: 같은 이름의 안전 앨범을 만들고 지금 담긴 사진을 모두 담는다.
 * 이후 기기 앨범에 넣는 사진도 따라 담는다 (updateAlbumMoments). 이미 연결했으면 그 안전 앨범을 돌려준다.
 */
export async function connectAlbumToCloud(db: SQLiteDatabase, deviceAlbumId: string, quality: PhotoQuality) {
  const album = await getAlbum(db, deviceAlbumId);
  if (!album || album.kind !== 'custom' || isBuiltInAlbum(deviceAlbumId)) throw new Error('연결할 수 없는 앨범이에요');
  if (album.linkedCloudAlbumId) return album.linkedCloudAlbumId;
  const id = await createAlbum(db, album.title, { quality, sourceAlbumId: deviceAlbumId });
  const cover = await db.getFirstAsync<{ cover_mode: AlbumSummary['coverMode']; cover_moment_id: string | null; cover_emoji: string | null }>(
    'SELECT cover_mode, cover_moment_id, cover_emoji FROM albums WHERE id = ?',
    deviceAlbumId,
  );
  await updateAlbumMoments(db, id, { add: [...(await albumMomentIds(db, deviceAlbumId))] });
  if (cover && cover.cover_mode !== 'latest') {
    await setAlbumCover(db, id, { mode: cover.cover_mode, momentId: cover.cover_moment_id, emoji: cover.cover_emoji });
  }
  return id;
}

/** 안전 사진첩 맨 위 카드에 보여줄 최근 기록 */
export function listRecentCloudMoments(db: SQLiteDatabase, limit: number) {
  return db.getAllAsync<Moment>(
    `SELECT * FROM moments m WHERE m.deleted_at IS NULL AND ${IN_CLOUD}
     ORDER BY m.taken_at DESC, m.created_at DESC LIMIT ?`,
    limit,
  );
}

/** 안전 앨범에 이미 연결된 기기 앨범 ID */
export async function linkedDeviceAlbumIds(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ source_album_id: string }>(
    "SELECT source_album_id FROM albums WHERE kind = 'cloud' AND deleted_at IS NULL AND source_album_id IS NOT NULL",
  );
  return new Set(rows.map((row) => row.source_album_id));
}

/**
 * 안전 앨범마다 아직 올리지 않은 사진 수 (이 기기 사진첩에 원본이 있는 기록만 센다).
 * 표시용이나, 원본을 보관하는 앨범이면 원본 중 하나라도 남았으면 한 장으로 센다.
 */
export async function listCloudAlbumPending(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ album_id: string; pending: number }>(
    `SELECT a.id AS album_id, COUNT(*) AS pending
     FROM albums a JOIN album_moments am ON am.album_id = a.id AND am.deleted_at IS NULL
     JOIN moments m ON m.id = am.moment_id
     WHERE a.kind = 'cloud' AND a.deleted_at IS NULL
       AND m.deleted_at IS NULL AND m.source_asset_id IS NOT NULL AND m.source_missing = 0
       AND (m.display_uploaded = 0 OR (IFNULL(a.photo_quality, 'original') = 'original' AND m.original_uploaded = 0))
     GROUP BY a.id`,
  );
  return new Map(rows.map((row) => [row.album_id, row.pending]));
}

/** 안전 앨범의 보관 화질을 바꾼다. 원본으로 바꾸면 담긴 사진의 원본을 이어서 올린다. */
export async function setAlbumQuality(db: SQLiteDatabase, id: string, quality: PhotoQuality) {
  await db.runAsync(
    `UPDATE albums SET photo_quality = ?, updated_at = ${laterThanBefore('?')}, ${SYNC_PENDING}
     WHERE id = ? AND kind = 'cloud' AND deleted_at IS NULL`,
    quality,
    new Date().toISOString(),
    id,
  );
  notifyChange();
}

export async function renameAlbum(db: SQLiteDatabase, id: string, title: string) {
  await db.runAsync(
    `UPDATE albums SET title = ?, updated_at = ${laterThanBefore('?')}, ${SYNC_PENDING}
     WHERE id = ? AND deleted_at IS NULL`,
    title,
    new Date().toISOString(),
    id,
  );
  notifyChange();
}

/** 앨범만 지운다. 들어 있던 기록은 다른 앨범과 '모든 순간'에 그대로 남는다. */
export async function deleteAlbum(db: SQLiteDatabase, id: string) {
  const now = new Date().toISOString();
  await inTransaction(db, async () => {
    await db.runAsync(
      `UPDATE albums SET deleted_at = ?, updated_at = ${laterThanBefore('?')}, ${SYNC_PENDING} WHERE id = ?`,
      now,
      now,
      id,
    );
    await db.runAsync(
      `UPDATE album_moments SET deleted_at = ?, updated_at = ${laterThanBefore('?')}, ${SYNC_PENDING}
       WHERE album_id = ? AND deleted_at IS NULL`,
      now,
      now,
      id,
    );
  });
  notifyChange();
}

/** 앨범에 들어 있는 기록 ID (기록에서 뺀 것은 세지 않는다) */
export async function albumMomentIds(db: SQLiteDatabase, id: string) {
  const rows = await db.getAllAsync<{ moment_id: string }>(
    `SELECT am.moment_id FROM album_moments am JOIN moments m ON m.id = am.moment_id
     WHERE am.album_id = ? AND am.deleted_at IS NULL AND m.deleted_at IS NULL`,
    id,
  );
  return new Set(rows.map((row) => row.moment_id));
}

/** 이 기록이 들어 있는 (사용자가 만든) 앨범 ID */
export async function momentAlbumIds(db: SQLiteDatabase, momentId: string) {
  const rows = await db.getAllAsync<{ album_id: string }>(
    `SELECT am.album_id FROM album_moments am JOIN albums a ON a.id = am.album_id
     WHERE am.moment_id = ? AND am.deleted_at IS NULL AND a.deleted_at IS NULL`,
    momentId,
  );
  return new Set(rows.map((row) => row.album_id));
}

/** 앨범에 기록을 넣고 뺀다. 이미 그 상태인 것은 건드리지 않는다. */
export async function updateAlbumMoments(
  db: SQLiteDatabase,
  albumId: string,
  change: { add?: string[]; remove?: string[] },
) {
  const add = change.add ?? [];
  const remove = change.remove ?? [];
  if (add.length === 0 && remove.length === 0) return;
  const now = new Date().toISOString();
  await inTransaction(db, async () => {
    const row = await db.getFirstAsync<{ next: number }>(
      'SELECT IFNULL(MAX(position), -1) + 1 AS next FROM album_moments WHERE album_id = ?',
      albumId,
    );
    let position = row?.next ?? 0;
    for (const momentId of add) await insertMember(db, albumId, momentId, position++, now);
    // 이 기기 앨범을 연결한 안전 앨범에도 담는다. 빼는 것은 따라 하지 않는다:
    // 기기 앨범을 정리하다가 안전 보관한 사진이 모르게 빠지지 않게, 안전 앨범에서 직접 뺀다.
    if (add.length > 0) {
      const linked = await db.getAllAsync<{ id: string; next: number }>(
        `SELECT a.id, (SELECT IFNULL(MAX(position), -1) + 1 FROM album_moments WHERE album_id = a.id) AS next
         FROM albums a WHERE a.source_album_id = ? AND a.kind = 'cloud' AND a.deleted_at IS NULL`,
        albumId,
      );
      for (const cloudAlbum of linked) {
        let next = cloudAlbum.next;
        for (const momentId of add) await insertMember(db, cloudAlbum.id, momentId, next++, now);
      }
    }
    for (const momentId of remove) {
      await db.runAsync(
        `UPDATE album_moments SET deleted_at = ?, updated_at = ${laterThanBefore('?')}, ${SYNC_PENDING}
         WHERE album_id = ? AND moment_id = ? AND deleted_at IS NULL`,
        now,
        now,
        albumId,
        momentId,
      );
    }
    // 직접 고른 표지는 반드시 현재 앨범 안의 사진이어야 한다. 표지 사진을 빼면
    // 이전 선택을 남겨 두었다가 나중에 다시 넣었을 때 표지가 몰래 되살아나지 않게
    // 최신 사진 표지로 되돌린다. 제거가 많아도 한 번의 UPDATE로 처리한다.
    if (remove.length > 0) {
      const selectedCover = await db.getFirstAsync<{ cover_moment_id: string | null }>(
        "SELECT cover_moment_id FROM albums WHERE id = ? AND cover_mode = 'photo' AND deleted_at IS NULL",
        albumId,
      );
      if (!selectedCover?.cover_moment_id || !new Set(remove).has(selectedCover.cover_moment_id)) return;
      await db.runAsync(
        `UPDATE albums SET cover_mode = 'latest', cover_moment_id = NULL, cover_emoji = NULL,
           updated_at = ${laterThanBefore('?')}, ${SYNC_PENDING}
         WHERE id = ? AND cover_mode = 'photo' AND cover_moment_id = ?
           AND deleted_at IS NULL`,
        now,
        albumId,
        selectedCover.cover_moment_id,
      );
    }
  });
  notifyChange();
}

/** 앨범에 기록 하나를 넣는다. 이미 들어 있으면 그대로 둔다. */
function insertMember(db: SQLiteDatabase, albumId: string, momentId: string, position: number, now: string) {
  // 뺐다가 다시 넣으면 지운 표시를 되돌린다 (같은 키라 동기화에서도 같은 행이다).
  return db.runAsync(
    `INSERT INTO album_moments (album_id, moment_id, position, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (album_id, moment_id) DO UPDATE SET deleted_at = NULL, position = excluded.position,
       updated_at = ${laterThanBefore('excluded.updated_at')}, ${SYNC_PENDING}
     WHERE deleted_at IS NOT NULL`,
    albumId,
    momentId,
    position,
    now,
  );
}

export type OnThisDay = { yearsAgo: number; moments: Moment[] };

/**
 * 몇 년 전 오늘(같은 월·일, 촬영지 날짜 기준) 남긴 기록. 가까운 해부터.
 * 촬영지 날짜는 UTC 날짜와 하루 차이가 날 수 있어, 앞뒤 하루까지 DB에서 고른 뒤 다시 거른다.
 */
export async function listOnThisDay(db: SQLiteDatabase, today: string): Promise<OnThisDay[]> {
  const [year, month, day] = today.split('-').map(Number);
  const monthDays = [-1, 0, 1].map((delta) => {
    const date = new Date(Date.UTC(2000, month - 1, day + delta));
    return date.toISOString().slice(5, 10);
  });
  const rows = await db.getAllAsync<Moment>(
    `SELECT * FROM moments WHERE deleted_at IS NULL AND substr(taken_at, 6, 5) IN (?, ?, ?)
     ORDER BY taken_at DESC, created_at DESC`,
    monthDays,
  );
  const target = today.slice(5);
  const byYear = new Map<number, Moment[]>();
  for (const moment of rows) {
    const key = localDateKey(moment.taken_at, moment.taken_tz_offset);
    const momentYear = Number(key.slice(0, 4));
    if (key.slice(5) !== target || momentYear >= year) continue;
    byYear.set(momentYear, [...(byYear.get(momentYear) ?? []), moment]);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([momentYear, moments]) => ({ yearsAgo: year - momentYear, moments }));
}
