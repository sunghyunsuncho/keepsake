import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { components } from '@/api/schema';
import { albumMomentIds, deleteAlbum } from '@/db/albums';
import { notifyChange } from '@/db/changes';
import { inTransaction } from '@/db/moments';
import { CloudError, cloudApi, unwrap } from '@/lib/cloud/session';
import { pushChanges } from '@/lib/cloud/sync';
import { MEDIA_PERMISSIONS } from '@/lib/photos';
import { cacheDir } from '@/lib/storage';

// 공유 앨범 (docs/PLAN.md §0 '공유 앨범', docs/PRICING.md). 가족·친구·파트너가 함께 사진을 담는 안전 앨범이다.
// 여러 사람이 동시에 고치므로 서버가 기준이고, 화면은 서버에서 바로 읽는다 (안전 사진첩처럼 인터넷이 필요하다).
// 항목은 올린 사람의 기록과 그 기록의 Cloud 파일을 가리킨다. 파일은 복사하지 않고, 용량만 서버가 나눠 센다:
// 앨범이 쓰는 파일은 앨범 용량(구성원이 각자 떼어 준 할당의 합)에서 센다.
// 동기화할 때마다 내 항목 목록을 shared_items에 받아 두고, 업로드·정리는 안전 앨범과 같은 규칙으로 한다.

export type SharedAlbumSummary = components['schemas']['SharedAlbumSummary'];
export type SharedAlbumDetail = components['schemas']['SharedAlbumDetail'];
export type SharedItem = components['schemas']['SharedItemOut'];
export type SharedMember = components['schemas']['MemberOut'];
export type Relation = SharedAlbumSummary['relation'];
type Quality = SharedAlbumSummary['photo_quality'];
export type SharedAlbumList = components['schemas']['SharedAlbumList'];
export type LeavePreview = components['schemas']['LeavePreview'];

const GB = 1024 * 1024 * 1024;
/** 할당을 고르는 단계 (GB). 내 남은 용량을 넘는 것은 고를 수 없다. */
export const ALLOCATION_STEPS = [1, 5, 10, 20, 30, 50].map((gb) => gb * GB);

export const RELATIONS: Record<Relation, { label: string; icon: 'home-outline' | 'people-outline' | 'heart-outline' | 'albums-outline' }> = {
  family: { label: '가족', icon: 'home-outline' },
  friends: { label: '친구', icon: 'people-outline' },
  partner: { label: '파트너', icon: 'heart-outline' },
  other: { label: '함께', icon: 'albums-outline' },
};
export const RELATION_ORDER: Relation[] = ['family', 'friends', 'partner', 'other'];
export const DISPLAY_NAME_MAX = 20;

/** 앱 밖에서 받은 초대 링크 (keepsake://shared-albums/join?code=…). 앱이 없으면 코드만 옮겨 적는다. */
export function inviteMessage(title: string, code: string) {
  return `Keepsake 공유 앨범 '${title}'에 초대해요.\n앱의 안전 사진첩 → [초대 코드로 참여]에서 코드를 입력해 주세요.\n\n초대 코드: ${code}\nkeepsake://shared-albums/join?code=${code}`;
}

/** 서버의 내 항목 목록으로 shared_items를 바꾼다. pull 뒤, 필요 없는 파일을 지우기 전에 부른다. */
export async function refreshSharedItems(db: SQLiteDatabase) {
  const { items } = unwrap(await cloudApi.GET('/shared-albums/my-items'));
  await inTransaction(db, async () => {
    await db.runAsync('DELETE FROM shared_items');
    for (const item of items) {
      await db.runAsync(
        'INSERT OR REPLACE INTO shared_items (album_id, moment_id, photo_quality) VALUES (?, ?, ?)',
        item.album_id,
        item.moment_id,
        item.photo_quality,
      );
    }
  });
}

export async function listSharedAlbums() {
  return unwrap(await cloudApi.GET('/shared-albums')).albums;
}

/** 목록과 함께 내 남은 용량·앨범 수 한도를 받는다 (만들기·참여 화면). */
export async function sharedAlbumOverview(): Promise<SharedAlbumList> {
  return unwrap(await cloudApi.GET('/shared-albums'));
}

export async function getSharedAlbum(albumId: string) {
  return unwrap(await cloudApi.GET('/shared-albums/{album_id}', { params: { path: { album_id: albumId } } }));
}

/** 앨범의 항목을 모두 받는다. 촬영 시각이 최근인 것부터. */
export async function listSharedItems(albumId: string) {
  const all: SharedItem[] = [];
  let cursor = 0;
  for (;;) {
    const page = unwrap(
      await cloudApi.GET('/shared-albums/{album_id}/items', {
        params: { path: { album_id: albumId }, query: { cursor } },
      }),
    );
    all.push(...page.items);
    cursor = page.cursor;
    if (!page.has_more) break;
  }
  return all.sort((a, b) => ((b.taken_at ?? b.added_at) < (a.taken_at ?? a.added_at) ? -1 : 1));
}

/** 내가 공유 앨범에 담은 사진 수 (나간 앨범에 남긴 것 포함). 계정을 지우면 모두 사라진다고 알린다. */
export async function mySharedItemCount() {
  return unwrap(await cloudApi.GET('/shared-albums/my-items')).items.length;
}

/** 이 앨범에 내가 담은 기록. 고르는 화면에서 이미 담은 사진을 표시한다. */
export async function mySharedMomentIds(db: SQLiteDatabase, albumId: string) {
  return new Set((await mySharedQualities(db, albumId)).keys());
}

/** 이 앨범에 내가 담은 기록과 그 사진의 화질 (사진마다 고른 화질, 없으면 앨범 화질). */
export async function mySharedQualities(db: SQLiteDatabase, albumId: string) {
  const rows = await db.getAllAsync<{ moment_id: string; photo_quality: Quality }>(
    'SELECT moment_id, photo_quality FROM shared_items WHERE album_id = ?',
    albumId,
  );
  return new Map(rows.map((row) => [row.moment_id, row.photo_quality]));
}

/** 이 기록을 담은 공유 앨범 수. 기록을 지울 때 공유 앨범에도 남아 있다고 알리고 함께 뺄지 묻는다. */
export async function sharedAlbumCount(db: SQLiteDatabase, momentId: string) {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM shared_items WHERE moment_id = ?',
    momentId,
  );
  return row?.count ?? 0;
}

/**
 * 내 기록을 모든 공유 앨범에서 뺀다 (기록을 지우며 공유 앨범에서도 빼기로 했을 때).
 * 서버에서 뺀 뒤에 기록을 지워야, 지운 기록의 파일을 앨범이 계속 쓰는 일이 없다. 인터넷이 필요하다.
 */
export async function removeFromSharedAlbums(db: SQLiteDatabase, momentIds: string[]) {
  unwrap(await cloudApi.POST('/shared-albums/my-items/remove', { body: { moment_ids: momentIds } }));
  await inTransaction(db, async () => {
    for (const momentId of momentIds) await db.runAsync('DELETE FROM shared_items WHERE moment_id = ?', momentId);
  });
  notifyChange();
}

export async function createSharedAlbum(body: components['schemas']['CreateSharedAlbumRequest']) {
  const album = unwrap(await cloudApi.POST('/shared-albums', { body }));
  notifyChange();
  return album;
}

export async function updateSharedAlbum(albumId: string, body: components['schemas']['UpdateSharedAlbumRequest']) {
  const album = unwrap(await cloudApi.PATCH('/shared-albums/{album_id}', { params: { path: { album_id: albumId } }, body }));
  notifyChange();
  return album;
}

export async function deleteSharedAlbum(albumId: string) {
  unwrap(await cloudApi.DELETE('/shared-albums/{album_id}', { params: { path: { album_id: albumId } } }));
  notifyChange();
}

/**
 * 내 기록을 공유 앨범에 담는다. chosen: 이번에 담는 사진에만 따로 고른 화질 (null이면 앨범 화질). 서버에 기록이 있어야 담기므로 먼저 보낸다.
 * 이미 안전 보관한 파일은 다시 올리지 않고, 없는 파일은 다음 동기화에서 앨범 화질로 올린다 (앨범 용량에서 센다).
 * 담은 수를 돌려준다.
 */
export async function addToSharedAlbum(
  db: SQLiteDatabase,
  albumId: string,
  momentIds: string[],
  quality: Quality,
  chosen: Quality | null = null,
) {
  await pushChanges(db);
  let added = 0;
  for (let i = 0; i < momentIds.length; i += 500) {
    const batch = momentIds.slice(i, i + 500);
    added += unwrap(
      await cloudApi.POST('/shared-albums/{album_id}/items', {
        params: { path: { album_id: albumId } },
        body: { moment_ids: batch, photo_quality: chosen },
      }),
    ).added;
    // 다음 동기화가 내 항목 목록을 다시 받기 전에도 바로 올리기 시작하도록 미리 적어 둔다.
    await rememberSharedItems(db, albumId, batch, () => chosen ?? quality);
  }
  notifyChange();
  return added;
}

/**
 * 나만 보던 안전 앨범을 공유 앨범으로 바꾼다. 서버가 같은 요청에서 앨범을 만들고 사진을 모두 담는다
 * (할당이 그 사진들보다 작으면 아무것도 만들지 않는다). 파일은 다시 올리거나 옮기지 않는다: 같은 Cloud 파일을
 * 공유 앨범이 가리키고, 그 용량을 개인 사용량에서 앨범 용량으로 옮겨 센다.
 * 원래 안전 앨범을 지우기 전에 shared_items에 적어 두므로 정리가 파일을 지우지 않는다.
 * 사진마다 고른 화질(moments.cloud_quality)도 그 사진의 공유 앨범 화질로 옮긴다.
 */
export async function convertToSharedAlbum(
  db: SQLiteDatabase,
  albumId: string,
  body: Omit<components['schemas']['CreateSharedAlbumRequest'], 'moment_ids'>,
) {
  await pushChanges(db);
  const momentIds = [...(await albumMomentIds(db, albumId))];
  const rows = await db.getAllAsync<{ id: string; cloud_quality: Quality }>(
    `SELECT m.id, m.cloud_quality FROM album_moments am JOIN moments m ON m.id = am.moment_id
     WHERE am.album_id = ? AND am.deleted_at IS NULL AND m.cloud_quality IS NOT NULL`,
    albumId,
  );
  const chosen = Object.fromEntries(rows.map((row) => [row.id, row.cloud_quality]));
  const shared = await createSharedAlbum({ ...body, moment_ids: momentIds, photo_qualities: chosen });
  await rememberSharedItems(db, shared.id, momentIds, (id) => chosen[id] ?? shared.photo_quality);
  await deleteAlbum(db, albumId);
  return shared;
}

async function rememberSharedItems(
  db: SQLiteDatabase,
  albumId: string,
  momentIds: string[],
  qualityOf: (momentId: string) => Quality,
) {
  await inTransaction(db, async () => {
    for (const momentId of momentIds) {
      await db.runAsync(
        'INSERT OR REPLACE INTO shared_items (album_id, moment_id, photo_quality) VALUES (?, ?, ?)',
        albumId,
        momentId,
        qualityOf(momentId),
      );
    }
  });
}

/** 한 사람이 담은 사진을 모두 뺀다 (넘친 용량 정리, 관리자 또는 본인). */
export async function removeAuthorItems(albumId: string, authorId: string) {
  unwrap(
    await cloudApi.DELETE('/shared-albums/{album_id}/authors/{author_id}/items', {
      params: { path: { album_id: albumId, author_id: authorId } },
    }),
  );
  notifyChange();
}

/** 올린 사람이나 관리자만 뺄 수 있다 (서버가 확인한다). 내 기록과 파일 정리는 다음 동기화가 한다. */
export async function removeSharedItem(albumId: string, itemId: string) {
  unwrap(
    await cloudApi.DELETE('/shared-albums/{album_id}/items/{item_id}', {
      params: { path: { album_id: albumId, item_id: itemId } },
    }),
  );
  notifyChange();
}

/**
 * 사진마다 화질을 바꾼다 (null이면 앨범 화질로 되돌린다). 올린 사람이나 관리자만 바꿀 수 있다.
 * 올린 사람의 기기가 다음 동기화에서 내 항목 목록을 다시 받아 원본을 올리거나 정리한다.
 */
export async function setSharedItemsQuality(albumId: string, itemIds: string[], quality: Quality | null) {
  unwrap(
    await cloudApi.POST('/shared-albums/{album_id}/items/quality', {
      params: { path: { album_id: albumId } },
      body: { item_ids: itemIds, photo_quality: quality },
    }),
  );
  notifyChange();
}

/** 여러 장을 한 번에 뺀다. 하나라도 뺄 수 없는 사진이 섞이면 서버가 아무것도 빼지 않는다. */
export async function removeSharedItems(albumId: string, itemIds: string[]) {
  unwrap(
    await cloudApi.POST('/shared-albums/{album_id}/items/remove', {
      params: { path: { album_id: albumId } },
      body: { item_ids: itemIds },
    }),
  );
  notifyChange();
}

export async function createInvite(albumId: string) {
  const invite = unwrap(await cloudApi.POST('/shared-albums/{album_id}/invite', { params: { path: { album_id: albumId } } }));
  notifyChange();
  return invite;
}

export async function revokeInvite(albumId: string) {
  unwrap(await cloudApi.DELETE('/shared-albums/{album_id}/invite', { params: { path: { album_id: albumId } } }));
  notifyChange();
}

export async function previewInvite(code: string) {
  return unwrap(await cloudApi.GET('/shared-albums/invites/{code}', { params: { path: { code: normalizeCode(code) } } }));
}

export async function joinSharedAlbum(code: string, displayName: string, allocatedBytes: number) {
  const album = unwrap(
    await cloudApi.POST('/shared-albums/join', {
      body: { code: normalizeCode(code), display_name: displayName, allocated_bytes: allocatedBytes },
    }),
  );
  notifyChange();
  return album;
}

export function normalizeCode(code: string) {
  return code.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

export async function updateMember(albumId: string, memberId: string, body: components['schemas']['UpdateMemberRequest']) {
  const album = unwrap(
    await cloudApi.PATCH('/shared-albums/{album_id}/members/{member_id}', {
      params: { path: { album_id: albumId, member_id: memberId } },
      body,
    }),
  );
  notifyChange();
  return album;
}

/** 나가거나(내 id) 내보낸다. photos: 그 사람이 담은 사진을 앨범에 남길지. 할당은 함께 빠진다. */
export async function removeMember(albumId: string, memberId: string, photos: 'keep' | 'remove') {
  unwrap(
    await cloudApi.DELETE('/shared-albums/{album_id}/members/{member_id}', {
      params: { path: { album_id: albumId, member_id: memberId }, query: { photos } },
    }),
  );
  notifyChange();
}

/** 구성원이 빠지면 용량이 얼마나 줄고 넘치는지. 사진을 남길지 고르기 전에 보여준다. */
export async function leavePreview(albumId: string, memberId: string) {
  return unwrap(
    await cloudApi.GET('/shared-albums/{album_id}/members/{member_id}/leave-preview', {
      params: { path: { album_id: albumId, member_id: memberId } },
    }),
  );
}

/** 소유자를 넘긴다 (받는 사람은 구독 중이고 공유 앨범을 더 가질 수 있어야 한다). */
export async function transferOwner(albumId: string, userId: string) {
  const album = unwrap(
    await cloudApi.POST('/shared-albums/{album_id}/owner', {
      params: { path: { album_id: albumId } },
      body: { user_id: userId },
    }),
  );
  notifyChange();
  return album;
}

type SharedVariant = SharedItem['stored_variants'][number];

async function sharedItemDownload(albumId: string, itemId: string, variant: SharedVariant) {
  return unwrap(
    await cloudApi.GET('/shared-albums/{album_id}/items/{item_id}/photo', {
      params: { path: { album_id: albumId, item_id: itemId }, query: { variant } },
    }),
  );
}

/** 다른 구성원이 올린 사진의 서명 URL. 동영상은 이 주소로 바로 재생한다. */
export async function sharedItemUrl(albumId: string, itemId: string, variant: SharedVariant) {
  return (await sharedItemDownload(albumId, itemId, variant)).download_url;
}

/** 기기 사진첩에 저장할 수 있는 항목: 다른 구성원이 담았고, 아직 저장하지 않았고, 파일이 있다. 내 사진은 내 기록이다. */
export async function unsavedSharedItems(db: SQLiteDatabase, items: SharedItem[]) {
  const rows = await db.getAllAsync<{ item_id: string }>('SELECT item_id FROM shared_downloads');
  const saved = new Set(rows.map((row) => row.item_id));
  return items.filter((item) => !item.is_mine && !saved.has(item.id) && item.stored_variants.length > 0);
}

export class SharedSaveError extends Error {}

/** 기기 사진첩에 저장할 파일 이름: Keepsake_20250525_143012_ab12 (촬영 시각 + 같은 시각의 사진이 겹치지 않게 항목 id 앞 4자리). */
function savedFileName(item: SharedItem) {
  const taken = item.taken_at ? new Date(item.taken_at) : new Date(item.added_at);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = Number.isNaN(taken.getTime())
    ? 'shared'
    : `${taken.getFullYear()}${pad(taken.getMonth() + 1)}${pad(taken.getDate())}_${pad(taken.getHours())}${pad(taken.getMinutes())}${pad(taken.getSeconds())}`;
  return `Keepsake_${stamp}_${item.id.slice(0, 4)}`;
}

/**
 * 공유 앨범의 사진을 기기 사진첩에 저장한다 (앨범 정리 전에 챙기기, 함께 본 사진을 내 사진첩에 두기).
 * 원본 → 720p 동영상 → 표시용 순으로 있는 가장 좋은 파일을 받는다. 저장한 항목은 기억해 두고 다시 받지 않는다.
 * 기록(나의 순간들)으로 만들지는 않는다: 남길지는 고르기에서 사용자가 정한다.
 */
export async function saveSharedItemsToLibrary(
  db: SQLiteDatabase,
  albumId: string,
  items: SharedItem[],
  onProgress: (done: number, total: number) => void,
) {
  const permission = await MediaLibrary.requestPermissionsAsync(false, MEDIA_PERMISSIONS);
  if (!permission.granted) throw new SharedSaveError('사진을 저장하려면 사진 접근을 허용해 주세요.');
  let failed = 0;
  for (const [index, item] of items.entries()) {
    onProgress(index, items.length);
    const variant = item.stored_variants.includes('original')
      ? 'original'
      : item.stored_variants.includes('compact')
        ? 'compact'
        : 'display';
    const dir = cacheDir('upload');
    try {
      const info = await sharedItemDownload(albumId, item.id, variant);
      const partial = new File(dir, `${item.id}.partial`);
      await File.downloadFileAsync(info.download_url, partial, { idempotent: true });
      if (partial.size !== info.size) {
        partial.delete();
        throw new Error('받은 사진 크기가 달라요');
      }
      // 사진첩이 형식을 확장자로 판단하므로 받은 형식의 확장자를 붙인다. 이름은 사진첩에서 알아보기 쉽게 촬영 시각으로 짓는다.
      const named = new File(dir, `${savedFileName(item)}.${info.extension}`);
      if (named.exists) named.delete();
      partial.move(named);
      try {
        const asset = await MediaLibrary.createAssetAsync(named.uri);
        await db.runAsync(
          'INSERT OR REPLACE INTO shared_downloads (item_id, asset_id, saved_at) VALUES (?, ?, ?)',
          item.id,
          asset.id,
          new Date().toISOString(),
        );
      } finally {
        if (named.exists) named.delete();
      }
    } catch (e) {
      if (e instanceof CloudError && (e.status === 401 || e.status === 403)) throw e;
      failed++;
    }
  }
  onProgress(items.length, items.length);
  notifyChange();
  return { total: items.length, failed };
}

const imageDownloads = new Map<string, Promise<string>>();

/** 공유 항목의 표시용 사진이나 썸네일을 캐시에 받아 둔다 (안전 사진첩의 cloudImageUri와 같다). */
export function sharedImageUri(albumId: string, itemId: string, variant: 'display' | 'thumb') {
  const key = `${variant}:${itemId}`;
  let download = imageDownloads.get(key);
  if (!download) {
    download = (async () => {
      const file = new File(cacheDir(`shared-${variant}`), `${itemId}.jpg`);
      if (!file.exists) {
        const partial = new File(file.parentDirectory, `${itemId}.jpg.partial`);
        await File.downloadFileAsync(await sharedItemUrl(albumId, itemId, variant), partial, { idempotent: true });
        partial.move(file);
      }
      return file.uri;
    })().finally(() => imageDownloads.delete(key));
    imageDownloads.set(key, download);
  }
  return download;
}
