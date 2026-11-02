import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

// 서명 URL의 쿼리처럼 주소 뒤에 붙은 값이 오류 내용에 실려 나가지 않게 한다.
function stripUrlQuery(text: string) {
  return text.replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, '$1');
}

// 비정상 종료와 오류만 보낸다. DSN이 없으면(로컬) 아무것도 하지 않는다.
// 사진·메모·장소를 보내지 않으므로 화면 캡처와 이동 기록을 쓰지 않고, 사용자도 지정하지 않는다
// (개인정보처리방침 §2.3).
export function initMonitoring() {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: process.env.EXPO_PUBLIC_APP_ENV || 'development',
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableAutoSessionTracking: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      delete event.user;
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = stripUrlQuery(exception.value);
      }
      if (event.message) event.message = stripUrlQuery(event.message);
      return event;
    },
  });
}

export const wrapRoot = Sentry.wrap;
