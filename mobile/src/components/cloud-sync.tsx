import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { subscribeChanges } from '@/db/changes';
import { purgeRetiredSpaces } from '@/db/spaces';
import { syncCloud } from '@/lib/cloud/engine';
import { useCloudSession } from '@/lib/cloud/session';

// 로그인한 경우에만 동기화한다: 앱을 열 때·앞으로 돌아올 때, 그리고 기록이 바뀌고 잠시 뒤.
const CHANGE_DEBOUNCE_MS = 5000;

export function CloudSync() {
  const db = useSQLiteContext();
  const session = useCloudSession();
  const signedIn = Boolean(session);

  useEffect(() => {
    // 공간이 바뀌면 이전 DB가 닫힌 뒤이므로, 정리하기로 한 계정 공간 파일을 지울 수 있다.
    purgeRetiredSpaces().catch(() => {});
  }, [db]);

  useEffect(() => {
    if (!signedIn) return;
    syncCloud(db);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribeChanges = subscribeChanges(() => {
      clearTimeout(timer);
      timer = setTimeout(() => syncCloud(db, { onlyIfLocalChanges: true }), CHANGE_DEBOUNCE_MS);
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') syncCloud(db);
    });
    return () => {
      clearTimeout(timer);
      unsubscribeChanges();
      appState.remove();
    };
  }, [db, signedIn]);

  return null;
}
