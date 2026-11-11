import { File } from 'expo-file-system';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getThumbnailAsync } from 'expo-video-thumbnails';

import { md5File, transcodeVideo, writeImageMetadata, type ImageMetadata } from '@modules/photo-meta';

import { createAlbum, updateAlbumMoments } from '@/db/albums';
import { notifyChange } from '@/db/changes';
import { inTransaction, setMomentSource, type MediaType } from '@/db/moments';
import { getSettings, setSetting } from '@/db/settings';
import { CloudError, cloudApi, unwrap } from '@/lib/cloud/session';
import { assetFileUri, hasLimitedPhotoAccess, MEDIA_PERMISSIONS, MEDIA_TYPES } from '@/lib/photos';
import { cacheDir } from '@/lib/storage';

// 사진 업로드·다운로드 (docs/PLAN.md §3.1). 사진 바이트는 서버를 거치지 않고 R2와 직접 오간다.
//
// 앱은 사진을 보관하지 않으므로, 올릴 때 기기 사진첩에서 원본을 읽고 표시용 사진은 그때 만들어 올린 뒤 지운다.
// 올릴 사진은 moments에서 바로 계산한다 (서버에 기록이 있고, 안전 앨범에 담겼고, 사진이 아직 올라가지 않은 것).
// 표시용은 안전 앨범에 담긴 기록 모두, 원본은 원본을 보관할 기록만 올린다 (wantsOriginal).
// 사진마다 고른 화질(moments.cloud_quality)이 안전 앨범의 화질보다 먼저다. 공유 앨범은 그 앨범 항목의 화질
// (shared_items.photo_quality: 공유 앨범에서 사진마다 고른 화질, 없으면 앨범 화질)을 따른다.
// 반대로 안전 앨범에서 빠졌거나 앨범을 효율 보관으로 바꿔 필요 없어진 사진은 서버에서 지운다 (releaseUnwantedPhotos).
//
// 썸네일(thumb)은 목록·표지에 그리는 작은 표시용이다. 표시용이 필요한 기록에는 늘 함께 둔다. 기기 사진첩에 원본이
// 없으면(정리로 지웠거나 다른 기기에서 남긴 기록) Cloud의 표시용으로 만든다. 썸네일이 없는 사진은 표시용으로 그린다.
//
// 동영상: 표시용(display)은 대표 장면 이미지라 목록·표지는 사진과 똑같이 그린다. 원본 보관 앨범은 영상 원본을,
// 효율 보관 앨범은 720p로 줄인 영상(compact)을 올린다. 원본 보관 앨범에 함께 담겨 원본이 올라가 있으면 compact는 필요 없다.
// 효율 보관으로 바꿔도 영상 원본은 compact가 올라간 뒤에 지운다. 그 사이 Cloud에 영상이 없는 때가 없게 하려는 것이고,
// 기기 사진첩에서 지워져 compact를 만들 수 없으면 원본을 남긴다 (Cloud에 남은 유일한 영상이다).
// upload_queue에는 실패한 사진의 재시도 횟수와 다음 시도 시각만 둔다. 앱을 다시 열어도 이어서 올린다.

type Variant = 'display' | 'thumb' | 'original' | 'compact';
type PendingUpload = { id: string; variant: Variant };

const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

// 표시용 리사이즈본: 긴 변 기준. 1장 약 0.8MB를 목표로 한다 (docs/PLAN.md §2.2).
// 메신저로 주고받는 사진보다 선명하게 남기려고 1600px에서 올렸다. 이미 올린 사진은 그대로 둔다.
const DISPLAY_LONG_EDGE = 2048;
const DISPLAY_QUALITY = 0.8;
// 썸네일: 3칸 목록의 정사각형 칸(3배 화면에서 약 420px)을 짧은 변이 채우는 크기. 1장 약 50KB.
const THUMB_LONG_EDGE = 640;
const THUMB_QUALITY = 0.75;

// R2 한 번의 PUT 한도(5GiB) 안에서 서버가 받는 크기 (backend/app/api/uploads.py MAX_UPLOAD_BYTES)
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
// 4GB를 넘는 동영상은 올릴 수 없다. 다시 시도해도 같으므로 하루에 한 번만 다시 본다 (영상을 잘랐을 수 있다).
const TOO_LARGE_RETRY_MS = 24 * 60 * 60 * 1000;

const UPLOADED_COLUMN: Record<Variant, string> = {
  display: 'display_uploaded',
  thumb: 'thumb_uploaded',
  original: 'original_uploaded',
  compact: 'compact_uploaded',
};

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
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  '3gp': 'video/3gpp',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

// 기기 사진첩에 원본이 있어야 올릴 수 있다. 지워진 사진(source_missing)이나 다른 기기에서 받은 기록은 뺀다.
const ON_DEVICE = 'deleted_at IS NULL AND source_asset_id IS NOT NULL AND source_missing = 0';
const UPLOADABLE = `${ON_DEVICE} AND sync_state = 'synced'`;
// 썸네일은 기기 원본이 없어도 Cloud의 표시용으로 만든다.
const THUMB_UPLOADABLE = `deleted_at IS NULL AND sync_state = 'synced'
  AND ((source_asset_id IS NOT NULL AND source_missing = 0) OR display_uploaded = 1)`;

/**
 * 안전 앨범이나 내가 담은 공유 앨범에 있는 기록 (moments 테이블 기준).
 * 공유 앨범의 파일도 내 Cloud 파일 그대로라 안전 앨범과 같은 규칙으로 올리고 지운다 (shared_items, lib/cloud/shared.ts).
 * 용량은 서버가 나눠 센다: 공유 앨범이 쓰는 파일은 그 앨범 용량이다.
 * sharedOnly: 공유 앨범만 (구독하지 않은 구성원은 공유 앨범 공간에만 올린다).
 */
function inCloudAlbum(sharedOnly = false) {
  const shared = `EXISTS (SELECT 1 FROM shared_items s WHERE s.moment_id = moments.id)`;
  if (sharedOnly) return `(${shared})`;
  return `(${inPersonalAlbum(false)} OR ${shared})`;
}

/** 내 안전 앨범(공유 앨범 제외)에 담긴 기록. originalOnly: 원본을 보관하는 앨범만. */
function inPersonalAlbum(originalOnly: boolean) {
  return `EXISTS (
    SELECT 1 FROM album_moments am JOIN albums a ON a.id = am.album_id
    WHERE am.moment_id = moments.id AND am.deleted_at IS NULL AND a.deleted_at IS NULL AND a.kind = 'cloud'
      ${originalOnly ? "AND IFNULL(a.photo_quality, 'original') = 'original'" : ''})`;
}

/**
 * 원본을 보관할 기록. 원본 보관 공유 앨범에 담았거나, 안전 앨범에 담겼고 사진에서 '원본'을 골랐거나,
 * 사진에서 고르지 않았고 원본 보관 안전 앨범에 담긴 기록이다. 사진에서 '효율'을 골라도 원본 보관 공유 앨범이 쓰면 남긴다.
 * sharedOnly: 공유 앨범만 본다 (inCloudAlbum과 같다).
 */
function wantsOriginal(sharedOnly = false) {
  const shared = `EXISTS (SELECT 1 FROM shared_items s WHERE s.moment_id = moments.id AND s.photo_quality = 'original')`;
  if (sharedOnly) return `(${shared})`;
  return `(${shared} OR (${inPersonalAlbum(false)} AND (cloud_quality = 'original'
    OR (cloud_quality IS NULL AND ${inPersonalAlbum(true)}))))`;
}

/** 효율 보관 동영상(720p)이 필요한 기록: 안전 앨범에 담겼지만 원본은 보관하지 않는 동영상 */
const WANTS_COMPACT = `media_type = 'video' AND ${inCloudAlbum()} AND NOT ${wantsOriginal()}`;

export async function pendingUploads(db: SQLiteDatabase, now = new Date().toISOString(), sharedOnly = false) {
  // 표시용 사진을 먼저 올린다. 새 기기에서 사진첩을 빨리 보여주기 위해서다.
  // 공유 앨범만 올릴 때도 compact 판단은 모든 앨범을 본다 (원본 보관 안전 앨범에 있으면 compact가 필요 없다).
  return db.getAllAsync<PendingUpload>(
    `SELECT p.id, p.variant FROM (
       SELECT id, 'display' AS variant, 0 AS priority, taken_at FROM moments
       WHERE ${UPLOADABLE} AND display_uploaded = 0 AND ${inCloudAlbum(sharedOnly)}
       UNION ALL
       -- Cloud 표시용으로 만드는 썸네일은 맨 뒤에: 원본이 있는 다른 기기가 먼저 올리면 받지 않아도 된다.
       SELECT id, 'thumb', CASE WHEN source_asset_id IS NOT NULL AND source_missing = 0 THEN 0 ELSE 2 END, taken_at
       FROM moments
       WHERE ${THUMB_UPLOADABLE} AND thumb_uploaded = 0 AND ${inCloudAlbum(sharedOnly)}
       UNION ALL
       SELECT id, 'original', 1, taken_at FROM moments
       WHERE ${UPLOADABLE} AND original_uploaded = 0 AND ${wantsOriginal(sharedOnly)}
       UNION ALL
       SELECT id, 'compact', 1, taken_at FROM moments
       WHERE ${UPLOADABLE} AND ${WANTS_COMPACT} AND compact_uploaded = 0 AND ${inCloudAlbum(sharedOnly)}
     ) AS p
     LEFT JOIN upload_queue q ON q.moment_id = p.id AND q.variant = p.variant
     WHERE q.next_attempt_at IS NULL OR q.next_attempt_at <= ?
     ORDER BY p.priority, p.taken_at DESC`,
    now,
  );
}

/** 화면에 보이는 '올릴 사진' 수. 썸네일은 표시용에서 따라 만드는 작은 파일이라 세지 않는다. */
export async function countPendingUploads(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT
       SUM(CASE WHEN display_uploaded = 0 AND ${inCloudAlbum()} THEN 1 ELSE 0 END) +
       SUM(CASE WHEN original_uploaded = 0 AND ${wantsOriginal()} THEN 1 ELSE 0 END) +
       SUM(CASE WHEN compact_uploaded = 0 AND ${WANTS_COMPACT} THEN 1 ELSE 0 END) AS count
     FROM moments WHERE ${ON_DEVICE}`,
  );
  return row?.count ?? 0;
}

const RELEASE_BATCH = 500;

/**
 * 올라가 있지만 이제 어떤 안전 앨범에도 필요 없는 파일. 표시용·썸네일은 안전 앨범 밖, 원본은 보관할 원본이 아닐 때
 * (원본 보관 앨범에서 빠졌거나 사진에서 '효율'을 골랐을 때). 효율 보관으로 남은 동영상의 원본은 compact가 올라간 뒤에
 * 지운다. compact는 원본을 보관하면 지운다.
 */
function unwantedPhotos(db: SQLiteDatabase) {
  return db.getAllAsync<PendingUpload>(
    `SELECT id, 'display' AS variant FROM moments
     WHERE deleted_at IS NULL AND display_uploaded = 1 AND NOT ${inCloudAlbum()}
     UNION ALL
     SELECT id, 'thumb' FROM moments
     WHERE deleted_at IS NULL AND thumb_uploaded = 1 AND NOT ${inCloudAlbum()}
     UNION ALL
     SELECT id, 'original' FROM moments
     WHERE deleted_at IS NULL AND original_uploaded = 1 AND NOT ${wantsOriginal()}
       AND (media_type != 'video' OR compact_uploaded = 1 OR NOT ${inCloudAlbum()})
     UNION ALL
     SELECT id, 'compact' FROM moments
     WHERE deleted_at IS NULL AND compact_uploaded = 1
       AND (NOT ${inCloudAlbum()} OR (original_uploaded = 1 AND ${wantsOriginal()}))
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
        await db.runAsync(`UPDATE moments SET ${UPLOADED_COLUMN[photo.variant]} = 0 WHERE id = ?`, photo.id);
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
     WHERE deleted_at IS NULL AND (display_uploaded = 1 OR original_uploaded = 1) AND NOT ${inCloudAlbum()}`,
  );
  if (rows.length > 0) {
    const quality = rows.some((row) => row.original_uploaded === 1) ? 'original' : 'display';
    const albumId = await createAlbum(db, '이전에 보관한 사진', { quality });
    await updateAlbumMoments(db, albumId, { add: rows.map((row) => row.id) });
  }
  await setSetting(db, 'cloud_photos_adopted', true);
}

/** 서버가 공유 앨범 용량이 찼다고 알리는 413. 그 앨범의 사진만 미루고 다른 사진은 계속 올린다. */
const SHARED_ALBUM_FULL = 'shared album storage is full';
const SHARED_FULL_RETRY_MS = 6 * 60 * 60 * 1000;

/**
 * 올릴 사진을 차례로 올린다. 구독이 끝났거나(403) 개인 용량이 찼으면(413) 멈추고 그 이유를 던진다.
 * 그 밖의 실패(공유 앨범 용량이 찬 경우 포함)는 사진별로 기록하고 다음 사진으로 넘어간다.
 * sharedOnly: 구독하지 않았거나 유예 중이면 공유 앨범의 사진만 올린다 (앨범 용량에서 센다).
 */
export async function uploadPending(db: SQLiteDatabase, shouldStop: () => boolean, sharedOnly = false) {
  let uploaded = 0;
  for (const item of await pendingUploads(db, undefined, sharedOnly)) {
    if (shouldStop()) break;
    try {
      if (await uploadOne(db, item)) uploaded++;
    } catch (e) {
      if (e instanceof CloudError && e.status === 413 && e.message === SHARED_ALBUM_FULL) {
        await recordFailure(db, item, e, SHARED_FULL_RETRY_MS);
        continue;
      }
      if (e instanceof CloudError && (e.status === 403 || e.status === 413 || e.status === 401)) throw e;
      await recordFailure(db, item, e, e instanceof TooLargeError ? TOO_LARGE_RETRY_MS : undefined);
    }
  }
  // 화면의 'Cloud에 보관됨' 표시와 Cloud에만 있는 원본 수가 달라진다.
  if (uploaded > 0) notifyChange();
  return uploaded;
}

class TooLargeError extends Error {}

/** 올렸으면 true. 기기 사진첩에서 원본이 지워졌으면 지워진 사진으로 표시하고 false. */
async function uploadOne(db: SQLiteDatabase, { id, variant }: PendingUpload) {
  const row = await db.getFirstAsync<{
    source_asset_id: string | null;
    source_missing: number;
    media_type: string;
    width: number | null;
    height: number | null;
    taken_at: string;
    taken_tz_offset: number | null;
    lat: number | null;
    lng: number | null;
  }>(
    `SELECT source_asset_id, source_missing, media_type, width, height, taken_at, taken_tz_offset, lat, lng
     FROM moments WHERE id = ? AND deleted_at IS NULL`,
    id,
  );
  if (!row) return false; // 올리는 동안 기록에서 뺐다.
  if (!row.source_asset_id || row.source_missing) {
    // 기기 원본이 없으면 썸네일만 Cloud의 표시용으로 만든다 (다른 파일은 올릴 후보가 되지 않는다).
    if (variant !== 'thumb') return false;
    await uploadThumbFromCloud(id, row.width, row.height, row.media_type === 'video');
    await markUploaded(db, id, variant);
    return true;
  }
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
  const sourceUri = assetFileUri(info);
  if (!sourceUri) throw new Error('원본 사진을 받지 못했어요');

  const width = row.width || info.width;
  const height = row.height || info.height;
  const video = row.media_type === 'video';
  // 동영상 원본은 몇 GB일 수 있어 복사하지 않고 사진첩 파일을 그대로 올린다. 올리는 동안 파일이 바뀌면
  // MD5가 달라 저장소가 거절하고 다음에 다시 올린다. 사진첩 파일이므로 다 올린 뒤에도 지우지 않는다.
  const temporary = !(video && variant === 'original');
  const file =
    variant === 'compact'
      ? await makeCompactVideo(sourceUri)
      : variant === 'display' || variant === 'thumb'
        ? await (video
            ? makeVideoPoster(sourceUri, width, height, IMAGE_SIZES[variant], variant === 'display' ? imageMetadata(row) : undefined)
            : makeImage(sourceUri, width, height, IMAGE_SIZES[variant], variant === 'display' ? imageMetadata(row) : undefined))
        : video
          ? new File(sourceUri)
          : copyToUploadDir(sourceUri, info.filename);
  try {
    await uploadFile(id, variant, file, video);
  } finally {
    if (temporary && file.exists) file.delete();
  }
  await markUploaded(db, id, variant);
  return true;
}

async function markUploaded(db: SQLiteDatabase, id: string, variant: Variant) {
  await db.runAsync(`UPDATE moments SET ${UPLOADED_COLUMN[variant]} = 1 WHERE id = ?`, id);
  await db.runAsync('DELETE FROM upload_queue WHERE moment_id = ? AND variant = ?', id, variant);
}

/**
 * 기기 원본이 없는 기록의 썸네일을 Cloud 표시용으로 만든다. 표시용은 볼 때 받아 둔 캐시가 있으면 그대로 쓰고,
 * 없으면 잠깐 받아 쓰고 지운다 (사진마다 받은 표시용이 캐시에 쌓이지 않게).
 */
async function uploadThumbFromCloud(id: string, width: number | null, height: number | null, video: boolean) {
  // 원본이 있는 다른 기기가 이미 올렸으면 표시용을 받지 않는다 (서명 URL만 받는 가벼운 요청).
  const existing = await cloudApi.GET('/moments/{moment_id}/photo', {
    params: { path: { moment_id: id }, query: { variant: 'thumb' } },
  });
  if (existing.response.ok) return;
  if (existing.response.status !== 404) unwrap(existing);

  const cached = new File(cacheDir('cloud-display'), `${id}.jpg`);
  const temporary = cached.exists ? null : new File(cacheDir('upload'), `${id}-display.jpg`);
  let file: File | null = null;
  try {
    if (temporary) await downloadTo(id, 'display', temporary);
    const display = (temporary ?? cached).uri;
    // 표시용은 원본과 비율이 같다. 크기를 모르면(오래된 기록) 한 번 읽어 본다.
    const size = width && height ? { width, height } : await imageSize(display);
    file = await makeImage(display, size.width, size.height, IMAGE_SIZES.thumb);
    await uploadFile(id, 'thumb', file, video);
  } finally {
    if (file?.exists) file.delete();
    if (temporary?.exists) temporary.delete();
  }
}

// 사진첩 파일을 직접 올리면 올리는 동안 사진첩이 파일을 바꿀 수 있어(편집, iCloud) 잠깐 복사해 둔다.
function copyToUploadDir(sourceUri: string, filename: string) {
  const ext = extensionOf(filename) ?? extensionOf(sourceUri) ?? 'jpg';
  const file = new File(cacheDir('upload'), `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  new File(sourceUri).copy(file);
  return file;
}

async function uploadFile(id: string, variant: Variant, file: File, video: boolean) {
  const ext = variant === 'display' || variant === 'thumb' ? 'jpg' : variant === 'compact' ? 'mp4' : (extensionOf(file.name) ?? 'jpg');
  const contentType = CONTENT_TYPES[ext] ?? (video && variant === 'original' ? `video/${ext}` : `image/${ext}`);
  if (file.size > MAX_UPLOAD_BYTES) throw new TooLargeError('4GB보다 큰 동영상은 보관할 수 없어요');
  // 큰 원본을 JS 메모리에 올리지 않도록 해시는 네이티브로 조금씩 읽어 계산하고 업로드도 네이티브로 한다.
  // (expo-file-system의 md5는 iOS에서 파일 전체를 메모리에 올려 큰 동영상에서 앱이 멈춘다.)
  // 저장소가 이 MD5로 받은 내용을 확인한다 (Content-MD5).
  const md5 = await md5File(file.uri).catch(() => null);
  if (!md5) throw new Error('파일을 읽을 수 없어요');

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

/** 동영상의 대표 장면을 표시용·썸네일 이미지로 만든다 (첫 장면은 검은 화면일 때가 많아 1초 쯤에서). */
async function makeVideoPoster(uri: string, width: number, height: number, size: ImageSize, metadata?: ImageMetadata) {
  const frame = await getThumbnailAsync(uri, { time: POSTER_TIME_MS }).catch(() =>
    // 1초보다 짧은 영상
    getThumbnailAsync(uri, { time: 0 }),
  );
  try {
    return await makeImage(frame.uri, frame.width || width, frame.height || height, size, metadata);
  } finally {
    const file = new File(frame.uri);
    if (file.exists) file.delete();
  }
}

const POSTER_TIME_MS = 1000;

/** 효율 보관 동영상: 짧은 변 720px 이하의 H.264 mp4 */
async function makeCompactVideo(uri: string) {
  const file = new File(cacheDir('upload'), `${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  try {
    await transcodeVideo(uri, file.uri);
  } catch (e) {
    if (file.exists) file.delete();
    throw e;
  }
  return file;
}

type ImageSize = { longEdge: number; quality: number };
const IMAGE_SIZES: Record<'display' | 'thumb', ImageSize> = {
  display: { longEdge: DISPLAY_LONG_EDGE, quality: DISPLAY_QUALITY },
  thumb: { longEdge: THUMB_LONG_EDGE, quality: THUMB_QUALITY },
};

/** 긴 변을 size.longEdge 이하로 줄인 JPEG */
async function makeImage(uri: string, width: number, height: number, { longEdge, quality }: ImageSize, metadata?: ImageMetadata) {
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > longEdge) {
    context.resize(width >= height ? { width: longEdge, height: null } : { width: null, height: longEdge });
  }
  // 원본 해상도 이미지를 메모리에 올리므로 다 쓰면 바로 놓아준다.
  const image = await context.renderAsync();
  try {
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
    // 메타데이터를 쓸 수 없는 손상된 원본이 있어도 사진 보관 자체가 멈추면 안 된다.
    // 촬영 정보는 moments에 이미 별도로 보관·동기화돼 있다.
    if (metadata) await writeImageMetadata(result.uri, metadata).catch(() => {});
    return new File(result.uri);
  } finally {
    image.release();
    context.release();
  }
}

function imageMetadata(row: { taken_at: string; taken_tz_offset: number | null; lat: number | null; lng: number | null }): ImageMetadata {
  return { takenAt: row.taken_at, takenTzOffset: row.taken_tz_offset, lat: row.lat, lng: row.lng };
}

async function recordFailure(db: SQLiteDatabase, item: PendingUpload, error: unknown, retryAfterMs?: number) {
  const row = await db.getFirstAsync<{ attempts: number }>(
    'SELECT attempts FROM upload_queue WHERE moment_id = ? AND variant = ?',
    item.id,
    item.variant,
  );
  const attempts = (row?.attempts ?? 0) + 1;
  // 1분, 2분, 4분 … 최대 6시간 간격으로 다시 시도한다.
  const delay = retryAfterMs ?? Math.min(60_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
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

async function imageSize(uri: string) {
  const image = await ImageManipulator.manipulate(uri).renderAsync();
  try {
    return { width: image.width, height: image.height };
  } finally {
    image.release();
  }
}

/**
 * 기기 사진첩에 원본이 없는 기록(지워진 사진, 다른 기기에서 남긴 기록)의 Cloud 표시용 사진이나 썸네일.
 * 볼 때 한 장씩 받아 캐시에 둔다. OS가 캐시를 지우면 다시 받는다.
 */
export function cloudImageUri(momentId: string, variant: 'display' | 'thumb') {
  // 같은 사진을 두 곳(앨범 표지와 목록)에서 그려도 임시 파일이 겹치지 않게 한 번만 받는다.
  const key = `${variant}:${momentId}`;
  let download = imageDownloads.get(key);
  if (!download) {
    download = fetchImage(momentId, variant).finally(() => imageDownloads.delete(key));
    imageDownloads.set(key, download);
  }
  return download;
}

const imageDownloads = new Map<string, Promise<string>>();

async function fetchImage(momentId: string, variant: 'display' | 'thumb') {
  const file = new File(cacheDir(`cloud-${variant}`), `${momentId}.jpg`);
  if (!file.exists) await downloadTo(momentId, variant, file);
  return file.uri;
}

/**
 * 크게 볼 때 쓰는 Cloud 원본 주소 (짧게 유효한 서명 URL). 파일로 받지 않는다.
 * 동영상은 원본이나 효율 보관 영상(compact)을 이 주소로 바로 재생한다.
 */
export async function cloudOriginalUrl(momentId: string, variant: 'original' | 'compact' = 'original') {
  const info = unwrap(
    await cloudApi.GET('/moments/{moment_id}/photo', {
      params: { path: { moment_id: momentId }, query: { variant } },
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
  options: { momentIds?: string[]; includeEfficient?: boolean } = {},
) {
  // momentIds를 받으면 안전 앨범 하나만 복원한다. 빈 배열을 IN ()으로 넘기지 않아야 하므로
  // 권한을 묻기 전 여기서 바로 끝낸다.
  if (options.momentIds?.length === 0) return { total: 0, failed: 0, linked: 0 };
  // 읽기 권한까지 받는다. iOS의 '추가만 허용'으로는 저장한 사진을 다시 읽지 못해 기록에 이을 수 없고,
  // 저장은 됐는데 실패로 처리되어 다시 시도할 때 사진이 중복된다.
  const permission = await MediaLibrary.requestPermissionsAsync(false, MEDIA_PERMISSIONS);
  if (!permission.granted) throw new PhotoSaveError('사진을 저장하려면 사진 접근을 허용해 주세요.');

  const ids = options.momentIds ?? null;
  const rows = await db.getAllAsync<DownloadableMoment>(
    `SELECT id, original_filename, media_type, taken_at, taken_tz_offset, lat, lng,
       original_uploaded, display_uploaded, compact_uploaded
     FROM moments
     WHERE deleted_at IS NULL AND ${options.includeEfficient ? '(original_uploaded = 1 OR display_uploaded = 1 OR compact_uploaded = 1)' : 'original_uploaded = 1'}
       AND (source_asset_id IS NULL OR source_missing = 1)
       ${ids ? `AND id IN (${ids.map(() => '?').join(', ')})` : ''}
     ORDER BY taken_at`,
    ...(ids ?? []),
  );
  let failed = 0;
  let linked = 0;
  try {
    for (const [index, row] of rows.entries()) {
      onProgress(index, rows.length);
      try {
        const result = await saveOrFindPhoto(row, options.includeEfficient ?? false);
        if (result.linked) linked++;
        await db.runAsync(
          'UPDATE moments SET source_asset_id = ?, source_uri = ?, source_missing = 0, source_link_synced = 0 WHERE id = ?',
          result.asset.id,
          result.asset.uri,
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
  return { total: rows.length, failed, linked };
}

/**
 * 원본은 MD5까지 같은 사진첩 항목을 찾아 연결한다. 효율 보관 파일은 원본과 같은 바이트일 수 없으므로,
 * 안정적으로 만든 파일명으로 다시 찾는다. 이 파일명은 첫 다운로드에서도 사진첩에 그대로 저장된다.
 */
type DownloadableMoment = {
  id: string;
  original_filename: string | null;
  media_type: MediaType;
  taken_at: string;
  taken_tz_offset: number | null;
  lat: number | null;
  lng: number | null;
  original_uploaded: number;
  display_uploaded: number;
  compact_uploaded: number;
};

function downloadVariant(row: DownloadableMoment, includeEfficient: boolean): Variant {
  if (row.original_uploaded === 1) return 'original';
  if (!includeEfficient) throw new Error('원본이 없어요');
  if (row.media_type === 'video' && row.compact_uploaded === 1) return 'compact';
  if (row.display_uploaded === 1) return 'display';
  // compact만 남은 비정상 상태도 내려받을 수 있게 한다.
  if (row.compact_uploaded === 1) return 'compact';
  throw new Error('다운로드할 파일이 없어요');
}

async function saveOrFindPhoto(row: DownloadableMoment, includeEfficient: boolean) {
  const variant = downloadVariant(row, includeEfficient);
  const dir = cacheDir('upload');
  const file = new File(dir, `${row.id}-${variant}`);
  const ext = await downloadTo(row.id, variant, file);
  // 사진첩이 형식을 확장자로 판단하므로 받은 형식의 확장자를 붙인다.
  const filename = downloadedFilename(row, ext, variant);
  const named = new File(dir, filename);
  if (named.exists) named.delete();
  file.move(named);
  try {
    // 예전 효율 보관 JPEG에는 EXIF가 없을 수 있다. 기록에 둔 값으로 내려받는 파일에는 채운다.
    if (variant === 'display' && row.media_type === 'photo') await writeImageMetadata(named.uri, imageMetadata(row)).catch(() => {});
    const existing = variant === 'original' ? await findSameOriginal(row, named.uri) : await findSameNamedAsset(row, filename);
    if (existing) return { asset: existing, linked: true };
    return { asset: await MediaLibrary.createAssetAsync(named.uri), linked: false };
  } finally {
    if (named.exists) named.delete();
  }
}

function downloadedFilename(row: Pick<DownloadableMoment, 'id' | 'original_filename'>, ext: string, variant: Variant) {
  // 파일명은 원래 사진첩이 정한 값이지만, 동기화 데이터가 깨져 경로 문자가 들어와도 캐시 밖을 건드리지 않게 한다.
  const original = row.original_filename?.split(/[\\/]/).pop();
  const base = original?.replace(/\.[^.]+$/, '') || `Keepsake_${row.id}`;
  // 원본은 카메라·iCloud 사진과 비교할 수 있게 원래 파일명을 유지한다. 효율 파일은 서로 다른
  // IMG_0001 같은 이름이 임시 폴더에서 충돌하지 않게 기록 id를 붙이고, 다음 다운로드 때도 같은 이름을 쓴다.
  return variant === 'original' ? `${base}.${ext}` : `Keepsake_${row.id.slice(0, 8)}_${base}.${ext}`;
}

// 파일 이름과 촬영 시각이 가까운 항목만 읽어서, 원본 파일의 MD5까지 같은지 확인한다.
async function findSameOriginal(row: Pick<DownloadableMoment, 'original_filename' | 'taken_at'>, originalUri: string) {
  if (!row.original_filename) return null;
  const taken = new Date(row.taken_at).getTime();
  const page = await MediaLibrary.getAssetsAsync({
    mediaType: MEDIA_TYPES,
    createdAfter: taken - 2000,
    createdBefore: taken + 2001,
    first: 20,
  });
  const originalMd5 = await md5File(originalUri);
  for (const candidate of page.assets) {
    if (candidate.filename !== row.original_filename) continue;
    const info = await MediaLibrary.getAssetInfoAsync(candidate.id, { shouldDownloadFromNetwork: true }).catch(() => null);
    const uri = info && assetFileUri(info);
    if (uri && (await md5File(uri).catch(() => null)) === originalMd5) return candidate;
  }
  return null;
}

// 효율 보관본은 원본과 바이트가 달라 MD5를 비교하지 않는다. 첫 다운로드 때 쓴 파일명을 그대로 찾아 다시 저장하지 않는다.
async function findSameNamedAsset(row: Pick<DownloadableMoment, 'taken_at'>, filename: string) {
  const taken = new Date(row.taken_at).getTime();
  const page = await MediaLibrary.getAssetsAsync({
    mediaType: MEDIA_TYPES,
    createdAfter: taken - 2000,
    createdBefore: taken + 2001,
    first: 20,
  });
  return page.assets.find((asset) => asset.filename === filename) ?? null;
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
