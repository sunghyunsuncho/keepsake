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
import { getSettings, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { todayKey } from '@/lib/dates';

const COLUMNS = 2;

// 사진첩 탭: 앨범을 고른다. '모든 순간'은 항상 맨 앞에 있고, 필요하면 앨범을 더 만든다.
export default function AlbumsScreen() {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const [naming, setNaming] = useState(false);
  const today = todayKey();
  const { data: albums } = useDbQuery(() => listAlbums(db), [db]);
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
  const showOnThisDay = !!onThisDay?.length && settings?.on_this_day_hidden !== today;

  const create = async (title: string) => {
    setNaming(false);
    const id = await createAlbum(db, title);
    // 새 앨범을 열고 바로 사진을 넣는 화면을 띄운다.
    router.push({ pathname: '/albums/[id]', params: { id } });
    router.push({ pathname: '/albums/[id]/add', params: { id } });
  };

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        {showOnThisDay && (
          <OnThisDayCards
            groups={onThisDay}
            onHide={() => setSetting(db, 'on_this_day_hidden', today)}
          />
        )}

        {albums[0].count === 0 && (
          <ThemedText themeColor="textSecondary" style={styles.hint}>
            아직 남긴 사진이 없어요.{'\n'}고르기 탭에서 십 년 뒤에도 다시 보고 싶은 몇 장을 골라 보세요.
          </ThemedText>
        )}

        <View style={styles.grid}>
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} width={cardWidth} />
          ))}
          <NewAlbumCard width={cardWidth} onPress={() => setNaming(true)} />
        </View>
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

function AlbumCard({ album, width }: { album: AlbumSummary; width: number }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/albums/[id]', params: { id: album.id } })}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.8 : 1 }]}>
      {album.cover ? (
        <MomentPhoto moment={album.cover} style={[styles.cover, { width, height: width }]} transition={150} />
      ) : (
        <View style={[styles.cover, styles.emptyCover, { width, height: width, backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="images-outline" size={32} color={theme.textSecondary} />
        </View>
      )}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.albumTitle}>
        {album.title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {album.count}장
      </ThemedText>
    </Pressable>
  );
}

function NewAlbumCard({ width, onPress }: { width: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}>
      <View style={[styles.cover, styles.emptyCover, styles.newCover, { width, height: width, borderColor: theme.border }]}>
        <Ionicons name="add" size={36} color={theme.accent} />
      </View>
      <ThemedText type="smallBold" style={[styles.albumTitle, { color: theme.accent }]}>
        새 앨범
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        이름을 지어 직접 묶어요
      </ThemedText>
    </Pressable>
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingVertical: Spacing.three, gap: Spacing.four },
  hint: { textAlign: 'center', paddingHorizontal: Spacing.four },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  cover: { borderRadius: Spacing.three, overflow: 'hidden' },
  emptyCover: { alignItems: 'center', justifyContent: 'center' },
  newCover: { borderWidth: 1.5, borderStyle: 'dashed' },
  albumTitle: { marginTop: Spacing.two },
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
