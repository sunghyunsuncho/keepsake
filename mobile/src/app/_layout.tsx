import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ActionSheetHost } from '@/components/action-sheet';
import { ActivityTracker } from '@/components/activity-tracker';
import { AppUpdates } from '@/components/app-updates';
import { CloudSync } from '@/components/cloud-sync';
import { LocalImportPrompt } from '@/components/local-import-prompt';
import { NotificationInbox } from '@/components/notification-inbox';
import { NotificationLinks } from '@/components/notification-links';
import { ModalHeader, StackHeader } from '@/components/stack-header';
import { UpdateGate, shouldShowUpdateGate } from '@/components/update-gate';
import { ReviewReminders } from '@/components/review-reminders';
import { WelcomeGate } from '@/components/welcome-gate';
import { StoreDemoSeed } from '@/components/store-demo-seed';
import { migrateDb } from '@/db/schema';
import { getLocalDb } from '@/db/spaces';
import { useActiveDatabaseName } from '@/lib/cloud/space';
import { LocalizationProvider, ROUTE_TITLES, useTranslation } from '@/lib/i18n';
import { initMonitoring, wrapRoot } from '@/lib/monitoring';

initMonitoring();

function RootLayout() {
  const colorScheme = useColorScheme();
  const databaseName = useActiveDatabaseName();
  const [localReady, setLocalReady] = useState(false);
  // 앱을 새로 켤 때만 뜬다 (RootLayout은 실행마다 한 번 마운트되고, 백그라운드에서 돌아올 때는 다시 마운트되지 않는다).
  const [updateGateOpen, setUpdateGateOpen] = useState(shouldShowUpdateGate);
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

  // 새 업데이트를 받는 동안 앱을 그리지 않는다. 곧 다시 시작할 번들로 로그인 확인·동기화를 시작하지 않게.
  if (updateGateOpen) return <UpdateGate onDone={() => setUpdateGateOpen(false)} />;

  return (
    // 앨범 화면의 두 손가락 확대·축소가 react-native-gesture-handler를 쓴다.
    <GestureHandlerRootView style={styles.flex}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {/* 공간이 바뀔 때 다시 그려지지 않게 SQLiteProvider 밖에 둔다 (앱 실행을 두 번 세지 않게). */}
        <ActivityTracker />
        <AppUpdates />
        {!databaseName || !localReady ? (
          <Loading />
        ) : (
          <Suspense fallback={<Loading />}>
            {/* 공간이 바뀌면 화면을 모두 새로 그려 이전 공간의 기록이 남지 않게 한다. */}
            <SQLiteProvider key={databaseName} databaseName={databaseName} onInit={migrateDb} useSuspense>
              <LocalizationProvider>
                <StoreDemoSeed />
                <CloudSync />
                <WelcomeGate />
                <LocalImportPrompt />
                <ReviewReminders />
                <NotificationInbox />
                <NotificationLinks />
                <AppStack />
                <ActionSheetHost />
              </LocalizationProvider>
            </SQLiteProvider>
          </Suspense>
        )}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

export default wrapRoot(RootLayout);

/** 언어를 바꾸면 현재 열려 있는 모달 제목까지 즉시 갱신한다. */
function AppStack() {
  const { language } = useTranslation();
  const title = ROUTE_TITLES[language];
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="moment/[id]" options={{ title: '', header: StackHeader }} />
      <Stack.Screen name="day" options={{ title: title.day, header: StackHeader }} />
      <Stack.Screen name="albums/[id]/index" options={{ title: '', header: StackHeader }} />
      <Stack.Screen name="album-map" options={{ title: title.map, header: StackHeader }} />
      <Stack.Screen name="albums/[id]/add" options={{ title: '', presentation: 'modal', header: ModalHeader }} />
      <Stack.Screen name="viewer" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="welcome" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
      <Stack.Screen name="cleanup" options={{ title: title.cleanup, presentation: 'modal', header: ModalHeader }} />
      <Stack.Screen name="cloud" options={{ title: title.cloud, presentation: 'modal', header: ModalHeader }} />
      <Stack.Screen name="sign-in" options={{ title: title.signIn, presentation: 'modal', header: ModalHeader }} />
      <Stack.Screen name="plans" options={{ title: title.plans, presentation: 'modal', header: ModalHeader }} />
      <Stack.Screen name="notifications" options={{ title: title.notifications, header: StackHeader }} />
      <Stack.Screen name="open-source-licenses" options={{ title: title.licenses, header: StackHeader }} />
      <Stack.Screen name="blocked-users" options={{ title: title.blocked, header: StackHeader }} />
      <Stack.Screen name="cloud-albums/new" options={{ title: title.newAlbum, presentation: 'modal', header: ModalHeader }} />
      <Stack.Screen name="cloud-import" options={{ title: title.import, presentation: 'modal', header: ModalHeader }} />
      <Stack.Screen name="shared-albums/join" options={{ title: title.join, presentation: 'modal', header: ModalHeader }} />
      <Stack.Screen name="shared-albums/[id]/index" options={{ title: '', header: StackHeader }} />
      <Stack.Screen name="shared-albums/[id]/add" options={{ title: '', presentation: 'modal', header: ModalHeader }} />
      <Stack.Screen name="shared-albums/[id]/members" options={{ title: title.manageAlbum, header: StackHeader }} />
    </Stack>
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
