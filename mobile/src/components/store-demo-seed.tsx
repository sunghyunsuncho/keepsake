import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import * as MediaLibrary from 'expo-media-library';
import { useSQLiteContext } from 'expo-sqlite';

import { createAlbum, listCustomAlbums, updateAlbumMoments } from '@/db/albums';
import { captureAsset } from '@/lib/capture';

/** 스토어 스크린샷 전용. 개발 빌드의 storeCapture=1 딥링크에서만 시뮬레이터 사진을 기록·앨범으로 구성한다. */
export function StoreDemoSeed() {
  const db = useSQLiteContext();
  const url = Linking.useLinkingURL();
  const ran = useRef(false);

  useEffect(() => {
    // 출시 앱에서 외부 링크 하나로 사용자의 사진첩을 훑어 데모 기록을 만들면 안 된다.
    // 캡처 도구(store-assets/simctl.ts)가 개발 빌드에 보내는 이름과도 맞춘다.
    if (!__DEV__ || ran.current || !url || Linking.parse(url).queryParams?.storeCapture !== '1') return;
    ran.current = true;
    void (async () => {
      const permission = await MediaLibrary.getPermissionsAsync(false, ['photo']);
      if (!permission.granted) throw new Error('스토어 데모 사진 권한이 필요합니다.');
      const page = await MediaLibrary.getAssetsAsync({ first: 100, mediaType: [MediaLibrary.MediaType.photo] });
      const assets = page.assets.filter((asset) => asset.filename.startsWith('keepsake-demo-')).slice(0, 8);
      if (assets.length < 4) throw new Error('keepsake-demo- 사진을 4장 이상 먼저 넣어주세요.');
      const reviewDate = new Date().toISOString().slice(0, 10);
      const ids = await Promise.all(
        assets.map((asset, index) => captureAsset(db, asset, reviewDate, index === 0 ? { id: '1' } : undefined)),
      );
      const existing = await listCustomAlbums(db);
      const ensure = async (title: string, selected: string[], cloud = false) => {
        let album = existing.find((item) => item.title === title && (cloud ? item.photo_quality !== null : item.photo_quality === null));
        const id = album?.id ?? await createAlbum(db, title, cloud ? { quality: 'original' } : undefined);
        await updateAlbumMoments(db, id, { add: selected });
        return id;
      };
      await ensure('주말의 작은 여행', ids.slice(0, 3));
      await ensure('오늘의 식탁', ids.slice(3, 5));
      await ensure('오래 남길 풍경', ids.slice(0, 4), true);
      await ensure('소중한 일상', ids.slice(4), true);
    })().catch((error) => console.warn('store demo seed failed', error));
  }, [db, url]);
  return null;
}
