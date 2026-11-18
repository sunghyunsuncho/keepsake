import * as Linking from 'expo-linking';
import { getTrackingPermissionsAsync, requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import mobileAds, { AdsConsent, AdsConsentPrivacyOptionsRequirementStatus, TestIds } from 'react-native-google-mobile-ads';

import { useCloudState } from '@/lib/cloud/engine';
import { useCloudSession } from '@/lib/cloud/session';

// AdMob 광고. 안전 보관 구독 중(체험 포함)이면 보이지 않고, 구독이 끝난 뒤 30일 유예부터는 다시 보인다.
// 광고 자리: 정리 완료, 설정, 새 사진을 다 본 고르기 탭과 기기 사진첩·안전 사진첩 탭의 탭 바 위(목록 밖에 고정). 사진을 크게 보거나 고르는 화면에는 두지 않는다.
// 버튼·탭 바와 붙어 잘못 누르지 않게 여백을 둔다.
// 동의는 처음 광고를 띄울 때 한 번 묻는다: Google UMP(유럽 등 필요한 지역) → iOS 앱 추적 투명성(ATT) → SDK 시작.

// 실제 광고는 스토어 빌드(production 프로필)에서만 요청한다. 개발·preview 빌드는 Google 테스트 광고를 써서
// 내 기기에서 실제 광고가 노출·클릭되어 무효 트래픽으로 잡히지 않게 한다. 스토어 빌드에 단위 ID가 없으면 광고를 띄우지 않는다.
//
// 비공개 테스트 기간에는 스토어 빌드에서도 광고를 띄우지 않는다. 테스터가 적어 몇 번의 노출·클릭만으로 무효 트래픽으로
// 잡히고, 정지는 같은 게시자 계정을 쓰는 다른 앱(베르니사주)까지 막는다. 광고를 끄면 동의(UMP)·추적 허용(ATT) 창도 뜨지
// 않는다. 정식 출시 때 true로 바꾼다.
const LIVE_ADS_ENABLED = false;

const BANNER_UNIT_ID =
  process.env.EXPO_PUBLIC_APP_ENV !== 'production'
    ? TestIds.ADAPTIVE_BANNER
    : !LIVE_ADS_ENABLED
      ? undefined
      : Platform.select({
        ios: process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER_ID,
        android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID,
      });

export const bannerUnitId = BANNER_UNIT_ID || null;

type AdsState = {
  /** 동의를 마치고 SDK를 시작해 광고를 요청해도 된다. */
  ready: boolean;
  /** 동의를 받은 지역이라 설정에 '광고 개인정보 설정'을 두어야 한다 (UMP 요구 사항). */
  privacyOptions: boolean;
};

let state: AdsState = { ready: false, privacyOptions: false };
const listeners = new Set<() => void>();

function update(patch: Partial<AdsState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

let starting: Promise<void> | null = null;

/** 실행마다 한 번만 동의 정보를 새로 받고 SDK를 시작한다. 실패해도 앱은 광고 없이 계속 쓴다. */
function startAds() {
  starting ??= (async () => {
    // 동의 정보를 받지 못해도(오프라인 등) 지난 실행의 동의로 광고를 요청할 수 있다.
    await AdsConsent.gatherConsent().catch(() => {});
    const info = await AdsConsent.getConsentInfo();
    update({ privacyOptions: info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED });
    if (!info.canRequestAds) return;
    // 추적 허용 창이 실패해도 비개인화 광고는 낼 수 있으니 SDK 시작은 계속한다.
    await requestTrackingIfAllowed().catch(() => {});
    await mobileAds().initialize();
    update({ ready: true });
  })().catch(() => {});
  return starting;
}

/** iOS ATT는 GDPR 지역이면 기기 정보 저장·접근(목적 1)에 동의한 사람에게만 묻는다. 거절해도 비개인화 광고가 나온다. */
async function requestTrackingIfAllowed() {
  if (Platform.OS !== 'ios') return;
  const gdprApplies = await AdsConsent.getGdprApplies();
  if (gdprApplies && !(await AdsConsent.getPurposeConsents()).startsWith('1')) return;
  const { canAskAgain, granted } = await getTrackingPermissionsAsync();
  if (!granted && canAskAgain) await requestTrackingPermissionsAsync();
}

/** 설정의 '광고 개인정보 설정'. 동의를 바꾸면 다음 광고 요청부터 반영된다. */
export function showAdPrivacyOptions() {
  return AdsConsent.showPrivacyOptionsForm().catch(() => {});
}

// 렌더마다 새 함수를 넘기면 useSyncExternalStore가 매번 구독을 풀고 다시 건다.
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useAdsState() {
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * 광고를 보여 줄 사람인가. 구독 중(`active`)이면 보이지 않는다.
 * 로그인했는데 계정을 아직 못 받았으면 구독자에게 광고가 잠깐 비치지 않도록 기다린다.
 */
export function useShowAds() {
  const session = useCloudSession();
  const { account } = useCloudState();
  const url = Linking.useLinkingURL();
  if (!bannerUnitId) return false;
  // 스토어 스크린샷(개발 빌드의 storeCapture=1)에는 테스트 광고가 찍히지 않게 한다.
  if (__DEV__ && url && Linking.parse(url).queryParams?.storeCapture === '1') return false;
  if (session === undefined || (session && !account)) return false;
  return account?.subscription.status !== 'active';
}

/** 광고 자리에서 쓴다. 광고를 보여 줄 사람이면 처음 한 번 동의를 묻고, 광고를 요청해도 되는지 알려 준다. */
export function useAds() {
  const show = useShowAds();
  const { ready, privacyOptions } = useAdsState();
  useEffect(() => {
    if (show) void startAds();
  }, [show]);
  return { show, ready: show && ready, privacyOptions: show && privacyOptions };
}
