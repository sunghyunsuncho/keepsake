import { File } from 'expo-file-system';
import { FileSystemUploadType, getInfoAsync, uploadAsync } from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import type { SQLiteDatabase } from 'expo-sqlite';

import { createAlbum, updateAlbumMoments } from '@/db/albums';
import { notifyChange } from '@/db/changes';
import { inTransaction, setMomentSource } from '@/db/moments';
import { getSettings, setSetting } from '@/db/settings';
import { CloudError, cloudApi, unwrap } from '@/lib/cloud/session';
import { hasLimitedPhotoAccess } from '@/lib/photos';
import { cacheDir } from '@/lib/storage';

// 사진 업로드·다운로드 (docs/PLAN.md §3.1). 사진 바이트는 서버를 거치지 않고 R2와 직접 오간다.
//
// 앱은 사진을 보관하지 않으므로, 올릴 때 기기 사진첩에서 원본을 읽고 표시용 사진은 그때 만들어 올린 뒤 지운다.
// 올릴 사진은 moments에서 바로 계산한다 (서버에 기록이 있고, 안전 앨범에 담겼고, 사진이 아직 올라가지 않은 것).
// 표시용은 안전 앨범에 담긴 기록 모두, 원본은 화질이 '원본'인 안전 앨범에 담긴 기록만 올린다 (db/albums.ts).
// 반대로 안전 앨범에서 빠졌거나 앨범을 효율 보관으로 바꿔 필요 없어진 사진은 서버에서 지운다 (releaseUnwantedPhotos).
// upload_queue에는 실패한 사진의 재시도 횟수와 다음 시도 시각만 둔다. 앱을 다시 열어도 이어서 올린다.

type Variant = 'display' | 'original';
type PendingUpload = { id: string; variant: Variant };

const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

// 표시용 리사이즈본: 긴 변 기준. 1장 약 0.5MB를 목표로 한다 (docs/PLAN.md §2.2).
const DISPLAY_LONG_EDGE = 1600;
const DISPLAY_QUALITY = 0.8;

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

// 기기 사진첩에 원본이 있어야 올릴 수 있다. 지워진 사진(source_missing)이나 다른 기기에서 받은 기록은 뺀다.
const ON_DEVICE = 'deleted_at IS NULL AND source_asset_id IS NOT NULL AND source_missing = 0';
const UPLOADABLE = `${ON_DEVICE} AND sync_state = 'synced'`;

/** 안전 앨범에 담긴 기록 (moments 테이블 기준). originalOnly: 원본을 보관하는 안전 앨범만. */
function inCloudAlbum(originalOnly: boolean) {
  return `EXISTS (
    SELECT 1 FROM album_moments am JOIN albums a ON a.id = am.album_id
    WHERE am.moment_id = moments.id AND am.deleted_at IS NULL AND a.deleted_at IS NULL AND a.kind = 'cloud'
      ${originalOnly ? "AND IFNULL(a.photo_quality, 'original') = 'original'" : ''})`;
}

export async function pendingUploads(db: SQLiteDatabase, now = new Date().toISOString()) {
  // 표시용 사진을 먼저 올린다. 새 기기에서 사진첩을 빨리 보여주기 위해서다.
  return db.getAllAsync<PendingUpload>(
    `SELECT p.id, p.variant FROM (
       SELECT id, 'display' AS variant, 0 AS priority, taken_at FROM moments
       WHERE ${UPLOADABLE} AND display_uploaded = 0 AND ${inCloudAlbum(false)}
       UNION ALL
       SELECT id, 'original', 1, taken_at FROM moments
       WHERE ${UPLOADABLE} AND original_uploaded = 0 AND ${inCloudAlbum(true)}
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
       SUM(CASE WHEN display_uploaded = 0 AND ${inCloudAlbum(false)} THEN 1 ELSE 0 END) +
       SUM(CASE WHEN original_uploaded = 0 AND ${inCloudAlbum(true)} THEN 1 ELSE 0 END) AS count
     FROM moments WHERE ${ON_DEVICE}`,
  );
  return row?.count ?? 0;
}

const RELEASE_BATCH = 500;

/** 올라가 있지만 이제 어떤 안전 앨범에도 필요 없는 사진. 표시용은 안전 앨범 밖, 원본은 원본 보관 앨범 밖. */
function unwantedPhotos(db: SQLiteDatabase) {
  return db.getAllAsync<PendingUpload>(
    `SELECT id, 'display' AS variant FROM moments
     WHERE deleted_at IS NULL AND display_uploaded = 1 AND NOT ${inCloudAlbum(false)}
     UNION ALL
     SELECT id, 'original' FROM moments
     WHERE deleted_at IS NULL AND original_uploaded = 1 AND NOT ${inCloudAlbum(true)}
     LIMIT ${RELEASE_BATCH}`,
  );
}

/**
 * 안전 앨범에서 빠진 사진을 서버에서 지운다. 기록(메모·장소)은 그대로 남는다.
 * 앨범 변경을 보내고(push) 다른 기기의 변경을 받은(pull) 뒤에 불러야, 다른 기기가 담은 사진을 지우지 않는다.
 * 지운 사진 수를 돌려준다.
 */
export async function releaseUnwantedPhotos(db: SQLiteDatabase) {
  let released = 0;
  for (;;) {
    const photos = await unwantedPhotos(db);
    if (photos.length === 0) break;
    unwrap(
      await cloudApi.POST('/photos/delete', {
        body: { photos: photos.map((photo) => ({ moment_id: photo.id, variant: photo.variant })) },
      }),
    );
    await inTransaction(db, async () => {
      for (const photo of photos) {
        await db.runAsync(
          `UPDATE moments SET ${photo.variant === 'display' ? 'display_uploaded' : 'original_uploaded'} = 0 WHERE id = ?`,
          photo.id,
        );
        await db.runAsync('DELETE FROM upload_queue WHERE moment_id = ? AND variant = ?', photo.id, photo.variant);
      }
    });
    released += photos.length;
  }
  if (released > 0) notifyChange();
  return released;
}

/**
 * 안전 앨범이 생기기 전에는 계정 공간의 모든 기록을 올렸다. 그 사진이 지워지지 않도록,
 * 이 계정 공간에서 처음 한 번 어느 안전 앨범에도 없는 올린 사진을 '이전에 보관한 사진' 앨범에 담는다.
 * 원본이 하나라도 있으면 원본 보관으로 만든다. pull 뒤에 불러야 다른 기기가 이미 담은 앨범을 본다.
 */
export async function adoptPhotosWithoutAlbum(db: SQLiteDatabase) {
  if ((await getSettings(db)).cloud_photos_adopted) return;
  const rows = await db.getAllAsync<{ id: string; original_uploaded: number }>(
    `SELECT id, original_uploaded FROM moments
     WHERE deleted_at IS NULL AND (display_uploaded = 1 OR original_uploaded = 1) AND NOT ${inCloudAlbum(false)}`,
  );
  if (rows.length > 0) {
    const quality = rows.some((row) => row.original_uploaded === 1) ? 'original' : 'display';
    const albumId = await createAlbum(db, '이전에 보관한 사진', { quality });
    await updateAlbumMoments(db, albumId, { add: rows.map((row) => row.id) });
  }
  await setSetting(db, 'cloud_photos_adopted', true);
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
      if (await uploadOne(db, item)) uploaded++;
    } catch (e) {
      if (e instanceof CloudError && (e.status === 403 || e.status === 413 || e.status === 401)) throw e;
      await recordFailure(db, item, e);
    }
  }
  // 화면의 'Cloud에 보관됨' 표시와 Cloud에만 있는 원본 수가 달라진다.
  if (uploaded > 0) notifyChange();
  return uploaded;
}

/** 올렸으면 true. 기기 사진첩에서 원본이 지워졌으면 지워진 사진으로 표시하고 false. */
async function uploadOne(db: SQLiteDatabase, { id, variant }: PendingUpload) {
  const row = await db.getFirstAsync<{ source_asset_id: string; width: number | null; height: number | null }>(
    'SELECT source_asset_id, width, height FROM moments WHERE id = ? AND deleted_at IS NULL',
    id,
  );
  if (!row) return false; // 올리는 동안 기록에서 뺐다.
  // iCloud에만 있는 원본은 받아야 파일이 생긴다 (OS가 관리하는 사진첩 캐시라 앱 용량은 늘지 않는다).
  // 사진이 없으면 null이고, 예외는 권한 문제 같은 일시적 실패라 재시도로 넘긴다 (지워진 사진으로 표시하지 않는다).
  const info = await MediaLibrary.getAssetInfoAsync(row.source_asset_id, {
    shouldDownloadFromNetwork: true,
  });
  if (!info) {
    if (await hasLimitedPhotoAccess()) throw new Error('허용하지 않은 사진이에요');
    await setMomentSource(db, id, { missing: true });
    return false;
  }
  const sourceUri = info.localUri;
  if (!sourceUri?.startsWith('file://')) throw new Error('원본 사진을 받지 못했어요');

  const file =
    variant === 'display'
      ? await makeDisplayImage(sourceUri, row.width || info.width, row.height || info.height)
      : copyToUploadDir(sourceUri, info.filename);
  try {
    await uploadFile(id, variant, file);
  } finally {
    if (file.exists) file.delete();
  }
  await db.runAsync(
    `UPDATE moments SET ${variant === 'display' ? 'display_uploaded' : 'original_uploaded'} = 1 WHERE id = ?`,
    id,
  );
  await db.runAsync('DELETE FROM upload_queue WHERE moment_id = ? AND variant = ?', id, variant);
  return true;
}

// 사진첩 파일을 직접 올리면 올리는 동안 사진첩이 파일을 바꿀 수 있어(편집, iCloud) 잠깐 복사해 둔다.
function copyToUploadDir(sourceUri: string, filename: string) {
  const ext = extensionOf(filename) ?? extensionOf(sourceUri) ?? 'jpg';
  const file = new File(cacheDir('upload'), `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  new File(sourceUri).copy(file);
  return file;
}

async function uploadFile(id: string, variant: Variant, file: File) {
  const ext = variant === 'display' ? 'jpg' : (extensionOf(file.name) ?? 'jpg');
  const contentType = CONTENT_TYPES[ext] ?? `image/${ext}`;
  // 큰 원본을 JS 메모리에 올리지 않도록 해시는 네이티브로 계산하고 업로드도 네이티브로 한다.
  // file.md5는 계산이 끝날 때까지 화면을 멈추므로 비동기 API를 쓴다.
  // 저장소가 이 MD5로 받은 내용을 확인한다 (Content-MD5).
  const info = await getInfoAsync(file.uri, { md5: true });
  const md5 = info.exists ? info.md5 : undefined;
  if (!md5) throw new Error('사진 파일을 읽을 수 없어요');

  const created = await cloudApi.POST('/uploads', {
    body: { moment_id: id, variant, size: file.size, content_type: contentType, md5 },
  });
  // 다른 기기가 이미 올렸다. 서버의 사진을 그대로 쓴다.
  if (created.response.status === 409) return;
  const upload = unwrap(created);
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
}

async function makeDisplayImage(uri: string, width: number, height: number) {
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > DISPLAY_LONG_EDGE) {
    context.resize(
      width >= height ? { width: DISPLAY_LONG_EDGE, height: null } : { width: null, height: DISPLAY_LONG_EDGE },
    );
  }
  // 원본 해상도 이미지를 메모리에 올리므로 다 쓰면 바로 놓아준다.
  const image = await context.renderAsync();
  try {
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: DISPLAY_QUALITY });
    return new File(result.uri);
  } finally {
    image.release();
    context.release();
  }
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

/**
 * 기기 사진첩에 원본이 없는 기록(지워진 사진, 다른 기기에서 남긴 기록)의 Cloud 표시용 사진.
 * 볼 때 한 장씩 받아 캐시에 둔다. OS가 캐시를 지우면 다시 받는다.
 */
export function cloudDisplayUri(momentId: string) {
  // 같은 사진을 두 곳(앨범 표지와 목록)에서 그려도 임시 파일이 겹치지 않게 한 번만 받는다.
  let download = displayDownloads.get(momentId);
  if (!download) {
    download = fetchDisplay(momentId).finally(() => displayDownloads.delete(momentId));
    displayDownloads.set(momentId, download);
  }
  return download;
}

const displayDownloads = new Map<string, Promise<string>>();

async function fetchDisplay(momentId: string) {
  const file = new File(cacheDir('cloud-display'), `${momentId}.jpg`);
  if (!file.exists) await downloadTo(momentId, 'display', file);
  return file.uri;
}

/** 크게 볼 때 쓰는 Cloud 원본 주소 (짧게 유효한 서명 URL). 파일로 받지 않는다. */
export async function cloudOriginalUrl(momentId: string) {
  const info = unwrap(
    await cloudApi.GET('/moments/{moment_id}/photo', {
      params: { path: { moment_id: momentId }, query: { variant: 'original' } },
    }),
  );
  return info.download_url;
}

/** Cloud에는 원본이 있는데 이 기기 사진첩에는 없는 기록 수. */
export async function countMissingOriginals(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM moments
     WHERE deleted_at IS NULL AND original_uploaded = 1
       AND (source_asset_id IS NULL OR source_missing = 1)`,
  );
  return row?.count ?? 0;
}

export class PhotoSaveError extends Error {}

/**
 * Cloud에만 있는 원본을 기기 사진첩에 저장하고 기록을 그 사진에 잇는다
 * (새 기기 복원, 구독 만료 후 30일 안의 전체 다운로드).
 * 같은 사진이 이미 사진첩에 있으면(같은 iCloud 사진을 쓰는 다른 기기) 저장하지 않고 잇기만 한다.
 */
export async function saveOriginalsToLibrary(
  db: SQLiteDatabase,
  onProgress: (done: number, total: number) => void,
) {
  // 읽기 권한까지 받는다. iOS의 '추가만 허용'으로는 저장한 사진을 다시 읽지 못해 기록에 이을 수 없고,
  // 저장은 됐는데 실패로 처리되어 다시 시도할 때 사진이 중복된다.
  const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  if (!permission.granted) throw new PhotoSaveError('사진을 저장하려면 사진 접근을 허용해 주세요.');

  const rows = await db.getAllAsync<{ id: string; original_filename: string | null; taken_at: string }>(
    `SELECT id, original_filename, taken_at FROM moments
     WHERE deleted_at IS NULL AND original_uploaded = 1
       AND (source_asset_id IS NULL OR source_missing = 1)
     ORDER BY taken_at`,
  );
  let failed = 0;
  try {
    for (const [index, row] of rows.entries()) {
      onProgress(index, rows.length);
      try {
        const asset = (await findSameAsset(row)) ?? (await saveOriginal(row.id));
        await db.runAsync(
          'UPDATE moments SET source_asset_id = ?, source_uri = ?, source_missing = 0, source_link_synced = 0 WHERE id = ?',
          asset.id,
          asset.uri,
          row.id,
        );
      } catch (e) {
        if (e instanceof CloudError && (e.status === 403 || e.status === 401)) throw e;
        failed++;
      }
    }
  } finally {
    // 중간에 멈춰도 그때까지 저장한 사진은 화면에 반영한다.
    notifyChange();
  }
  onProgress(rows.length, rows.length);
  return { total: rows.length, failed };
}

async function saveOriginal(momentId: string) {
  const dir = cacheDir('upload');
  const file = new File(dir, `${momentId}-original`);
  const ext = await downloadTo(momentId, 'original', file);
  // 사진첩이 형식을 확장자로 판단하므로 받은 형식의 확장자를 붙인다.
  const named = new File(dir, `${momentId}.${ext}`);
  if (named.exists) named.delete();
  file.move(named);
  try {
    return await MediaLibrary.createAssetAsync(named.uri);
  } finally {
    if (named.exists) named.delete();
  }
}

// 파일 이름이 같고 촬영 시각이 2초 안이면 같은 사진으로 본다.
async function findSameAsset(row: { original_filename: string | null; taken_at: string }) {
  if (!row.original_filename) return null;
  const taken = new Date(row.taken_at).getTime();
  const page = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    createdAfter: taken - 2000,
    createdBefore: taken + 2001,
    first: 20,
  });
  return page.assets.find((asset) => asset.filename === row.original_filename) ?? null;
}

/** 사진 하나를 받아 destination에 둔다. 저장한 형식의 확장자를 돌려준다. */
async function downloadTo(id: string, variant: Variant, destination: File) {
  const info = unwrap(
    await cloudApi.GET('/moments/{moment_id}/photo', {
      params: { path: { moment_id: id }, query: { variant } },
    }),
  );
  // 받다가 끊긴 파일을 완성된 사진으로 착각하지 않도록 임시 이름으로 받은 뒤 옮긴다.
  const partial = new File(destination.parentDirectory, `${destination.name}.partial`);
  await File.downloadFileAsync(info.download_url, partial, { idempotent: true });
  if (partial.size !== info.size) {
    partial.delete();
    throw new Error('받은 사진 크기가 달라요');
  }
  if (destination.exists) destination.delete();
  partial.move(destination);
  return info.extension;
}

function extensionOf(name: string | undefined) {
  const match = name?.match(/\.([A-Za-z0-9]{1,5})$/);
  return match ? match[1].toLowerCase() : null;
}
