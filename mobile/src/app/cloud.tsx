import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { Button } from '@/components/button';
import { SignInButtons } from '@/components/sign-in-buttons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { AppLanguage } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { afterSignIn, refreshSubscription, useCloudState } from '@/lib/cloud/engine';
import {
  getCloudPackages,
  purchase,
  purchasesAvailable,
  restorePurchases,
} from '@/lib/cloud/purchases';
import { useCloudSession } from '@/lib/cloud/session';
import { useTranslation } from '@/lib/i18n';
import { openLegalDocument } from '@/lib/legal';
import { describeSignInError, SignInCancelled, signInWithApple, signInWithGoogle } from '@/lib/cloud/sign-in';
import { formatSize } from '@/lib/storage';

// 소개·등급 비교·가격 → [구독하기]를 누르면 로그인 → 구매 → 기기 기록을 백업할지 묻기 (docs/PLAN.md §2.4).
// 로그인만 해도 기록(메모·장소·앨범)을 백업하고, 구독하면 안전 앨범의 사진까지 보관한다.
// 가격은 로그인 없이 볼 수 있다. 이미 구독한 사용자가 새 기기에서 로그인하면 구매 없이 바로 복원이 시작된다.
// 가입하면 무료 회원이다. 결제를 연결하기 전(RevenueCat 키 없음)에는 상품이 없어 구독을 준비 중이라고 알리고,
// 구독 기능은 관리자가 구독 회원(무상 제공)으로 지정한 계정만 쓴다. 구매 복원·약관 안내도 결제가 있을 때만 보인다.

// 계정 공간으로 바뀌면 내비게이션이 처음으로 돌아가 이미 닫혀 있을 수 있다.
function closeScreen() {
  if (router.canGoBack()) router.back();
}

/** 로그인한 뒤 이어서 할 일 */
type Intent = { kind: 'purchase'; pkg: PurchasesPackage } | { kind: 'signIn' };

/** 무료(로그인)와 안전 보관에서 되는 일. 자세한 등급 안내는 /plans, 기준은 docs/PRICING.md §2. */
type Row = { text: string; free: boolean };
const COMPARE: Record<AppLanguage, (size: string) => { free: string; paid: string; rows: Row[] }> = {
  ko: (size) => ({
    free: '무료',
    paid: '안전 보관',
    rows: [
      { text: '메모·장소·날짜·앨범 백업', free: true },
      { text: '새 휴대폰에서 같은 사진과 다시 잇기', free: true },
      { text: '공유 앨범 참여', free: true },
      { text: `사진·동영상 파일 보관 (${size})`, free: false },
      { text: '사진첩에서 지워도 Keepsake에 남기', free: false },
      { text: '휴대폰을 잃어버려도 사진 되찾기', free: false },
      { text: '공유 앨범 만들기', free: false },
    ],
  }),
  en: (size) => ({
    free: 'Free',
    paid: 'Secure',
    rows: [
      { text: 'Back up notes, places, dates, and albums', free: true },
      { text: 'Reconnect to the same photos on a new phone', free: true },
      { text: 'Join shared albums', free: true },
      { text: `Store photo and video files (${size})`, free: false },
      { text: 'Keep photos after deleting them from your library', free: false },
      { text: 'Get photos back even if you lose your phone', free: false },
      { text: 'Create shared albums', free: false },
    ],
  }),
  ja: (size) => ({
    free: '無料',
    paid: '安全保管',
    rows: [
      { text: 'メモ・場所・日付・アルバムのバックアップ', free: true },
      { text: '新しいスマホで同じ写真とまたつなぐ', free: true },
      { text: '共有アルバムへの参加', free: true },
      { text: `写真・動画ファイルの保管（${size}）`, free: false },
      { text: 'ライブラリから削除してもKeepsakeに残す', free: false },
      { text: 'スマホをなくしても写真を取り戻す', free: false },
      { text: '共有アルバムの作成', free: false },
    ],
  }),
};
const DEFAULT_SIZE = '50GB';

export default function CloudScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const session = useCloudSession();
  const { account } = useCloudState();
  const { t } = useTranslation();
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
        grace ? '백업한 기록이 그대로 이어져요.' : '안전 앨범에 담은 사진을 보관해요.',
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
        // 이미 구독 중인 계정(또는 관리자가 무상 제공한 계정): 구매하지 않고 바로 백업·복원을 시작한다.
        Alert.alert('안전 보관에 연결했어요', '이 계정의 기록을 받아올게요. 이 기기의 기록은 백업하기로 고른 것만 들어가요.');
        closeScreen();
        return;
      }
      if (next?.kind === 'purchase') {
        if (await purchase(next.pkg)) await afterPurchase();
        return;
      }
      Alert.alert('로그인했어요', '이제 메모·장소·앨범을 이 계정에 백업해요. 사진까지 안전 보관하려면 구독해 주세요.');
    });

  const subscribed = Boolean(session) && (account?.subscription.can_upload ?? false);

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: theme.accent + '18' }]}>
            <Ionicons name="shield-checkmark-outline" size={26} color={theme.accent} />
          </View>
          <ThemedText style={styles.heroTitle}>남긴 사진까지 안전하게</ThemedText>
          <ThemedText themeColor="textSecondary">
            로그인하면 기록을 무료로 백업해요. 구독하면 안전 앨범에 담은 사진 파일까지 보관해서, 사진첩에서 지우거나
            휴대폰을 잃어버려도 사진이 남아요.
          </ThemedText>
        </View>

        <Compare subscribed={subscribed} />

        <View style={styles.aside}>
          <ThemedText type="small" themeColor="textSecondary">
            로그인하지 않아도 사진 고르기·사진첩·정리는 모두 무료로 쓸 수 있어요.
          </ThemedText>
          <Pressable
            onPress={() => router.push({ pathname: '/plans', params: { from: 'cloud' } })}
            accessibilityRole="link"
            hitSlop={8}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.link}>
              {t('comparePlans')}
            </ThemedText>
          </Pressable>
        </View>

        {subscribed ? (
          <View style={styles.section}>
            <Notice icon="checkmark-circle" title="안전 보관을 사용하고 있어요." />
            <Button label="닫기" variant="secondary" onPress={closeScreen} />
          </View>
        ) : !session && intent ? (
          <SignInButtons
            busy={busy}
            reason={
              intent.kind === 'purchase'
                ? '백업한 사진을 다른 기기에서도 찾을 수 있도록, 구독 전에 로그인해 주세요.'
                : purchasesAvailable
                  ? '이미 구독 중이라면 같은 계정으로 로그인하면 백업한 기록을 받아와요.'
                  : '로그인하면 기록을 무료로 백업해요. 다른 기기에서 같은 계정으로 로그인하면 기록을 받아와요.'
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

/** 무료와 안전 보관을 한 표로 비교한다. 지금 쓰는 쪽 열 제목을 강조한다. */
function Compare({ subscribed }: { subscribed: boolean }) {
  const theme = useTheme();
  const { language } = useTranslation();
  const { account } = useCloudState();
  const copy = COMPARE[language](account?.usage ? formatSize(account.usage.max_bytes) : DEFAULT_SIZE);
  const mark = (on: boolean, paid: boolean) => (
    <View style={styles.cell}>
      {on ? (
        <Ionicons name="checkmark" size={18} color={paid ? theme.accent : theme.text} />
      ) : (
        <View style={[styles.dash, { backgroundColor: theme.border }]} />
      )}
    </View>
  );
  return (
    <View style={[styles.compare, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.row}>
        <View style={styles.flex} />
        <View style={styles.cell}>
          <ThemedText type="smallBold" themeColor={subscribed ? 'textSecondary' : 'text'}>
            {copy.free}
          </ThemedText>
        </View>
        <View style={styles.cell}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {copy.paid}
          </ThemedText>
        </View>
      </View>
      {copy.rows.map((row) => (
        <View key={row.text} style={[styles.row, styles.rowLine, { borderTopColor: theme.border }]}>
          <ThemedText type="small" style={styles.flex}>
            {row.text}
          </ThemedText>
          {mark(row.free, false)}
          {mark(true, true)}
        </View>
      ))}
    </View>
  );
}

function Notice({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.notice, { borderColor: theme.border }]}>
      <Ionicons name={icon} size={20} color={theme.accent} />
      <View style={[styles.flex, styles.noticeText]}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {text && (
          <ThemedText type="small" themeColor="textSecondary">
            {text}
          </ThemedText>
        )}
      </View>
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

  // 결제를 아직 연결하지 않은 빌드: 살 수도, 복원할 수도 없으니 준비 중이라고만 알린다.
  if (!purchasesAvailable) {
    return (
      <Notice
        icon="time-outline"
        title="안전 보관 구독은 준비하고 있어요"
        text={signedIn ? '지금은 이 계정에 기록을 무료로 백업하고 있어요.' : '지금은 로그인해서 기록을 무료로 백업할 수 있어요.'}
      />
    );
  }

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
        <Pressable onPress={() => openLegalDocument('terms')} hitSlop={8}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.link}>
            이용약관
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => openLegalDocument('privacy')} hitSlop={8}>
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
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  hero: { gap: Spacing.two },
  heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  heroTitle: { fontSize: 24, lineHeight: 32, fontWeight: 700 },
  compare: { borderRadius: 16, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth },
  cell: { width: 64, alignItems: 'center' },
  dash: { width: 10, height: 2, borderRadius: 1 },
  aside: { gap: Spacing.two },
  section: { gap: Spacing.three },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeText: { gap: Spacing.one },
  legal: { flexDirection: 'row', gap: Spacing.three },
  link: { textDecorationLine: 'underline' },
});
