import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { CloudSync } from '@/components/cloud-sync';
import { LocalImportPrompt } from '@/components/local-import-prompt';
import { ReviewReminders } from '@/components/review-reminders';
import { migrateDb } from '@/db/schema';
import { getLocalDb } from '@/db/spaces';
import { useActiveDatabaseName } from '@/lib/cloud/space';

export default function RootLayout() {
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
              <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="moment/[id]" options={{ title: '' }} />
                <Stack.Screen name="day" options={{ title: '날짜로 보기' }} />
                <Stack.Screen name="albums/[id]/index" options={{ title: '' }} />
                <Stack.Screen name="albums/[id]/add" options={{ title: '', presentation: 'modal' }} />
                <Stack.Screen name="viewer" options={{ headerShown: false, animation: 'fade' }} />
                <Stack.Screen name="cleanup" options={{ title: '사진 정리', presentation: 'modal' }} />
                <Stack.Screen name="cloud" options={{ title: 'Keepsake Cloud', presentation: 'modal' }} />
                <Stack.Screen name="cloud-import" options={{ title: '기기 기록 올리기', presentation: 'modal' }} />
              </Stack>
            </SQLiteProvider>
          </Suspense>
        )}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

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
