import { randomUUID } from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import {
  defaultDatabaseDirectory,
  deleteDatabaseAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';

import { accountDatabaseName, ACCOUNT_DATABASE_PATTERN, DATABASE_NAME, migrateDb } from '@/db/schema';
import { inTransaction } from '@/db/moments';
import { getSettings, setDeviceDb, setSetting } from '@/db/settings';
import { clearCloudDisplayCache } from '@/lib/storage';

// 기록을 두는 공간은 기기 안의 DB 파일로 나눈다.
// Local(keepsake.db)은 로그인과 무관한 이 기기의 기록이고, 계정 공간(keepsake-account-<id>.db)은 그 계정 Cloud의
// 기기 사본이다. 오프라인에서도 볼 수 있고, 서로 섞이지 않는다.

const MOVE_BATCH = 100;

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

function databaseDirectory() {
  // Android 경로에는 file://가 없다.
  return new Directory(
    defaultDatabaseDirectory.startsWith('file://')
      ? defaultDatabaseDirectory
      : `file://${defaultDatabaseDirectory}`,
  );
}

/** 연결을 닫지 않고 끝나면 WAL 파일이 남는다. 최근 메모가 들어 있을 수 있어 함께 지운다. */
function deleteWalFiles(name: string) {
  for (const suffix of ['-wal', '-shm']) {
    const file = new File(databaseDirectory(), `${name}${suffix}`);
    if (file.exists) file.delete();
  }
}

function accountDatabaseFiles() {
  const directory = databaseDirectory();
  if (!directory.exists) return [];
  return directory
    .list()
    .map((entry) => entry.name)
    .filter((name) => ACCOUNT_DATABASE_PATTERN.test(name));
}

/**
 * 이 기기의 어떤 공간이든 기록으로 남긴 사진 id. 사진 정리가 이 사진들을 지우면 안 된다.
 * 다른 기기에서 받은 기록은 이 기기 사진과 연결돼 있지 않아도 iCloud로 같은 사진일 수 있어 파일 이름으로도 찾는다.
 * 이름만 같은 다른 사진이 빠져도 지우자고 권하지 않을 뿐이라 시각까지 맞춰 보지 않는다.
 */
export async function assetsKeptOnDevice(assets: { id: string; filename: string }[]) {
  const localDb = await getLocalDb();
  const kept = await keptIn(localDb, assets);
  const retired = (await getSettings(localDb)).retired_spaces.map(accountDatabaseName);
  for (const name of accountDatabaseFiles()) {
    if (retired.includes(name)) continue;
    const db = await openDatabaseAsync(name, { useNewConnection: true });
    try {
      (await keptIn(db, assets)).forEach((id) => kept.add(id));
    } finally {
      await db.closeAsync();
    }
  }
  return kept;
}

async function keptIn(db: SQLiteDatabase, assets: { id: string; filename: string }[]) {
  const kept = await existingAssets(db, assets.map((asset) => asset.id));
  const names = new Set<string>();
  for (let i = 0; i < assets.length; i += 500) {
    const chunk = assets.slice(i, i + 500).map((asset) => asset.filename);
    const rows = await db.getAllAsync<{ original_filename: string }>(
      `SELECT original_filename FROM moments
       WHERE deleted_at IS NULL AND original_filename IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    rows.forEach((row) => names.add(row.original_filename));
  }
  assets.forEach((asset) => {
    if (names.has(asset.filename)) kept.add(asset.id);
  });
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
 * 사진을 찾지 못한 기록도 옮긴다. 메모와 장소는 사진이 없어도 남겨야 한다.
 */
export async function keepLinkedMomentsInLocal(accountDb: SQLiteDatabase) {
  const localDb = await getLocalDb();
  const rows = await accountDb.getAllAsync<Record<string, string | number | null>>(
    `SELECT source_asset_id, source_uri, source_missing, original_filename, width, height, taken_at, taken_tz_offset,
       lat, lng, place_name, memo, created_at, updated_at
     FROM moments WHERE deleted_at IS NULL AND source_asset_id IS NOT NULL`,
  );
  if (rows.length === 0) return;
  const existing = await existingAssets(localDb, rows.map((row) => String(row.source_asset_id)));
  // 기록이 많아도 쓰기 잠금을 오래 쥐지 않게 나눠서 저장한다. 중간에 멈추면 위의 확인으로 이어서 옮긴다.
  const missing = rows.filter((row) => !existing.has(String(row.source_asset_id)));
  for (let i = 0; i < missing.length; i += MOVE_BATCH) {
    const batch = missing.slice(i, i + MOVE_BATCH);
    await inTransaction(localDb, async () => {
      for (const row of batch) {
        const columns = Object.keys(row);
        await localDb.runAsync(
          `INSERT INTO moments (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
          [randomUUID(), ...columns.map((column) => row[column])],
        );
      }
    });
  }
}

const retiring = new Map<string, Promise<void>>();

/**
 * 서버 데이터가 지워진 계정 공간을 정리한다. 남길 기록을 옮기고, 파일은 purgeRetiredSpaces가 지운다.
 * 쓰던 연결은 닫지 않으므로(patches/expo-sqlite) 파일은 다음 실행에서 지워진다.
 * 옮기다 실패해도 계정이 사라져 다시 로그인할 수 없으니, 할 일을 먼저 적어 두고 다음 실행 때 다시 한다.
 */
export function retireAccountSpace(userId: string) {
  // 여러 요청이 함께 계정 삭제를 알아채도 기록을 한 번만 옮긴다.
  let running = retiring.get(userId);
  if (!running) {
    running = moveAndRetire(userId).finally(() => retiring.delete(userId));
    retiring.set(userId, running);
  }
  return running;
}

async function moveAndRetire(userId: string) {
  const name = accountDatabaseName(userId);
  const localDb = await getLocalDb();
  const { retired_spaces: retired, retiring_spaces: pending } = await getSettings(localDb);
  if (retired.includes(userId)) return;
  if (!accountDatabaseFiles().includes(name)) {
    if (pending.includes(userId)) {
      await setSetting(localDb, 'retiring_spaces', pending.filter((id) => id !== userId));
    }
    return;
  }
  if (!pending.includes(userId)) await setSetting(localDb, 'retiring_spaces', [...pending, userId]);
  const db = await openDatabaseAsync(name, { useNewConnection: true });
  try {
    await keepLinkedMomentsInLocal(db);
  } finally {
    await db.closeAsync();
  }
  const latest = await getSettings(localDb);
  await setSetting(localDb, 'retired_spaces', [...latest.retired_spaces, userId]);
  await setSetting(localDb, 'retiring_spaces', latest.retiring_spaces.filter((id) => id !== userId));
  clearCloudDisplayCache();
}

/** 정리하기로 했던 공간을 다시 쓰게 되면(지우기 전에 재구독) 파일을 지우지 않는다. */
export async function keepAccountSpace(userId: string) {
  const localDb = await getLocalDb();
  const { retired_spaces: retired, retiring_spaces: pending } = await getSettings(localDb);
  if (retired.includes(userId)) {
    await setSetting(localDb, 'retired_spaces', retired.filter((id) => id !== userId));
  }
  if (pending.includes(userId)) {
    await setSetting(localDb, 'retiring_spaces', pending.filter((id) => id !== userId));
  }
}

/** 정리하기로 한 계정 공간 파일을 지운다. 아직 열려 있으면 다음 기회에 지운다. */
export async function purgeRetiredSpaces() {
  const localDb = await getLocalDb();
  for (const userId of (await getSettings(localDb)).retiring_spaces) {
    await retireAccountSpace(userId).catch(() => {});
  }
  const { retired_spaces: retired } = await getSettings(localDb);
  const deleted: string[] = [];
  const files = accountDatabaseFiles();
  for (const userId of retired) {
    const name = accountDatabaseName(userId);
    try {
      // 파일을 지운 뒤 멈췄으면 본 파일은 이미 없다. 아직 열려 있으면 예외가 나고 다음 기회에 지운다.
      if (files.includes(name)) await deleteDatabaseAsync(name);
      deleteWalFiles(name);
      deleted.push(userId);
    } catch {
      // 다음 실행에서 다시 지운다.
    }
  }
  if (deleted.length > 0) {
    // 지우는 사이 바뀌었을 수 있어 최신 목록에서 지운 것만 뺀다.
    const latest = (await getSettings(localDb)).retired_spaces;
    await setSetting(localDb, 'retired_spaces', latest.filter((id) => !deleted.includes(id)));
  }
}
