import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyChange } from '@/db/changes';
import { inTransaction, laterThanBefore, listMoments, type Moment } from '@/db/moments';
import { localDateKey } from '@/lib/dates';

// 사진첩 탭의 앨범. 기본 앨범('모든 순간')은 행이 없고 남긴 기록 전체를 보여준다.
// 사용자가 만든 앨범은 albums 행(kind 'custom')이고, album_moments가 기록을 가리키기만 한다.
// 한 기록이 여러 앨범에 들어가도 사진·기록은 하나다.

export const ALL_ALBUM_ID = 'all';
export const ALL_ALBUM_TITLE = '나의 순간들';
export const ALBUM_TITLE_MAX = 40;

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
};

const SYNC_PENDING = "sync_state = CASE sync_state WHEN 'synced' THEN 'pending' ELSE sync_state END";

/** 기본 앨범 + 사용자가 만든 앨범(만든 순서). */
export async function listAlbums(db: SQLiteDatabase): Promise<AlbumSummary[]> {
  // 데이터가 바뀔 때마다 다시 읽으므로 기록 전체를 읽지 않고 수와 표지만 가져온다.
  const total = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM moments WHERE deleted_at IS NULL',
  );
  const latest = await db.getFirstAsync<Moment>(
    'SELECT * FROM moments WHERE deleted_at IS NULL ORDER BY taken_at DESC, created_at DESC LIMIT 1',
  );
  const totalRange = await db.getFirstAsync<{ start_at: string | null; end_at: string | null }>(
    'SELECT MIN(taken_at) AS start_at, MAX(taken_at) AS end_at FROM moments WHERE deleted_at IS NULL',
  );
  const albums = await listCustomAlbums(db);
  // 앨범마다 최근 기록 한 행 + 그 앨범의 기록 수
  const covers = await db.getAllAsync<Moment & { cover_album_id: string; album_count: number; album_start_at: string; album_end_at: string }>(
    `SELECT * FROM (
       SELECT m.*, am.album_id AS cover_album_id,
         ROW_NUMBER() OVER (PARTITION BY am.album_id ORDER BY m.taken_at DESC, m.created_at DESC) AS album_rank,
         COUNT(*) OVER (PARTITION BY am.album_id) AS album_count,
         MIN(m.taken_at) OVER (PARTITION BY am.album_id) AS album_start_at,
         MAX(m.taken_at) OVER (PARTITION BY am.album_id) AS album_end_at
       FROM album_moments am JOIN moments m ON m.id = am.moment_id
       WHERE am.deleted_at IS NULL AND m.deleted_at IS NULL
     ) WHERE album_rank = 1`,
  );
  const selectedCovers = albums.some((album) => album.cover_mode === 'photo')
    ? await db.getAllAsync<Moment & { cover_album_id: string }>(
        `SELECT m.*, a.id AS cover_album_id FROM albums a
         JOIN album_moments am ON am.album_id = a.id AND am.moment_id = a.cover_moment_id AND am.deleted_at IS NULL
         JOIN moments m ON m.id = a.cover_moment_id
         WHERE a.deleted_at IS NULL AND a.cover_mode = 'photo' AND m.deleted_at IS NULL`,
      )
    : [];
  const coverOf = new Map(covers.map((cover) => [cover.cover_album_id, cover]));
  const selectedCoverOf = new Map(selectedCovers.map((cover) => [cover.cover_album_id, cover]));
  return [
    {
      id: ALL_ALBUM_ID,
      title: ALL_ALBUM_TITLE,
      count: total?.count ?? 0,
      startAt: totalRange?.start_at ?? null,
      endAt: totalRange?.end_at ?? null,
      coverMode: 'latest',
      coverEmoji: null,
      cover: latest,
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
      };
    }),
  ];
}

/** 사용자가 만든 앨범 (만든 순서). */
export function listCustomAlbums(db: SQLiteDatabase) {
  return db
    .getAllAsync<{ id: string; title: string; cover_mode: AlbumSummary['coverMode']; cover_emoji: string | null }>(
      "SELECT id, title, cover_mode, cover_emoji FROM albums WHERE deleted_at IS NULL AND kind = 'custom' ORDER BY created_at",
    )
    .catch(async (error: unknown) => {
      // Fast Refresh 중에는 SQLiteProvider가 다시 마운트되지 않아 새 마이그레이션이 아직 실행되지 않을 수 있다.
      // 그때도 목록 화면은 기존 최신 사진 표지로 연다. 다음 전체 새로고침에서 마이그레이션이 적용된다.
      if (!String(error).includes('no such column')) throw error;
      const legacy = await db.getAllAsync<{ id: string; title: string }>(
        "SELECT id, title FROM albums WHERE deleted_at IS NULL AND kind = 'custom' ORDER BY created_at",
      );
      return legacy.map((album) => ({ ...album, cover_mode: 'latest' as const, cover_emoji: null }));
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
  const row = await db.getFirstAsync<{ title: string }>(
    'SELECT title FROM albums WHERE id = ? AND deleted_at IS NULL',
    id,
  );
  return row?.title ?? null;
}

/** 앨범의 기록. 사진첩과 같은 순서(최근 기록부터). */
export function listAlbumMoments(db: SQLiteDatabase, id: string) {
  if (id === ALL_ALBUM_ID) return listMoments(db);
  return db.getAllAsync<Moment>(
    `SELECT m.* FROM album_moments am JOIN moments m ON m.id = am.moment_id
     WHERE am.album_id = ? AND am.deleted_at IS NULL AND m.deleted_at IS NULL
     ORDER BY m.taken_at DESC, m.created_at DESC`,
    id,
  );
}

export async function createAlbum(db: SQLiteDatabase, title: string) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO albums (id, kind, title, created_at, updated_at) VALUES (?, 'custom', ?, ?, ?)`,
    id,
    title,
    now,
    now,
  );
  notifyChange();
  return id;
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
    for (const momentId of add) {
      // 뺐다가 다시 넣으면 지운 표시를 되돌린다 (같은 키라 동기화에서도 같은 행이다).
      await db.runAsync(
        `INSERT INTO album_moments (album_id, moment_id, position, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (album_id, moment_id) DO UPDATE SET deleted_at = NULL, position = excluded.position,
           updated_at = ${laterThanBefore('excluded.updated_at')}, ${SYNC_PENDING}
         WHERE deleted_at IS NOT NULL`,
        albumId,
        momentId,
        position++,
        now,
      );
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
