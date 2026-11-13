import type { ConfigContext, ExpoConfig } from 'expo/config';

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
  // Sentry 플러그인은 빌드 중 소스맵을 올리는데, 토큰이 없으면 빌드가 실패한다.
  // SENTRY_AUTH_TOKEN은 EAS Secret이라 클라우드 빌드에만 들어오므로, 로컬 빌드는 업로드 없이 만든다.
  // 앱의 오류 수집은 DSN만 있으면 되므로 플러그인이 없어도 동작한다.
  const plugins = process.env.SENTRY_AUTH_TOKEN
    ? (config.plugins ?? [])
    : (config.plugins ?? []).filter(
        (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== '@sentry/react-native/expo',
      );
  return {
    ...(config as ExpoConfig),
    android: mapsApiKey
      ? { ...config.android, config: { ...config.android?.config, googleMaps: { apiKey: mapsApiKey } } }
      : config.android,
    plugins: [...plugins, ...googlePlugin],
  };
};
