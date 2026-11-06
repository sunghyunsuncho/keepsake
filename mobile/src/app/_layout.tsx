import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { CloudSync } from '@/components/cloud-sync';
import { LocalImportPrompt } from '@/components/local-import-prompt';
import { NotificationInbox } from '@/components/notification-inbox';
import { ModalHeader, StackHeader } from '@/components/stack-header';
import { ReviewReminders } from '@/components/review-reminders';
import { migrateDb } from '@/db/schema';
import { getLocalDb } from '@/db/spaces';
import { useActiveDatabaseName } from '@/lib/cloud/space';
import { initMonitoring, wrapRoot } from '@/lib/monitoring';

initMonitoring();

function RootLayout() {
  const colorScheme = useColorScheme();
  const databaseName = useActiveDatabaseName();
  const [localReady, setLocalReady] = useState(false);
  useEffect(() => {
    getLocalDb().then(
      () => setLocalReady(true),
      (e: unknown) => {
        // 기록을 열 수 없으면 Suspense와 같이 오류 화면으로 보낸다.
        setLocalReady(() => {
          throw e;
        });
      },
    );
  }, []);

  return (
    // 앨범 화면의 두 손가락 확대·축소가 react-native-gesture-handler를 쓴다.
    <GestureHandlerRootView style={styles.flex}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {!databaseName || !localReady ? (
          <Loading />
        ) : (
          <Suspense fallback={<Loading />}>
            {/* 공간이 바뀌면 화면을 모두 새로 그려 이전 공간의 기록이 남지 않게 한다. */}
            <SQLiteProvider key={databaseName} databaseName={databaseName} onInit={migrateDb} useSuspense>
              <CloudSync />
              <LocalImportPrompt />
              <ReviewReminders />
              <NotificationInbox />
              {/* 뒤로 가기가 있는 화면은 배경 없는 '<'로 통일한다 (components/stack-header.tsx). */}
              <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="moment/[id]" options={{ title: '', header: StackHeader }} />
                <Stack.Screen name="day" options={{ title: '지난 사진', header: StackHeader }} />
                <Stack.Screen name="albums/[id]/index" options={{ title: '', header: StackHeader }} />
                <Stack.Screen name="albums/[id]/add" options={{ title: '', presentation: 'modal', header: ModalHeader }} />
                <Stack.Screen name="viewer" options={{ headerShown: false, animation: 'fade' }} />
                <Stack.Screen name="cleanup" options={{ title: '사진 정리', presentation: 'modal', header: ModalHeader }} />
                <Stack.Screen name="cloud" options={{ title: '안전 보관', presentation: 'modal', header: ModalHeader }} />
                <Stack.Screen name="notifications" options={{ title: '알림', header: StackHeader }} />
                <Stack.Screen name="open-source-licenses" options={{ title: '오픈소스 라이선스', header: StackHeader }} />
                <Stack.Screen name="legal/[doc]" options={{ header: StackHeader }} />
                <Stack.Screen name="cloud-albums/new" options={{ title: '새 안전 앨범', presentation: 'modal', header: ModalHeader }} />
                <Stack.Screen name="cloud-import" options={{ title: '기기 기록 올리기', presentation: 'modal', header: ModalHeader }} />
              </Stack>
            </SQLiteProvider>
          </Suspense>
        )}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

export default wrapRoot(RootLayout);

function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
