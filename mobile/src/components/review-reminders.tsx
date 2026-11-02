import * as Notifications from 'expo-notifications';
import { router, useNavigationContainerRef } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { rescheduleReminders } from '@/lib/reminders';

/** 고르기 알림을 앱을 열 때·백그라운드로 갈 때 다시 예약하고, 알림을 누르면 고르기 탭으로 연다. */
export function ReviewReminders() {
  const db = useSQLiteContext();
  const navigation = useNavigationContainerRef();

  useEffect(() => {
    rescheduleReminders(db);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'background') rescheduleReminders(db);
    });
    return () => appState.remove();
  }, [db]);

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const url = response?.notification.request.content.data?.url;
      if (url !== '/') return;
      // 앱이 꺼져 있다 열리면 내비게이터가 아직 없어 이동하면 오류가 난다. 그때는 어차피 고르기 탭에서 시작한다.
      if (navigation.isReady()) router.navigate('/');
      Notifications.clearLastNotificationResponse();
    };
    // 앱이 꺼져 있을 때 알림을 눌러 연 경우
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [navigation]);

  return null;
}
