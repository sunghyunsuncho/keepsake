import { File, Paths } from 'expo-file-system';
import createClient, { type Middleware } from 'openapi-fetch';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { API_URL } from '@/api/client';
import type { components, paths } from '@/api/schema';

// Cloud 로그인 상태. 서버가 발급한 토큰은 Keychain/Keystore에만 둔다.
// Local 사용자는 로그인하지 않으므로 세션이 없는 상태가 기본이다 (docs/PLAN.md §0).
const SESSION_KEY = 'keepsake.cloud.session';
// iOS Keychain은 앱을 지워도 남는다. 앱과 함께 지워지는 이 파일이 없으면 새로 설치한 것으로 보고 세션을 버린다.
const INSTALL_MARKER = 'keepsake-installed';
export const SPACE_KEY = 'keepsake.cloud.space';
// 서버가 지워진 계정의 토큰에 주는 401 내용 (backend current_user)
export const ACCOUNT_UNAVAILABLE = 'account unavailable';

export type CloudSession = { accessToken: string; userId: string };
export type Account = components['schemas']['AccountResponse'];

let session: CloudSession | null | undefined; // undefined: 아직 읽지 않음
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

let loading: Promise<CloudSession | null> | null = null;

export function loadSession(): Promise<CloudSession | null> {
  if (session !== undefined) return Promise.resolve(session);
  loading ??= readSession();
  return loading;
}

async function forgetSessionAfterReinstall() {
  try {
    const marker = new File(Paths.document, INSTALL_MARKER);
    if (marker.exists) return;
    // 표시를 먼저 남긴다. 반대 순서면 표시를 남기지 못할 때 실행할 때마다 로그인이 풀린다.
    marker.create();
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.deleteItemAsync(SPACE_KEY);
  } catch {
    // 지우지 못해도 앱은 열려야 한다.
  }
}

async function readSession() {
  await forgetSessionAfterReinstall();
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

type SessionLostHandler = (userId: string, accountGone: boolean) => Promise<void>;
let sessionLostHandler: SessionLostHandler | null = null;

/** 서버가 세션을 거절했을 때 할 정리를 engine이 등록한다. accountGone: 다른 기기 등에서 계정이 지워졌다. */
export function setSessionLostHandler(handler: SessionLostHandler) {
  sessionLostHandler = handler;
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
      const { accessToken, userId } = session;
      const body = (await response.clone().json().catch(() => null)) as { detail?: unknown } | null;
      await sessionLostHandler?.(userId, body?.detail === ACCOUNT_UNAVAILABLE);
      // 정리하는 사이 새로 로그인했으면 그 세션은 지우지 않는다.
      if (session?.accessToken !== accessToken) return response;
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
