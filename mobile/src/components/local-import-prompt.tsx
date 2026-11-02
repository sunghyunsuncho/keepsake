import { router, useNavigationContainerRef } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef } from 'react';

import { isAccountDb } from '@/db/spaces';
import { useCloudState } from '@/lib/cloud/engine';
import { listImportable } from '@/lib/cloud/imports';

const NAVIGATOR_RETRY_MS = 200;

/** 계정 공간을 열었을 때, 이 계정에 아직 묻지 않은 Local 기록이 있으면 올리기 화면을 연다. */
export function LocalImportPrompt() {
  const db = useSQLiteContext();
  const navigation = useNavigationContainerRef();
  const { account } = useCloudState();
  const userId = account?.subscription.can_upload ? account.user_id : null;
  const asked = useRef(false);

  useEffect(() => {
    if (!userId || asked.current || !isAccountDb(db, userId)) return;
    asked.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 공간을 바꾸면 내비게이터도 새로 만들어져, 이 효과가 먼저 돌 때는 아직 이동할 수 없다.
    const open = () => {
      if (navigation.isReady()) router.push('/cloud-import');
      else timer = setTimeout(open, NAVIGATOR_RETRY_MS);
    };
    listImportable(db, { skipped: false })
      .then((moments) => {
        if (moments.length > 0) open();
      })
      .catch(() => {
        asked.current = false;
      });
    return () => clearTimeout(timer);
  }, [db, userId, navigation]);

  return null;
}
