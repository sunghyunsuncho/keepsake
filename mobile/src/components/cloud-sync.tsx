import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { subscribeChanges } from '@/db/changes';
import { purgeRetiredSpaces } from '@/db/spaces';
import { syncCloud } from '@/lib/cloud/engine';
import { useCloudSession } from '@/lib/cloud/session';

// 로그인한 경우에만 동기화한다: 앱을 열 때·앞으로 돌아올 때·인터넷이 다시 연결될 때, 그리고 기록이 바뀌고 잠시 뒤.
const CHANGE_DEBOUNCE_MS = 5000;

export function CloudSync() {
  const db = useSQLiteContext();
  const session = useCloudSession();
  const signedIn = Boolean(session);

  useEffect(() => {
    // 옮기다 멈춘 계정 공간을 마저 옮기고 파일을 지운다. 아직 열려 있는 파일은 다음 실행에서 지워진다.
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
    // 오프라인으로 앱을 열면 계정 상태를 받지 못한다. 연결되는 순간 다시 받아 안전 사진첩을 연다.
    let wasOffline = false;
    const network = Network.addNetworkStateListener(({ isConnected, isInternetReachable }) => {
      const offline = isConnected === false || isInternetReachable === false;
      if (wasOffline && !offline) syncCloud(db);
      wasOffline = offline;
    });
    return () => {
      clearTimeout(timer);
      unsubscribeChanges();
      appState.remove();
      network.remove();
    };
  }, [db, signedIn]);

  return null;
}
