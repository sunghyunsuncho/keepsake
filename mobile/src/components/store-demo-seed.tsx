import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import * as MediaLibrary from 'expo-media-library';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSQLiteContext } from 'expo-sqlite';

import {
  connectAlbumToCloud,
  createAlbum,
  deleteAlbum,
  listCustomAlbums,
  setAlbumCover,
  updateAlbumMoments,
  type PhotoQuality,
} from '@/db/albums';
import { listMoments, softDeleteMoment, updateMoment } from '@/db/moments';
import { getSettings, setSetting } from '@/db/settings';
import { getLocalDb } from '@/db/spaces';
import { captureAsset } from '@/lib/capture';
import { setCleanupPhotos } from '@/lib/cleanup';
import { syncCloud } from '@/lib/cloud/engine';
import { loadSession } from '@/lib/cloud/session';
import { ALLOCATION_STEPS, addToSharedAlbum, createSharedAlbum, deleteSharedAlbum, listSharedAlbums } from '@/lib/cloud/shared';
import { localDateKey } from '@/lib/dates';

import demo from './store-demo-photos.json';

// 사진 목록과 앨범 구성은 store-demo-photos.json 한 곳에 둔다. 사진첩에 넣는 쪽(scripts/store_demo_photos.py)도 같은 파일을 읽는다.
// 사진은 'keepsake-demo-<key>.jpg'의 <key>(또는 그 앞부분)로 앨범에 적는다.
// keep: false는 살펴보고 남기지 않은 사진(정리 후보), today: true는 아직 고르지 않은 오늘 사진이다.
type DemoPhoto = {
  file: string;
  takenAt: string;
  place?: string;
  memo?: string;
  keep?: boolean;
  today?: boolean;
  detail?: boolean;
};
type DemoCover = { photo?: string; emoji?: string };

const PREFIX = 'keepsake-demo-';
const keyOf = (file: string) => file.slice(PREFIX.length).replace(/\.jpg$/, '');

/**
 * 스토어 스크린샷 전용. 개발 빌드의 storeCapture=1 딥링크에서만 시뮬레이터 사진을 기록·앨범으로 구성한다.
 * 이미 구성했으면 다시 만들지 않고, storeReset=1을 함께 주면 지금 공간의 기록·앨범(내가 만든 공유 앨범 포함)을 지우고 새로 만든다.
 */
export function StoreDemoSeed() {
  const db = useSQLiteContext();
  const url = Linking.useLinkingURL();
  const ran = useRef(false);

  useEffect(() => {
    // 출시 앱에서 외부 링크 하나로 사용자의 사진첩을 훑어 데모 기록을 만들면 안 된다.
    // 캡처 도구(store-assets/simctl.ts)가 개발 빌드에 보내는 이름과도 맞춘다.
    if (!__DEV__ || ran.current || !url) return;
    const params = Linking.parse(url).queryParams;
    if (params?.storeCapture !== '1') return;
    ran.current = true;
    void seedStoreDemo(db, params.storeReset === '1').catch((error) => console.warn('store demo seed failed', error));
  }, [db, url]);
  return null;
}

async function seedStoreDemo(db: SQLiteDatabase, reset: boolean) {
  const photos: DemoPhoto[] = demo.photos;
  // 앨범 화면은 메모·장소가 사진과 함께 보이는 이야기 보기로 캡처한다.
  await setSetting(db, 'album_zoom', 'story');
  const seeded = (await listCustomAlbums(db)).some((album) => album.title === demo.albums[0].title);
  if (seeded && !reset) return showCleanupCandidates(db);

  const permission = await MediaLibrary.getPermissionsAsync(false, ['photo']);
  if (!permission.granted) throw new Error('스토어 데모 사진 권한이 필요합니다.');
  // iOS 사진첩은 넣은 사진의 이름을 IMG_0001.JPG처럼 바꾸므로, 사진마다 다르게 적은 촬영 시각으로 찾는다.
  const page = await MediaLibrary.getAssetsAsync({ first: 1000, mediaType: [MediaLibrary.MediaType.photo] });
  const byTime = new Map(page.assets.map((asset) => [asset.creationTime, asset]));
  const assets = new Map<string, MediaLibrary.Asset>();
  for (const photo of photos) {
    const asset = byTime.get(Date.parse(photo.takenAt));
    if (asset) assets.set(photo.file, asset);
  }
  const missing = photos.filter((photo) => !assets.has(photo.file)).map((photo) => photo.file);
  if (missing.length > 0) throw new Error(`데모 사진을 먼저 넣어주세요 (make demo-photos): ${missing.join(', ')}`);

  const session = await loadSession();
  if (reset) await clearSpace(db, Boolean(session));

  // 상세 화면 캡처 경로(moment/1)를 위해 ID를 정한다. 이전 구성에서 지운 같은 ID의 행이 남아 있으면 비운다.
  await db.runAsync("DELETE FROM moments WHERE id = '1' AND deleted_at IS NOT NULL");
  const ids = new Map<string, string>();
  for (const photo of photos) {
    if (photo.keep === false || photo.today) continue;
    const asset = assets.get(photo.file)!;
    const id = await captureAsset(db, asset, localDateKey(new Date(asset.creationTime).toISOString()), photo.detail ? { id: '1' } : undefined);
    // 장소는 영어로 직접 적는다. 좌표로 찾는 이름은 한국어라 en/ja 화면에 어울리지 않는다.
    await updateMoment(db, id, { memo: photo.memo, place_name: photo.place });
    ids.set(keyOf(photo.file), id);
  }
  const pick = (selector: string | string[]) =>
    typeof selector === 'string'
      ? [...ids].filter(([key]) => key.startsWith(selector)).map(([, id]) => id)
      : selector.map((key) => ids.get(key)).filter((id): id is string => Boolean(id));
  const cover = async (albumId: string, value: DemoCover | undefined) => {
    if (value?.photo) await setAlbumCover(db, albumId, { mode: 'photo', momentId: ids.get(value.photo) });
    else if (value?.emoji) await setAlbumCover(db, albumId, { mode: 'design', emoji: value.emoji });
  };

  for (const album of demo.albums as { title: string; photos: string | string[]; cover?: DemoCover; secure?: PhotoQuality }[]) {
    const id = await createAlbum(db, album.title);
    await updateAlbumMoments(db, id, { add: pick(album.photos) });
    await cover(id, album.cover);
    if (album.secure) await connectAlbumToCloud(db, id, album.secure);
  }
  for (const album of demo.secureAlbums as { title: string; photos: string[]; cover?: DemoCover; quality: PhotoQuality }[]) {
    const id = await createAlbum(db, album.title, { quality: album.quality });
    await updateAlbumMoments(db, id, { add: pick(album.photos) });
    await cover(id, album.cover);
  }
  if (session) {
    for (const album of demo.sharedAlbums) {
      const quality = album.quality as PhotoQuality;
      const shared = await createSharedAlbum({
        title: album.title,
        relation: album.relation as 'family',
        photo_quality: quality,
        display_name: album.displayName,
        allocated_bytes: ALLOCATION_STEPS[0],
      });
      await addToSharedAlbum(db, shared.id, pick(album.photos), quality);
    }
    // 안전 사진첩 화면이 Cloud 사진으로 채워지도록 바로 올린다.
    void syncCloud(db);
  }

  // 고르기 화면: 오늘 사진만 아직 보지 않은 사진으로 남기고, 남기지 않은 사진은 정리 후보로 둔다.
  const firstToday = Math.min(...photos.filter((photo) => photo.today).map((photo) => assets.get(photo.file)!.creationTime));
  await setSetting(db, 'review_cursor', new Date(firstToday - 60_000).toISOString());
  await setSetting(db, 'missed_photo_ids', []);
  await setSetting(db, 'picking_album_id', null);
  await setSetting(db, 'on_this_day_hidden', null);
  await setSetting(
    db,
    'cleanup_candidate_ids',
    photos.filter((photo) => photo.keep === false).map((photo) => assets.get(photo.file)!.id),
  );
  await showCleanupCandidates(db);
}

/** 지금 공간의 기록과 앨범을 지운다. 계정 공간이면 Local의 기록도 지워 '기기 기록 올리기' 안내가 나오지 않게 한다. */
async function clearSpace(db: SQLiteDatabase, signedIn: boolean) {
  const local = await getLocalDb();
  for (const target of new Set([db, local])) {
    for (const moment of await listMoments(target)) await softDeleteMoment(target, moment.id);
    for (const kind of ['custom', 'cloud'] as const) {
      for (const album of await listCustomAlbums(target, kind)) await deleteAlbum(target, album.id);
    }
  }
  if (signedIn) {
    for (const album of await listSharedAlbums()) if (album.is_owner) await deleteSharedAlbum(album.id);
  }
}

/** 정리 화면은 고르기 화면의 카드에서 후보를 넘겨받는다. 캡처는 딥링크로 바로 열므로 미리 넘겨 둔다. */
async function showCleanupCandidates(db: SQLiteDatabase) {
  setCleanupPhotos((await getSettings(db)).cleanup_candidate_ids);
}
