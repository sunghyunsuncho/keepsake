import Ionicons from '@expo/vector-icons/Ionicons';
import { useNetworkState } from 'expo-network';
import { router, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AdBanner, TAB_AD_MAX_HEIGHT } from '@/components/ad-banner';
import { AlbumSectionHeader, MomentsRowCard } from '@/components/album-shelf';
import { Button } from '@/components/button';
import { CreatedAlbumCard } from '@/components/created-album-card';
import { CloudAlbumGuide } from '@/components/library-guide';
import { NotificationBell } from '@/components/notification-bell';
import { PhotoQualityBadge } from '@/components/photo-quality';
import { SharedAlbumSection } from '@/components/shared-album-section';
import { ThemedText } from '@/components/themed-text';
import { HeaderButton } from '@/components/stack-header';
import { TabTitle } from '@/components/tab-title';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { listAlbums, listCloudAlbumPending, listRecentCloudMoments, type AlbumSummary } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { useTheme } from '@/hooks/use-theme';
import { useCloudState } from '@/lib/cloud/engine';
import { useCloudSession } from '@/lib/cloud/session';
import { formatBytes } from '@/lib/storage';
import { photoCount, useTranslation } from '@/lib/i18n';

/** 계정의 안전 보관 공간: 안전 앨범 목록. 구독 중이거나 유예 기간에만 연다. */
export default function CloudLibraryScreen() {
  const session = useCloudSession();
  const { t } = useTranslation();
  const { account } = useCloudState();
  const theme = useTheme();
  const canView = Boolean(session && account?.subscription.can_download);
  const network = useNetworkState();
  // 처음에는 값을 모른다(undefined). 연결이 없다고 확인될 때만 오프라인으로 본다.
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const navigation = useNavigation();
  const [guide, setGuide] = useState(false);

  // 제목 바로 오른쪽에 (i) 안내, 오른쪽 위에는 안전 사진첩 설정(구독 중일 때)과 알림 버튼을 둔다.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => <TabTitle title={t('secureLibrary')} infoLabel={t('secureLibrary')} onInfo={() => setGuide(true)} />,
      headerRight: () => (
        <View style={styles.headerButtons}>
          {canView && (
            <HeaderButton
              icon="settings-outline"
              label="안전 사진첩 설정"
              size={22}
              onPress={() => router.navigate({ pathname: '/settings', params: { section: 'cloud' } })}
            />
          )}
          <NotificationBell />
        </View>
      ),
    });
  }, [navigation, theme.text, canView, t]);

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={[styles.content, offline && styles.offlineContent]}>
        {offline ? (
          <OfflineNotice />
        ) : canView ? (
          <CloudAlbums />
        ) : (
          <>
            <SecureStorageIntro signedIn={Boolean(session)} />
            {/* 초대받은 공유 앨범은 구독하지 않아도 본다. */}
            {session && <SharedAlbumSection canCreate={false} />}
          </>
        )}
      </ScrollView>

      {/* 광고는 목록 밖 탭 바 위에 고정한다 (고르기 탭과 같다). 공유 앨범이 많아져도 아래로 밀리지 않는다.
          오프라인이면 광고를 받을 수 없으니 두지 않는다. */}
      {!offline && <AdBanner maxHeight={TAB_AD_MAX_HEIGHT} style={styles.ad} />}
      <CloudAlbumGuide visible={guide} onClose={() => setGuide(false)} />
    </ThemedView>
  );
}

const BENEFITS = [
  { icon: 'shield-checkmark-outline', text: '안전 앨범에 담은 사진을 원본 그대로, 또는 용량을 아껴 보관해요' },
  { icon: 'phone-portrait-outline', text: '기기 사진첩에서 지워도 남아서 휴대폰이 가벼워져요' },
  { icon: 'sync-outline', text: '휴대폰을 잃어버려도, 사진첩 백업이 없어도 사진이 돌아와요' },
] as const;

/**
 * 구독 전(비로그인·무료 회원)에 보이는 안내. 구독 회원 화면과 같은 '나만 보는 안전 앨범' 섹션에,
 * 앨범 카드와 같은 모양의 카드로 지금 무엇이 지켜지는지와 구독하면 달라지는 점을 보여준다.
 */
function SecureStorageIntro({ signedIn }: { signedIn: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.createdAlbums}>
      <AlbumSectionHeader title="나만 보는 안전 앨범" />
      <View style={[styles.intro, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={styles.introRow}>
          <View style={[styles.introTile, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="cloud-outline" size={22} color={theme.textSecondary} />
          </View>
          <View style={styles.introBody}>
            <ThemedText type="smallBold">남긴 사진을 안전하게 보관해요</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {signedIn
                ? '지금은 메모·장소·날짜만 백업하고 있어요. 구독하면 사진 파일까지 지켜 드려요.'
                : '로그인하면 기록을, 구독하면 사진까지 이 계정에 보관해요.'}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.introDivider, { backgroundColor: theme.border }]} />
        <View style={styles.benefits}>
          {BENEFITS.map(({ icon, text }) => (
            <View key={text} style={styles.benefit}>
              <Ionicons name={icon} size={18} color={theme.accent} />
              <ThemedText type="small" style={styles.flex}>
                {text}
              </ThemedText>
            </View>
          ))}
        </View>
        <Button label={signedIn ? '안전 보관 시작하기' : '안전 보관 알아보기'} onPress={() => router.push('/cloud')} />
        <Pressable onPress={() => router.push('/plans')} accessibilityRole="button" hitSlop={8}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={[styles.center, styles.link]}>
            {t('comparePlans')}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * 안전 사진첩은 계정의 안전 보관 공간을 보여주므로 인터넷이 있어야 한다. 사진 고르기·기기 사진첩·설정은 오프라인에서도 쓴다.
 * 연결되면 useNetworkState가 바뀌어 이 화면이 사라지고, CloudSync가 다시 동기화한다.
 */
function OfflineNotice() {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name="cloud-offline-outline" size={44} color={theme.textSecondary} />
      <ThemedText type="smallBold">인터넷에 연결되면 안전 사진첩을 볼 수 있어요</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        안전 사진첩은 계정에 보관한 사진을 불러와서 인터넷이 필요해요.{'\n'}
        사진 고르기와 기기 사진첩은 지금도 그대로 쓸 수 있어요.
      </ThemedText>
      <Button label="기기 사진첩으로 가기" variant="secondary" onPress={() => router.navigate('/album')} />
    </View>
  );
}

function CloudAlbums() {
  const db = useSQLiteContext();
  const { language } = useTranslation();
  const { account, running, problem, pendingUploads } = useCloudState();
  const { data: albums } = useDbQuery(() => listAlbums(db, 'cloud'), [db]);
  const { data: recentMoments } = useDbQuery(() => listRecentCloudMoments(db, 3), [db]);
  const { data: pending } = useDbQuery(() => listCloudAlbumPending(db), [db]);


  if (!albums) return <ActivityIndicator />;

  const canUpload = account?.subscription.can_upload ?? false;
  const allAlbum = albums[0];
  const cloudAlbums = albums.slice(1);
  // 할 일이 있을 때만 알린다. 마지막 동기화 시각은 안전 사진첩 설정(⚙)에서 본다.
  const syncLine = running ? (language === 'en' ? 'Syncing…' : language === 'ja' ? '同期中…' : '동기화하는 중…') : canUpload && pendingUploads > 0 ? (language === 'en' ? `${photoCount(language, pendingUploads)} to upload` : language === 'ja' ? `アップロード待ち ${photoCount(language, pendingUploads)}` : `올릴 사진 ${photoCount(language, pendingUploads)}`) : null;
  const newAlbum = canUpload ? [{ icon: 'add' as const, label: '새 안전 앨범', onPress: () => router.push('/cloud-albums/new') }] : [];

  return (
    <>
      {/* 모든 사진은 한 줄 카드로(사용한 공간은 그 안에), 새 앨범은 목록 제목 오른쪽 버튼으로 두어
          앨범 목록이 위쪽부터 보이게 한다. */}
      <MomentsRowCard album={allAlbum} moments={recentMoments} source="cloud">
        {account?.usage && (
          <StorageMeter
            used={account.usage.bytes_total}
            allocated={account.usage.allocated_bytes}
            max={account.usage.max_bytes}
            note={syncLine}
            problem={problem}
          />
        )}
      </MomentsRowCard>

      <View style={styles.createdAlbums}>
        <AlbumSectionHeader title="나만 보는 안전 앨범" actions={newAlbum} />
        {cloudAlbums.length > 0 ? (
          <View style={styles.albumStack}>
            {cloudAlbums.map((album) => (
              <CreatedAlbumCard key={album.id} album={album} source="cloud">
                <CloudAlbumBadges album={album} pending={pending?.get(album.id) ?? 0} />
              </CreatedAlbumCard>
            ))}
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionHint}>
            아직 안전 앨범이 없어요. 안전 보관할 사진을 앨범으로 묶어 보세요.
          </ThemedText>
        )}
      </View>

      <SharedAlbumSection canCreate={canUpload} />

    </>
  );
}

/**
 * 사용한 공간 (모든 사진 카드 안의 한 줄). 할 일(올릴 사진·동기화 중)이나 문제가 있을 때만 한 줄 더 보여 준다.
 * allocated: 공유 앨범에 나눠 준 용량. 공유 앨범의 사진은 개인 사용량이 아니라 그 안에서 센다 (막대의 회색 부분).
 */
function StorageMeter({
  used,
  allocated,
  max,
  note,
  problem,
}: {
  used: number;
  allocated: number;
  max: number;
  note: string | null;
  problem: string | null;
}) {
  const theme = useTheme();
  const { language } = useTranslation();
  const ratio = max > 0 ? Math.min(used / max, 1) : 0;
  const sharedRatio = max > 0 ? Math.min(allocated / max, 1 - ratio) : 0;
  return (
    <View style={styles.meter}>
      <View style={styles.meterLabels}>
        <View style={[styles.meterTrack, styles.meterRow, styles.flex, { backgroundColor: theme.backgroundSelected }]}>
        <View
          style={[
            styles.meterFill,
            {
              width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%`,
              backgroundColor: ratio + sharedRatio > 0.9 ? theme.danger : theme.accent,
            },
          ]}
        />
        {allocated > 0 && (
          <View style={[styles.meterFill, { width: `${sharedRatio * 100}%`, backgroundColor: theme.textSecondary }]} />
        )}
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.meterText}>
          {formatBytes(used + allocated)} / {formatBytes(max)}
          {allocated > 0 ? (language === 'en' ? ` · ${formatBytes(allocated)} shared` : language === 'ja' ? ` · 共有 ${formatBytes(allocated)}` : ` · 공유 ${formatBytes(allocated)}`) : ''}
        </ThemedText>
      </View>
      {problem ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {problem}
        </ThemedText>
      ) : (
        note && (
          <ThemedText type="small" themeColor="textSecondary">
            {note}
          </ThemedText>
        )
      )}
    </View>
  );
}

/** 안전 앨범의 화질·연결·올릴 사진 표시. 카드는 기기 사진첩의 앨범과 같은 모양이다. */
function CloudAlbumBadges({ album, pending }: { album: AlbumSummary; pending: number }) {
  const theme = useTheme();
  const { language } = useTranslation();
  return (
    <View style={styles.badges}>
      {album.photoQuality && <PhotoQualityBadge quality={album.photoQuality} />}
      {album.sourceAlbumId && (
        <View style={[styles.linkBadge, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="link-outline" size={12} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.badgeText}>
            기기 앨범 연결
          </ThemedText>
        </View>
      )}
      {pending > 0 && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.badgeText}>
          {language === 'en' ? `${photoCount(language, pending)} to upload` : language === 'ja' ? `アップロード待ち ${photoCount(language, pending)}` : `올릴 사진 ${photoCount(language, pending)}`}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingVertical: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.six },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  // 앨범 카드(MomentsRowCard)와 같은 바탕·테두리·모서리
  intro: {
    marginHorizontal: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  introRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  introTile: { width: 48, height: 48, borderRadius: Spacing.one + 2, alignItems: 'center', justifyContent: 'center' },
  introBody: { flex: 1, gap: Spacing.half },
  introDivider: { height: StyleSheet.hairlineWidth },
  benefits: { gap: Spacing.two },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  link: { textDecorationLine: 'underline' },
  offlineContent: { flexGrow: 1, justifyContent: 'center' },
  // 고르기 탭과 같은 자리: 탭 바와 붙어 있으면 탭을 누르려다 광고를 누르기 쉬워 아래를 띄운다.
  ad: { marginHorizontal: Spacing.three, marginBottom: Spacing.five },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five, paddingHorizontal: Spacing.three },
  center: { textAlign: 'center' },
  meter: { gap: Spacing.half, paddingHorizontal: Spacing.half },
  meterLabels: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  meterTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  meterFill: { height: 4, borderRadius: 2 },
  meterRow: { flexDirection: 'row' },
  meterText: { fontSize: 12, lineHeight: 16 },
  createdAlbums: { gap: Spacing.two },
  sectionHint: { paddingHorizontal: Spacing.three },
  albumStack: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.one },
  linkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 10,
  },
  badgeText: { fontSize: 12, lineHeight: 16 },
});
