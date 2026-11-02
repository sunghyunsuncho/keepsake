import * as MediaLibrary from 'expo-media-library';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { dayRange } from '@/lib/dates';

export type PhotoAccess = 'undetermined' | 'denied' | 'limited' | 'all';

// 사진(photo)만 요청한다. Android 13+에서 동영상 권한을 따로 묻지 않도록 app.json의
// granularPermissions와 맞춘다.
const GRANULAR: MediaLibrary.GranularPermission[] = ['photo'];

function toAccess(response: MediaLibrary.PermissionResponse): PhotoAccess {
  if (response.status === 'undetermined') return 'undetermined';
  if (!response.granted) return 'denied';
  // iOS 14+ "선택한 사진만", Android 14+ "일부 사진만 허용"
  return response.accessPrivileges === 'limited' ? 'limited' : 'all';
}

/** 일부 사진만 허용한 상태면 사진을 찾지 못해도 지워졌다고 볼 수 없다. */
export async function hasLimitedPhotoAccess() {
  const { accessPrivileges } = await MediaLibrary.getPermissionsAsync(false, GRANULAR);
  return accessPrivileges === 'limited';
}

/**
 * 사진 접근 상태. 설정 앱에서 권한을 바꾸고 돌아오는 경우를 위해 앱이 다시 활성화될 때도
 * 확인한다. `canAskAgain`이 false면 시스템 대화상자가 더 이상 뜨지 않으므로 설정으로 안내한다.
 */
export function usePhotoAccess() {
  const [access, setAccess] = useState<PhotoAccess | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(true);

  const apply = useCallback((response: MediaLibrary.PermissionResponse) => {
    setAccess(toAccess(response));
    setCanAskAgain(response.canAskAgain);
  }, []);

  const refresh = useCallback(async () => {
    apply(await MediaLibrary.getPermissionsAsync(false, GRANULAR));
  }, [apply]);

  const request = useCallback(async () => {
    apply(await MediaLibrary.requestPermissionsAsync(false, GRANULAR));
  }, [apply]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return { access, canAskAgain, request, refresh };
}

/** 제한된 접근 상태에서 사용자가 보여줄 사진을 더 고르게 한다 (iOS, Android 14+). */
export function presentLimitedPicker() {
  return MediaLibrary.presentPermissionsPickerAsync(['photo']);
}

/**
 * 사진 보관함이 바뀌면(사진 추가, 제한된 접근 범위 변경) 호출된다.
 * 카메라 앱에서 찍고 돌아오는 경우처럼 백그라운드에 있는 동안의 변경은 이벤트가 오지 않을 수 있어
 * (특히 Android) 앱이 다시 활성화될 때도 호출한다.
 */
export function subscribeLibraryChanges(listener: () => void) {
  // iCloud 동기화나 사진 여러 장 저장·삭제 중에는 이벤트가 연달아 온다. 그때마다 목록을 다시 읽지 않게 모은다.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const library = MediaLibrary.addListener(() => {
    clearTimeout(timer);
    timer = setTimeout(listener, LIBRARY_CHANGE_DELAY_MS);
  });
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') listener();
  });
  return () => {
    clearTimeout(timer);
    library.remove();
    appState.remove();
  };
}

const LIBRARY_CHANGE_DELAY_MS = 500;

/**
 * 고르기 화면의 '아직 안 본 사진': since(이 시각까지는 이미 봤다) 이후에 찍은 사진을
 * 오래된 것부터 한 쪽씩 가져온다. 필름 한 롤을 처음부터 넘겨 보듯 순서대로 보여준다.
 */
export async function getPhotosSince(since: Date, after?: string) {
  const page = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    // createdAfter가 경계 시각을 포함할 수 있어 1ms 뒤부터 찾는다.
    createdAfter: since.getTime() + 1,
    sortBy: [[MediaLibrary.SortBy.creationTime, true]],
    first: INBOX_PAGE_SIZE,
    after,
  });
  return {
    assets: page.assets,
    endCursor: page.endCursor,
    hasNextPage: page.hasNextPage,
    totalCount: page.totalCount,
  };
}

/** since 이후에 찍은 사진 수. 사진 접근 권한이 없으면 null. */
export async function countPhotosSince(since: Date) {
  const { granted } = await MediaLibrary.getPermissionsAsync(false, GRANULAR);
  if (!granted) return null;
  const page = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    createdAfter: since.getTime() + 1,
    first: 1,
  });
  return page.totalCount;
}

const INBOX_PAGE_SIZE = 200;
const PAGE_SIZE = 300;

/** 그날(현지 시간) 촬영한 사진 전체를 촬영 시각 순으로 가져온다. */
export async function getDayPhotos(dateKey: string) {
  const { start, end } = dayRange(dateKey);
  const assets: MediaLibrary.Asset[] = [];
  let after: string | undefined;

  // 하루치는 보통 수십~수백 장이라 모두 불러오고, 화면에서는 썸네일만 그린다.
  for (;;) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.photo,
      createdAfter: start,
      createdBefore: end,
      sortBy: [[MediaLibrary.SortBy.creationTime, true]],
      first: PAGE_SIZE,
      after,
    });
    assets.push(...page.assets);
    if (!page.hasNextPage) break;
    after = page.endCursor;
  }
  return assets;
}
