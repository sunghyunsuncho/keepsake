import { router, useNavigationContainerRef } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';

import { getSettings, setSetting } from '@/db/settings';

const NAVIGATOR_RETRY_MS = 200;

/** 처음 실행하면 앱 소개(/welcome)를 연다. 소개를 본 기록은 계정과 무관하게 기기에 하나다. */
export function WelcomeGate() {
  const db = useSQLiteContext();
  const navigation = useNavigationContainerRef();

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 앱을 막 켰을 때는 내비게이터가 아직 준비되지 않았을 수 있다.
    const open = () => {
      if (!alive) return;
      if (navigation.isReady()) router.push('/welcome');
      else timer = setTimeout(open, NAVIGATOR_RETRY_MS);
    };
    getSettings(db)
      .then((settings) => {
        if (!alive || settings.welcome_seen) return;
        // 소개가 생기기 전부터 쓰던 사람은 이미 고르기를 시작했으므로 막아서지 않는다.
        if (settings.review_cursor !== null) return setSetting(db, 'welcome_seen', true);
        open();
      })
      .catch(() => {});
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [db, navigation]);

  return null;
}
