import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';

import type { components } from '@/api/schema';
import { notifyChange } from '@/db/changes';
import { PORTABLE_MOMENT_COLUMNS, type Moment } from '@/db/moments';
import { getSettings, setSetting } from '@/db/settings';
import { RECORD_TABLES } from '@/lib/archive';
import { cloudApi, unwrap } from '@/lib/cloud/session';
import { deletePhotoDir, photoDirPath } from '@/lib/storage';

// 기기 ↔ 서버 동기화 (docs/PLAN.md §3.2). 규칙은 ZIP 가져오기와 같다: updated_at 최신 우선, 삭제는 deleted_at.
// sync_state: local_only(서버에 없음) → pending(서버에 있지만 고침) → synced.

type SyncMoment = components['schemas']['SyncMoment'];
type SyncRecordRow = components['schemas']['SyncRecordRow'];
type RecordKind = SyncRecordRow['kind'];
type Row = Record<string, SQLiteBindValue>;

const PUSH_BATCH = 200;
const RECORD_KINDS = Object.keys(RECORD_TABLES) as RecordKind[];

// 사진 파일 경로는 기기마다 다르므로 서버 값을 쓰지 않는다 (서버도 저장하지 않는다).
const REMOTE_MOMENT_COLUMNS = PORTABLE_MOMENT_COLUMNS.filter(
  (c) => c !== 'local_display_path' && c !== 'local_original_path',
);

/** 서버 행 ID. album_moments는 복합 키라 "album_id:moment_id"로 보낸다. */
function recordId(kind: RecordKind, row: Row) {
  return RECORD_TABLES[kind].keys.map((key) => String(row[key])).join(':');
}

/** 이 기기에서 바뀐 기록을 서버로 보낸다. 서버에 더 최신 값이 있으면 다음 pull에서 받는다. */
export async function pushChanges(db: SQLiteDatabase) {
  let pushed = 0;
  for (;;) {
    const moments = await db.getAllAsync<Moment>(
      `SELECT * FROM moments WHERE sync_state != 'synced' ORDER BY updated_at LIMIT ${PUSH_BATCH}`,
    );
    const records: { kind: RecordKind; row: Row }[] = [];
    for (const kind of RECORD_KINDS) {
      if (moments.length + records.length >= PUSH_BATCH) break;
      const rows = await db.getAllAsync<Row>(
        `SELECT * FROM ${kind} WHERE sync_state != 'synced' LIMIT ${PUSH_BATCH - moments.length - records.length}`,
      );
      rows.forEach((row) => records.push({ kind, row }));
    }
    if (moments.length === 0 && records.length === 0) return pushed;

    unwrap(
      await cloudApi.POST('/sync/push', {
        body: {
          moments: moments.map((m) => ({
            id: m.id,
            updated_at: m.updated_at,
            deleted_at: m.deleted_at,
            data: Object.fromEntries(PORTABLE_MOMENT_COLUMNS.map((c) => [c, m[c]])),
          })),
          records: records.map(({ kind, row }) => ({
            kind,
            id: recordId(kind, row),
            updated_at: String(row.updated_at),
            deleted_at: (row.deleted_at as string | null) ?? null,
            data: Object.fromEntries(RECORD_TABLES[kind].columns.map((c) => [c, row[c] ?? null])),
          })),
        },
      }),
    );

    // 보내는 동안 다시 고친 행(updated_at이 바뀜)은 다음 번에 다시 보낸다.
    for (const m of moments) {
      await db.runAsync(
        "UPDATE moments SET sync_state = 'synced' WHERE id = ? AND updated_at = ?",
        m.id,
        m.updated_at,
      );
    }
    for (const { kind, row } of records) {
      const { keys } = RECORD_TABLES[kind];
      await db.runAsync(
        `UPDATE ${kind} SET sync_state = 'synced'
         WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')} AND updated_at = ?`,
        [...keys.map((k) => row[k]), row.updated_at],
      );
    }
    pushed += moments.length + records.length;
  }
}

/** 다른 기기에서 바뀐 기록을 받아 합친다. 받은 기록 수를 돌려준다. */
export async function pullChanges(db: SQLiteDatabase) {
  let cursor = (await getSettings(db)).cloud_pull_cursor;
  let pulled = 0;
  for (;;) {
    const page = unwrap(await cloudApi.GET('/sync/pull', { params: { query: { cursor } } }));
    const removed: string[] = [];
    await db.withTransactionAsync(async () => {
      for (const remote of page.moments) {
        if (await mergeMoment(db, withDeviceTimes(remote))) removed.push(remote.id);
      }
      for (const remote of page.records) await mergeRecord(db, withDeviceTimes(remote));
      // 다른 기기가 올려서 이미 Cloud에 있는 사진은 이 기기의 재시도 기록이 필요 없다.
      await db.runAsync(
        `DELETE FROM upload_queue WHERE EXISTS (
           SELECT 1 FROM moments m WHERE m.id = upload_queue.moment_id
             AND (CASE upload_queue.variant WHEN 'display' THEN m.display_uploaded ELSE m.original_uploaded END) = 1
         )`,
      );
    });
    // 다른 기기에서 지운 기록의 사진 파일은 DB 반영 후에 지운다.
    removed.forEach(deletePhotoDir);
    cursor = page.cursor;
    pulled += page.moments.length + page.records.length;
    await setSetting(db, 'cloud_pull_cursor', cursor);
    if (!page.has_more) break;
  }
  if (pulled > 0) notifyChange();
  return pulled;
}

/**
 * 서버는 시각을 마이크로초까지 돌려준다(…56.128000Z). 기기는 updated_at을 문자열로 비교하므로
 * 기기가 쓰는 형식(toISOString, …56.128Z)으로 맞춘다.
 */
function withDeviceTimes<T extends { updated_at: string; deleted_at?: string | null }>(row: T): T {
  return {
    ...row,
    updated_at: new Date(row.updated_at).toISOString(),
    deleted_at: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  };
}

/** 서버 기록을 합친다. 이번에 지워진 기록이면 true. */
async function mergeMoment(db: SQLiteDatabase, remote: SyncMoment) {
  const local = await db.getFirstAsync<Moment>('SELECT * FROM moments WHERE id = ?', remote.id);
  const stored = remote.stored_variants ?? [];
  const displayUploaded = stored.includes('display') ? 1 : 0;
  const originalUploaded = stored.includes('original') ? 1 : 0;
  if (local && local.updated_at >= remote.updated_at) {
    // 내용은 이 기기 쪽이 같거나 최신이다. 사진이 Cloud에 올라갔는지만 반영한다.
    await db.runAsync(
      'UPDATE moments SET display_uploaded = ?, original_uploaded = ? WHERE id = ?',
      displayUploaded,
      originalUploaded,
      remote.id,
    );
    return false;
  }
  const data = remote.data as Record<string, unknown>;
  const values: Record<string, unknown> = {
    ...Object.fromEntries(REMOTE_MOMENT_COLUMNS.map((c) => [c, data[c] ?? null])),
    id: remote.id,
    memo: typeof data.memo === 'string' ? data.memo : '',
    updated_at: remote.updated_at,
    deleted_at: remote.deleted_at ?? null,
    created_at: data.created_at ?? remote.updated_at,
    // 표시용 사진은 항상 이 경로에 둔다. 파일이 아직 없으면 사진 받기(photos.ts)가 채운다.
    local_display_path: `${photoDirPath(remote.id)}/display.jpg`,
    local_original_path: remote.deleted_at ? null : (local?.local_original_path ?? null),
    sync_state: 'synced',
    display_uploaded: displayUploaded,
    original_uploaded: originalUploaded,
  };
  const columns = Object.keys(values);
  await db.runAsync(
    `INSERT INTO moments (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${columns
       .filter((c) => c !== 'id')
       .map((c) => `${c} = excluded.${c}`)
       .join(', ')}`,
    columns.map((c) => values[c] as SQLiteBindValue),
  );
  return remote.deleted_at != null && local?.deleted_at == null;
}

async function mergeRecord(db: SQLiteDatabase, remote: SyncRecordRow) {
  const { keys, columns } = RECORD_TABLES[remote.kind];
  const data: Row = {
    ...(remote.data as Row),
    updated_at: remote.updated_at,
    deleted_at: remote.deleted_at ?? null,
  };
  const existing = await db.getFirstAsync<{ updated_at: string }>(
    `SELECT updated_at FROM ${remote.kind} WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}`,
    keys.map((k) => data[k] ?? null),
  );
  if (existing && existing.updated_at >= remote.updated_at) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO ${remote.kind} (${columns.join(', ')}, sync_state)
     VALUES (${columns.map(() => '?').join(', ')}, 'synced')`,
    columns.map((c) => data[c] ?? null),
  );
}

/** 로그아웃·계정 삭제 후: 이 기기의 기록을 다시 'Cloud에 없음'으로 돌린다. 기록과 사진은 그대로 둔다. */
export async function resetCloudState(db: SQLiteDatabase) {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "UPDATE moments SET sync_state = 'local_only', display_uploaded = 0, original_uploaded = 0",
    );
    for (const kind of RECORD_KINDS) {
      await db.runAsync(`UPDATE ${kind} SET sync_state = 'local_only'`);
    }
    await db.runAsync('DELETE FROM upload_queue');
  });
  await setSetting(db, 'cloud_pull_cursor', 0);
  await setSetting(db, 'cloud_account_key', null);
}

/** 서버에 보낼 변경이 있는지. 데이터가 바뀔 때마다 네트워크를 쓰지 않으려고 먼저 확인한다. */
export async function hasLocalChanges(db: SQLiteDatabase) {
  const tables = ['moments', ...RECORD_KINDS];
  for (const table of tables) {
    const row = await db.getFirstAsync(`SELECT 1 FROM ${table} WHERE sync_state != 'synced' LIMIT 1`);
    if (row) return true;
  }
  return false;
}
