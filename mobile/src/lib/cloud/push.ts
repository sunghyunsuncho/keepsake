import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { cloudApi } from '@/lib/cloud/session';
import { getCurrentLanguage, localizeText } from '@/lib/i18n';

// 서버가 보내는 알림(구독 만료 후 유예 알림, 공유 앨범의 내 사진에 달린 댓글)을 받을 Expo 푸시 토큰을 서버에 알린다.
// 알림 문구는 서버가 만들므로 앱 언어도 함께 보낸다 (언어를 바꾸면 다시 알린다).
// EAS 프로젝트가 연결되지 않은 개발 빌드에서는 토큰을 받을 수 없으므로 건너뛴다.

const projectId: string | undefined =
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

/** ask가 true면 권한을 묻는다 (구독 직후, 공유 앨범을 만들거나 참여하거나 처음 댓글을 남길 때). false면 이미 허용된 경우에만 등록한다. */
export async function registerPushToken({ ask }: { ask: boolean }) {
  if (!projectId) return;
  try {
    let { granted } = await Notifications.getPermissionsAsync();
    if (!granted && ask) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('cloud', {
        name: localizeText(getCurrentLanguage(), '안전 보관'),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await cloudApi.PUT('/account/devices', {
      body: { expo_push_token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android', language: getCurrentLanguage() },
    });
  } catch {
    // 알림은 부가 기능이라 실패해도 Cloud 사용을 막지 않는다. 앱을 다음에 실행할 때 다시 시도한다.
  }
}

/**
 * 로그아웃 전에 이 기기를 계정의 알림에서 뺀다 (로그아웃한 휴대폰에 그 계정의 댓글 알림이 오지 않게).
 * 세션이 있을 때 불러야 한다. 로그아웃을 붙잡지 않게 실패하거나 오래 걸리면 넘어간다.
 */
export async function unregisterPushToken() {
  if (!projectId) return;
  const attempt = (async () => {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await cloudApi.DELETE('/account/devices', { params: { query: { token: data } } });
  })().catch(() => {});
  await Promise.race([attempt, new Promise((done) => setTimeout(done, 3000))]);
}
