import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MomentPhoto } from '@/components/moment-photo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { AlbumSummary } from '@/db/albums';
import { useTheme } from '@/hooks/use-theme';
import { photoCount, useTranslation } from '@/lib/i18n';

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
  const { language } = useTranslation();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/albums/[id]', params: source ? { id: album.id, source } : { id: album.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.createdAlbumCard,
        { backgroundColor: theme.background, borderColor: theme.border, opacity: pressed ? 0.8 : 1 },
      ]}>
      <SpringCover spine={theme.accent}>
        {album.coverMode === 'design' ? (
          <EmojiCover emoji={album.coverEmoji} />
        ) : album.cover ? (
          <MomentPhoto moment={album.cover} variant="thumb" style={SPRING_COVER_PHOTO} transition={150} />
        ) : (
          <EmptyCover icon="images-outline" />
        )}
      </SpringCover>
      <View style={styles.createdAlbumBody}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.createdAlbumTitle} localize={false}>
          {album.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {photoCount(language, album.count)}
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

/** 책등(spine 색)과 스프링 고리가 있는 표지. children은 SPRING_COVER_PHOTO 자리에 그린다. */
export function SpringCover({ spine, children }: { spine: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.coverStack, { backgroundColor: theme.backgroundSelected, borderColor: theme.border }]}>
      <View style={[styles.coverLayer, { backgroundColor: spine }]} />
      <View style={styles.springBinding}>
        {Array.from({ length: 6 }, (_, index) => (
          <View key={index} style={[styles.springRing, { borderColor: theme.background }]} />
        ))}
      </View>
      {children}
    </View>
  );
}

export function EmojiCover({ emoji }: { emoji: string | null }) {
  const theme = useTheme();
  return (
    <View style={[styles.createdCover, styles.emojiCover, { backgroundColor: theme.background }]}>
      <ThemedText style={styles.coverEmoji}>{emoji ?? '✨'}</ThemedText>
    </View>
  );
}

export function EmptyCover({ icon, color }: { icon: keyof typeof Ionicons.glyphMap; color?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.createdCover, styles.emptyCover, { backgroundColor: theme.backgroundSelected }]}>
      <Ionicons name={icon} size={28} color={color ?? theme.textSecondary} />
    </View>
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

/** 표지 사진 자리 (책등 오른쪽) */
export const SPRING_COVER_PHOTO = {
  position: 'absolute',
  left: 12,
  top: 7,
  width: 70,
  height: 78,
  borderRadius: Spacing.one,
  overflow: 'hidden',
} as const;

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
  createdCover: SPRING_COVER_PHOTO,
  emojiCover: { alignItems: 'center', justifyContent: 'center', paddingTop: 3 },
  coverEmoji: { fontSize: 30, lineHeight: 42, includeFontPadding: false },
  createdAlbumBody: { flex: 1, gap: Spacing.one },
  createdAlbumTitle: { fontSize: 17, lineHeight: 24 },
  albumKind: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.one },
});
