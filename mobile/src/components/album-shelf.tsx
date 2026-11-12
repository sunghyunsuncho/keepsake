import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MomentPhoto } from '@/components/moment-photo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { isBuiltInAlbum, type AlbumSummary } from '@/db/albums';
import type { Moment } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { localizeText, photoCount, useTranslation } from '@/lib/i18n';

// 기기 사진첩과 안전 사진첩 맨 위: 기본 보기(모든 사진)를 가로 한 줄 카드로 두고,
// 새 앨범은 앨범 목록 제목 오른쪽 버튼으로 둔다. 앨범 목록이 화면 위쪽부터 보이게 하려는 것이다.

const PREVIEW = 48;

/** 기본 보기 카드. 최근 사진 세 장과 사진 수. children은 카드 아래쪽에 붙인다 (안전 사진첩의 사용한 공간). */
export function MomentsRowCard({
  album,
  moments,
  source,
  children,
}: {
  album: AlbumSummary;
  moments: Moment[] | undefined;
  /** 'cloud'면 앨범 화면에서 안전 사진첩으로 돌아간다. */
  source?: 'cloud';
  children?: ReactNode;
}) {
  const theme = useTheme();
  const { language } = useTranslation();
  // 기본 보관함만 앱의 시스템 명칭이다. 사용자가 만든 앨범 제목은 원문을 보존한다.
  const title = isBuiltInAlbum(album.id) ? localizeText(language, album.title) : album.title;
  const previews = moments?.length ? moments.slice(0, 3) : album.cover ? [album.cover] : [];
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/albums/[id]', params: source ? { id: album.id, source } : { id: album.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${photoCount(language, album.count)}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.8 : 1 },
      ]}>
      <View style={styles.row}>
        <View style={styles.previews}>
          {previews.length > 0 ? (
            previews.map((moment) => (
              <MomentPhoto key={moment.id} moment={moment} variant="thumb" style={styles.preview} transition={150} />
            ))
          ) : (
            <View style={[styles.preview, styles.empty, { backgroundColor: theme.backgroundSelected }]}>
              <Ionicons name={source === 'cloud' ? 'cloud-outline' : 'images-outline'} size={22} color={theme.textSecondary} />
            </View>
          )}
        </View>
        <View style={styles.body}>
          <ThemedText type="smallBold" numberOfLines={1} localize={false}>
            {title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {photoCount(language, album.count)}
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
      </View>
      {children}
    </Pressable>
  );
}

export type SectionAction = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** 버튼 색. 공유 앨범은 책등과 같은 네이비로 나만 보는 앨범(accent)과 구분한다. */
  color?: string;
};

/**
 * 앨범 목록 제목. 오른쪽에 새 앨범·참여 같은 버튼을 둔다 (할 수 없는 버튼은 넘기지 않는다).
 * 만들기(icon 'add')는 + 와 이름을 함께 감싼 색 채운 알약 버튼으로, 그 밖의 버튼은 글자 버튼으로 그린다.
 */
export function AlbumSectionHeader({ title, actions = [] }: { title: string; actions?: SectionAction[] }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1} style={styles.headerTitle}>
        {title}
      </ThemedText>
      <View style={styles.actions}>
        {actions.map((action) => {
          const color = action.color ?? theme.accent;
          const create = action.icon === 'add';
          return (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={({ pressed }) => [
                styles.action,
                create && [styles.pill, { backgroundColor: color, shadowColor: color }],
                { opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] },
              ]}>
              <Ionicons name={action.icon} size={15} color={create ? '#fff' : color} />
              <ThemedText type="smallBold" style={[create && styles.pillText, { color: create ? '#fff' : color }]}>
                {action.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.three,
    padding: Spacing.two,
    gap: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  previews: { flexDirection: 'row', gap: Spacing.half },
  preview: { width: PREVIEW, height: PREVIEW, borderRadius: Spacing.one + 2, overflow: 'hidden' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: Spacing.half },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three },
  headerTitle: { flexShrink: 1, marginRight: 'auto' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  action: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 26 },
  // 만들기 버튼: + 와 이름을 감싼 알약. 같은 색의 옅은 그림자로 살짝 떠 보이게 한다.
  pill: {
    height: 26,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.two + 4,
    borderRadius: 13,
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pillText: { fontSize: 13, lineHeight: 18 },
});
