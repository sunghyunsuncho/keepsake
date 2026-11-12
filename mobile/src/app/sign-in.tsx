import { router } from 'expo-router';
import { CloudArrowUpIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SignInButtons } from '@/components/sign-in-buttons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { afterSignIn } from '@/lib/cloud/engine';
import { describeSignInError, SignInCancelled, signInWithApple, signInWithGoogle } from '@/lib/cloud/sign-in';

// 설정의 [로그인하고 기록 백업하기]: 로그인만 한다. 구독 소개와 가격은 안전 보관 화면(/cloud)에 둔다.
// 로그인하면 계정 공간으로 바뀌고, 이 기기에 남긴 기록이 있으면 LocalImportPrompt가 백업할지 묻는다.
export default function SignInScreen() {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  const signIn = async (method: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    try {
      await afterSignIn(await method());
      // 계정 공간으로 바뀌면 내비게이션이 처음으로 돌아가 이미 닫혀 있을 수 있다.
      if (router.canGoBack()) router.back();
    } catch (e) {
      if (!(e instanceof SignInCancelled)) Alert.alert('문제가 생겼어요', describeSignInError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.content} edges={['bottom']}>
        <View style={styles.intro}>
          <View style={[styles.icon, { backgroundColor: theme.accent + '18' }]}>
            <CloudArrowUpIcon size={28} color={theme.accent} />
          </View>
          <ThemedText type="subtitle" style={styles.center}>
            기록을 계정에 백업해요
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            메모·장소·날짜·앨범을 무료로 백업해요. 휴대폰을 바꿔도 사진첩에 같은 사진이 있으면 기록과 다시 이어져요.
          </ThemedText>
        </View>
        <SignInButtons busy={busy} onApple={() => signIn(signInWithApple)} onGoogle={() => signIn(signInWithGoogle)} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', gap: Spacing.five, padding: Spacing.four },
  intro: { alignItems: 'center', gap: Spacing.two },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
