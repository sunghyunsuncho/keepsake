import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { recordNotifications } from '@/db/notifications';

function entryOf(notification: Notifications.Notification) {
  const { content, identifier } = notification.request;
  const url = content.data?.url;
  return {
    id: identifier,
    title: content.title ?? '',
    body: content.body ?? '',
    url: typeof url === 'string' ? url : null,
    received_at: new Date(notification.date).toISOString(),
  };
}

/**
 * 받은 알림을 알림 내역에 남긴다. 앱이 켜져 있을 때 받은 알림, 눌러서 연 알림, 알림 센터에 남아 있는 알림을 모은다.
 * 앱이 꺼진 동안 받고 알림 센터에서 지운 알림은 운영체제가 알려 주지 않아 남지 않는다.
 */
export function NotificationInbox() {
  useEffect(() => {
    const collectPresented = () => {
      Notifications.getPresentedNotificationsAsync()
        .then((presented) => recordNotifications(presented.map(entryOf)))
        .catch(() => {});
    };
    collectPresented();
    const last = Notifications.getLastNotificationResponse();
    if (last) recordNotifications([entryOf(last.notification)]).catch(() => {});
    const received = Notifications.addNotificationReceivedListener((notification) => {
      recordNotifications([entryOf(notification)]).catch(() => {});
    });
    const responded = Notifications.addNotificationResponseReceivedListener((response) => {
      recordNotifications([entryOf(response.notification)]).catch(() => {});
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') collectPresented();
    });
    return () => {
      received.remove();
      responded.remove();
      appState.remove();
    };
  }, []);

  return null;
}
