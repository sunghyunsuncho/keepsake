import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AlbumNameSheet } from '@/components/album-name-sheet';
import { MomentPhoto } from '@/components/moment-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { createAlbum, listAlbums, listOnThisDay, type AlbumSummary, type OnThisDay } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { listRecentlySavedMoments, type Moment } from '@/db/moments';
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
        <View style={styles.intro}>
          <ThemedText type="smallBold">이 기기에 보관한 사진으로 사진첩을 만들어요</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            나의 순간들에 남긴 사진을 여행, 가족, 계절처럼 마음에 드는 이야기로 묶어 보세요.
          </ThemedText>
        </View>

        <View style={[styles.topRow, { backgroundColor: theme.backgroundElement }]}>
          <AlbumCard album={momentsAlbum} moments={recentMoments} width={cardWidth} height={topCardHeight} />
          <NewAlbumCard width={cardWidth} height={topCardHeight} onPress={() => setNaming(true)} />
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
    </ThemedView>
  );
}

function AlbumCard({ album, moments, width, height }: { album: AlbumSummary; moments: Moment[] | undefined; width: number; height: number }) {
  const theme = useTheme();
  const previews = moments?.length ? moments : album.cover ? [album.cover] : [];
  const innerHeight = height - Spacing.two - Spacing.one;
  const mainWidth = Math.round((width - Spacing.two * 2 - Spacing.one) * 0.62);
  const sideWidth = width - Spacing.two * 2 - Spacing.one - mainWidth;
  const sideCount = Math.min(Math.max(previews.length - 1, 0), 2);
  const sideHeight = sideCount === 1 ? innerHeight : (innerHeight - Spacing.one) / 2;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/albums/[id]', params: { id: album.id } })}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.8 : 1 }]}>
      <View style={[styles.momentsBox, { width, height, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        {previews.length > 0 ? (
          <>
            <MomentPhoto moment={previews[0]} style={[styles.mainMomentPhoto, { width: mainWidth, height: innerHeight }]} transition={150} />
            {previews.length > 1 && (
              <View style={styles.sideMomentPhotos}>
                {previews.slice(1, 3).map((moment) => (
                  <MomentPhoto key={moment.id} moment={moment} style={[styles.sideMomentPhoto, { width: sideWidth, height: sideHeight }]} transition={150} />
                ))}
              </View>
            )}
          </>
        ) : (
          <View style={[styles.emptyMomentsBox, styles.emptyCover, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="images-outline" size={28} color={theme.textSecondary} />
          </View>
        )}
      </View>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.albumTitle}>
        {album.title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {album.count}장
      </ThemedText>
    </Pressable>
  );
}

function NewAlbumCard({ width, height, onPress }: { width: number; height: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}>
      <View style={[styles.newBookShelf, { width, height, backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.newBook, { height: height - 24, backgroundColor: theme.backgroundSelected, borderColor: theme.border }]}>
          <View style={[styles.bookSpine, { backgroundColor: theme.accent }]} />
          <View style={styles.newBookSpring}>
            {Array.from({ length: 4 }, (_, index) => (
              <View key={index} style={[styles.newBookRing, { borderColor: theme.background }]} />
            ))}
          </View>
          <Ionicons name="add" size={18} color={theme.accent} />
          <View style={[styles.bookPage, { backgroundColor: theme.background }]} />
          <View style={[styles.bookPage, styles.bookPageLower, { backgroundColor: theme.background }]} />
        </View>
      </View>
      <ThemedText type="smallBold" style={[styles.albumTitle, { color: theme.accent }]}>
        새 앨범
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        나의 순간들에서 골라 담아요
      </ThemedText>
    </Pressable>
  );
}

/** 만든 앨범은 표지와 책등이 느껴지는 세로 목록으로 쌓는다. */
function CreatedAlbumCard({ album }: { album: AlbumSummary }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/albums/[id]', params: { id: album.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.createdAlbumCard,
        { backgroundColor: theme.background, borderColor: theme.border, opacity: pressed ? 0.8 : 1 },
      ]}>
      <View style={[styles.coverStack, { backgroundColor: theme.backgroundSelected, borderColor: theme.border }]}>
        <View style={[styles.coverLayer, { backgroundColor: theme.accent }]} />
        <View style={styles.springBinding}>
          {Array.from({ length: 6 }, (_, index) => (
            <View key={index} style={[styles.springRing, { borderColor: theme.background }]} />
          ))}
        </View>
        {album.coverMode === 'design' ? (
          <View style={[styles.createdCover, styles.emojiCover, { backgroundColor: theme.background }]}>
            <ThemedText style={styles.coverEmoji}>{album.coverEmoji ?? '✨'}</ThemedText>
          </View>
        ) : album.cover ? (
          <MomentPhoto moment={album.cover} style={styles.createdCover} transition={150} />
        ) : (
          <View style={[styles.createdCover, styles.emptyCover, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="images-outline" size={28} color={theme.textSecondary} />
          </View>
        )}
      </View>
      <View style={styles.createdAlbumBody}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.createdAlbumTitle}>
          {album.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          사진 {album.count}장
        </ThemedText>
        {album.startAt && album.endAt && (
          <View style={styles.albumKind}>
            <Ionicons name="calendar-outline" size={14} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {formatAlbumPeriod(album.startAt, album.endAt)}
            </ThemedText>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

function formatAlbumPeriod(startAt: string, endAt: string) {
  const format = (value: string) => {
    const date = new Date(value);
    return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
  };
  const start = format(startAt);
  const end = format(endAt);
  return start === end ? start : `${start} – ${end}`;
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingVertical: Spacing.three, gap: Spacing.four },
  intro: { marginHorizontal: Spacing.three, paddingHorizontal: Spacing.one, gap: Spacing.one },
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
  emptyCover: { alignItems: 'center', justifyContent: 'center' },
  momentsBox: { flexDirection: 'row', padding: Spacing.one, gap: Spacing.one, borderRadius: Spacing.three, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  mainMomentPhoto: { borderRadius: Spacing.two, overflow: 'hidden' },
  sideMomentPhotos: { gap: Spacing.one },
  sideMomentPhoto: { borderRadius: Spacing.one, overflow: 'hidden' },
  emptyMomentsBox: { flex: 1, borderRadius: Spacing.two },
  newBookShelf: { alignItems: 'center', justifyContent: 'center', borderRadius: Spacing.three, position: 'relative', overflow: 'hidden' },
  newBook: { width: 70, borderWidth: StyleSheet.hairlineWidth, borderRadius: Spacing.one, overflow: 'hidden', justifyContent: 'center', paddingLeft: Spacing.three, gap: Spacing.one },
  bookSpine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6 },
  newBookSpring: { position: 'absolute', zIndex: 2, left: 0, top: 6, bottom: 6, justifyContent: 'space-between' },
  newBookRing: { width: 12, height: 5, marginLeft: -2, borderWidth: 1.25, borderRadius: 3 },
  bookPage: { height: 3, marginRight: Spacing.two, borderRadius: Spacing.half },
  bookPageLower: { width: 28 },
  albumTitle: { marginTop: Spacing.one },
  createdAlbums: { gap: Spacing.two },
  sectionTitle: { paddingHorizontal: Spacing.three },
  albumStack: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  createdAlbumCard: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.three,
    padding: Spacing.two,
  },
  coverStack: { width: 88, height: 92, position: 'relative', borderRadius: Spacing.two, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  coverLayer: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 10 },
  springBinding: { position: 'absolute', zIndex: 2, left: 0, top: 8, bottom: 8, justifyContent: 'space-between' },
  springRing: { width: 15, height: 6, marginLeft: -2, borderWidth: 1.5, borderRadius: 3 },
  createdCover: { position: 'absolute', left: 12, top: 7, width: 70, height: 78, borderRadius: Spacing.one, overflow: 'hidden' },
  emojiCover: { alignItems: 'center', justifyContent: 'center', paddingTop: 3 },
  coverEmoji: { fontSize: 30, lineHeight: 42, includeFontPadding: false },
  createdAlbumBody: { flex: 1, gap: Spacing.one },
  createdAlbumTitle: { fontSize: 17, lineHeight: 24 },
  albumKind: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.one },
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
