import { File } from 'expo-file-system';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyChange } from '@/db/changes';
import { CloudError, cloudApi, unwrap } from '@/lib/cloud/session';
import { ensureDir, photoDir, photoDirPath, resolveLibraryFile } from '@/lib/storage';

// 사진 업로드·다운로드 (docs/PLAN.md §3.1). 사진 바이트는 서버를 거치지 않고 R2와 직접 오간다.
//
// 올릴 사진은 moments에서 바로 계산한다 (서버에 기록이 있고, 사진이 아직 올라가지 않은 것).
// upload_queue에는 실패한 사진의 재시도 횟수와 다음 시도 시각만 둔다. 앱을 다시 열어도 이어서 올린다.

type Variant = 'display' | 'original';
type PendingUpload = { id: string; variant: Variant; path: string };

const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
  heif: 'image/heif',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  dng: 'image/x-adobe-dng',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export async function pendingUploads(db: SQLiteDatabase, now = new Date().toISOString()) {
  // 표시용 사진을 먼저 올린다. 새 기기에서 사진첩을 빨리 보여주기 위해서다.
  return db.getAllAsync<PendingUpload>(
    `SELECT p.id, p.variant, p.path FROM (
       SELECT id, 'display' AS variant, local_display_path AS path, 0 AS priority, taken_at FROM moments
       WHERE deleted_at IS NULL AND sync_state = 'synced' AND display_uploaded = 0
       UNION ALL
       SELECT id, 'original', local_original_path, 1, taken_at FROM moments
       WHERE deleted_at IS NULL AND sync_state = 'synced' AND original_uploaded = 0
         AND local_original_path IS NOT NULL
     ) AS p
     LEFT JOIN upload_queue q ON q.moment_id = p.id AND q.variant = p.variant
     WHERE q.next_attempt_at IS NULL OR q.next_attempt_at <= ?
     ORDER BY p.priority, p.taken_at DESC`,
    now,
  );
}

export async function countPendingUploads(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT
       SUM(CASE WHEN display_uploaded = 0 THEN 1 ELSE 0 END) +
       SUM(CASE WHEN original_uploaded = 0 AND local_original_path IS NOT NULL THEN 1 ELSE 0 END)
       AS count
     FROM moments WHERE deleted_at IS NULL`,
  );
  return row?.count ?? 0;
}

/**
 * 올릴 사진을 차례로 올린다. 구독이 끝났거나(403) 용량이 찼으면(413) 멈추고 그 이유를 던진다.
 * 그 밖의 실패는 사진별로 기록하고 다음 사진으로 넘어간다.
 */
export async function uploadPending(db: SQLiteDatabase, shouldStop: () => boolean) {
  let uploaded = 0;
  for (const item of await pendingUploads(db)) {
    if (shouldStop()) break;
    try {
      await uploadOne(db, item);
      uploaded++;
    } catch (e) {
      if (e instanceof CloudError && (e.status === 403 || e.status === 413 || e.status === 401)) throw e;
      await recordFailure(db, item, e);
    }
  }
  return uploaded;
}

async function uploadOne(db: SQLiteDatabase, { id, variant, path }: PendingUpload) {
  const file = resolveLibraryFile(path);
  if (!file.exists) {
    if (variant === 'original') {
      // 원본이 사라졌다면 표시용만 남긴다 (docs/PLAN.md §8 '원본 없음').
      await db.runAsync('UPDATE moments SET local_original_path = NULL WHERE id = ?', id);
      return;
    }
    throw new Error('표시용 사진 파일이 없어요');
  }
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? `image/${ext}`;
  // 큰 원본을 JS 메모리에 올리지 않도록 해시는 네이티브로 계산하고 업로드도 네이티브로 한다.
  // 저장소가 이 MD5로 받은 내용을 확인한다 (Content-MD5).
  const md5 = file.md5;
  if (!md5) throw new Error('사진 파일을 읽을 수 없어요');

  const upload = unwrap(
    await cloudApi.POST('/uploads', {
      body: { moment_id: id, variant, size: file.size, content_type: contentType, md5 },
    }),
  );
  const put = await uploadAsync(upload.upload_url, file.uri, {
    httpMethod: 'PUT',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: upload.headers,
  });
  if (put.status < 200 || put.status >= 300) throw new Error(`저장소 업로드 실패 (${put.status})`);
  unwrap(
    await cloudApi.POST('/uploads/{upload_id}/complete', {
      params: { path: { upload_id: upload.id } },
    }),
  );
  await db.runAsync(
    `UPDATE moments SET ${variant === 'display' ? 'display_uploaded' : 'original_uploaded'} = 1 WHERE id = ?`,
    id,
  );
  await db.runAsync('DELETE FROM upload_queue WHERE moment_id = ? AND variant = ?', id, variant);
}

async function recordFailure(db: SQLiteDatabase, item: PendingUpload, error: unknown) {
  const row = await db.getFirstAsync<{ attempts: number }>(
    'SELECT attempts FROM upload_queue WHERE moment_id = ? AND variant = ?',
    item.id,
    item.variant,
  );
  const attempts = (row?.attempts ?? 0) + 1;
  // 1분, 2분, 4분 … 최대 6시간 간격으로 다시 시도한다.
  const delay = Math.min(60_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  const now = new Date();
  await db.runAsync(
    `INSERT INTO upload_queue (moment_id, variant, attempts, last_error, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (moment_id, variant) DO UPDATE SET attempts = excluded.attempts,
       last_error = excluded.last_error, next_attempt_at = excluded.next_attempt_at`,
    item.id,
    item.variant,
    attempts,
    error instanceof Error ? error.message : String(error),
    new Date(now.getTime() + delay).toISOString(),
    now.toISOString(),
  );
}

/** 다른 기기에서 올린 기록의 표시용 사진 중 이 기기에 없는 것을 받는다. */
export async function downloadMissingDisplays(db: SQLiteDatabase, shouldStop: () => boolean) {
  const rows = await db.getAllAsync<{ id: string; local_display_path: string }>(
    `SELECT id, local_display_path FROM moments
     WHERE deleted_at IS NULL AND display_uploaded = 1 ORDER BY taken_at DESC`,
  );
  let downloaded = 0;
  for (const row of rows) {
    if (shouldStop()) break;
    if (resolveLibraryFile(row.local_display_path).exists) continue;
    try {
      await downloadPhoto(row.id, 'display', 'display.jpg');
      downloaded++;
      // 사진첩이 받은 사진부터 보여주도록 몇 장마다 알린다.
      if (downloaded % 10 === 0) notifyChange();
    } catch (e) {
      if (e instanceof CloudError && (e.status === 403 || e.status === 401)) throw e;
      // 이번에 못 받은 사진은 다음 동기화 때 다시 받는다.
    }
  }
  if (downloaded > 0) notifyChange();
  return downloaded;
}

export async function countMissingOriginals(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM moments
     WHERE deleted_at IS NULL AND original_uploaded = 1 AND local_original_path IS NULL`,
  );
  return row?.count ?? 0;
}

/** Cloud에만 있는 원본을 모두 기기로 받는다 (새 기기 복원, 구독 만료 후 30일 안의 전체 다운로드). */
export async function downloadOriginals(
  db: SQLiteDatabase,
  onProgress: (done: number, total: number) => void,
) {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM moments
     WHERE deleted_at IS NULL AND original_uploaded = 1 AND local_original_path IS NULL
     ORDER BY taken_at`,
  );
  let failed = 0;
  for (const [index, row] of rows.entries()) {
    onProgress(index, rows.length);
    try {
      const ext = await downloadPhoto(row.id, 'original');
      await db.runAsync(
        'UPDATE moments SET local_original_path = ? WHERE id = ? AND deleted_at IS NULL',
        `${photoDirPath(row.id)}/original.${ext}`,
        row.id,
      );
    } catch (e) {
      if (e instanceof CloudError && (e.status === 403 || e.status === 401)) throw e;
      failed++;
    }
  }
  onProgress(rows.length, rows.length);
  notifyChange();
  return { total: rows.length, failed };
}

/** 사진 하나를 받아 photos/{id}/ 아래에 둔다. 저장한 확장자를 돌려준다. */
async function downloadPhoto(id: string, variant: Variant, filename?: string) {
  const info = unwrap(
    await cloudApi.GET('/moments/{moment_id}/photo', {
      params: { path: { moment_id: id }, query: { variant } },
    }),
  );
  const dir = photoDir(id);
  ensureDir(dir);
  const destination = new File(dir, filename ?? `${variant}.${info.extension}`);
  // 받다가 끊긴 파일을 완성된 사진으로 착각하지 않도록 임시 이름으로 받은 뒤 옮긴다.
  const partial = new File(dir, `${destination.name}.partial`);
  await File.downloadFileAsync(info.download_url, partial, { idempotent: true });
  if (partial.size !== info.size) {
    partial.delete();
    throw new Error('받은 사진 크기가 달라요');
  }
  if (destination.exists) destination.delete();
  partial.move(destination);
  return info.extension;
}
