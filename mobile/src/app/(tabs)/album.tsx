import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AlbumNameSheet } from '@/components/album-name-sheet';
import { MomentPhoto } from '@/components/moment-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { createAlbum, listAlbums, listOnThisDay, type OnThisDay } from '@/db/albums';
import { MomentsAlbumCard, NewAlbumCard } from '@/components/album-shelf';
import { CreatedAlbumCard } from '@/components/created-album-card';
import { DeviceAlbumGuide } from '@/components/library-guide';
import { LibraryIntro } from '@/components/library-intro';
import { NotificationBell } from '@/components/notification-bell';
import { HeaderButton } from '@/components/stack-header';
import { TabTitle } from '@/components/tab-title';
import { useDbQuery } from '@/db/changes';
import { listRecentlySavedMoments } from '@/db/moments';
import { getSettings, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { todayKey } from '@/lib/dates';

const COLUMNS = 2;

// 기기 사진첩 탭: 이 기기에 보관한 '나의 순간들'과 사용자가 만든 앨범을 고른다.
export default function AlbumsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [naming, setNaming] = useState(false);
  const [guide, setGuide] = useState(false);
  const navigation = useNavigation();
  // 제목 바로 오른쪽에 (i) 안내, 오른쪽 위에는 기기 사진첩 설정과 알림 버튼을 둔다.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => <TabTitle title="기기 사진첩" infoLabel="기기 사진첩 안내" onInfo={() => setGuide(true)} />,
      headerRight: () => (
        <View style={styles.headerButtons}>
          <HeaderButton
            icon="settings-outline"
            label="기기 사진첩 설정"
            size={22}
            onPress={() => router.navigate({ pathname: '/settings', params: { section: 'device' } })}
          />
          <NotificationBell />
        </View>
      ),
    });
  }, [navigation]);
  const today = todayKey();
  const { data: albums } = useDbQuery(() => listAlbums(db), [db]);
  const { data: recentMoments } = useDbQuery(() => listRecentlySavedMoments(db, 3), [db]);
  const { data: onThisDay } = useDbQuery(() => listOnThisDay(db, today), [db, today]);
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);

  if (!albums) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const cardWidth = (width - Spacing.three * 2 - Spacing.three * (COLUMNS - 1)) / COLUMNS;
  const topCardHeight = Math.min(Math.round(cardWidth * 0.56), 100);
  const showOnThisDay = !!onThisDay?.length && settings?.on_this_day_hidden !== today;
  const momentsAlbum = albums[0];
  const customAlbums = albums.slice(1);

  const create = async (title: string) => {
    setNaming(false);
    const id = await createAlbum(db, title);
    // 앨범은 이미 남긴 사진에서 골라 채우는 흐름으로 시작한다.
    router.push({ pathname: '/albums/[id]/add', params: { id } });
  };

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <LibraryIntro
          title="이 기기에 보관한 사진으로 사진첩을 만들어요"
          description="남긴 사진을 이야기별 앨범으로 묶어 보세요."
        />

        <View style={[styles.topRow, { backgroundColor: theme.backgroundElement }]}>
          <MomentsAlbumCard album={momentsAlbum} moments={recentMoments} width={cardWidth} height={topCardHeight} />
          <NewAlbumCard width={cardWidth} height={topCardHeight} caption="나의 순간들에서 골라 담아요" onPress={() => setNaming(true)} />
        </View>

        {momentsAlbum.count === 0 && (
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            아직 남긴 사진이 없어요.{'\n'}고르기에서 남긴 사진은 나의 순간들에 차곡차곡 쌓여요.
          </ThemedText>
        )}

        {customAlbums.length > 0 && (
          <View style={styles.createdAlbums}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
              만든 앨범
            </ThemedText>
            <View style={styles.albumStack}>
              {customAlbums.map((album) => (
                <CreatedAlbumCard key={album.id} album={album} />
              ))}
            </View>
          </View>
        )}

        {showOnThisDay && <OnThisDayCards groups={onThisDay} onHide={() => setSetting(db, 'on_this_day_hidden', today)} />}
      </ScrollView>

      <AlbumNameSheet
        visible={naming}
        heading="새 앨범"
        confirmLabel="만들기"
        onSubmit={create}
        onCancel={() => setNaming(false)}
      />
      <DeviceAlbumGuide visible={guide} onClose={() => setGuide(false)} />
    </ThemedView>
  );
}

/** 몇 년 전 오늘 남긴 기록. 있는 날에만 조용히 보여주고, 닫으면 그날은 다시 보여주지 않는다. */
function OnThisDayCards({ groups, onHide }: { groups: OnThisDay[]; onHide: () => void }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const single = groups.length === 1;
  const cardWidth = single ? width - Spacing.three * 2 : width * 0.78;
  const today = todayKey();

  return (
    <View style={styles.onThisDay}>
      <View style={styles.onThisDayHeader}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          그날의 기억
        </ThemedText>
        <Pressable onPress={onHide} hitSlop={12} accessibilityLabel="오늘은 그만 보기">
          <Ionicons name="close" size={20} color={theme.textSecondary} />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        scrollEnabled={!single}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.onThisDayRow}
        snapToInterval={cardWidth + Spacing.two}
        decelerationRate="fast">
        {groups.map(({ yearsAgo, moments }) => {
          const first = moments[0];
          const memo = moments.find((m) => m.memo.trim() !== '')?.memo;
          return (
            <Pressable
              key={yearsAgo}
              onPress={() =>
                router.push({ pathname: '/viewer', params: { onThisDay: today, moment: first.id } })
              }
              style={({ pressed }) => [
                styles.memoryCard,
                { width: cardWidth, backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 },
              ]}>
              <MomentPhoto moment={first} style={{ width: cardWidth, height: cardWidth * 0.62 }} transition={150} />
              <View style={styles.memoryBody}>
                <ThemedText style={styles.memoryTitle}>
                  {yearsAgo}년 전 오늘
                  <ThemedText type="small" themeColor="textSecondary">
                    {moments.length > 1 ? `  ${moments.length}장` : ''}
                  </ThemedText>
                </ThemedText>
                {memo && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                    {memo}
                  </ThemedText>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingVertical: Spacing.three, gap: Spacing.four },
  hint: { textAlign: 'center', paddingHorizontal: Spacing.four },
  topRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
  },
  cover: { borderRadius: Spacing.three, overflow: 'hidden' },
  createdAlbums: { gap: Spacing.two },
  sectionTitle: { paddingHorizontal: Spacing.three },
  albumStack: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  onThisDay: { gap: Spacing.two },
  onThisDayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  onThisDayRow: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  memoryCard: { borderRadius: Spacing.three, overflow: 'hidden' },
  memoryBody: { padding: Spacing.three, gap: Spacing.one },
  memoryTitle: { fontSize: 18, lineHeight: 26, fontWeight: 700 },
});
