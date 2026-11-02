import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyChange } from '@/db/changes';
import { inTransaction, type Moment } from '@/db/moments';
import { getLocalDb } from '@/db/spaces';

// Local 기록을 계정 Cloud로 복사한다. Local 기록은 그대로 남고, 복사한 뒤에는 서로 따로 고쳐진다.
// 어떤 Local 기록을 물어봤는지는 계정 공간(local_imports)에 둔다. 그래서 계정마다 따로 묻는다.

type Decision = 'uploaded' | 'skipped';

/** 올릴 수 있는 Local 기록. skipped: 전에 [나중에]를 고른 기록도 함께 보여줄지. 원본이 없는 기록은 올릴 사진이 없어 뺀다. */
export async function listImportable(accountDb: SQLiteDatabase, options: { skipped: boolean }) {
  const localDb = await getLocalDb();
  const moments = await localDb.getAllAsync<Moment>(
    `SELECT * FROM moments WHERE deleted_at IS NULL AND source_asset_id IS NOT NULL AND source_missing = 0
     ORDER BY taken_at DESC`,
  );
  const decided = await accountDb.getAllAsync<{ local_moment_id: string; decision: Decision }>(
    'SELECT local_moment_id, decision FROM local_imports',
  );
  const hidden = new Set(
    decided.filter((row) => !options.skipped || row.decision === 'uploaded').map((row) => row.local_moment_id),
  );
  return moments.filter((moment) => !hidden.has(moment.id));
}

/** 고른 기록을 계정 공간에 새 기록으로 복사하고, 나머지는 [나중에]로 기억한다. */
export async function importMoments(accountDb: SQLiteDatabase, selected: Moment[], skipped: Moment[]) {
  const now = new Date().toISOString();
  await inTransaction(accountDb, async () => {
    for (const moment of selected) {
      // 이 계정에 같은 사진의 기록이 이미 있으면 또 올리지 않는다.
      const existing = await accountDb.getFirstAsync(
        'SELECT 1 FROM moments WHERE source_asset_id = ? AND deleted_at IS NULL',
        moment.source_asset_id,
      );
      if (!existing) {
        await accountDb.runAsync(
          `INSERT INTO moments (id, source_asset_id, source_uri, original_filename, width, height,
             taken_at, taken_tz_offset, lat, lng, place_name, memo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          randomUUID(),
          moment.source_asset_id,
          moment.source_uri,
          moment.original_filename,
          moment.width,
          moment.height,
          moment.taken_at,
          moment.taken_tz_offset,
          moment.lat,
          moment.lng,
          moment.place_name,
          moment.memo,
          moment.created_at,
          now,
        );
      }
      await saveDecision(accountDb, moment.id, 'uploaded', now);
    }
    for (const moment of skipped) await saveDecision(accountDb, moment.id, 'skipped', now);
  });
  notifyChange();
}

function saveDecision(db: SQLiteDatabase, id: string, decision: Decision, now: string) {
  return db.runAsync(
    `INSERT INTO local_imports (local_moment_id, decision, decided_at) VALUES (?, ?, ?)
     ON CONFLICT (local_moment_id) DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at`,
    id,
    decision,
    now,
  );
}
