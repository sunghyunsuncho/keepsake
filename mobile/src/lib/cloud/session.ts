import createClient, { type Middleware } from 'openapi-fetch';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { API_URL } from '@/api/client';
import type { components, paths } from '@/api/schema';
import { retireAccountSpace } from '@/db/spaces';

// Cloud 로그인 상태. 서버가 발급한 토큰은 Keychain/Keystore에만 둔다.
// Local 사용자는 로그인하지 않으므로 세션이 없는 상태가 기본이다 (docs/PLAN.md §0).
const SESSION_KEY = 'keepsake.cloud.session';

export type CloudSession = { accessToken: string; userId: string };
export type Account = components['schemas']['AccountResponse'];

let session: CloudSession | null | undefined; // undefined: 아직 읽지 않음
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export async function loadSession(): Promise<CloudSession | null> {
  if (session !== undefined) return session;
  // 저장소를 읽지 못해도(복원된 기기의 키 불일치 등) 앱은 Local로 열려야 한다.
  const raw = await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
  session = parseSession(raw);
  if (raw && !session) await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
  emit();
  return session;
}

function parseSession(raw: string | null): CloudSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.accessToken === 'string' && typeof value.userId === 'string') {
      return { accessToken: value.accessToken, userId: value.userId };
    }
  } catch {
    // 깨진 값은 로그아웃 상태로 본다.
  }
  return null;
}

export async function saveSession(next: CloudSession | null) {
  if (next) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next));
  else await SecureStore.deleteItemAsync(SESSION_KEY);
  session = next;
  emit();
}

export function useCloudSession() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (session === undefined) loadSession();
      return () => listeners.delete(listener);
    },
    () => session,
  );
}

export class CloudError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// 토큰을 붙이고, 만료·무효(401)면 로그아웃 상태로 돌린다. 기기 데이터는 그대로 남는다.
const auth: Middleware = {
  async onRequest({ request }) {
    const current = await loadSession();
    if (current) request.headers.set('Authorization', `Bearer ${current.accessToken}`);
    return request;
  },
  async onResponse({ request, response }) {
    // 이전 계정의 토큰으로 보낸 요청이 늦게 401을 받아도, 그 사이 새로 로그인한 세션은 지우지 않는다.
    if (response.status === 401 && session && request.headers.get('Authorization') === `Bearer ${session.accessToken}`) {
      // 계정이 지워졌으면(다른 기기, 응답을 받지 못한 삭제 요청) 이 기기 사진의 기록을 Local에 남긴다.
      const { userId } = session;
      const body = (await response.clone().json().catch(() => null)) as { detail?: unknown } | null;
      if (body?.detail === 'account unavailable') await retireAccountSpace(userId).catch(() => {});
      await saveSession(null);
    }
    return response;
  },
};

export const cloudApi = createClient<paths>({ baseUrl: API_URL });
cloudApi.use(auth);

/** openapi-fetch 결과에서 data를 꺼내고, 실패면 CloudError를 던진다. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    const detail = (result.error as { detail?: unknown } | undefined)?.detail;
    throw new CloudError(result.response.status, typeof detail === 'string' ? detail : 'Cloud 요청 실패');
  }
  return result.data as T;
}
