import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, useColorScheme, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { afterSignIn, refreshSubscription, useCloudState } from '@/lib/cloud/engine';
import {
  getCloudPackages,
  purchase,
  purchasesAvailable,
  restorePurchases,
} from '@/lib/cloud/purchases';
import { useCloudSession } from '@/lib/cloud/session';
import {
  appleSignInAvailable,
  describeSignInError,
  googleSignInAvailable,
  SignInCancelled,
  signInWithApple,
  signInWithGoogle,
} from '@/lib/cloud/sign-in';

// 소개·가격 → [구독하기]를 누르면 로그인 → 구매 → 올릴 기기 기록 고르기 (docs/PLAN.md §2.4).
// 로그인만 해도 기록(메모·장소·앨범)을 백업하고, 구독하면 안전 앨범의 사진까지 보관한다.
// 가격은 로그인 없이 볼 수 있다. 이미 구독한 사용자가 새 기기에서 로그인하면 구매 없이 바로 복원이 시작된다.
// 결제를 연결하기 전(RevenueCat 키 없음)에는 서버가 로그인한 계정을 구독 중으로 보므로 로그인만 받는다.


// 계정 공간으로 바뀌면 내비게이션이 처음으로 돌아가 이미 닫혀 있을 수 있다.
function closeScreen() {
  if (router.canGoBack()) router.back();
}

/** 로그인한 뒤 이어서 할 일 */
type Intent = { kind: 'purchase'; pkg: PurchasesPackage } | { kind: 'signIn' };

export default function CloudScreen() {
  const db = useSQLiteContext();
  const session = useCloudSession();
  const { account } = useCloudState();
  const [busy, setBusy] = useState(false);
  // 로그인 전에 고른 상품. 있으면 로그인 버튼을 보여준다.
  const [intent, setIntent] = useState<Intent | null>(purchasesAvailable ? null : { kind: 'signIn' });

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (e) {
      if (!(e instanceof SignInCancelled)) {
        Alert.alert('문제가 생겼어요', describeSignInError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const grace = account?.subscription.status === 'grace';

  const afterPurchase = async () => {
    const refreshed = await refreshSubscription(db);
    if (refreshed.subscription.can_upload) {
      Alert.alert(
        grace ? '다시 구독해 주셔서 고마워요' : '안전 보관을 시작했어요',
        grace ? '백업한 기록이 그대로 이어져요.' : '올릴 기록을 고르면 백업을 시작해요.',
      );
      closeScreen();
    } else {
      // webhook이 늦게 오면 서버가 아직 모를 수 있다. 다음 동기화 때 다시 확인한다.
      Alert.alert('구매를 확인하는 중이에요', '잠시 후 설정 화면에서 상태가 바뀌어요.');
    }
  };

  const buy = (pkg: PurchasesPackage) =>
    run(async () => {
      if (await purchase(pkg)) await afterPurchase();
    });

  const signIn = (method: () => Promise<string>) =>
    run(async () => {
      const userId = await method();
      const signedIn = await afterSignIn(userId);
      const next = intent;
      setIntent(null);
      if (signedIn.subscription.can_upload) {
        // 이미 구독 중인 계정(또는 결제 연결 전): 구매하지 않고 바로 백업·복원을 시작한다.
        Alert.alert('안전 보관에 연결했어요', '이 계정의 기록을 받아올게요. 이 기기의 기록은 고른 것만 올라가요.');
        closeScreen();
        return;
      }
      if (next?.kind === 'purchase') {
        if (await purchase(next.pkg)) await afterPurchase();
        return;
      }
      Alert.alert('로그인했어요', '이제 메모·장소·앨범을 이 계정에 백업해요. 사진까지 안전 보관하려면 구독해 주세요.');
    });

  const subscribed = account?.subscription.can_upload ?? false;

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pitch}>
          <ThemedText type="subtitle">남긴 사진은 지키고, 휴대폰은 가볍게</ThemedText>
          <Feature text="로그인만 해도 메모·장소·앨범을 계정에 백업해요. 로그인하지 않으면 이 기기에만 남아요." />
          <Feature text="구독하면 안전 앨범에 담은 사진을 보관해요. 앨범마다 원본 그대로, 또는 용량을 아끼는 효율 보관을 골라요." />
          <Feature text="안전 보관이 끝난 사진은 기기 사진첩에서 지워도 Keepsake에 그대로 남아요. 휴대폰을 비워도 돼요." />
          <Feature text="기기를 바꿔도 로그인만 하면 그대로 돌아와요." />
          <Feature text="여러 기기에서 같은 사진첩을 볼 수 있어요." />
          <ThemedText type="small" themeColor="textSecondary">
            고르기와 사진첩은 이 기기에만 보관해도 모두 쓸 수 있어요. 기기의 기록은 고른 것만 안전 보관함에 복사되고, 구독과 관계없이 그대로 남아요.
          </ThemedText>
        </View>

        {session && subscribed ? (
          <View style={styles.section}>
            <ThemedText>안전 보관을 사용하고 있어요.</ThemedText>
            <Button label="닫기" onPress={() => router.back()} />
          </View>
        ) : !session && intent ? (
          <SignInButtons
            busy={busy}
            reason={
              intent.kind === 'purchase'
                ? '백업한 사진을 다른 기기에서도 찾을 수 있도록, 구독 전에 로그인해 주세요.'
                : purchasesAvailable
                  ? '이미 구독 중이라면 같은 계정으로 로그인하면 백업한 기록을 받아와요.'
                  : '로그인하면 이 계정의 안전 보관함을 볼 수 있어요. 다른 기기에서 같은 계정으로 로그인하면 기록을 받아와요.'
            }
            onApple={() => signIn(signInWithApple)}
            onGoogle={() => signIn(signInWithGoogle)}
            onCancel={purchasesAvailable ? () => setIntent(null) : undefined}
          />
        ) : (
          <Paywall
            busy={busy}
            grace={grace}
            signedIn={Boolean(session)}
            onBuy={(pkg) => (session ? buy(pkg) : setIntent({ kind: 'purchase', pkg }))}
            onSignIn={() => setIntent({ kind: 'signIn' })}
            onRestore={() =>
              run(async () => {
                await restorePurchases();
                await afterPurchase();
              })
            }
          />
        )}
      </ScrollView>
    </ThemedView>
  );
}

function Feature({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.feature}>
      <View style={[styles.dot, { backgroundColor: theme.accent }]} />
      <ThemedText style={styles.flex}>{text}</ThemedText>
    </View>
  );
}

function SignInButtons({
  busy,
  reason,
  onApple,
  onGoogle,
  onCancel,
}: {
  busy: boolean;
  reason: string;
  onApple: () => void;
  onGoogle: () => void;
  onCancel?: () => void;
}) {
  const scheme = useColorScheme();
  const [apple, setApple] = useState(false);
  useEffect(() => {
    appleSignInAvailable().then(setApple);
  }, []);

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">로그인</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {reason}
      </ThemedText>
      {apple && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={
            scheme === 'dark'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={Spacing.three}
          style={styles.appleButton}
          onPress={busy ? () => {} : onApple}
        />
      )}
      {googleSignInAvailable && (
        <Button label="Google로 계속하기" variant="secondary" loading={busy} onPress={onGoogle} />
      )}
      {!apple && !googleSignInAvailable && (
        <ThemedText type="small" themeColor="textSecondary">
          이 빌드에서는 로그인을 사용할 수 없어요.
        </ThemedText>
      )}
      {onCancel && <Button label="돌아가기" variant="secondary" disabled={busy} onPress={onCancel} />}
    </View>
  );
}

function Paywall({
  busy,
  grace,
  signedIn,
  onBuy,
  onSignIn,
  onRestore,
}: {
  busy: boolean;
  grace: boolean;
  signedIn: boolean;
  onBuy: (pkg: PurchasesPackage) => void;
  onSignIn: () => void;
  onRestore: () => void;
}) {
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);

  useEffect(() => {
    getCloudPackages()
      .then(setPackages)
      .catch(() => setPackages([]));
  }, []);

  if (packages === null) return <ActivityIndicator />;

  return (
    <View style={styles.section}>
      {grace && (
        <ThemedText type="small">
          지금 다시 구독하면 아무것도 다시 올리지 않고 바로 이어서 쓸 수 있어요.
        </ThemedText>
      )}
      {packages.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          구독 상품을 불러오지 못했어요. 잠시 후 다시 열어 주세요.
        </ThemedText>
      )}
      {packages.map((pkg) => (
        <Button
          key={pkg.identifier}
          label={`${pkg.product.title} · ${pkg.product.priceString}${periodLabel(pkg.product.subscriptionPeriod)}`}
          loading={busy}
          onPress={() => onBuy(pkg)}
        />
      ))}
      {signedIn ? (
        <Button label="구매 복원" variant="secondary" disabled={busy} onPress={onRestore} />
      ) : (
        <Button label="로그인만 하기 · 이미 구독 중이에요" variant="secondary" disabled={busy} onPress={onSignIn} />
      )}
      <ThemedText type="small" themeColor="textSecondary">
        구독은 기간이 끝나기 24시간 전까지 해지하지 않으면 자동으로 갱신돼요. 해지는 스토어의 구독 관리에서 할
        수 있어요. 구독이 끝나면 30일 동안 보관한 사진을 내려받을 수 있고, 그 뒤 사진은 삭제돼요. 기록 백업은 로그인한 동안 계속돼요.
      </ThemedText>
      <View style={styles.legal}>
        <Pressable onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })} hitSlop={8}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.link}>
            이용약관
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })} hitSlop={8}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.link}>
            개인정보처리방침
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function periodLabel(period: string | null) {
  // ISO 8601 기간 (P1M, P1Y)
  if (period === 'P1M') return ' / 월';
  if (period === 'P1Y') return ' / 년';
  return '';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.five, paddingBottom: Spacing.six },
  pitch: { gap: Spacing.three },
  feature: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 6, height: 6, borderRadius: 3 },
  section: { gap: Spacing.three },
  appleButton: { height: 48 },
  legal: { flexDirection: 'row', gap: Spacing.three },
  link: { textDecorationLine: 'underline' },
});
