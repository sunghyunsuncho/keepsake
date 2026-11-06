import * as Network from 'expo-network';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { getSettings, setSetting } from '@/db/settings';
import { isAccountDb, keepAccountSpace, retireAccountSpace } from '@/db/spaces';
import { pushDeviceLinks, restoreDeviceLinks } from '@/lib/cloud/device-links';
import { adoptPhotosWithoutAlbum, countPendingUploads, releaseUnwantedPhotos, uploadPending } from '@/lib/cloud/photos';
import { clearPurchasesUser, setPurchasesUser } from '@/lib/cloud/purchases';
import { registerPushToken } from '@/lib/cloud/push';
import {
  ACCOUNT_UNAVAILABLE,
  type Account,
  CloudError,
  cloudApi,
  loadSession,
  saveSession,
  unwrap,
  setSessionLostHandler,
} from '@/lib/cloud/session';
import { signOutProviders } from '@/lib/cloud/sign-in';
import { setCloudSpace } from '@/lib/cloud/space';
import { hasLocalChanges, pullChanges, pushChanges, resetAccountSpace } from '@/lib/cloud/sync';

// Cloud 동기화 한 바퀴: 계정 확인 → 바뀐 기록 push → 다른 기기 변경 pull → 필요 없어진 사진 지우기 → 사진 업로드.
// 등급: 로그인하지 않으면 Local만 쓰고 백업은 없다. 로그인하면 기록(메모·장소·앨범)을 계정에 백업하고,
// 구독하면 안전 앨범에 담은 사진까지 보관한다. 계정 공간의 DB만 서버와 맞춘다. Local DB는 사용자가 골라서 복사할 때(cloud/imports.ts)만 Cloud에 들어간다.
// 사진 받기는 볼 때 한 장씩 한다 (components/moment-photo.tsx).
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
// 로그아웃·계정 삭제 중에는 새 동기화를 시작하지 않는다.
let pauses = 0;
// 공간이 바뀌면 다시 돌 때는 마지막에 요청한 DB를 쓴다.
let latestDb: SQLiteDatabase | null = null;
let pushTokenChecked = false;

/**
 * 동기화를 한 번 돌린다. 이미 도는 중이면 끝난 뒤 한 번 더 돈다 (그 사이 바뀐 것을 놓치지 않도록).
 * onlyIfLocalChanges: 데이터가 바뀔 때마다 부르는 경우. 보낼 것이 없으면 네트워크를 쓰지 않는다.
 */
export function syncCloud(db: SQLiteDatabase, options: { onlyIfLocalChanges?: boolean } = {}) {
  if (pauses > 0) return Promise.resolve();
  const mode = options.onlyIfLocalChanges ? 'local' : 'full';
  latestDb = db;
  if (current) {
    if (again !== 'full') again = mode;
    return current;
  }
  current = (async () => {
    let next: 'none' | 'local' | 'full' = mode;
    try {
      while (next !== 'none' && !stopRequested) {
        again = 'none';
        await runOnce(latestDb ?? db, next === 'local');
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
  const onAccountSpace = isAccountDb(db, session.userId);
  if (onlyIfLocalChanges && !onAccountSpace) return;
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
    let account: Account;
    try {
      account = unwrap(await cloudApi.GET('/account'));
    } finally {
      // 계정이 지워졌다고(401) 확인된 경우만 빼고 RevenueCat 사용자를 맞춘다. 서버가 잠시 실패해도 구매·복원은
      // 되어야 하고, 지워진 계정의 RevenueCat 고객은 다시 만들면 안 된다.
      // 결제 SDK 문제로 백업이 멈추지 않게 한다 (사용자 연결은 다음 동기화나 구매 전에 다시 한다).
      if ((await loadSession())?.userId === session.userId) {
        await setPurchasesUser(session.userId).catch(() => {});
      }
    }
    update({ account, problem: null });
    const { subscription } = account;
    // 로그인한 계정은 구독과 관계없이 계정 공간을 쓴다 (기록 백업). 공간을 바꾸면 CloudSync가 새 DB로 다시 부른다.
    if (!onAccountSpace) {
      await setCloudSpace(session.userId);
      return;
    }
    await keepAccountSpace(session.userId);
    // 서버 데이터가 새로 시작됐으면(data_generation) 이 공간의 기록도 더는 Cloud에 없다.
    const accountKey = `${account.user_id}:${account.data_generation}`;
    const savedKey = (await getSettings(db)).cloud_account_key;
    if (savedKey !== accountKey) {
      if (savedKey !== null) await resetAccountSpace(db);
      await setSetting(db, 'cloud_account_key', accountKey);
    }
    if (!pushTokenChecked && subscription.status !== 'none') {
      // 토큰은 바뀔 수 있으므로 앱을 실행할 때마다 한 번 알린다 (권한은 구독 직후에만 묻는다).
      pushTokenChecked = true;
      registerPushToken({ ask: false });
    }
    let problem: string | null = null;
    let pushed = 0;
    let uploaded = 0;

    // 기록 백업은 로그인한 계정 모두에게 준다.
    pushed = await pushChanges(db);
    // 사진을 올리기 전에 받는다: 이미 Cloud에 있는 사진(다시 로그인한 계정, 다른 기기가 올린 사진)은
    // pull이 '올라감'으로 표시하므로 다시 올리지 않는다.
    await pullChanges(db);
    // 연결은 없어도 사진을 Cloud에서 볼 수 있으므로, 실패해도 백업을 멈추지 않고 다음에 다시 한다.
    await restoreDeviceLinks(db, session.userId).catch(() => {});
    await pushDeviceLinks(db, session.userId).catch(() => {});
    // 안전 앨범에서 빠진 사진은 구독 상태와 관계없이 지운다 (용량을 돌려받는 일이라 막지 않는다).
    // 이 마이그레이션은 서버 사진을 지우지 않기 위한 로컬 정리다. 만료 상태에서도 먼저
    // 실행해야, 아직 안전 앨범으로 옮기지 못한 이전 버전의 사진을 release가 지우지 않는다.
    await adoptPhotosWithoutAlbum(db);
    const released = await releaseUnwantedPhotos(db);
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
            problem = '안전 보관함 용량이 가득 찼어요. 새 사진은 올리지 않고, 이미 올린 사진은 그대로 있어요.';
          } else throw e;
        }
      }
    }
    // 보낸 기록(삭제 포함)이나 올린 사진이 있으면 사용량이 바뀌었으므로 다시 받는다.
    const refreshed = pushed > 0 || uploaded > 0 || released > 0 ? unwrap(await cloudApi.GET('/account')) : account;
    update({ account: refreshed, problem, lastSyncedAt: new Date().toISOString() });
  } catch (e) {
    update({ problem: describe(e) });
  } finally {
    // 세지 못하면 다음 동기화에서 다시 센다.
    update({ running: false, pendingUploads: await countPendingUploads(db).catch(() => 0) });
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
 * 계정 공간으로 옮기고 동기화를 시작하는 일은 세션이 생기면 CloudSync가 한다.
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

/** 이 기기에서 계정을 떠난다. 계정 공간은 지우지 않는다. */
async function leaveAccount() {
  await clearPurchasesUser();
  await signOutProviders();
  await setCloudSpace(null);
  await saveSession(null);
  pushTokenChecked = false;
  update({ account: null, problem: null, pendingUploads: 0, lastSyncedAt: null });
}

// 서버가 세션을 거절했다. 도는 동기화의 요청 안에서 불리므로 그 동기화를 기다리지 않는다.
setSessionLostHandler(async (userId, accountGone) => {
  pushTokenChecked = false;
  if (!accountGone) return;
  pauses++;
  try {
    // 다른 기기 등에서 계정이 지워졌다. 먼저 계정 공간을 떠나서, 옮긴 뒤에 그 공간에 새 기록이 쌓이지 않게 한다.
    // 앱이 중간에 꺼져도 다음 실행은 Local로 열린다. 그다음 이 기기 사진과 연결된 기록을 남긴다.
    await setCloudSpace(null).catch(() => {});
    await retireAccountSpace(userId).catch(() => {});
    // 옮기는 사이 다른 계정으로 로그인했으면 그 세션을 건드리지 않는다.
    if ((await loadSession())?.userId === userId) await leaveAccount().catch(() => {});
  } finally {
    pauses--;
  }
});

/** 로그아웃. Local로 돌아간다. 계정 공간은 기기에 남아 다시 로그인하면 이어서 쓴다. */
export async function signOut() {
  // 도는 동기화를 먼저 끝낸다. 세션을 지우면 쓰던 공간이 바뀐다.
  pauses++;
  try {
    await stopSync();
    await leaveAccount();
  } finally {
    pauses--;
  }
}

/** 계정 삭제 (App Store 필수). 서버와 R2의 데이터를 지우고, 이 기기 사진의 기록은 Local에 남긴다. */
export async function deleteAccount() {
  pauses++;
  try {
    await stopSync();
    const session = await loadSession();
    try {
      unwrap(await cloudApi.DELETE('/account'));
    } catch (e) {
      // 앞선 요청의 응답만 놓쳤고 서버에서는 이미 지워졌다. 토큰 만료 같은 다른 401은 실패다.
      if (!(e instanceof CloudError && e.status === 401 && e.message === ACCOUNT_UNAVAILABLE)) throw e;
    }
    // 공간을 먼저 떠난 뒤 옮긴다 (위 세션 상실 처리와 같은 이유).
    // 기기 정리에 실패해도 삭제 실패로 알리지 않는다. 다음 실행 때 다시 옮긴다.
    await setCloudSpace(null).catch(() => {});
    if (session) await retireAccountSpace(session.userId).catch(() => {});
  } finally {
    pauses--;
  }
  await signOut();
}
