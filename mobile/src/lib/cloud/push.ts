import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { cloudApi } from '@/lib/cloud/session';

// 구독 만료 후 유예 알림(만료 즉시, 삭제 7일 전·1일 전)을 받을 Expo 푸시 토큰을 서버에 알린다.
// EAS 프로젝트가 연결되지 않은 개발 빌드에서는 토큰을 받을 수 없으므로 건너뛴다.

const projectId: string | undefined =
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

/** ask가 true면 권한을 묻는다 (구독 직후 한 번). false면 이미 허용된 경우에만 등록한다. */
export async function registerPushToken({ ask }: { ask: boolean }) {
  if (!projectId) return;
  try {
    let { granted } = await Notifications.getPermissionsAsync();
    if (!granted && ask) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('cloud', {
        name: 'Cloud 백업',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await cloudApi.PUT('/account/devices', {
      body: { expo_push_token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    });
  } catch {
    // 알림은 부가 기능이라 실패해도 Cloud 사용을 막지 않는다. 앱을 다음에 실행할 때 다시 시도한다.
  }
}
