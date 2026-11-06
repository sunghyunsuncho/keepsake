import Ionicons from '@expo/vector-icons/Ionicons';
import { useNetworkState } from 'expo-network';
import { router, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useLayoutEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { MomentsAlbumCard, NewAlbumCard } from '@/components/album-shelf';
import { Button } from '@/components/button';
import { CreatedAlbumCard } from '@/components/created-album-card';
import { CloudAlbumGuide } from '@/components/library-guide';
import { LibraryIntro } from '@/components/library-intro';
import { NotificationBell } from '@/components/notification-bell';
import { PhotoQualityBadge } from '@/components/photo-quality';
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
import { formatFullDate, formatTime } from '@/lib/dates';
import { formatBytes } from '@/lib/storage';

/** 계정의 안전 보관 공간: 안전 앨범 목록. 구독 중이거나 유예 기간에만 연다. */
export default function CloudLibraryScreen() {
  const session = useCloudSession();
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
      headerTitle: () => <TabTitle title="안전 사진첩" infoLabel="안전 사진첩 안내" onInfo={() => setGuide(true)} />,
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
  }, [navigation, theme.text, canView]);

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={[styles.content, offline && styles.offlineContent]}>
        {offline ? (
          <OfflineNotice />
        ) : canView ? (
          <CloudAlbums />
        ) : (
          <>
            <View style={styles.lockedIntro}>
              <ThemedText type="subtitle">안전 보관 사진첩</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                이 계정의 안전 보관 공간에 저장된 사진과 앨범이에요. 기기를 바꿔도 로그인하면 다시 볼 수 있어요.
              </ThemedText>
            </View>
            <View style={styles.empty}>
              <Ionicons name="cloud-outline" size={40} color={theme.textSecondary} />
              <ThemedText type="smallBold">아직 안전 보관 사진첩이 없어요</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                구독하면 안전 앨범에 담은 사진을 이 계정에 보관하고, 다른 기기에서도 볼 수 있어요.
              </ThemedText>
              <Button label={session ? '구독하기' : '안전 보관 알아보기'} onPress={() => router.push('/cloud')} />
            </View>
          </>
        )}

      </ScrollView>
      <CloudAlbumGuide visible={guide} onClose={() => setGuide(false)} />
    </ThemedView>
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
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { account, running, problem, pendingUploads, lastSyncedAt } = useCloudState();
  const { data: albums } = useDbQuery(() => listAlbums(db, 'cloud'), [db]);
  const { data: recentMoments } = useDbQuery(() => listRecentCloudMoments(db, 3), [db]);
  const { data: pending } = useDbQuery(() => listCloudAlbumPending(db), [db]);


  if (!albums) return <ActivityIndicator />;

  const canUpload = account?.subscription.can_upload ?? false;
  const cardWidth = (width - Spacing.three * 2 - Spacing.three) / 2;
  const topCardHeight = Math.min(Math.round(cardWidth * 0.56), 100);
  const allAlbum = albums[0];
  const cloudAlbums = albums.slice(1);
  const syncLine = running
    ? '동기화하는 중…'
    : canUpload && pendingUploads > 0
      ? `올릴 사진 ${pendingUploads}장`
      : lastSyncedAt
        ? `${formatFullDate(lastSyncedAt)} ${formatTime(lastSyncedAt)}에 동기화했어요`
        : null;

  return (
    <>
      {/* 기기 사진첩과 같은 높이의 소개 문구 → 같은 위치의 카드 두 장. 사용한 공간은 그 아래에 둔다. */}
      <LibraryIntro
        title="안전 보관한 사진으로 사진첩을 만들어요"
        description="기기를 바꾸거나 사진을 지워도 계정에 남아요."
      />

      <View style={[styles.topRow, { backgroundColor: theme.backgroundElement }]}>
        <MomentsAlbumCard album={allAlbum} moments={recentMoments} width={cardWidth} height={topCardHeight} source="cloud" />
        {canUpload && (
          <NewAlbumCard
            width={cardWidth}
            height={topCardHeight}
            label="새 안전 앨범"
            caption="새로 만들거나 연결해요"
            onPress={() => router.push('/cloud-albums/new')}
          />
        )}
      </View>

      {account?.usage && (
        <StorageMeter used={account.usage.bytes_total} max={account.usage.max_bytes} note={syncLine} problem={problem} />
      )}

      {cloudAlbums.length > 0 ? (
        <View style={styles.createdAlbums}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
            안전 앨범
          </ThemedText>
          <View style={styles.albumStack}>
            {cloudAlbums.map((album) => (
              <CreatedAlbumCard key={album.id} album={album} source="cloud">
                <CloudAlbumBadges album={album} pending={pending?.get(album.id) ?? 0} />
              </CreatedAlbumCard>
            ))}
          </View>
        </View>
      ) : (
        <ThemedText themeColor="textSecondary" style={styles.hint}>
          아직 안전 앨범이 없어요.{'\n'}안전 보관할 사진을 앨범으로 묶어 보세요.
        </ThemedText>
      )}

    </>
  );
}

/** 사용한 공간과 동기화 상태. 앨범의 보관 화질을 고를 때 참고하도록 목록 위에 둔다. */
function StorageMeter({ used, max, note, problem }: { used: number; max: number; note: string | null; problem: string | null }) {
  const theme = useTheme();
  const ratio = max > 0 ? Math.min(used / max, 1) : 0;
  return (
    <View style={styles.meter}>
      <View style={styles.meterLabels}>
        <ThemedText type="small" themeColor="textSecondary">
          사용한 공간
        </ThemedText>
        <ThemedText type="small">
          {formatBytes(used)} / {formatBytes(max)}
        </ThemedText>
      </View>
      <View style={[styles.meterTrack, { backgroundColor: theme.backgroundElement }]}>
        <View
          style={[
            styles.meterFill,
            { width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%`, backgroundColor: ratio > 0.9 ? theme.danger : theme.accent },
          ]}
        />
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
          올릴 사진 {pending}장
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingVertical: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.six },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  lockedIntro: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  offlineContent: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five, paddingHorizontal: Spacing.three },
  center: { textAlign: 'center' },
  hint: { textAlign: 'center', paddingHorizontal: Spacing.four },
  meter: { gap: Spacing.one, marginHorizontal: Spacing.three, paddingHorizontal: Spacing.one },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  meterTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },
  topRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
  },
  createdAlbums: { gap: Spacing.two },
  sectionTitle: { paddingHorizontal: Spacing.three },
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
