import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';

import type { components } from '@/api/schema';
import { notifyChange } from '@/db/changes';
import { inTransaction, SYNCED_MOMENT_COLUMNS, type Moment } from '@/db/moments';
import { getSettings, setSetting } from '@/db/settings';
import { keepLinkedMomentsInLocal } from '@/db/spaces';
import { cloudApi, unwrap } from '@/lib/cloud/session';

// 기기 ↔ 서버 동기화 (docs/PLAN.md §3.2). updated_at 최신 우선, 삭제는 deleted_at.
// sync_state: local_only(서버에 없음) → pending(서버에 있지만 고침) → synced.

type SyncMoment = components['schemas']['SyncMoment'];
type SyncRecordRow = components['schemas']['SyncRecordRow'];
type RecordKind = SyncRecordRow['kind'];
type Row = Record<string, SQLiteBindValue>;

const PUSH_BATCH = 200;

// moments 외에 동기화하는 테이블. 컬럼 이름은 서버 값이 아니라 여기 고정된 목록에서만 가져온다 (SQL에 그대로 들어가므로).
const RECORD_TABLES = {
  albums: {
    keys: ['id'],
    columns: ['id', 'kind', 'title', 'start_date', 'end_date', 'created_at', 'updated_at', 'deleted_at'],
  },
  album_moments: {
    keys: ['album_id', 'moment_id'],
    columns: ['album_id', 'moment_id', 'position', 'updated_at', 'deleted_at'],
  },
  review_sessions: {
    keys: ['date'],
    columns: ['id', 'date', 'reviewed_at', 'selected_count', 'updated_at', 'deleted_at'],
  },
} as const;
const RECORD_KINDS = Object.keys(RECORD_TABLES) as RecordKind[];

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
            data: Object.fromEntries(SYNCED_MOMENT_COLUMNS.map((c) => [c, m[c]])),
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
    await inTransaction(db, async () => {
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
    });
    pushed += moments.length + records.length;
  }
}

/** 다른 기기에서 바뀐 기록을 받아 합친다. 받은 기록 수를 돌려준다. */
export async function pullChanges(db: SQLiteDatabase) {
  let cursor = (await getSettings(db)).cloud_pull_cursor;
  let pulled = 0;
  for (;;) {
    const page = unwrap(await cloudApi.GET('/sync/pull', { params: { query: { cursor } } }));
    await inTransaction(db, async () => {
      for (const remote of page.moments) await mergeMoment(db, withDeviceTimes(remote));
      for (const remote of page.records) await mergeRecord(db, withDeviceTimes(remote));
      // 다른 기기가 올려서 이미 Cloud에 있는 사진은 이 기기의 재시도 기록이 필요 없다.
      await db.runAsync(
        `DELETE FROM upload_queue WHERE EXISTS (
           SELECT 1 FROM moments m WHERE m.id = upload_queue.moment_id
             AND (CASE upload_queue.variant WHEN 'display' THEN m.display_uploaded ELSE m.original_uploaded END) = 1
         )`,
      );
    });
    pulled += page.moments.length + page.records.length;
    // 받은 것이 없으면 저장하지 않는다. 저장하면 변경 알림으로 화면이 모두 다시 읽는다.
    if (page.cursor !== cursor) {
      cursor = page.cursor;
      await setSetting(db, 'cloud_pull_cursor', cursor);
    }
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

/**
 * 서버 기록을 합친다. 기기 전용 값(사진첩 연결)은 서버에 없으므로 이 기기 값을 그대로 둔다.
 * 다른 기기에서 남긴 기록은 사진첩 연결 없이 들어오고, 사진은 Cloud에서 받아 보여준다.
 */
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
    return;
  }
  const data = remote.data as Record<string, unknown>;
  const values: Record<string, unknown> = {
    ...Object.fromEntries(SYNCED_MOMENT_COLUMNS.map((c) => [c, data[c] ?? null])),
    id: remote.id,
    memo: typeof data.memo === 'string' ? data.memo : '',
    updated_at: remote.updated_at,
    deleted_at: remote.deleted_at ?? null,
    created_at: data.created_at ?? remote.updated_at,
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

/** 서버 데이터가 지워진 계정 공간을 비운다. 이 기기 사진의 기록은 먼저 Local로 옮겨 둔다. */
export async function resetAccountSpace(db: SQLiteDatabase) {
  await keepLinkedMomentsInLocal(db);
  await inTransaction(db, async () => {
    for (const table of ['moments', ...RECORD_KINDS, 'upload_queue', 'local_imports']) {
      await db.runAsync(`DELETE FROM ${table}`);
    }
  });
  await setSetting(db, 'cloud_pull_cursor', 0);
  await setSetting(db, 'cloud_links_restored', false);
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
