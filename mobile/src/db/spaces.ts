import { randomUUID } from 'expo-crypto';
import { Directory } from 'expo-file-system';
import {
  defaultDatabaseDirectory,
  deleteDatabaseAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';

import { accountDatabaseName, ACCOUNT_DATABASE_PATTERN, DATABASE_NAME, migrateDb } from '@/db/schema';
import { getSettings, setDeviceDb, setSetting } from '@/db/settings';
import { clearCloudDisplayCache } from '@/lib/storage';

// 기록을 두는 공간은 기기 안의 DB 파일로 나눈다.
// Local(keepsake.db)은 로그인과 무관한 이 기기의 기록이고, 계정 공간(keepsake-account-<id>.db)은 그 계정 Cloud의
// 기기 사본이다. 오프라인에서도 볼 수 있고, 서로 섞이지 않는다.

let local: Promise<SQLiteDatabase> | null = null;

/** Local DB 연결. 계정 공간을 보는 동안에도 기기 설정과 올리기 후보를 읽으려고 따로 열어 둔다. */
export function getLocalDb() {
  local ??= (async () => {
    const db = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
    await migrateDb(db);
    setDeviceDb(db);
    return db;
  })();
  return local;
}

export function isAccountDb(db: SQLiteDatabase, userId: string) {
  return db.databasePath.endsWith(`/${accountDatabaseName(userId)}`);
}

function accountDatabaseFiles() {
  // Android 경로에는 file://가 없다.
  const directory = new Directory(
    defaultDatabaseDirectory.startsWith('file://')
      ? defaultDatabaseDirectory
      : `file://${defaultDatabaseDirectory}`,
  );
  if (!directory.exists) return [];
  return directory
    .list()
    .map((entry) => entry.name)
    .filter((name) => ACCOUNT_DATABASE_PATTERN.test(name));
}

/** 이 기기의 어떤 공간이든 기록이 가리키는 사진 id. 사진 정리가 이 사진들을 지우면 안 된다. */
export async function assetsKeptOnDevice(assetIds: string[]) {
  const localDb = await getLocalDb();
  const kept = await existingAssets(localDb, assetIds);
  const retired = (await getSettings(localDb)).retired_spaces.map(accountDatabaseName);
  for (const name of accountDatabaseFiles()) {
    if (retired.includes(name)) continue;
    const db = await openDatabaseAsync(name, { useNewConnection: true });
    try {
      (await existingAssets(db, assetIds)).forEach((id) => kept.add(id));
    } finally {
      await db.closeAsync();
    }
  }
  return kept;
}

async function existingAssets(db: SQLiteDatabase, assetIds: string[]) {
  const found = new Set<string>();
  for (let i = 0; i < assetIds.length; i += 500) {
    const chunk = assetIds.slice(i, i + 500);
    const rows = await db.getAllAsync<{ source_asset_id: string }>(
      `SELECT source_asset_id FROM moments
       WHERE deleted_at IS NULL AND source_asset_id IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    rows.forEach((row) => found.add(row.source_asset_id));
  }
  return found;
}

/**
 * 계정 공간의 기록 중 이 기기 사진을 가리키는 것을 Local로 옮긴다. Cloud가 지워져도 이 기기의 기록은 남긴다는 약속이다.
 * 같은 사진의 기록이 Local에 이미 있으면 옮기지 않는다. 다른 기기에서 받은 기록은 사진이 없어 옮기지 않는다.
 */
export async function keepLinkedMomentsInLocal(accountDb: SQLiteDatabase) {
  const localDb = await getLocalDb();
  const rows = await accountDb.getAllAsync<Record<string, string | number | null>>(
    `SELECT source_asset_id, source_uri, original_filename, width, height, taken_at, taken_tz_offset,
       lat, lng, place_name, memo, created_at, updated_at
     FROM moments WHERE deleted_at IS NULL AND source_asset_id IS NOT NULL AND source_missing = 0`,
  );
  if (rows.length === 0) return;
  const existing = await existingAssets(localDb, rows.map((row) => String(row.source_asset_id)));
  for (const row of rows) {
    if (existing.has(String(row.source_asset_id))) continue;
    const columns = Object.keys(row);
    await localDb.runAsync(
      `INSERT INTO moments (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
      [randomUUID(), ...columns.map((column) => row[column])],
    );
  }
}

/**
 * 서버 데이터가 지워진 계정 공간을 정리한다. 남길 기록을 옮기고, 파일은 닫힌 뒤 purgeRetiredSpaces가 지운다.
 */
export async function retireAccountSpace(userId: string) {
  const name = accountDatabaseName(userId);
  if (!accountDatabaseFiles().includes(name)) return;
  const localDb = await getLocalDb();
  const { retired_spaces: retired } = await getSettings(localDb);
  if (retired.includes(userId)) return;
  const db = await openDatabaseAsync(name, { useNewConnection: true });
  try {
    await keepLinkedMomentsInLocal(db);
  } finally {
    await db.closeAsync();
  }
  await setSetting(localDb, 'retired_spaces', [...retired, userId]);
  clearCloudDisplayCache();
}

/** 정리하기로 했던 공간을 다시 쓰게 되면(지우기 전에 재구독) 파일을 지우지 않는다. */
export async function keepAccountSpace(userId: string) {
  const localDb = await getLocalDb();
  const { retired_spaces: retired } = await getSettings(localDb);
  if (retired.includes(userId)) {
    await setSetting(localDb, 'retired_spaces', retired.filter((id) => id !== userId));
  }
}

/** 정리하기로 한 계정 공간 파일을 지운다. 아직 열려 있으면 다음 기회에 지운다. */
export async function purgeRetiredSpaces() {
  const localDb = await getLocalDb();
  const { retired_spaces: retired } = await getSettings(localDb);
  const remaining: string[] = [];
  for (const userId of retired) {
    try {
      await deleteDatabaseAsync(accountDatabaseName(userId));
    } catch {
      remaining.push(userId);
    }
  }
  if (remaining.length !== retired.length) await setSetting(localDb, 'retired_spaces', remaining);
}
