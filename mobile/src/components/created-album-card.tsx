import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MomentPhoto } from '@/components/moment-photo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { AlbumSummary } from '@/db/albums';
import { useTheme } from '@/hooks/use-theme';

/** 만든 앨범은 표지와 책등이 느껴지는 세로 목록으로 쌓는다. */
export function CreatedAlbumCard({
  album,
  source,
  children,
}: {
  album: AlbumSummary;
  /** 'cloud'면 앨범 화면에서 안전 사진첩으로 돌아간다. */
  source?: 'cloud';
  /** 사진 수·기간 아래에 붙일 표시 (안전 앨범의 화질 등) */
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/albums/[id]', params: source ? { id: album.id, source } : { id: album.id } })}
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
        {children}
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

const styles = StyleSheet.create({
  emptyCover: { alignItems: 'center', justifyContent: 'center' },
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
});
