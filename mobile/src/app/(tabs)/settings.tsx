import * as Application from 'expo-application';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CloudArrowUpIcon, FileTextIcon, FlagIcon, GlobeSimpleIcon, ProhibitIcon, ImageSquareIcon, LightbulbIcon, ListChecksIcon, ShieldCheckIcon, SignInIcon, SlidersHorizontalIcon, UserIcon } from 'phosphor-react-native';

import { AdBanner } from '@/components/ad-banner';
import { AccountRows, CloudLibraryRows, RecordBackupRows } from '@/components/cloud-section';
import { showActionSheet } from '@/components/action-sheet';
import { ReminderRows } from '@/components/reminder-section';
import { SettingsCard, SettingsRow, SettingsSection, shortDateTime } from '@/components/settings-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { APP_NAME, COMPANY, CONTACT_EMAIL } from '@/constants/app-info';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { libraryStats } from '@/db/moments';
import { APP_LANGUAGES, getSettings, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { showAdPrivacyOptions, useAds } from '@/lib/ads';
import { useCloudState } from '@/lib/cloud/engine';
import { type Account, useCloudSession } from '@/lib/cloud/session';
import { formatFullDate } from '@/lib/dates';
import { openLegalDocument } from '@/lib/legal';
import { LANGUAGE_LABELS, useTranslation } from '@/lib/i18n';

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
  const { language, setLanguage, t } = useTranslation();
  // 안전 사진첩 설정은 구독 중이거나 구독이 끝난 뒤 30일 유예 중(사진을 내려받아야 함)일 때만 보인다.
  const paid = Boolean(session && account?.subscription.can_download);
  const ads = useAds();

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
    Alert.alert(t('resetStartTitle'), t('resetStartMessage'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('reset'), style: 'destructive', onPress: () => setSetting(db, 'review_cursor', null) },
    ]);

  const chooseLanguage = () =>
    showActionSheet(t('chooseLanguage'), undefined, [
      ...APP_LANGUAGES.map((option) => ({
        text: `${LANGUAGE_LABELS[option]}${option === language ? ' ✓' : ''}`,
        onPress: () => {
          // 저장 실패 시 Provider가 이전 언어로 되돌린다. 시트 동작에서 미처리 Promise는 남기지 않는다.
          void setLanguage(option).catch(() => {});
        },
      })),
      { text: t('cancel'), style: 'cancel' as const },
    ]);

  return (
    <ThemedView style={styles.flex}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
        <ProfileCard signedIn={Boolean(session)} account={account} />

        <AdBanner maxHeight={100} style={styles.ad} />

        <View onLayout={(e) => remember('device')(e.nativeEvent.layout.y)}>
          <SettingsSection title={t('deviceLibrary')}>
            <SettingsRow
              label={t('startPoint')}
              icon={FlagIcon}
              value={settings?.review_cursor ? shortDateTime(settings.review_cursor, language) : t('notSet')}
              onPress={settings?.review_cursor ? resetCursor : undefined}
            />
            <ReminderRows settings={settings} />
            <SettingsRow label={t('savedRecords')} icon={ImageSquareIcon} value={stats ? statsLabel(stats.count, stats.days, language) : null} />
            <RecordBackupRows />
          </SettingsSection>
        </View>

        {paid && (
          <View onLayout={(e) => remember('cloud')(e.nativeEvent.layout.y)}>
            <SettingsSection title={t('secureLibrary')}>
              <CloudLibraryRows />
            </SettingsSection>
          </View>
        )}

        {session && (
          <SettingsSection title={t('account')}>
            {/* 공유 앨범에서 차단한 사람. 앨범을 나간 사람의 차단도 여기서 푼다. */}
            <SettingsRow label={t('blockedUsers')} icon={ProhibitIcon} onPress={() => router.push('/blocked-users')} />
            <AccountRows />
          </SettingsSection>
        )}

        <SettingsSection title={t('settings')}>
          <SettingsRow label={t('language')} icon={GlobeSimpleIcon} value={LANGUAGE_LABELS[language]} onPress={chooseLanguage} />
          {/* 광고 동의를 받은 지역(UMP)이면 언제든 동의를 바꿀 수 있어야 한다. */}
          {ads.privacyOptions && (
            <SettingsRow label={t('adPrivacy')} icon={SlidersHorizontalIcon} onPress={showAdPrivacyOptions} />
          )}
        </SettingsSection>

        <SettingsSection title={t('helpAndInfo')}>
          <SettingsRow label={t('howToUse')} icon={LightbulbIcon} onPress={() => router.push('/welcome')} />
          <SettingsRow label={t('plansGuide')} icon={ListChecksIcon} onPress={() => router.push('/plans')} />
          <SettingsRow
            label={t('terms')}
            icon={FileTextIcon}
            onPress={() => openLegalDocument('terms')}
          />
          <SettingsRow
            label={t('privacy')}
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
  const { t } = useTranslation();
  const initial = account?.email?.trim()[0]?.toUpperCase();
  const action = !signedIn
    ? { label: t('signInAndBackup'), icon: SignInIcon }
    : account && !account.subscription.can_upload
      ? {
          label: account.subscription.status === 'grace' ? t('subscribeAgain') : t('startSecureStorage'),
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
            {signedIn ? (account?.email ?? t('signedInAccount')) : t('notSignedIn')}
          </ThemedText>
          <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.userSub}>
            {signedIn ? planText(account, t) : t('localOnly')}
          </ThemedText>
        </View>
      </View>
      {action && (
        <SettingsRow label={action.label} icon={action.icon} onPress={() => router.push(signedIn ? '/cloud' : '/sign-in')} />
      )}
    </SettingsCard>
  );
}

function planText(account: Account | null, t: ReturnType<typeof useTranslation>['t']) {
  if (!account) return t('loadingAccount');
  const { status, grace_until: graceUntil } = account.subscription;
  switch (status) {
    case 'active':
      return t('secureStorageActive');
    case 'grace':
      return graceUntil ? `${t('subscriptionEnded')} (${formatFullDate(graceUntil)})` : t('subscriptionEnded');
    default:
      return t('freeBackup');
  }
}

function statsLabel(count: number, days: number, language: 'ko' | 'en' | 'ja') {
  if (language === 'en') return `${count} photos · ${days} days`;
  if (language === 'ja') return `${count}枚 · ${days}日`;
  return `${count}장 · ${days}일`;
}

/** 하단 앱 정보: 이름, 버전·운영사, 문의 메일, 오픈소스 라이선스, 저작권 */
function AppFooter() {
  const { t } = useTranslation();
  const version = Application.nativeApplicationVersion ?? '—';
  const build = Application.nativeBuildVersion;
  return (
    <View style={styles.footer}>
      <ThemedText themeColor="textMid" style={styles.footerName}>
        {APP_NAME}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.footerLine}>
        {t('version')} {version}
        {build ? ` (${build})` : ''} · {COMPANY}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.footerLine}>
        {t('contact')} {CONTACT_EMAIL}
      </ThemedText>
      <View style={styles.footerBottom}>
        <Pressable onPress={() => router.push('/open-source-licenses')} hitSlop={8} accessibilityRole="link">
          <ThemedText themeColor="textSecondary" style={[styles.footerLine, styles.footerLink]}>
            {t('openSource')}
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
  // 목록의 gap이 이미 위아래를 띄운다.
  ad: { marginTop: 0 },
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
