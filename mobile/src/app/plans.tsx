import { router, useLocalSearchParams } from 'expo-router';
import { CheckIcon, CloudIcon, DeviceMobileIcon, MinusIcon, ShieldCheckIcon, UserIcon } from 'phosphor-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { AppLanguage } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useCloudState } from '@/lib/cloud/engine';
import { PLAN_ORDER, SHARED_ALBUM_LIMITS } from '@/lib/cloud/purchases';
import { useCloudSession } from '@/lib/cloud/session';
import { useTranslation } from '@/lib/i18n';
import { formatSize } from '@/lib/storage';
import { openSubscription } from '@/lib/cloud/subscribe';

// 이용 등급 안내: 이 기기에만 보관(비로그인) / 로그인(무료) / 안전 보관(유료 구독)에서 각각 무엇을 할 수 있는지.
// 기준은 docs/PRICING.md §2. 등급 규칙을 바꾸면 이 화면도 함께 고친다. 광고는 구독 중일 때만 빠진다 (lib/ads.ts).
// from=cloud: 안전 보관 화면에서 열었으면 아래 버튼은 그 화면으로 돌아간다 (같은 화면을 또 쌓지 않는다).

type Level = 'local' | 'free' | 'paid';

type Plan = { name: string; tag: string; intro?: string; can: string[]; cannot: string[]; note?: string };

type Copy = {
  lead: string;
  current: string;
  canTitle: string;
  cannotTitle: string;
  plans: Record<Level, Plan>;
  cta: { local: string; free: string; grace: string };
};

const COPY: Record<AppLanguage, (size: string, albums: string) => Copy> = {
  ko: (size, albums) => ({
    lead: '고르고, 남기고, 다시 보는 핵심 기능은 어느 등급에서나 모두 무료예요. 등급에 따라 기록과 사진을 어디까지 지켜 두는지가 달라요.',
    current: '지금 이용 중',
    canTitle: '할 수 있어요',
    cannotTitle: '할 수 없어요',
    plans: {
      local: {
        name: '이 기기에만 보관',
        tag: '로그인 없이 · 무료',
        can: [
          '사진 고르기·남기기, 메모와 장소 적기',
          '기기 사진첩과 앨범, 지도, 지난 사진 다시 보기',
          '남기지 않은 사진 정리',
        ],
        cannot: [
          '기록 백업. 기록은 이 기기에만 있어서 앱을 지우거나 휴대폰을 바꾸면 돌아오지 않아요.',
          '사진 파일 보관',
          '공유 앨범 참여·만들기',
        ],
      },
      free: {
        name: '로그인',
        tag: '무료 회원',
        intro: '이 기기에만 보관의 모든 기능에 더해',
        can: [
          '메모·장소·날짜·앨범을 계정에 백업',
          '휴대폰을 바꾸거나 앱을 다시 설치해도 기록이 돌아와요. 사진첩에 같은 사진이 있으면(iCloud 사진·Google 포토) 사진과 다시 이어져요',
          '초대받은 공유 앨범에 참여해 사진 보기·담기',
        ],
        cannot: [
          '사진 파일 보관. 사진첩에서 지웠거나 새 휴대폰 사진첩에 없는 사진은 기록만 돌아와요.',
          '공유 앨범 만들기',
        ],
      },
      paid: {
        name: '안전 보관',
        tag: '유료 구독',
        intro: '로그인의 모든 기능에 더해',
        can: [
          `안전 앨범에 담은 사진·동영상을 ${size}까지 보관`,
          '앨범마다, 사진마다 원본 그대로 또는 용량을 아끼는 효율 보관',
          '보관한 사진은 기기 사진첩에서 지워도 남아요. 휴대폰을 가볍게 비울 수 있어요.',
          '휴대폰을 잃어버려도, 사진첩 백업이 없어도 로그인하면 사진이 돌아와요',
          `가족·친구와 쓰는 공유 앨범을 ${albums}개까지 만들고 내 용량을 나눠 주기`,
          '광고 없이 쓰기',
        ],
        cannot: [],
        note: '구독이 끝나면 광고가 다시 보이고, 30일 동안 보관한 사진을 내려받을 수 있으며, 그 뒤 사진은 삭제돼요. 기록 백업은 로그인한 동안 계속돼요.',
      },
    },
    cta: { local: '로그인하고 기록 백업하기', free: '안전 보관 시작하기', grace: '다시 구독하기' },
  }),
  en: (size, albums) => ({
    lead: 'Choosing, keeping, and revisiting photos are free on every plan. Plans differ in how much of your memories and photos are kept safe.',
    current: 'Current plan',
    canTitle: 'Included',
    cannotTitle: 'Not included',
    plans: {
      local: {
        name: 'This device only',
        tag: 'No sign-in · Free',
        can: [
          'Choose and keep photos, add notes and places',
          'Device library, albums, map, and past photos',
          'Clean up photos you did not keep',
        ],
        cannot: [
          'Memory backup. Memories live only on this device, so they are lost if you delete the app or change phones.',
          'Photo file storage',
          'Joining or creating shared albums',
        ],
      },
      free: {
        name: 'Signed in',
        tag: 'Free account',
        intro: 'Everything in This device only, plus',
        can: [
          'Back up notes, places, dates, and albums to your account',
          'Your memories come back on a new phone or after reinstalling, and reconnect to the same photos in your library (iCloud Photos, Google Photos)',
          'Join shared albums you are invited to, and view or add photos',
        ],
        cannot: [
          'Photo file storage. For photos you deleted, or that are not in your new phone’s library, only the memory comes back.',
          'Creating shared albums',
        ],
      },
      paid: {
        name: 'Secure Storage',
        tag: 'Subscription',
        intro: 'Everything in Signed in, plus',
        can: [
          `Store photos and videos in secure albums, up to ${size}`,
          'Choose Original quality or Space saver, per album or per photo',
          'Stored photos stay even if you delete them from your library, so you can free up your phone',
          'Even if you lose your phone or have no library backup, your photos come back when you sign in',
          `Create up to ${albums} shared albums with family and friends, and share your storage with them`,
          'No ads',
        ],
        cannot: [],
        note: 'When a subscription ends, ads return and you can download stored photos for 30 days before they are deleted. Memory backup continues while you are signed in.',
      },
    },
    cta: { local: 'Sign in and back up memories', free: 'Start Secure Storage', grace: 'Subscribe again' },
  }),
  ja: (size, albums) => ({
    lead: '写真を選ぶ・残す・見返す基本機能は、どのプランでもすべて無料です。プランによって、思い出と写真をどこまで守れるかが変わります。',
    current: '利用中',
    canTitle: 'できること',
    cannotTitle: 'できないこと',
    plans: {
      local: {
        name: 'このデバイスだけに保存',
        tag: 'ログインなし · 無料',
        can: [
          '写真を選んで残す、メモと場所を書く',
          'デバイスのライブラリとアルバム、地図、過去の写真を見返す',
          '残さなかった写真の整理',
        ],
        cannot: [
          '思い出のバックアップ。思い出はこのデバイスにしかないため、アプリを削除したりスマホを替えたりすると戻りません。',
          '写真ファイルの保管',
          '共有アルバムへの参加・作成',
        ],
      },
      free: {
        name: 'ログイン',
        tag: '無料会員',
        intro: '「このデバイスだけに保存」のすべての機能に加えて',
        can: [
          'メモ・場所・日付・アルバムをアカウントにバックアップ',
          'スマホを替えても再インストールしても思い出が戻り、ライブラリに同じ写真があれば（iCloud写真・Googleフォト）写真とまたつながります',
          '招待された共有アルバムに参加して写真を見る・追加する',
        ],
        cannot: [
          '写真ファイルの保管。削除した写真や、新しいスマホのライブラリにない写真は、思い出だけが戻ります。',
          '共有アルバムの作成',
        ],
      },
      paid: {
        name: '安全保管',
        tag: '有料サブスクリプション',
        intro: '「ログイン」のすべての機能に加えて',
        can: [
          `セキュアアルバムの写真・動画を${size}まで保管`,
          'アルバムごと・写真ごとに、オリジナル品質か、容量を節約する省スペース保存を選べます',
          '保管した写真はライブラリから削除しても残ります。スマホを軽くできます。',
          'スマホをなくしても、ライブラリのバックアップがなくても、ログインすれば写真が戻ります',
          `家族や友だちと使う共有アルバムを${albums}個まで作成し、自分の容量を分けられます`,
          '広告なしで使える',
        ],
        cannot: [],
        note: 'サブスクリプションが終わると広告が表示されるようになり、30日間は保管した写真をダウンロードでき、その後削除されます。思い出のバックアップはログイン中ずっと続きます。',
      },
    },
    cta: { local: 'ログインして思い出をバックアップ', free: '安全保管を始める', grace: '再登録する' },
  }),
};

const ICONS = { local: DeviceMobileIcon, free: UserIcon, paid: ShieldCheckIcon };
// 구독하기 전에는 두 요금제의 용량과 공유 앨범 수를 함께 보여 준다 (docs/PRICING.md §2).
const DEFAULT_SIZE = '10GB / 100GB';
const DEFAULT_ALBUMS = PLAN_ORDER.map((plan) => SHARED_ALBUM_LIMITS[plan]).join(' / ');

export default function PlansScreen() {
  const theme = useTheme();
  const { language } = useTranslation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const session = useCloudSession();
  const { account } = useCloudState();
  const plan = account?.subscription.plan;
  const copy = COPY[language](
    account?.usage.max_bytes ? formatSize(account.usage.max_bytes) : DEFAULT_SIZE,
    plan ? String(SHARED_ALBUM_LIMITS[plan]) : DEFAULT_ALBUMS,
  );
  const grace = account?.subscription.status === 'grace';
  const current: Level = !session ? 'local' : account?.subscription.can_upload ? 'paid' : 'free';
  const cta = current === 'local' ? copy.cta.local : current === 'free' ? (grace ? copy.cta.grace : copy.cta.free) : null;

  const openCloud = () => {
    if (current === 'local') router.push('/sign-in');
    else
      openSubscription(() => {
        if (from === 'cloud' && router.canGoBack()) router.back();
        else router.push('/cloud');
      });
  };

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.lead}>
            <CloudIcon size={28} color={theme.accent} />
            <ThemedText themeColor="textSecondary">{copy.lead}</ThemedText>
          </View>
          {(['local', 'free', 'paid'] as const).map((level) => (
            <PlanCard key={level} level={level} plan={copy.plans[level]} copy={copy} current={level === current} />
          ))}
        </ScrollView>
        {cta && (
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Button label={cta} onPress={openCloud} />
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function PlanCard({ level, plan, copy, current }: { level: Level; plan: Plan; copy: Copy; current: boolean }) {
  const theme = useTheme();
  const Icon = ICONS[level];
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: current ? theme.accent : 'transparent' },
      ]}>
      <View style={styles.cardHeading}>
        <View style={[styles.icon, { backgroundColor: theme.accent + '18' }]}>
          <Icon size={20} color={theme.accent} weight="bold" />
        </View>
        <View style={styles.flex}>
          <ThemedText type="smallBold">{plan.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {plan.tag}
          </ThemedText>
        </View>
        {current && (
          <View style={[styles.badge, { backgroundColor: theme.accent }]}>
            <ThemedText type="small" style={[styles.badgeText, { color: theme.onAccent }]}>
              {copy.current}
            </ThemedText>
          </View>
        )}
      </View>

      <View style={styles.group}>
        <ThemedText type="small" themeColor="textSecondary">
          {plan.intro ?? copy.canTitle}
        </ThemedText>
        {plan.can.map((item) => (
          <Line key={item} text={item} included />
        ))}
      </View>
      {plan.cannot.length > 0 && (
        <View style={styles.group}>
          <ThemedText type="small" themeColor="textSecondary">
            {copy.cannotTitle}
          </ThemedText>
          {plan.cannot.map((item) => (
            <Line key={item} text={item} included={false} />
          ))}
        </View>
      )}
      {plan.note && (
        <ThemedText type="small" themeColor="textSecondary">
          {plan.note}
        </ThemedText>
      )}
    </View>
  );
}

function Line({ text, included }: { text: string; included: boolean }) {
  const theme = useTheme();
  const Icon = included ? CheckIcon : MinusIcon;
  return (
    <View style={styles.line}>
      <Icon size={16} color={included ? theme.accent : theme.textSecondary} weight="bold" style={styles.lineIcon} />
      <ThemedText type="small" themeColor={included ? 'text' : 'textSecondary'} style={styles.flex}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
  lead: { gap: Spacing.two, paddingHorizontal: Spacing.one, paddingBottom: Spacing.one },
  card: { gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three, borderWidth: 1.5 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  badgeText: { fontWeight: '600' },
  group: { gap: Spacing.one },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  lineIcon: { marginTop: 3 },
  footer: { padding: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
});
