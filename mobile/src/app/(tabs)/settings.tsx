import * as Application from 'expo-application';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CloudArrowUpIcon, FileTextIcon, FlagIcon, ImageSquareIcon, ShieldCheckIcon, SignInIcon, UserIcon } from 'phosphor-react-native';

import { AccountRows, CloudLibraryRows, RecordBackupRows } from '@/components/cloud-section';
import { ReminderRows } from '@/components/reminder-section';
import { SettingsCard, SettingsRow, SettingsSection, shortDateTime } from '@/components/settings-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { APP_NAME, COMPANY, CONTACT_EMAIL } from '@/constants/app-info';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { libraryStats } from '@/db/moments';
import { getSettings, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useCloudState } from '@/lib/cloud/engine';
import { type Account, useCloudSession } from '@/lib/cloud/session';
import { formatFullDate } from '@/lib/dates';
import { openLegalDocument } from '@/lib/legal';

type SectionKey = 'device' | 'cloud';

// 설정 탭은 마이페이지 역할도 한다: 계정 → 기기 사진첩 → 안전 사진첩(구독 중일 때만) → 계정 관리.
// 기기 사진첩·안전 사진첩 탭의 설정 버튼은 ?section=device|cloud로 열어 그 영역으로 바로 옮겨 준다.
export default function SettingsScreen() {
  const db = useSQLiteContext();
  const { section } = useLocalSearchParams<{ section?: SectionKey }>();
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const { data: stats } = useDbQuery(() => libraryStats(db), [db]);
  const session = useCloudSession();
  const { account } = useCloudState();
  // 안전 사진첩 설정은 구독 중이거나 구독이 끝난 뒤 30일 유예 중(사진을 내려받아야 함)일 때만 보인다.
  const paid = Boolean(session && account?.subscription.can_download);

  const scroll = useRef<ScrollView>(null);
  const [offsets, setOffsets] = useState<Partial<Record<SectionKey, number>>>({});
  const offset = section ? offsets[section] : undefined;
  useEffect(() => {
    if (!section || offset === undefined) return;
    scroll.current?.scrollTo({ y: Math.max(offset - Spacing.three, 0), animated: true });
    // 한 번 옮긴 뒤에는 지워서, 다음에 탭을 눌러 들어올 때 다시 움직이지 않게 한다.
    router.setParams({ section: undefined });
  }, [section, offset]);
  const remember = (key: SectionKey) => (y: number) => setOffsets((prev) => (prev[key] === y ? prev : { ...prev, [key]: y }));

  const resetCursor = () =>
    Alert.alert('고르기 시작 시점을 초기화할까요?', '남긴 사진은 그대로예요. 다음에 고르기 탭을 열면 다시 정해요.', [
      { text: '취소', style: 'cancel' },
      { text: '초기화', style: 'destructive', onPress: () => setSetting(db, 'review_cursor', null) },
    ]);

  return (
    <ThemedView style={styles.flex}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
        <ProfileCard signedIn={Boolean(session)} account={account} />

        <View onLayout={(e) => remember('device')(e.nativeEvent.layout.y)}>
          <SettingsSection title="기기 사진첩">
            <SettingsRow
              label="고르기 시작 시점"
              icon={FlagIcon}
              value={settings?.review_cursor ? shortDateTime(settings.review_cursor) : '정하지 않음'}
              onPress={settings?.review_cursor ? resetCursor : undefined}
            />
            <ReminderRows settings={settings} />
            <SettingsRow label="남긴 기록" icon={ImageSquareIcon} value={stats ? `${stats.count}장 · ${stats.days}일` : null} />
            <RecordBackupRows />
          </SettingsSection>
        </View>

        {paid && (
          <View onLayout={(e) => remember('cloud')(e.nativeEvent.layout.y)}>
            <SettingsSection title="안전 사진첩">
              <CloudLibraryRows />
            </SettingsSection>
          </View>
        )}

        {session && (
          <SettingsSection title="계정">
            <AccountRows />
          </SettingsSection>
        )}

        <SettingsSection title="도움말 및 정보">
          <SettingsRow
            label="이용약관"
            icon={FileTextIcon}
            onPress={() => openLegalDocument('terms')}
          />
          <SettingsRow
            label="개인정보 처리방침"
            icon={ShieldCheckIcon}
            onPress={() => openLegalDocument('privacy')}
          />
        </SettingsSection>

        <AppFooter />
      </ScrollView>
    </ThemedView>
  );
}

/**
 * 마이페이지 계정 카드 (Vernissage 마이 탭의 사용자 카드와 같은 모양): 이니셜 원 + 계정 + 이용 중인 등급.
 * 로그인하지 않았으면 로그인을, 구독 전이면 구독을 아래 줄에서 안내한다.
 */
function ProfileCard({ signedIn, account }: { signedIn: boolean; account: Account | null }) {
  const theme = useTheme();
  const initial = account?.email?.trim()[0]?.toUpperCase();
  const action = !signedIn
    ? { label: '로그인하고 기록 백업하기', icon: SignInIcon }
    : account && !account.subscription.can_upload
      ? {
          label: account.subscription.status === 'grace' ? '다시 구독하기' : '사진 안전 보관 시작하기',
          icon: CloudArrowUpIcon,
        }
      : null;

  return (
    <SettingsCard>
      <View style={styles.userRow}>
        <View style={[styles.avatar, { backgroundColor: signedIn ? theme.accent : theme.backgroundSelected }]}>
          {signedIn && initial ? (
            <ThemedText style={[styles.avatarText, { color: theme.onAccent }]}>{initial}</ThemedText>
          ) : (
            <UserIcon size={26} color={signedIn ? theme.onAccent : theme.textSecondary} weight="fill" />
          )}
        </View>
        <View style={styles.userInfo}>
          <ThemedText themeColor="text" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.userName}>
            {signedIn ? (account?.email ?? '로그인한 계정') : '로그인하지 않았어요'}
          </ThemedText>
          <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.userSub}>
            {signedIn ? planText(account) : '기록이 이 기기에만 있어요'}
          </ThemedText>
        </View>
      </View>
      {action && <SettingsRow label={action.label} icon={action.icon} onPress={() => router.push('/cloud')} />}
    </SettingsCard>
  );
}

function planText(account: Account | null) {
  if (!account) return '계정 정보를 불러오는 중이에요';
  const { status, grace_until: graceUntil } = account.subscription;
  switch (status) {
    case 'active':
      return '안전 보관 · 사진까지 보관하고 있어요';
    case 'grace':
      return graceUntil ? `구독 종료 · ${formatFullDate(graceUntil)}까지 사진 내려받기` : '구독 종료 · 30일 동안 사진 내려받기';
    default:
      return '무료 · 기록을 백업하고 있어요';
  }
}

/** 하단 앱 정보: 이름, 버전·운영사, 문의 메일, 오픈소스 라이선스, 저작권 */
function AppFooter() {
  const version = Application.nativeApplicationVersion ?? '—';
  const build = Application.nativeBuildVersion;
  return (
    <View style={styles.footer}>
      <ThemedText themeColor="textMid" style={styles.footerName}>
        {APP_NAME}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.footerLine}>
        버전 {version}
        {build ? ` (${build})` : ''} · {COMPANY}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.footerLine}>
        문의 {CONTACT_EMAIL}
      </ThemedText>
      <View style={styles.footerBottom}>
        <Pressable onPress={() => router.push('/open-source-licenses')} hitSlop={8} accessibilityRole="link">
          <ThemedText themeColor="textSecondary" style={[styles.footerLine, styles.footerLink]}>
            오픈소스 라이선스
          </ThemedText>
        </Pressable>
        <ThemedText themeColor="textSecondary" style={styles.footerLine}>
          © {new Date().getFullYear()} {COMPANY}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.six },
  // Vernissage 사용자 카드와 같은 크기: 원 56, 이름 17, 보조 줄 14.
  userRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 21, lineHeight: 26, fontWeight: '700' },
  userInfo: { flex: 1, gap: 3 },
  userName: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  userSub: { fontSize: 14, lineHeight: 19 },
  // Vernissage 마이 탭 하단과 같은 크기: 앱 이름 14, 나머지 12.
  footer: { gap: 3, paddingHorizontal: Spacing.one, paddingTop: Spacing.two },
  footerName: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  footerLine: { fontSize: 12, lineHeight: 17 },
  footerBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.two },
  footerLink: { textDecorationLine: 'underline' },
});
