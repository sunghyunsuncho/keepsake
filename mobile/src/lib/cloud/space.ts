import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { accountDatabaseName, DATABASE_NAME } from '@/db/schema';
import { loadSession, SPACE_KEY, useCloudSession } from '@/lib/cloud/session';

// 지금 어느 공간을 보는지. Cloud를 읽을 수 있는 계정만 계정 공간을 쓴다.
// 오프라인으로 앱을 열어도 같은 공간을 보여주도록 기기에 저장한다.

let space: string | null | undefined; // undefined: 아직 읽지 않음
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

async function loadSpace() {
  if (space !== undefined) return;
  // 재설치면 세션과 함께 이 값도 지워진다. 그 뒤에 읽는다.
  await loadSession();
  space = await SecureStore.getItemAsync(SPACE_KEY).catch(() => null);
  emit();
}

export async function setCloudSpace(userId: string | null) {
  if (userId) await SecureStore.setItemAsync(SPACE_KEY, userId);
  else await SecureStore.deleteItemAsync(SPACE_KEY);
  space = userId;
  emit();
}

/** 지금 열어야 할 DB 이름. 세션이 없거나 다른 계정이면 Local이다. 읽는 중에는 undefined. */
export function useActiveDatabaseName() {
  const session = useCloudSession();
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (space === undefined) loadSpace();
      return () => listeners.delete(listener);
    },
    () => space,
  );
  if (session === undefined || current === undefined) return undefined;
  return session && session.userId === current ? accountDatabaseName(current) : DATABASE_NAME;
}
