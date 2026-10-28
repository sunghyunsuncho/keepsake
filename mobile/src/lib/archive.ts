import * as Application from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import {
  getUncompressedSize,
  listContents,
  NO_COMPRESSION,
  subscribe,
  unzip,
  zip,
} from 'react-native-zip-archive';

import { notifyChange } from '@/db/changes';
import { MOMENT_COLUMNS, type Moment } from '@/db/moments';
import { RECOMMENDED_COUNT_RANGE, setSetting } from '@/db/settings';
import {
  ensureDir,
  freshCacheDir,
  libraryDir,
  photoDir,
  photoDirPath,
  toNativePath,
} from '@/lib/storage';

// ZIP 내보내기 형식 (Local 사용자의 유일한 백업 수단, docs/PLAN.md §2.1)
//
//   manifest.json                       ExportManifest
//   photos/{moment_id}/original.{ext}   원본 (없을 수 있음)
//   photos/{moment_id}/display.jpg      표시용 리사이즈본
//
// 앱의 library 폴더 구조와 같아서 사진을 따로 복사하지 않고 폴더를 그대로 압축한다.
// 삭제된 기록(tombstone)도 함께 내보내서, 가져올 때 updated_at 최신 우선으로 병합하면
// 다른 기기에서 지운 기록도 지워진다 (§3.2 동기화 규칙과 같은 방식).
export const EXPORT_FORMAT = 'keepsake-export';
export const EXPORT_VERSION = 1;
const MANIFEST_NAME = 'manifest.json';

type ExportedMoment = Omit<Moment, 'sync_state' | 'original_uploaded'>;
type Album = {
  id: string;
  kind: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type AlbumMoment = {
  album_id: string;
  moment_id: string;
  position: number;
  updated_at: string;
  deleted_at: string | null;
};
type ReviewSession = {
  id: string;
  date: string;
  reviewed_at: string;
  selected_count: number;
  updated_at: string;
  deleted_at: string | null;
};

export type ExportManifest = {
  format: typeof EXPORT_FORMAT;
  version: number;
  exported_at: string;
  app_version: string | null;
  platform: string;
  moments: ExportedMoment[];
  albums: Album[];
  album_moments: AlbumMoment[];
  review_sessions: ReviewSession[];
  settings: { daily_recommended_count?: number };
};

export type Progress = { phase: 'preparing' | 'compressing' | 'extracting' | 'merging'; ratio: number };
type OnProgress = (progress: Progress) => void;

export class ArchiveError extends Error {}

// ───────────────────────── 내보내기 ─────────────────────────

export type ExportResult = { file: File; momentCount: number; bytes: number };

export async function exportArchive(db: SQLiteDatabase, onProgress: OnProgress): Promise<ExportResult> {
  onProgress({ phase: 'preparing', ratio: 0 });
  ensureDir(libraryDir);

  const exportedMoments = await db.getAllAsync<ExportedMoment>(
    `SELECT ${MOMENT_COLUMNS.filter((c) => c !== 'sync_state' && c !== 'original_uploaded').join(', ')}
     FROM moments ORDER BY taken_at`,
  );
  // 파일이 실제로 있는 것만 경로를 남긴다. 사라진 원본을 가리키지 않도록 한다.
  for (const moment of exportedMoments) {
    if (moment.local_original_path && !libraryFileExists(moment.local_original_path)) {
      moment.local_original_path = null;
    }
  }
  const countRow = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'daily_recommended_count'",
  );
  const count = countRow ? safeJsonParse(countRow.value) : undefined;

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    app_version: Application.nativeApplicationVersion,
    platform: Platform.OS,
    moments: exportedMoments,
    albums: await db.getAllAsync<Album>('SELECT * FROM albums'),
    album_moments: await db.getAllAsync<AlbumMoment>('SELECT * FROM album_moments'),
    review_sessions: await db.getAllAsync<ReviewSession>('SELECT * FROM review_sessions'),
    settings: isValidCount(count) ? { daily_recommended_count: count } : {},
  };

  // 사진은 이미 압축된 형식이라 다시 압축하지 않는다(속도 우선). 대신 ZIP 크기만큼 공간이 필요하다.
  const libraryBytes = libraryDir.size ?? 0;
  if (Paths.availableDiskSpace < libraryBytes * 1.05 + 50 * 1024 * 1024) {
    throw new ArchiveError('기기 저장 공간이 부족해요. 내보내려면 약 ' + mb(libraryBytes) + 'MB가 필요해요.');
  }

  const manifestFile = new File(libraryDir, MANIFEST_NAME);
  manifestFile.write(JSON.stringify(manifest));

  const outDir = freshCacheDir('export');
  const target = new File(outDir, `keepsake-${fileStamp(new Date())}.zip`);
  try {
    await withZipProgress(
      (ratio) => onProgress({ phase: 'compressing', ratio }),
      () => zip(toNativePath(libraryDir.uri), toNativePath(target.uri), NO_COMPRESSION),
    );
  } catch (e) {
    outDir.delete();
    throw e;
  } finally {
    if (manifestFile.exists) manifestFile.delete();
  }

  await setSetting(db, 'last_exported_at', manifest.exported_at);
  return {
    file: target,
    momentCount: exportedMoments.filter((m) => !m.deleted_at).length,
    bytes: target.size,
  };
}

/** 공유 시트를 닫은 뒤 임시 ZIP을 지운다. */
export function cleanupExport() {
  const dir = new Directory(Paths.cache, 'export');
  if (dir.exists) dir.delete();
}

// ───────────────────────── 가져오기 ─────────────────────────

export type ImportResult = {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** 사진 파일이 없어 건너뛴 기록 수 */
  missingPhotos: number;
};

export async function importArchive(
  db: SQLiteDatabase,
  zipUri: string,
  onProgress: OnProgress,
): Promise<ImportResult> {
  onProgress({ phase: 'preparing', ratio: 0 });
  const zipPath = toNativePath(zipUri);

  let entries: string[];
  try {
    entries = (await listContents(zipPath)).map((e) => e.path);
  } catch {
    throw new ArchiveError('ZIP 파일을 읽을 수 없어요. 파일이 손상되었을 수 있어요.');
  }
  if (!entries.includes(MANIFEST_NAME)) {
    throw new ArchiveError('Keepsake에서 내보낸 파일이 아니에요.');
  }
  // 압축을 푼 사진을 library로 옮기므로(같은 저장소 안 이동) 푼 크기만큼만 있으면 된다.
  const uncompressed = await getUncompressedSize(zipPath).catch(() => 0);
  if (Paths.availableDiskSpace < uncompressed * 1.05 + 50 * 1024 * 1024) {
    throw new ArchiveError(`기기 저장 공간이 부족해요. 가져오려면 약 ${mb(uncompressed)}MB가 필요해요.`);
  }

  const staging = freshCacheDir('import');
  try {
    await withZipProgress(
      (ratio) => onProgress({ phase: 'extracting', ratio }),
      () => unzip(zipPath, toNativePath(staging.uri)),
    );
    const manifest = parseManifest(await new File(staging, MANIFEST_NAME).text());
    onProgress({ phase: 'merging', ratio: 0 });
    const result = await mergeManifest(db, manifest, staging, (ratio) =>
      onProgress({ phase: 'merging', ratio }),
    );
    notifyChange();
    return result;
  } finally {
    if (staging.exists) staging.delete();
  }
}

async function mergeManifest(
  db: SQLiteDatabase,
  manifest: ExportManifest,
  staging: Directory,
  onRatio: (ratio: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { added: 0, updated: 0, removed: 0, unchanged: 0, missingPhotos: 0 };
  const stagingLibrary = (relative: string) => new File(staging, relative);

  const local = new Map(
    (
      await db.getAllAsync<Pick<Moment, 'id' | 'updated_at' | 'deleted_at'>>(
        'SELECT id, updated_at, deleted_at FROM moments',
      )
    ).map((row) => [row.id, row]),
  );

  // 파일 이동은 DB 트랜잭션 밖에서 먼저 한다. 이미 있는 사진은 건드리지 않으므로
  // 중간에 실패해도 기존 기록이 가리키는 파일은 그대로 남는다.
  // add: 새 기록, update: 바뀐 기록, remove: 기기에 있던 기록이 지워짐, tombstone: 이미 없는 기록의 삭제 표시만 보관
  type Plan = { moment: ExportedMoment; kind: 'add' | 'update' | 'remove' | 'tombstone' };
  const plans: Plan[] = [];
  manifest.moments.forEach((incoming, index) => {
    if (index % 20 === 0) onRatio(index / manifest.moments.length / 2);
    const existing = local.get(incoming.id);
    if (existing && existing.updated_at >= incoming.updated_at) {
      result.unchanged++;
      return;
    }
    if (incoming.deleted_at) {
      // 기기에 없던 tombstone도 보관해 이후 병합(다른 ZIP, Cloud 동기화)에 쓴다.
      const tombstone = { ...incoming, local_original_path: null };
      plans.push({
        moment: tombstone,
        kind: existing && !existing.deleted_at ? 'remove' : 'tombstone',
      });
      return;
    }

    const display = placePhoto(incoming.local_display_path, stagingLibrary);
    if (!display) {
      result.missingPhotos++;
      return;
    }
    const original = incoming.local_original_path
      ? placePhoto(incoming.local_original_path, stagingLibrary)
      : null;
    plans.push({
      moment: { ...incoming, local_display_path: display, local_original_path: original },
      kind: existing ? 'update' : 'add',
    });
  });

  await db.withExclusiveTransactionAsync(async (txn) => {
    // 별도 연결이라 기본 연결이 잠깐 쓰는 중이면 바로 실패하지 않고 기다린다.
    await txn.execAsync('PRAGMA busy_timeout = 5000');
    for (const [index, { moment, kind }] of plans.entries()) {
      if (index % 20 === 0) onRatio(0.5 + index / plans.length / 2);
      await upsertMoment(txn, moment);
      if (kind === 'remove') result.removed++;
      else if (kind === 'update') result.updated++;
      else if (kind === 'add') result.added++;
    }
    for (const album of manifest.albums) await upsertNewer(txn, 'albums', album);
    for (const row of manifest.album_moments) await upsertNewer(txn, 'album_moments', row);
    for (const session of manifest.review_sessions) {
      await upsertNewer(txn, 'review_sessions', session);
    }
    // 새 기기로 옮기는 경우에만 설정을 가져온다. 이미 설정을 바꾼 기기는 그대로 둔다.
    const count = manifest.settings.daily_recommended_count;
    const hasSetting = await txn.getFirstAsync(
      "SELECT 1 FROM settings WHERE key = 'daily_recommended_count'",
    );
    if (count !== undefined && !hasSetting) {
      await txn.runAsync(
        "INSERT INTO settings (key, value) VALUES ('daily_recommended_count', ?)",
        JSON.stringify(count),
      );
    }
  });

  // 지워진 기록의 사진 파일은 DB 반영 후에 지운다.
  for (const { moment, kind } of plans) {
    if (kind === 'remove') {
      const dir = photoDir(moment.id);
      if (dir.exists) dir.delete();
    }
  }
  onRatio(1);
  return result;
}

/**
 * ZIP에서 꺼낸 사진을 library로 옮기고 library 기준 경로를 돌려준다.
 * 같은 기록의 사진이 이미 기기에 있으면 그대로 쓴다 (같은 ID = 같은 사진).
 */
function placePhoto(relative: string, fromStaging: (relative: string) => File) {
  const dest = new File(libraryDir, relative);
  if (dest.exists) return relative;
  const source = fromStaging(relative);
  if (!source.exists) return null;
  ensureDir(new Directory(libraryDir, relative.slice(0, relative.lastIndexOf('/'))));
  source.move(dest);
  return relative;
}

async function upsertMoment(txn: SQLiteDatabase, moment: ExportedMoment) {
  const columns = MOMENT_COLUMNS.filter((c) => c !== 'sync_state' && c !== 'original_uploaded');
  await txn.runAsync(
    `INSERT INTO moments (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${columns
       .filter((c) => c !== 'id')
       .map((c) => `${c} = excluded.${c}`)
       .join(', ')},
       sync_state = CASE sync_state WHEN 'synced' THEN 'pending' ELSE sync_state END`,
    columns.map((c) => moment[c]),
  );
}

// 컬럼 이름은 manifest가 아니라 여기 고정된 목록에서만 가져온다 (SQL에 그대로 들어가므로).
const TABLES = {
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

/** 키가 같은 행이 없거나 들어온 행이 더 최신일 때만 쓴다. */
async function upsertNewer<Table extends keyof typeof TABLES>(
  txn: SQLiteDatabase,
  table: Table,
  row: { updated_at: string },
) {
  const { keys, columns } = TABLES[table];
  const values = row as unknown as Record<string, string | number | null>;
  const existing = await txn.getFirstAsync<{ updated_at: string }>(
    `SELECT updated_at FROM ${table} WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}`,
    keys.map((k) => values[k]),
  );
  if (existing && existing.updated_at >= row.updated_at) return;
  // OR REPLACE: 같은 키(또는 review_sessions의 같은 id)를 가진 이전 행을 바꾼다.
  await txn.runAsync(
    `INSERT OR REPLACE INTO ${table} (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map((c) => values[c] ?? null),
  );
}

// ───────────────────────── 검증 ─────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * manifest는 사용자가 고른 임의의 파일에서 오므로 형식을 엄격히 확인한다.
 * 특히 사진 경로는 `photos/{자기 id}/...`만 허용해 library 밖 파일을 건드리지 못하게 한다.
 */
export function parseManifest(text: string): ExportManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ArchiveError('백업 정보(manifest.json)를 읽을 수 없어요.');
  }
  const m = raw as Partial<ExportManifest>;
  if (!m || m.format !== EXPORT_FORMAT) throw new ArchiveError('Keepsake에서 내보낸 파일이 아니에요.');
  if (typeof m.version !== 'number' || m.version > EXPORT_VERSION) {
    throw new ArchiveError('더 새로운 버전의 앱에서 내보낸 파일이에요. 앱을 업데이트해 주세요.');
  }
  if (!Array.isArray(m.moments)) throw new ArchiveError('백업 정보가 올바르지 않아요.');

  const moments = m.moments.map((raw) => {
    // taken_tz_offset은 나중에 추가된 필드라 이전 ZIP에는 없다.
    const moment = { ...raw, taken_tz_offset: raw?.taken_tz_offset ?? null };
    if (!isValidMoment(moment)) throw new ArchiveError('백업 정보에 올바르지 않은 기록이 있어요.');
    return moment;
  });
  const count = m.settings?.daily_recommended_count;
  return {
    format: EXPORT_FORMAT,
    version: m.version,
    exported_at: String(m.exported_at ?? ''),
    app_version: m.app_version ?? null,
    platform: String(m.platform ?? ''),
    moments,
    albums: arrayOf(m.albums, isValidAlbum),
    album_moments: arrayOf(m.album_moments, isValidAlbumMoment),
    review_sessions: arrayOf(m.review_sessions, isValidReviewSession),
    settings: isValidCount(count) ? { daily_recommended_count: count } : {},
  };
}

function arrayOf<T>(value: unknown, isValid: (item: unknown) => item is T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isValid)) {
    throw new ArchiveError('백업 정보가 올바르지 않아요.');
  }
  return value;
}

function isValidMoment(value: unknown): value is ExportedMoment {
  const m = value as ExportedMoment;
  if (!m || typeof m.id !== 'string' || !UUID.test(m.id)) return false;
  const dir = photoDirPath(m.id);
  const displayOk =
    typeof m.local_display_path === 'string' && m.local_display_path === `${dir}/display.jpg`;
  const originalOk =
    m.local_original_path === null ||
    (typeof m.local_original_path === 'string' &&
      new RegExp(`^${dir}/original\\.[a-z0-9]{1,5}$`).test(m.local_original_path));
  return (
    displayOk &&
    originalOk &&
    isIso(m.taken_at) &&
    isIso(m.created_at) &&
    isIso(m.updated_at) &&
    (m.deleted_at === null || isIso(m.deleted_at)) &&
    typeof m.memo === 'string' &&
    isNullable(m.source_asset_id, 'string') &&
    isNullable(m.original_filename, 'string') &&
    isNullable(m.place_name, 'string') &&
    isNullable(m.width, 'number') &&
    isNullable(m.height, 'number') &&
    isNullable(m.lat, 'number') &&
    isNullable(m.lng, 'number') &&
    // UTC-12 ~ UTC+14
    (m.taken_tz_offset === null ||
      (Number.isInteger(m.taken_tz_offset) && Math.abs(m.taken_tz_offset) <= 14 * 60))
  );
}

function isValidAlbum(value: unknown): value is Album {
  const a = value as Album;
  return (
    !!a &&
    typeof a.id === 'string' &&
    UUID.test(a.id) &&
    typeof a.kind === 'string' &&
    typeof a.title === 'string' &&
    isNullable(a.start_date, 'string') &&
    isNullable(a.end_date, 'string') &&
    isIso(a.created_at) &&
    isIso(a.updated_at) &&
    (a.deleted_at === null || isIso(a.deleted_at))
  );
}

function isValidAlbumMoment(value: unknown): value is AlbumMoment {
  const a = value as AlbumMoment;
  return (
    !!a &&
    typeof a.album_id === 'string' &&
    UUID.test(a.album_id) &&
    typeof a.moment_id === 'string' &&
    UUID.test(a.moment_id) &&
    Number.isInteger(a.position) &&
    isIso(a.updated_at) &&
    (a.deleted_at === null || isIso(a.deleted_at))
  );
}

function isValidReviewSession(value: unknown): value is ReviewSession {
  const r = value as ReviewSession;
  return (
    !!r &&
    typeof r.id === 'string' &&
    typeof r.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
    isIso(r.reviewed_at) &&
    Number.isInteger(r.selected_count) &&
    isIso(r.updated_at) &&
    (r.deleted_at === null || isIso(r.deleted_at))
  );
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && ISO.test(value);
}

function isNullable(value: unknown, type: 'string' | 'number') {
  return value === null || typeof value === type;
}

// ───────────────────────── 유틸 ─────────────────────────

async function withZipProgress<T>(onRatio: (ratio: number) => void, run: () => Promise<T>) {
  // 진행 이벤트는 전역이라 한 번에 한 작업만 돌린다는 전제로 구독한다.
  const sub = subscribe(({ progress }) => onRatio(progress));
  try {
    return await run();
  } finally {
    sub.remove();
  }
}

function isValidCount(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= RECOMMENDED_COUNT_RANGE.min &&
    (value as number) <= RECOMMENDED_COUNT_RANGE.max
  );
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function libraryFileExists(relative: string) {
  return new File(libraryDir, relative).exists;
}

function fileStamp(date: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

function mb(bytes: number) {
  return Math.ceil(bytes / 1024 / 1024);
}
