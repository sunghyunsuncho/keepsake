import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyChange } from '@/db/changes';
import { dayRange, localDateKey } from '@/lib/dates';

export type SyncState = 'local_only' | 'pending' | 'synced';

export type Moment = {
  id: string;
  source_asset_id: string | null;
  local_original_path: string | null;
  local_display_path: string;
  original_filename: string | null;
  width: number | null;
  height: number | null;
  taken_at: string;
  /** 촬영지 시간대 (UTC 기준 분). null이면 기기 시간대로 보여준다. */
  taken_tz_offset: number | null;
  lat: number | null;
  lng: number | null;
  place_name: string | null;
  memo: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_state: SyncState;
  /** Cloud에 원본/표시용 사진이 올라가 있는지 (0|1) */
  original_uploaded: number;
  display_uploaded: number;
};

export type NewMoment = Pick<
  Moment,
  | 'id'
  | 'source_asset_id'
  | 'local_original_path'
  | 'local_display_path'
  | 'original_filename'
  | 'width'
  | 'height'
  | 'taken_at'
  | 'taken_tz_offset'
  | 'lat'
  | 'lng'
>;

export type MomentEdit = Partial<Pick<Moment, 'memo' | 'place_name' | 'taken_at'>>;

export const MOMENT_COLUMNS = [
  'id',
  'source_asset_id',
  'local_original_path',
  'local_display_path',
  'original_filename',
  'width',
  'height',
  'taken_at',
  'taken_tz_offset',
  'lat',
  'lng',
  'place_name',
  'memo',
  'created_at',
  'updated_at',
  'deleted_at',
  'sync_state',
  'original_uploaded',
  'display_uploaded',
] as const satisfies readonly (keyof Moment)[];

/** 이 기기의 Cloud 동기화 상태. ZIP에는 넣지 않는다 (다른 기기·계정에서는 의미가 없음). */
export const CLOUD_STATE_COLUMNS = ['sync_state', 'original_uploaded', 'display_uploaded'] as const;
export const PORTABLE_MOMENT_COLUMNS = MOMENT_COLUMNS.filter(
  (c): c is Exclude<(typeof MOMENT_COLUMNS)[number], (typeof CLOUD_STATE_COLUMNS)[number]> =>
    !(CLOUD_STATE_COLUMNS as readonly string[]).includes(c),
);

export function listMoments(db: SQLiteDatabase) {
  return db.getAllAsync<Moment>(
    'SELECT * FROM moments WHERE deleted_at IS NULL ORDER BY taken_at DESC, created_at DESC',
  );
}

export function getMoment(db: SQLiteDatabase, id: string) {
  return db.getFirstAsync<Moment>('SELECT * FROM moments WHERE id = ? AND deleted_at IS NULL', id);
}

/** 날짜 화면에서 이미 고른 사진을 표시하기 위해 원본 asset ID → moment ID를 돌려준다. */
export async function momentIdsByAsset(db: SQLiteDatabase, assetIds: string[]) {
  const result = new Map<string, string>();
  // SQLite 바인딩 변수 한도(기본 32766)보다 충분히 작게 나눈다.
  for (let i = 0; i < assetIds.length; i += 500) {
    const chunk = assetIds.slice(i, i + 500);
    const rows = await db.getAllAsync<{ id: string; source_asset_id: string }>(
      `SELECT id, source_asset_id FROM moments
       WHERE deleted_at IS NULL AND source_asset_id IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    rows.forEach((row) => result.set(row.source_asset_id, row.id));
  }
  return result;
}

/**
 * 여러 쓰기를 한 트랜잭션으로 묶는다.
 * withExclusiveTransactionAsync는 별도 연결을 열어서, 그동안 기본 연결의 쓰기(장소 채우기, 메모 자동 저장)가
 * "database is locked"로 실패할 수 있다. 그래서 기본 연결에서 트랜잭션을 쓰고, BEGIN이 겹치지 않게
 * 이 함수로 들어오는 트랜잭션을 하나씩 차례로 실행한다.
 */
let transactionQueue: Promise<unknown> = Promise.resolve();
function inTransaction(db: SQLiteDatabase, task: () => Promise<void>) {
  const run = transactionQueue.then(() => db.withTransactionAsync(task));
  transactionQueue = run.catch(() => {});
  return run;
}

/** 이 사진(보관함 asset)으로 이미 남긴 기록 ID. 같은 사진이 두 번 남지 않게 확인한다. */
export async function findMomentByAsset(db: SQLiteDatabase, assetId: string) {
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM moments WHERE source_asset_id = ? AND deleted_at IS NULL',
    assetId,
  );
  return row?.id ?? null;
}

/** 아직 지워지지 않은 기록 ID만 돌려준다 (방금 남긴 사진 목록에서 그 사이 지운 기록을 빼기 위해). */
export async function activeMomentIds(db: SQLiteDatabase, ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM moments WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  return new Set(rows.map((row) => row.id));
}

export async function insertMoment(db: SQLiteDatabase, moment: NewMoment, reviewDate: string) {
  const now = new Date().toISOString();
  await inTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO moments (id, source_asset_id, local_original_path, local_display_path,
         original_filename, width, height, taken_at, taken_tz_offset, lat, lng,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      moment.id,
      moment.source_asset_id,
      moment.local_original_path,
      moment.local_display_path,
      moment.original_filename,
      moment.width,
      moment.height,
      moment.taken_at,
      moment.taken_tz_offset,
      moment.lat,
      moment.lng,
      now,
      now,
    );
    await recordReview(db, reviewDate, now);
  });
  notifyChange();
}

/**
 * 고친 시각(SQL 식). 이 기기 시계가 다른 기기보다 조금 늦어도, 방금 받은 값을 고치면 이전 updated_at보다
 * 뒤가 되게 한다. 그래야 서버와 다른 기기가 'updated_at이 큰 쪽이 이긴다' 규칙으로 이 수정을 받아들인다.
 * value는 새 시각을 나타내는 SQL 식(`?`, `excluded.updated_at`)이고 한 번만 들어간다.
 */
function laterThanBefore(value: string) {
  // 이전 값을 읽지 못하면(형식이 깨진 경우) ''가 되어 새 시각을 그대로 쓴다.
  return `MAX(${value}, IFNULL(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds'), ''))`;
}

/**
 * 지워진 기록은 고치지 않는다. 상세 화면을 떠날 때 남은 입력을 저장하는데, 그 사이 기록이 지워졌다면
 * updated_at만 올라가 ZIP 병합에서 이 삭제 기록이 더 최신으로 취급될 수 있다.
 */
export async function updateMoment(db: SQLiteDatabase, id: string, edit: MomentEdit) {
  const entries = Object.entries(edit).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE moments SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ${laterThanBefore('?')},
       sync_state = CASE sync_state WHEN 'synced' THEN 'pending' ELSE sync_state END
     WHERE id = ? AND deleted_at IS NULL`,
    [...entries.map(([, value]) => value as string | null), now, id],
  );
  notifyChange();
}

/**
 * 사진 좌표로 찾은 장소 이름과 시간대를 채운다. 사용자가 이미 입력했거나 EXIF로 정해진 값은
 * 덮어쓰지 않는다 (지오코딩은 기록을 만든 뒤 따로 돌기 때문에 그 사이 사용자가 고칠 수 있다).
 */
export async function fillPlaceIfEmpty(
  db: SQLiteDatabase,
  id: string,
  placeName: string,
  tzOffset: number | null,
) {
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `UPDATE moments SET
       place_name = COALESCE(place_name, ?),
       taken_tz_offset = COALESCE(taken_tz_offset, ?),
       updated_at = ${laterThanBefore('?')},
       sync_state = CASE sync_state WHEN 'synced' THEN 'pending' ELSE sync_state END
     WHERE id = ? AND deleted_at IS NULL
       AND (place_name IS NULL OR (taken_tz_offset IS NULL AND ? IS NOT NULL))`,
    placeName,
    tzOffset,
    now,
    id,
    tzOffset,
  );
  if (result.changes > 0) notifyChange();
}

/** 소프트 삭제. 나중에 동기화할 때 삭제 사실을 서버에 전달하기 위해 행은 남긴다. */
export async function softDeleteMoment(db: SQLiteDatabase, id: string, reviewDate?: string) {
  const now = new Date().toISOString();
  await inTransaction(db, async () => {
    await db.runAsync(
      `UPDATE moments SET deleted_at = ?, updated_at = ${laterThanBefore('?')}, local_original_path = NULL,
         sync_state = CASE sync_state WHEN 'synced' THEN 'pending' ELSE sync_state END
       WHERE id = ?`,
      now,
      now,
      id,
    );
    if (reviewDate) await recordReview(db, reviewDate, now);
  });
  notifyChange();
}

// 고르기 화면에서 그날 사진을 고를 때마다 그날의 선택 기록을 갱신한다.
async function recordReview(db: SQLiteDatabase, date: string, now: string) {
  const { start, end } = dayRange(date);
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM moments
     WHERE deleted_at IS NULL AND taken_at >= ? AND taken_at < ?`,
    start.toISOString(),
    end.toISOString(),
  );
  await db.runAsync(
    `INSERT INTO review_sessions (id, date, reviewed_at, selected_count, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET reviewed_at = excluded.reviewed_at,
       selected_count = excluded.selected_count, updated_at = ${laterThanBefore('excluded.updated_at')},
       sync_state = CASE sync_state WHEN 'synced' THEN 'pending' ELSE sync_state END`,
    randomUUID(),
    date,
    now,
    row?.count ?? 0,
    now,
  );
}

export type LibraryStats = { count: number; days: number };

export async function libraryStats(db: SQLiteDatabase): Promise<LibraryStats> {
  const rows = await db.getAllAsync<{ taken_at: string; taken_tz_offset: number | null }>(
    'SELECT taken_at, taken_tz_offset FROM moments WHERE deleted_at IS NULL',
  );
  // 사진첩과 같은 기준(촬영지 날짜)으로 센다.
  const days = new Set(rows.map((r) => localDateKey(r.taken_at, r.taken_tz_offset)));
  return { count: rows.length, days: days.size };
}
