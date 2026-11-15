import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState } from 'react-native';

// OTA 업데이트(EAS Update). 앱을 켤 때 네이티브가 새 업데이트를 확인해 뒤에서 내려받고(app.json updates.checkAutomatically),
// 다음에 앱을 켤 때 적용한다. 앱을 끄지 않고 며칠씩 두는 사람도 받도록, 오래 백그라운드에 있다 돌아오면 다시 확인해 내려받아 둔다.
// 쓰는 중에 앱을 다시 시작하지 않는다 (고르던 사진·입력 중인 메모가 날아가지 않게).
const RECHECK_AFTER_MS = 60 * 60 * 1000;

export function AppUpdates() {
  useEffect(() => {
    // 개발 빌드와 비상 실행(내려받은 업데이트가 실패해 내장 번들로 돌아온 경우)에서는 확인하지 않는다.
    if (__DEV__ || !Updates.isEnabled || Updates.isEmergencyLaunch) return;
    let lastCheck = Date.now();
    let checking = false;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || checking || Date.now() - lastCheck < RECHECK_AFTER_MS) return;
      lastCheck = Date.now();
      checking = true;
      Updates.checkForUpdateAsync()
        .then((result) => (result.isAvailable ? Updates.fetchUpdateAsync() : undefined))
        // 오프라인 등으로 실패하면 다음 확인이나 다음 실행에서 다시 받는다.
        .catch(() => {})
        .finally(() => {
          checking = false;
        });
    });
    return () => subscription.remove();
  }, []);

  return null;
}
