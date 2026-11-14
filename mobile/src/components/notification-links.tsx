import * as Notifications from 'expo-notifications';
import { router, useNavigationContainerRef, type Href } from 'expo-router';
import { useEffect } from 'react';

// 서버가 보낸 알림 중 화면을 여는 것. 댓글 알림은 그 공유 앨범에서 사진을 크게 보고 댓글을 연다.
// 모르는 주소는 열지 않는다 (알림 내용으로 아무 화면이나 열리지 않게).
const COMMENT_LINK = /^\/shared-albums\/[0-9a-f-]{36}\?item=[0-9a-f-]{36}&comments=1$/;

const opened = new Set<string>();

/** 알림이 여는 공유 앨범 주소. 열 수 없는 주소면 null. 알림 내역 화면도 쓴다. */
export function sharedAlbumLink(url: string | null | undefined): Href | null {
  return typeof url === 'string' && COMMENT_LINK.test(url) ? (url as Href) : null;
}

/** 댓글 알림을 누르면 그 사진을 연다. 고르기 알림('/')은 ReviewReminders가 연다. */
export function NotificationLinks() {
  const navigation = useNavigationContainerRef();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = (response: Notifications.NotificationResponse | null, tries = 0) => {
      const href = sharedAlbumLink(response?.notification.request.content.data?.url as string | undefined);
      if (!href || !response) return;
      // 앱을 켠 알림은 마지막 응답과 리스너로 두 번 올 수 있다. 같은 알림으로 화면을 두 번 쌓지 않는다.
      const id = response.notification.request.identifier;
      if (tries === 0 && opened.has(id)) return;
      opened.add(id);
      // 앱이 꺼져 있다 열리면 내비게이터가 준비될 때까지 잠깐 기다린다.
      if (!navigation.isReady()) {
        if (tries < 20) timer = setTimeout(() => open(response, tries + 1), 250);
        return;
      }
      router.push(href);
      Notifications.clearLastNotificationResponse();
    };
    // 앱이 꺼져 있을 때 알림을 눌러 연 경우
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => open(response));
    return () => {
      subscription.remove();
      if (timer) clearTimeout(timer);
    };
  }, [navigation]);

  return null;
}
