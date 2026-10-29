import { Platform } from 'react-native';
import Purchases, { type PurchasesError, type PurchasesPackage } from 'react-native-purchases';

// RevenueCat (docs/PLAN.md §2.3). 앱은 구매·복원만 하고, 구독 여부는 서버가 webhook·REST로 판단한다.
// 상품·가격은 로그인 전에도 익명 사용자로 불러온다. 구매·복원은 로그인한 뒤에만 해서
// app_user_id가 항상 서버의 user_id가 되게 한다 (익명 ID로 결제가 남지 않게).

const API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
});

export const purchasesAvailable = Boolean(API_KEY);

let configured = false;
let currentUser: string | null = null;

// 설정·사용자 전환은 한 번에 하나씩 한다. 로그인 화면과 동기화가 동시에 부르면 SDK를 두 번 설정할 수 있다.
let queue: Promise<unknown> = Promise.resolve();
function serially<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/** SDK를 한 번만 설정한다. 이번에 설정했으면 true. appUserID가 없으면 익명 사용자로 시작한다. */
async function configure(apiKey: string, appUserID?: string) {
  if (configured || (await Purchases.isConfigured())) {
    configured = true;
    return false;
  }
  Purchases.configure({ apiKey, appUserID });
  configured = true;
  return true;
}

export async function setPurchasesUser(userId: string) {
  const apiKey = API_KEY;
  if (!apiKey || currentUser === userId) return;
  await serially(async () => {
    if (currentUser === userId) return;
    if (!(await configure(apiKey, userId))) await Purchases.logIn(userId);
    currentUser = userId;
  });
}

export async function clearPurchasesUser() {
  await serially(async () => {
    if (!currentUser) return;
    currentUser = null;
    try {
      await Purchases.logOut();
    } catch {
      // 이미 익명 상태면 실패한다. 무시해도 된다.
    }
  });
}

/** 페이월에 보여줄 구독 상품 (RevenueCat의 current offering). 로그인 전에도 불러올 수 있다. */
export async function getCloudPackages(): Promise<PurchasesPackage[]> {
  const apiKey = API_KEY;
  if (!apiKey) return [];
  await serially(() => configure(apiKey));
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

/** 구매. 사용자가 취소하면 false. 로그인한 뒤에만 부른다. */
export async function purchase(pkg: PurchasesPackage) {
  if (!currentUser) throw new Error('구매 전에 로그인해야 해요');
  try {
    await Purchases.purchasePackage(pkg);
    return true;
  } catch (e) {
    if (isCancelled(e)) return false;
    throw e;
  }
}

export async function restorePurchases() {
  if (!currentUser) throw new Error('복원 전에 로그인해야 해요');
  await Purchases.restorePurchases();
}

function isCancelled(e: unknown) {
  const error = e as Partial<PurchasesError>;
  return error?.userCancelled === true || error?.code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
}

/** 스토어 구독 관리 화면 (해지는 스토어에서만 할 수 있다). */
export const MANAGE_SUBSCRIPTION_URL = Platform.select({
  ios: 'https://apps.apple.com/account/subscriptions',
  default: 'https://play.google.com/store/account/subscriptions',
});
