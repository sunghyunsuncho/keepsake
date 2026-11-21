import type { ConfigContext, ExpoConfig } from 'expo/config';
import {
  AndroidConfig,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidManifest,
  withAndroidStyles,
  type ConfigPlugin,
} from 'expo/config-plugins';

// Play는 세로 고정(screenOrientation)과 ACCESS_WIFI_STATE(expo-network)를 보고
// screen.portrait·wifi 하드웨어를 필수로 추론해, 그 기능이 없는 기기에서 설치를 막는다.
// 둘 다 없어도 앱은 동작하므로 선택사항으로 명시한다.
const OPTIONAL_FEATURES = ['android.hardware.screen.portrait', 'android.hardware.wifi'];
const withOptionalHardwareFeatures: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const features = (manifest['uses-feature'] ??= []);
    for (const name of OPTIONAL_FEATURES) {
      const existing = features.find((f) => f.$['android:name'] === name);
      if (existing) existing.$['android:required'] = 'false';
      else features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    return mod;
  });

// Android 테마에 강조색이 없으면 시스템 대화상자(Alert)의 버튼, 시각·날짜 선택 창이 기본 청록색으로 나온다.
// 앱의 포인트 색(constants/theme.ts의 accent)을 테마의 colorAccent로 준다. 다크 모드는 values-night에 따로 둔다.
const ACCENT = { light: '#CD5837', dark: '#E57A5A' };
const withAndroidAccentColor: ConfigPlugin = (config) => {
  config = withAndroidColors(config, (mod) => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, { name: 'colorAccent', value: ACCENT.light });
    return mod;
  });
  config = withAndroidColorsNight(config, (mod) => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, { name: 'colorAccent', value: ACCENT.dark });
    return mod;
  });
  return withAndroidStyles(config, (mod) => {
    mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: 'colorAccent',
      value: '@color/colorAccent',
    });
    return mod;
  });
};

// app.json을 기본으로 쓰고, 환경 변수가 있어야 하는 설정만 여기서 더한다.
// Google 로그인 iOS URL scheme은 iOS OAuth 클라이언트 ID를 뒤집은 값이다
// (xxxx.apps.googleusercontent.com → com.googleusercontent.apps.xxxx).
// 클라이언트 ID가 없으면 Google 로그인 없이 빌드된다 (앱도 버튼을 숨긴다).
export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = process.env.EXPO_PUBLIC_APP_ENV;
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  // 스토어 빌드에 개발용 localhost가 포함되면 실기기에서 Cloud 기능이 전부 실패한다.
  // production 프로필은 EAS 환경변수로 공개 HTTPS API를 명시해야 한다.
  // eas-cli는 EAS 환경변수를 받기 전에 로컬 .env로 config를 한 번 읽으므로, 실제 빌드(EAS_BUILD)에서만 검사한다.
  if (
    process.env.EAS_BUILD === 'true' &&
    appEnv === 'production' &&
    (!apiUrl || !apiUrl.startsWith('https://'))
  ) {
    throw new Error('Production builds require EXPO_PUBLIC_API_URL to be an HTTPS URL.');
  }
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  // iOS는 기본 Apple 지도를 쓰므로 키가 필요 없다. Android Google 지도 타일만 빌드 시 키를 넣는다.
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const googlePlugin: [string, { iosUrlScheme: string }][] = iosClientId
    ? [
        [
          '@react-native-google-signin/google-signin',
          { iosUrlScheme: `com.googleusercontent.apps.${iosClientId.replace('.apps.googleusercontent.com', '')}` },
        ],
      ]
    : [];
  // AdMob 앱 ID는 네이티브 설정에 들어가고, 없으면 SDK가 앱 시작 때 멈춘다.
  // 개발·preview 빌드는 Google 예시 앱 ID로 빌드하고(개발·preview 빌드는 테스트 광고만 요청한다), 스토어 빌드는 실제 ID를 요구한다.
  const admobAndroidAppId = process.env.ADMOB_ANDROID_APP_ID;
  const admobIosAppId = process.env.ADMOB_IOS_APP_ID;
  if (process.env.EAS_BUILD === 'true' && appEnv === 'production' && (!admobAndroidAppId || !admobIosAppId)) {
    throw new Error('Production builds require ADMOB_ANDROID_APP_ID and ADMOB_IOS_APP_ID.');
  }
  const adsPlugins: [string, Record<string, unknown>][] = [
    [
      'react-native-google-mobile-ads',
      {
        androidAppId: admobAndroidAppId || 'ca-app-pub-3940256099942544~3347511713',
        iosAppId: admobIosAppId || 'ca-app-pub-3940256099942544~1458002511',
        // 동의를 받기 전에는 앱 측정 데이터를 보내지 않는다 (lib/ads.ts가 동의 뒤 SDK를 시작한다).
        delayAppMeasurementInit: true,
        skAdNetworkItems: ['cstr6suwn9.skadnetwork'],
      },
    ],
    [
      'expo-tracking-transparency',
      { userTrackingPermission: '내 관심사에 맞는 광고를 보여 주는 데 사용됩니다. 허용하지 않아도 앱의 모든 기능을 쓸 수 있어요.' },
    ],
  ];
  // Sentry 플러그인은 빌드 중 소스맵을 올리는데, 토큰이 없으면 빌드가 실패한다.
  // SENTRY_AUTH_TOKEN은 EAS Secret이라 클라우드 빌드에만 들어오므로, 로컬 빌드는 업로드 없이 만든다.
  // 앱의 오류 수집은 DSN만 있으면 되므로 플러그인이 없어도 동작한다.
  const plugins = process.env.SENTRY_AUTH_TOKEN
    ? (config.plugins ?? [])
    : (config.plugins ?? []).filter(
        (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== '@sentry/react-native/expo',
      );
  return withAndroidAccentColor(
    withOptionalHardwareFeatures({
      ...(config as ExpoConfig),
      android: mapsApiKey
        ? { ...config.android, config: { ...config.android?.config, googleMaps: { apiKey: mapsApiKey } } }
        : config.android,
      plugins: [...plugins, ...googlePlugin, ...adsPlugins],
    }),
  );
};
