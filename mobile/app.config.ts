import type { ConfigContext, ExpoConfig } from 'expo/config';

// app.json을 기본으로 쓰고, 환경 변수가 있어야 하는 설정만 여기서 더한다.
// Google 로그인 iOS URL scheme은 iOS OAuth 클라이언트 ID를 뒤집은 값이다
// (xxxx.apps.googleusercontent.com → com.googleusercontent.apps.xxxx).
// 클라이언트 ID가 없으면 Google 로그인 없이 빌드된다 (앱도 버튼을 숨긴다).
export default ({ config }: ConfigContext): ExpoConfig => {
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
  return {
    ...(config as ExpoConfig),
    android: mapsApiKey
      ? { ...config.android, config: { ...config.android?.config, googleMaps: { apiKey: mapsApiKey } } }
      : config.android,
    plugins: [...(config.plugins ?? []), ...googlePlugin],
  };
};
