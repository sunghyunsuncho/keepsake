import * as Network from 'expo-network';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { getSettings, setSetting } from '@/db/settings';
import { countPendingUploads, downloadMissingDisplays, uploadPending } from '@/lib/cloud/photos';
import { clearPurchasesUser, setPurchasesUser } from '@/lib/cloud/purchases';
import { registerPushToken } from '@/lib/cloud/push';
import {
  type Account,
  CloudError,
  cloudApi,
  loadSession,
  saveSession,
  unwrap,
} from '@/lib/cloud/session';
import { signOutProviders } from '@/lib/cloud/sign-in';
import { hasLocalChanges, pullChanges, pushChanges, resetCloudState } from '@/lib/cloud/sync';

// Cloud 동기화 한 바퀴: 구독 상태 확인 → 바뀐 기록 push → 다른 기기 변경 pull → 사진 업로드 → 사진 받기.
// 화면은 cloudState만 보여주고, 허용 여부는 서버가 준 subscription 값을 그대로 따른다.

export type CloudState = {
  account: Account | null;
  running: boolean;
  /** 마지막 동기화에서 생긴 문제 (사용자에게 보여줄 문장) */
  problem: string | null;
  pendingUploads: number;
  lastSyncedAt: string | null;
};

let state: CloudState = {
  account: null,
  running: false,
  problem: null,
  pendingUploads: 0,
  lastSyncedAt: null,
};
const listeners = new Set<() => void>();

function update(patch: Partial<CloudState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function useCloudState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

let current: Promise<void> | null = null;
// 도는 중에 다시 요청되면 끝난 뒤 한 번 더 돈다. 'local'은 보낼 변경이 있을 때만 도는 요청이다.
// (동기화 자체가 pull 지점을 저장하며 변경 알림을 내므로, 'local'로 다시 돌면 할 일 없이 끝난다.)
let again: 'none' | 'local' | 'full' = 'none';
let stopRequested = false;
let pushTokenChecked = false;

/**
 * 동기화를 한 번 돌린다. 이미 도는 중이면 끝난 뒤 한 번 더 돈다 (그 사이 바뀐 것을 놓치지 않도록).
 * onlyIfLocalChanges: 데이터가 바뀔 때마다 부르는 경우. 보낼 것이 없으면 네트워크를 쓰지 않는다.
 */
export function syncCloud(db: SQLiteDatabase, options: { onlyIfLocalChanges?: boolean } = {}) {
  const mode = options.onlyIfLocalChanges ? 'local' : 'full';
  if (current) {
    if (again !== 'full') again = mode;
    return current;
  }
  current = (async () => {
    let next: 'none' | 'local' | 'full' = mode;
    try {
      while (next !== 'none' && !stopRequested) {
        again = 'none';
        await runOnce(db, next === 'local');
        next = again;
      }
    } finally {
      current = null;
      again = 'none';
      stopRequested = false;
    }
  })();
  return current;
}

async function runOnce(db: SQLiteDatabase, onlyIfLocalChanges: boolean) {
  const session = await loadSession();
  if (!session) {
    if (state.account) update({ account: null, problem: null });
    return;
  }
  if (onlyIfLocalChanges && !(await hasLocalChanges(db))) {
    update({ pendingUploads: await countPendingUploads(db) });
    return;
  }
  update({ running: true });
  try {
    const network = await Network.getNetworkStateAsync();
    if (network.isInternetReachable === false) {
      update({ problem: '인터넷에 연결되면 이어서 백업할게요.' });
      return;
    }
    // 결제 SDK 문제로 백업이 멈추지 않게 한다 (사용자 연결은 다음 동기화나 구매 전에 다시 한다).
    await setPurchasesUser(session.userId).catch(() => {});
    const account = unwrap(await cloudApi.GET('/account'));
    update({ account });
    // 기기의 '보냄' 표시와 pull 지점은 한 계정의 한 세대 기준이다. 다른 계정으로 로그인했거나
    // (세션 만료 뒤 다른 계정으로 들어온 경우 포함) 서버가 유예 만료로 데이터를 지웠으면 처음부터 다시 맞춘다.
    const accountKey = `${account.user_id}:${account.data_generation}`;
    if ((await getSettings(db)).cloud_account_key !== accountKey) {
      await resetCloudState(db);
      await setSetting(db, 'cloud_account_key', accountKey);
    }
    const { subscription } = account;
    if (!pushTokenChecked && subscription.status !== 'none') {
      // 토큰은 바뀔 수 있으므로 앱을 실행할 때마다 한 번 알린다 (권한은 구독 직후에만 묻는다).
      pushTokenChecked = true;
      registerPushToken({ ask: false });
    }
    let problem: string | null = null;
    let pushed = 0;
    let uploaded = 0;

    if (subscription.can_upload) pushed = await pushChanges(db);
    // 사진을 올리기 전에 받는다: 이미 Cloud에 있는 사진(다시 로그인한 계정, 다른 기기가 올린 사진)은
    // pull이 '올라감'으로 표시하므로 다시 올리지 않는다.
    const pulled = subscription.can_download ? await pullChanges(db) : 0;
    if (subscription.can_upload) {
      const settings = await getSettings(db);
      const cellular = network.type === Network.NetworkStateType.CELLULAR;
      if (settings.wifi_only_upload && cellular) {
        problem = 'Wi-Fi에 연결되면 사진을 올릴게요.';
      } else {
        try {
          uploaded = await uploadPending(db, () => stopRequested);
        } catch (e) {
          if (e instanceof CloudError && e.status === 413) {
            problem = 'Cloud 용량이 가득 찼어요. 새 사진은 올리지 않고, 이미 올린 사진은 그대로 있어요.';
          } else throw e;
        }
      }
    }
    // 빠진 표시용 사진 찾기는 모든 기록의 파일을 확인하므로, 기록을 고칠 때마다 도는 동기화에서는
    // 새로 받은 기록이 있을 때만 한다.
    if (subscription.can_download && (pulled > 0 || !onlyIfLocalChanges)) {
      await downloadMissingDisplays(db, () => stopRequested);
    }
    // 보낸 기록(삭제 포함)이나 올린 사진이 있으면 사용량이 바뀌었으므로 다시 받는다.
    const refreshed = pushed > 0 || uploaded > 0 ? unwrap(await cloudApi.GET('/account')) : account;
    update({ account: refreshed, problem, lastSyncedAt: new Date().toISOString() });
  } catch (e) {
    update({ problem: describe(e) });
  } finally {
    update({ running: false, pendingUploads: await countPendingUploads(db) });
  }
}

function describe(e: unknown) {
  if (e instanceof CloudError) {
    if (e.status === 401) return '로그인이 만료됐어요. 다시 로그인해 주세요.';
    if (e.status === 403) return '구독 상태가 바뀌었어요. 잠시 후 다시 확인할게요.';
    return '서버와 연결하지 못했어요. 잠시 후 다시 시도할게요.';
  }
  return '동기화하지 못했어요. 잠시 후 다시 시도할게요.';
}

/**
 * 로그인 직후: RevenueCat 사용자를 맞추고 화면에 쓸 계정 상태를 받는다.
 * 기기의 기록을 이 계정에 올리는 동기화는 세션이 생기면 CloudSync가 시작한다.
 */
export async function afterSignIn(userId: string) {
  // 실패해도 로그인은 끝났다. 구매는 사용자가 연결되지 않았으면 스스로 거절한다.
  await setPurchasesUser(userId).catch(() => {});
  const account = unwrap(await cloudApi.GET('/account'));
  update({ account, problem: null });
  return account;
}

/** 구매·구매 복원 직후: webhook을 기다리지 않고 서버가 RevenueCat을 직접 확인하게 한다. */
export async function refreshSubscription(db: SQLiteDatabase) {
  const account = unwrap(await cloudApi.POST('/account/refresh-subscription'));
  update({ account });
  if (account.subscription.can_upload) {
    registerPushToken({ ask: true });
    syncCloud(db);
  }
  return account;
}

/** 도는 중인 동기화를 멈추고 끝날 때까지 기다린다. stopRequested는 그 동기화가 끝나며 되돌린다. */
async function stopSync() {
  if (!current) return;
  stopRequested = true;
  await current;
}

/** 로그아웃. 기기의 기록과 사진은 그대로 두고 Local로 돌아간다. */
export async function signOut(db: SQLiteDatabase) {
  // 세션을 먼저 지워서 그 사이 새 동기화가 시작되지 않게 하고, 도는 중인 것은 끝날 때까지 기다린다.
  await saveSession(null);
  await stopSync();
  await clearPurchasesUser();
  await signOutProviders();
  await resetCloudState(db);
  pushTokenChecked = false;
  update({ account: null, problem: null, pendingUploads: 0, lastSyncedAt: null });
}

/** 계정 삭제 (App Store 필수). 서버와 R2의 데이터를 지우고 Local로 돌아간다. */
export async function deleteAccount(db: SQLiteDatabase) {
  await stopSync();
  unwrap(await cloudApi.DELETE('/account'));
  await signOut(db);
}
