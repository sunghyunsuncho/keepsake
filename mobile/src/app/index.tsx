import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { API_URL, api } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

type ServerStatus = 'checking' | 'ok' | 'unreachable';

// 주소가 틀리면 fetch가 OS 기본 타임아웃(수십 초)까지 걸려 있으므로 직접 끊는다.
const HEALTH_TIMEOUT_MS = 5000;

// Phase 0 확인용 화면. Phase 1에서 날짜별 사진 선택 화면으로 교체한다.
export default function HomeScreen() {
  const [status, setStatus] = useState<ServerStatus>('checking');

  useEffect(() => {
    // 화면을 벗어난 뒤 도착한 응답으로 상태를 바꾸지 않도록 표시한다.
    let unmounted = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    api
      .GET('/health/ready', { signal: controller.signal })
      .then(({ data }) => data?.status === 'ok')
      .catch(() => false)
      .then((ok) => {
        clearTimeout(timeout);
        if (!unmounted) setStatus(ok ? 'ok' : 'unreachable');
      });

    return () => {
      unmounted = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">Keepsake</ThemedText>
        <ThemedText themeColor="textSecondary">
          모든 순간을 저장하기보다, 소중한 순간을 선택한다.
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.statusBox}>
          <ThemedText type="smallBold">API 서버</ThemedText>
          <ThemedText type="code">{API_URL}</ThemedText>
          <ThemedText type="small">{STATUS_LABEL[status]}</ThemedText>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const STATUS_LABEL: Record<ServerStatus, string> = {
  checking: '확인 중…',
  ok: '연결됨 (DB 포함)',
  unreachable: '연결 안 됨. 서버 실행 여부와 EXPO_PUBLIC_API_URL을 확인하세요.',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
  },
  statusBox: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Spacing.four,
  },
});
