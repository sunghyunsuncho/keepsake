import { existingIds, favoriteIds, trashPhotos } from '@modules/photo-meta';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';

import type { SQLiteDatabase } from 'expo-sqlite';

import { getSettings, setSetting } from '@/db/settings';
import { assetsKeptOnDevice, getLocalDb } from '@/db/spaces';
import { hasLimitedPhotoAccess } from '@/lib/photos';

// 사진 정리: 고르기를 마친 뒤, 살펴보고 남기지 않은 사진을 기기 사진첩에서 지운다 (docs/PLAN.md Phase 3).
// 남긴 사진은 절대 지우지 않는다. 기록은 사진첩 원본을 가리키기 때문이다. 로그아웃한 계정의 공간까지 모두 확인한다.
// 삭제는 OS 확인 창을 거친다. iOS는 '최근 삭제된 항목', Android 11+는 기기 휴지통(createTrashRequest)으로 간다.
// Android 10 이하는 휴지통 API가 없어 바로 지워지고 되돌릴 수 없다.

const ASSET_INFO_BATCH = 20;
const canTrash = Platform.OS === 'android' && Platform.Version >= 30;

export const DELETE_NOTICE =
  Platform.OS === 'ios'
    ? "지운 사진은 사진 앱의 '최근 삭제된 항목'에 30일 동안 있어요. iCloud 사진을 쓰고 있다면 다른 기기에서도 함께 지워져요."
    : canTrash
      ? '지운 사진은 기기 휴지통으로 옮겨지고, 일정 기간이 지나면 완전히 지워져요.'
      : '지운 사진은 되돌릴 수 없어요.';

// Android는 즐겨찾기 여부를 주지 않아 즐겨찾기도 목록에 나온다. 빠진다고 안내하면 소중한 사진을 지울 수 있다.
export const CLEANUP_GUIDE =
  Platform.OS === 'ios'
    ? '지우지 않을 사진을 눌러 주세요. 남긴 사진과 즐겨찾기는 여기에 나오지 않아요.'
    : '지우지 않을 사진을 눌러 주세요. 남긴 사진은 여기에 나오지 않아요.';

// 정리 후보(살펴보고 남기지 않은 사진)의 id는 기기 설정에 둔다. 다른 화면을 다녀오거나 앱을 다시 열어도
// 사용자가 [그대로 두기]를 누르거나 정리를 마칠 때까지 고르기 화면의 정리 후보 카드가 남는다.

// 정리 후보는 읽고 고쳐 쓰는 곳이 여럿이라(더하기, 정리 마치기, 지워진 후보 빼기) 겹치면 늦게 쓴 쪽이 앞의 결과를
// 덮는다 (정리에서 '지우지 않을 사진'으로 뺀 후보가 되살아나는 등). 쓰기를 차례로 한다.
// 앞의 쓰기가 실패해도 다음 쓰기는 한다 (대기열은 실패를 삼키고, 실패는 그 쓰기를 부른 쪽에만 알린다).
let candidateWrites: Promise<void> = Promise.resolve();

function updateCandidates(task: () => Promise<unknown>): Promise<void> {
  const next = candidateWrites.then(task).then(() => {});
  candidateWrites = next.catch(() => {});
  return next;
}

/** 새로 살펴보고 남기지 않은 사진을 정리 후보에 더한다. 이미 있는 후보는 그대로 둔다. */
export function addCleanupCandidates(db: SQLiteDatabase, assets: MediaLibrary.Asset[]) {
  if (assets.length === 0) return Promise.resolve();
  return updateCandidates(async () => {
    const current = (await getSettings(db)).cleanup_candidate_ids;
    const known = new Set(current);
    const added = assets.map((asset) => asset.id).filter((id) => !known.has(id));
    if (added.length > 0) await setSetting(db, 'cleanup_candidate_ids', [...current, ...added]);
  });
}

/** [그대로 두기]: 이번 정리 후보를 모두 내려놓는다. 사진첩에는 아무 변화가 없다. */
export function keepCleanupCandidates(db: SQLiteDatabase) {
  return updateCandidates(() => setSetting(db, 'cleanup_candidate_ids', []));
}

/**
 * 그 사이 사진첩에서 지워진 정리 후보를 뺀다. 카드의 수가 정리 화면과 같아지게 한다 (정리 화면도 열 때 뺀다).
 * iOS는 한 번에 확인할 수 있어 사진첩이 바뀔 때마다 한다. Android는 한 장씩 물어야 해서 정리 화면에서만 뺀다.
 */
export async function removeGoneCleanupCandidates(db: SQLiteDatabase) {
  if (Platform.OS !== 'ios') return;
  const current = (await getSettings(db)).cleanup_candidate_ids;
  if (current.length === 0) return;
  const existing = await existingIds(current);
  // 이전 네이티브 빌드이거나, 일부 사진만 허용해 찾지 못한 것일 수 있으면 건드리지 않는다.
  if (!existing || (await hasLimitedPhotoAccess())) return;
  const found = new Set(existing);
  await removeCleanupCandidates(new Set(current.filter((id) => !found.has(id))));
}

/** 정리 후보였던 사진을 나중에 남겼으면 후보에서 뺀다. 정리 화면은 남긴 사진을 빼므로 카드의 수도 맞춘다. */
export function removeKeptCleanupCandidates(assetIds: string[]) {
  return removeCleanupCandidates(new Set(assetIds));
}

function removeCleanupCandidates(ids: ReadonlySet<string>) {
  if (ids.size === 0) return Promise.resolve();
  return updateCandidates(async () => {
    const db = await getLocalDb();
    const current = (await getSettings(db)).cleanup_candidate_ids;
    const next = current.filter((id) => !ids.has(id));
    if (next.length !== current.length) await setSetting(db, 'cleanup_candidate_ids', next);
  });
}

// 정리 화면에 넘길 후보 id. 사진 목록이 수백 장일 수 있어 화면 주소에 넣지 않고 메모리로 넘긴다.
let pending: string[] = [];

export function setCleanupPhotos(assetIds: string[]) {
  pending = assetIds;
}

/** 정리 화면을 취소하면 넘겨받은 목록을 버린다. 사진첩의 파일에는 아무 변화가 없고, 정리 후보는 그대로 남는다. */
export function clearCleanupPhotos() {
  pending = [];
}

/** 정리 화면에 넘겨받은 후보를 모두 처리했다(지웠거나, 다시 확인해 보니 지울 사진이 없음). 정리 후보에서 뺀다. */
export async function finishCleanup() {
  const ids = new Set(pending);
  pending = [];
  await removeCleanupCandidates(ids);
}

/** 살펴본 사진(until까지) 중 이번에 남긴 사진을 뺀 것. */
export function photosLeftBehind(
  shown: MediaLibrary.Asset[],
  keptIds: Iterable<string>,
  until: number,
) {
  const kept = new Set(keptIds);
  return shown.filter((asset) => asset.creationTime <= until && !kept.has(asset.id));
}

/**
 * 살펴본 사진 중 기록으로 남기지 않은 사진. 안내하는 수와 정리 화면의 목록이 같아지도록 파일 이름까지 확인하고,
 * 정리 화면처럼 iOS 즐겨찾기도 뺀다.
 */
export async function withoutKeptPhotos(assets: MediaLibrary.Asset[]) {
  if (assets.length === 0) return assets;
  // 확인하지 못해도 정리 화면과 지우기 직전에 다시 확인한다.
  const [saved, favorites] = await Promise.all([
    assetsKeptOnDevice(assets).catch(() => new Set<string>()),
    Platform.OS === 'ios'
      ? favoriteIds(assets.map((asset) => asset.id)).then((ids) => new Set(ids), () => new Set<string>())
      : new Set<string>(),
  ]);
  return assets.filter((asset) => !saved.has(asset.id) && !favorites.has(asset.id));
}

/**
 * 정리 화면에 보여줄 사진. 고르기 화면 이후에 달라졌을 수 있어 남긴 사진을 다시 확인하고, 즐겨찾기도 뺀다.
 * 그 사이 기기 사진첩에서 지워진 사진은 정리 후보에서도 뺀다.
 */
export async function loadCleanupPhotos() {
  const found: MediaLibrary.AssetInfo[] = [];
  const gone = new Set<string>();
  for (let i = 0; i < pending.length; i += ASSET_INFO_BATCH) {
    const batch = pending.slice(i, i + ASSET_INFO_BATCH);
    const infos = await Promise.all(
      batch.map((id) =>
        MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: false }).then(
          // 타입은 null을 말하지 않지만, 사진첩에 없는 사진이면 null을 준다 (lib/cloud/photos.ts와 같다).
          (info: MediaLibrary.AssetInfo | null): MediaLibrary.AssetInfo | 'gone' => info ?? 'gone',
          () => null, // 확인하지 못한 사진은 지우자고 권하지 않는다 (후보에는 남긴다).
        ),
      ),
    );
    infos.forEach((info, index) => {
      if (info === 'gone') gone.add(batch[index]);
      // Android는 즐겨찾기 여부를 주지 않는다 (CLEANUP_GUIDE).
      else if (info && !(Platform.OS === 'ios' && info.isFavorite)) found.push(info);
    });
  }
  await removeCleanupCandidates(gone);
  const saved = await assetsKeptOnDevice(found);
  return found.filter((asset) => !saved.has(asset.id));
}

/**
 * 사진첩에서 지우고 지운 수를 돌려준다. 그 사이 기록으로 남긴 사진은 지우지 않는다.
 * 사용자가 OS 확인 창에서 취소하면 예외가 난다.
 */
export async function deleteLeftBehindPhotos(assets: MediaLibrary.Asset[]) {
  const saved = await assetsKeptOnDevice(assets);
  const targets = assets.filter((asset) => !saved.has(asset.id));
  if (targets.length === 0) {
    // 모두 남기기로 고른 것도 정리를 끝낸 것이다. 후보 카드를 다시 띄우지 않는다.
    await finishCleanup();
    return 0;
  }
  if (canTrash) {
    const ids = (video: boolean) => targets.filter((a) => (a.mediaType === 'video') === video).map((a) => a.id);
    if (!(await trashPhotos(ids(false), ids(true)))) throw new Error('cancelled');
  } else {
    await MediaLibrary.deleteAssetsAsync(targets);
  }
  // 지우지 않겠다고 누른 사진도 사용자가 확인을 마친 것이라 후보에서 함께 뺀다.
  await finishCleanup();
  return targets.length;
}
