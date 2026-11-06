import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { MomentPhoto } from '@/components/moment-photo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { AlbumSummary } from '@/db/albums';
import type { Moment } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';

// 기기 사진첩과 안전 사진첩 맨 위에 나란히 놓는 두 카드: 기본 보기와 새 앨범.

/** 앨범 목록 맨 위의 기본 보기 카드. 최근 사진 세 장을 겹쳐 보여준다. */
export function MomentsAlbumCard({
  album,
  moments,
  width,
  height,
  source,
}: {
  album: AlbumSummary;
  moments: Moment[] | undefined;
  width: number;
  height: number;
  /** 'cloud'면 앨범 화면에서 안전 사진첩으로 돌아간다. */
  source?: 'cloud';
}) {
  const theme = useTheme();
  const previews = moments?.length ? moments : album.cover ? [album.cover] : [];
  const innerHeight = height - Spacing.two - Spacing.one;
  const mainWidth = Math.round((width - Spacing.two * 2 - Spacing.one) * 0.62);
  const sideWidth = width - Spacing.two * 2 - Spacing.one - mainWidth;
  const sideCount = Math.min(Math.max(previews.length - 1, 0), 2);
  const sideHeight = sideCount === 1 ? innerHeight : (innerHeight - Spacing.one) / 2;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/albums/[id]', params: source ? { id: album.id, source } : { id: album.id } })}
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
            <Ionicons name={source === 'cloud' ? 'cloud-outline' : 'images-outline'} size={28} color={theme.textSecondary} />
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

/** 새 앨범을 만드는 책 모양 카드 */
export function NewAlbumCard({
  width,
  height,
  label = '새 앨범',
  caption,
  onPress,
}: {
  width: number;
  height: number;
  label?: string;
  caption: string;
  onPress: () => void;
}) {
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
        {label}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {caption}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  momentsBox: { flexDirection: 'row', padding: Spacing.one, gap: Spacing.one, borderRadius: Spacing.three, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  mainMomentPhoto: { borderRadius: Spacing.two, overflow: 'hidden' },
  sideMomentPhotos: { gap: Spacing.one },
  sideMomentPhoto: { borderRadius: Spacing.one, overflow: 'hidden' },
  emptyMomentsBox: { flex: 1, borderRadius: Spacing.two },
  emptyCover: { alignItems: 'center', justifyContent: 'center' },
  newBookShelf: { alignItems: 'center', justifyContent: 'center', borderRadius: Spacing.three, position: 'relative', overflow: 'hidden' },
  newBook: { width: 70, borderWidth: StyleSheet.hairlineWidth, borderRadius: Spacing.one, overflow: 'hidden', justifyContent: 'center', paddingLeft: Spacing.three, gap: Spacing.one },
  bookSpine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6 },
  newBookSpring: { position: 'absolute', zIndex: 2, left: 0, top: 6, bottom: 6, justifyContent: 'space-between' },
  newBookRing: { width: 12, height: 5, marginLeft: -2, borderWidth: 1.25, borderRadius: 3 },
  bookPage: { height: 3, marginRight: Spacing.two, borderRadius: Spacing.half },
  bookPageLower: { width: 28 },
  albumTitle: { marginTop: Spacing.one },
});
