import { Platform } from 'react-native';
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  PRORATION_MODE,
  type PurchasesError,
  type PurchasesPackage,
} from 'react-native-purchases';

import { trackEvent } from '@/lib/activity';

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
  const apiKey = API_KEY;
  if (!apiKey) return;
  await serially(async () => {
    currentUser = null;
    // 이번 실행에서 사용자를 정한 적이 없어도 SDK에는 지난 실행의 사용자가 저장돼 있을 수 있다.
    await configure(apiKey);
    try {
      if (!(await Purchases.isAnonymous())) await Purchases.logOut();
    } catch {
      // 이미 익명 상태면 실패한다. 무시해도 된다.
    }
  });
}

// 요금제 (docs/PRICING.md §2, 서버 app/plans.py와 같은 규칙). App Store 상품은 `keepsake_cloud_10gb_monthly`,
// Play 상품은 구독 ID에 기본 요금제를 붙인 `keepsake_cloud_10gb:monthly`로 온다.
export type CloudPlan = 'cloud_10gb' | 'cloud_100gb';
export const PLAN_ORDER: CloudPlan[] = ['cloud_10gb', 'cloud_100gb'];
// 요금제마다 만들 수 있는 공유 앨범 수. 서버 app/plans.py의 shared_albums와 같다.
export const SHARED_ALBUM_LIMITS: Record<CloudPlan, number> = { cloud_10gb: 2, cloud_100gb: 50 };
const PRODUCT_PLANS: Record<string, CloudPlan> = {
  keepsake_cloud_10gb: 'cloud_10gb',
  keepsake_cloud_100gb: 'cloud_100gb',
};

export function planOfProduct(productId: string): CloudPlan | null {
  const base = productId.split(':')[0].replace(/_(monthly|yearly)$/, '');
  return PRODUCT_PLANS[base] ?? null;
}

export type CloudPackage = {
  pkg: PurchasesPackage;
  plan: CloudPlan;
  /** 첫 구독 무료 체험을 받을 수 있는지. 확실하지 않으면 false (없는 체험을 약속하지 않는다). */
  freeTrial: boolean;
};

/** 페이월에 보여줄 구독 상품 (RevenueCat의 current offering). 로그인 전에도 불러올 수 있다. */
export async function getCloudPackages(): Promise<CloudPackage[]> {
  const apiKey = API_KEY;
  if (!apiKey) return [];
  await serially(() => configure(apiKey));
  const offerings = await Purchases.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];
  const trials = await freeTrials(packages);
  return packages.flatMap((pkg) => {
    const plan = planOfProduct(pkg.product.identifier);
    return plan ? [{ pkg, plan, freeTrial: trials.has(pkg.product.identifier) }] : [];
  });
}

// Play는 받을 수 있는 체험만 기본 옵션(defaultOption)에 넣어 준다. App Store는 상품에 체험이 있어도
// 이미 받았을 수 있어서 자격을 따로 묻는다 (같은 구독 그룹에서 Apple ID당 한 번).
async function freeTrials(packages: PurchasesPackage[]) {
  if (Platform.OS === 'android') {
    return new Set(packages.filter((p) => p.product.defaultOption?.freePhase).map((p) => p.product.identifier));
  }
  const withTrial = packages.filter((p) => p.product.introPrice?.price === 0).map((p) => p.product.identifier);
  if (withTrial.length === 0) return new Set<string>();
  try {
    const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility(withTrial);
    return new Set(
      withTrial.filter((id) => eligibility[id]?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE),
    );
  } catch {
    return new Set<string>();
  }
}

/** 구매. 사용자가 취소하면 false. 로그인한 뒤에만 부른다. */
export async function purchase(pkg: PurchasesPackage) {
  if (!currentUser) throw new Error('구매 전에 로그인해야 해요');
  try {
    await Purchases.purchasePackage(pkg, null, await playProductChange(pkg));
    trackEvent('subscribed', { plan: planOfProduct(pkg.product.identifier) });
    return true;
  } catch (e) {
    if (isCancelled(e)) return false;
    throw e;
  }
}

// App Store는 같은 구독 그룹 안에서 요금제를 바꾼다. Play는 바꾸기 전 구독을 알려 주지 않으면
// 두 구독이 함께 결제되므로 지금 구독을 넘긴다. 올리면 바로 바꾸고(남은 기간은 날짜로 환산), 내리면 다음 갱신부터.
async function playProductChange(pkg: PurchasesPackage) {
  if (Platform.OS !== 'android') return null;
  const info = await Purchases.getCustomerInfo();
  const current = info.activeSubscriptions.find((id) => planOfProduct(id) !== null);
  const next = planOfProduct(pkg.product.identifier);
  if (!current || !next || current === pkg.product.identifier) return null;
  const upgrade = PLAN_ORDER.indexOf(next) >= PLAN_ORDER.indexOf(planOfProduct(current)!);
  return {
    oldProductIdentifier: current.split(':')[0],
    prorationMode: upgrade ? PRORATION_MODE.IMMEDIATE_WITH_TIME_PRORATION : PRORATION_MODE.DEFERRED,
  };
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
