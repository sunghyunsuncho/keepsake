import * as MediaLibrary from 'expo-media-library';
import type { SQLiteDatabase } from 'expo-sqlite';

import { momentIdsByAsset } from '@/db/moments';
import { getSettings, setSetting } from '@/db/settings';

// 놓친 사진: 고르기 지점보다 이전 시각으로 나중에 보관함에 들어온 사진 (다른 기기에서 받은 사진,
// 메신저로 받은 사진, 가져온 사진). 고르기 화면은 지점 이후만 보여주므로 따로 찾아서 위쪽에 묶어 보여준다.
//
// 보관함은 '추가된 시각'으로 찾을 수 없어서, 지점 이전 사진 수가 늘었는지 보고 늘어난 만큼을
// 마지막 확인 이후 수정 시각(modificationTime)이 가장 최근인 사진에서 고른다.
// iOS는 사진을 편집해도 수정 시각이 바뀌므로, 사진이 새로 늘었을 때만 찾는다.

// 한 번에 이보다 많이 늘면 놓친 사진이 아니라 보관함 전체가 바뀐 것(iCloud 첫 동기화, 권한 범위 변경)으로
// 보고 기준만 다시 잡는다.
const MAX_MISSED_AT_ONCE = 200;

let running: Promise<void> | null = null;

/** 보관함이 바뀌었을 수 있을 때(고르기 화면을 열 때, 보관함 변경, 앱 복귀) 부른다. */
export function checkMissedPhotos(db: SQLiteDatabase, { limited }: { limited: boolean }) {
  // 겹쳐 실행하면 같은 사진을 두 번 넣으므로, 실행 중이면 그 결과를 기다린다.
  running ??= check(db, limited)
    .catch(() => {
      // 다음 확인 때 다시 센다.
    })
    .finally(() => {
      running = null;
    });
  return running;
}

async function check(db: SQLiteDatabase, limited: boolean) {
  const settings = await getSettings(db);
  const cursor = settings.review_cursor;
  if (!cursor) return;
  const checkedAt = Date.now();
  const createdBefore = Math.min(new Date(cursor).getTime(), checkedAt) + 1;
  const { totalCount } = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    createdBefore,
    first: 1,
  });

  const base = settings.missed_baseline;
  const resetBaseline = () =>
    setSetting(db, 'missed_baseline', { cursor, count: totalCount, checked_at: checkedAt });

  // 일부 사진만 허용한 경우, 사용자가 보여줄 사진을 더 고르면 예전 사진이 '새로' 보이므로 찾지 않는다.
  if (!base || base.cursor !== cursor || limited) return resetBaseline();
  if (totalCount === base.count) return;
  const added = totalCount - base.count;
  if (added < 0 || added > MAX_MISSED_AT_ONCE) return resetBaseline();

  const page = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    createdBefore,
    sortBy: [[MediaLibrary.SortBy.modificationTime, false]],
    first: added,
  });
  const already = new Set(settings.missed_photo_ids);
  const candidates = page.assets.filter(
    (asset) => asset.modificationTime > base.checked_at && !already.has(asset.id),
  );
  const saved = await momentIdsByAsset(
    db,
    candidates.map((asset) => asset.id),
  );
  const found = candidates.filter((asset) => !saved.has(asset.id)).map((asset) => asset.id);

  if (found.length > 0) await setSetting(db, 'missed_photo_ids', [...found, ...already]);
  await resetBaseline();
}

/** 놓친 사진을 오래된 것부터. 그 사이 보관함에서 지워진 사진은 뺀다. */
export async function loadMissedPhotos(ids: string[]) {
  const assets = await Promise.all(
    // 썸네일만 그리면 되므로 iCloud에서 원본을 받지 않는다.
    ids.map((id) =>
      MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: false }).catch(() => null),
    ),
  );
  return assets
    .filter((asset): asset is MediaLibrary.AssetInfo => !!asset)
    .sort((a, b) => a.creationTime - b.creationTime);
}

/** [남기기]·[여기까지 봤어요]를 누르면 놓친 사진도 본 것으로 친다. */
export function clearMissedPhotos(db: SQLiteDatabase) {
  return setSetting(db, 'missed_photo_ids', []);
}
