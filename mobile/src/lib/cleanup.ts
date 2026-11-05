import { trashPhotos } from '@modules/photo-meta';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';

import { assetsKeptOnDevice } from '@/db/spaces';

// 사진 정리: 고르기를 마친 뒤, 살펴보고 남기지 않은 사진을 기기 사진첩에서 지운다 (docs/PLAN.md Phase 3).
// 남긴 사진은 절대 지우지 않는다. 기록은 사진첩 원본을 가리키기 때문이다. 로그아웃한 계정의 공간까지 모두 확인한다.
// 삭제는 OS 확인 창을 거친다. iOS는 '최근 삭제된 항목', Android 11+는 기기 휴지통(createTrashRequest)으로 간다.
// Android 10 이하는 휴지통 API가 없어 바로 지워지고 되돌릴 수 없다.

const FAVORITE_CHECK_BATCH = 20;
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

// 사진 목록이 수백 장일 수 있어 화면 주소에 넣지 않고 메모리로 넘긴다.
let pending: MediaLibrary.Asset[] = [];

export function setCleanupPhotos(assets: MediaLibrary.Asset[]) {
  pending = assets;
}

/** 정리 화면을 취소하면 후보도 버린다. 사진첩의 파일에는 아무 변화가 없다. */
export function clearCleanupPhotos() {
  pending = [];
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

/** 살펴본 사진 중 기록으로 남기지 않은 사진. 안내하는 수와 정리 화면의 목록이 같아지도록 파일 이름까지 확인한다. */
export async function withoutKeptPhotos(assets: MediaLibrary.Asset[]) {
  if (assets.length === 0) return assets;
  // 확인하지 못해도 정리 화면과 지우기 직전에 다시 확인한다.
  const saved = await assetsKeptOnDevice(assets).catch(() => new Set<string>());
  return assets.filter((asset) => !saved.has(asset.id));
}

/** 정리 화면에 보여줄 사진. 고르기 화면 이후에 달라졌을 수 있어 남긴 사진을 다시 확인하고, 즐겨찾기도 뺀다. */
export async function loadCleanupPhotos() {
  const saved = await assetsKeptOnDevice(pending);
  const candidates = pending.filter((asset) => !saved.has(asset.id));
  if (Platform.OS !== 'ios') return candidates; // Android는 즐겨찾기 여부를 주지 않는다.

  const result: MediaLibrary.Asset[] = [];
  for (let i = 0; i < candidates.length; i += FAVORITE_CHECK_BATCH) {
    const batch = candidates.slice(i, i + FAVORITE_CHECK_BATCH);
    const favorites = await Promise.all(batch.map(isFavorite));
    batch.forEach((asset, index) => {
      if (!favorites[index]) result.push(asset);
    });
  }
  return result;
}

async function isFavorite(asset: MediaLibrary.Asset) {
  try {
    const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false });
    return info.isFavorite === true;
  } catch {
    // 확인하지 못한 사진은 지우자고 권하지 않는다.
    return true;
  }
}

/**
 * 사진첩에서 지우고 지운 수를 돌려준다. 그 사이 기록으로 남긴 사진은 지우지 않는다.
 * 사용자가 OS 확인 창에서 취소하면 예외가 난다.
 */
export async function deleteLeftBehindPhotos(assets: MediaLibrary.Asset[]) {
  const saved = await assetsKeptOnDevice(assets);
  const targets = assets.filter((asset) => !saved.has(asset.id));
  if (targets.length === 0) return 0;
  if (canTrash) {
    if (!(await trashPhotos(targets.map((asset) => asset.id)))) throw new Error('cancelled');
  } else {
    await MediaLibrary.deleteAssetsAsync(targets);
  }
  pending = [];
  return targets.length;
}
