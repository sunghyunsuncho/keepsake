import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { PhotoQuality } from '@/db/albums';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';

// 안전 앨범의 보관 화질. 숫자는 docs/PLAN.md §2.2의 추정치다 (사진 기준. 동영상은 길이에 따라 크게 다르다).
export const PHOTO_QUALITY: Record<
  PhotoQuality,
  { label: string; badge: string; icon: keyof typeof Ionicons.glyphMap; description: string; size: string }
> = {
  original: {
    label: '원본 그대로',
    badge: '원본 보관',
    icon: 'diamond-outline',
    description: '찍은 그대로의 원본과 보기용 사진을 함께 보관해요. 동영상도 원본 그대로예요. 인화하거나 원본을 다시 내려받을 때 좋아요.',
    size: '1장에 약 3~5MB',
  },
  display: {
    label: '효율 보관',
    badge: '효율 보관',
    icon: 'leaf-outline',
    description: '휴대폰에서 볼 때 뭉개지지 않는 크기(사진은 긴 변 2048px, 동영상은 720p)로만 보관해요. 같은 용량에 훨씬 많이 담을 수 있어요.',
    size: '1장에 약 0.8MB',
  },
};

export const PHOTO_QUALITIES: readonly PhotoQuality[] = ['original', 'display'];

/** 보관 화질 두 가지 중 하나를 고르는 카드 */
export function PhotoQualityPicker({ value, onChange }: { value: PhotoQuality; onChange: (value: PhotoQuality) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.options}>
      {PHOTO_QUALITIES.map((quality) => {
        const info = PHOTO_QUALITY[quality];
        const selected = quality === value;
        return (
          <Pressable
            key={quality}
            onPress={() => onChange(quality)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.option,
              {
                borderColor: selected ? theme.accent : theme.border,
                backgroundColor: selected ? theme.backgroundElement : theme.background,
                opacity: pressed ? 0.8 : 1,
              },
            ]}>
            <Ionicons name={info.icon} size={22} color={selected ? theme.accent : theme.textSecondary} />
            <View style={styles.body}>
              <View style={styles.titleRow}>
                <ThemedText type="smallBold">{info.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {info.size}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {info.description}
              </ThemedText>
            </View>
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={22}
              color={selected ? theme.accent : theme.textSecondary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 사진을 담을 때 고르는 화질: 원본 그대로 / 효율 보관. 앨범 화질과 같은 쪽에 '앨범 기본'을 붙인다.
 * 앨범 기본 쪽을 고르면 null(앨범 화질 따르기)로 돌려준다: 나중에 앨범 화질을 바꾸면 그 사진도 따라간다.
 * 고른 화질은 이번에 담는 사진에만 쓰고, 담은 뒤에도 사진마다 바꿀 수 있다.
 */
export function QualityChoice({
  albumQuality,
  value,
  onChange,
}: {
  albumQuality: PhotoQuality;
  value: PhotoQuality | null;
  onChange: (value: PhotoQuality | null) => void;
}) {
  const theme = useTheme();
  const current = value ?? albumQuality;
  return (
    <View style={[styles.choice, { backgroundColor: theme.backgroundElement }]}>
      {PHOTO_QUALITIES.map((quality) => {
        const selected = quality === current;
        const albumDefault = quality === albumQuality;
        return (
          <Pressable
            key={quality}
            onPress={() => onChange(albumDefault ? null : quality)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${PHOTO_QUALITY[quality].label}${albumDefault ? ', 앨범 기본' : ''}`}
            style={[styles.choiceItem, selected && { backgroundColor: theme.background }]}>
            <Ionicons name={PHOTO_QUALITY[quality].icon} size={14} color={selected ? theme.accent : theme.textSecondary} />
            <ThemedText type={selected ? 'smallBold' : 'small'} themeColor={selected ? 'text' : 'textSecondary'} numberOfLines={1}>
              {PHOTO_QUALITY[quality].label}
            </ThemedText>
            {albumDefault && (
              <ThemedText type="small" style={[styles.defaultTag, { color: theme.accent, borderColor: theme.accent }]}>
                앨범 기본
              </ThemedText>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 사진 칸 오른쪽 아래의 화질 표시 (담는 화면에서 어떤 화질로 보관될지). 동영상 표시는 왼쪽 아래, 체크는 오른쪽 위다.
 * 원본은 포인트 색으로 칠해 한눈에 구분한다. 사진 위에 겹치므로 부모가 position을 잡는다.
 */
export function QualityTileBadge({ quality }: { quality: PhotoQuality }) {
  const theme = useTheme();
  const { language } = useTranslation();
  const original = quality === 'original';
  return (
    <View
      style={[styles.tileBadge, { backgroundColor: original ? theme.accent : 'rgba(0,0,0,0.5)' }]}
      pointerEvents="none"
      accessibilityLabel={PHOTO_QUALITY[quality].badge}>
      <Ionicons name={PHOTO_QUALITY[quality].icon} size={10} color={original ? theme.onAccent : '#fff'} />
      <Text style={[styles.tileBadgeText, { color: original ? theme.onAccent : '#fff' }]}>{original ? (language === 'en' ? 'Original' : language === 'ja' ? 'オリジナル' : '원본') : language === 'en' ? 'Optimized' : language === 'ja' ? '省容量' : '효율'}</Text>
    </View>
  );
}

/** 안전 앨범 카드와 앨범 화면에 붙는 작은 화질 표시 */
export function PhotoQualityBadge({ quality }: { quality: PhotoQuality }) {
  const theme = useTheme();
  const info = PHOTO_QUALITY[quality];
  return (
    <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
      <Ionicons name={info.icon} size={12} color={theme.accent} />
      <ThemedText type="small" style={styles.badgeText}>
        {info.badge}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  options: { gap: Spacing.two },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
  },
  body: { flex: 1, gap: Spacing.one },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 10,
  },
  badgeText: { fontSize: 12, lineHeight: 16 },
  // 동영상 표시(VideoBadge)와 같은 크기
  tileBadge: {
    position: 'absolute',
    right: Spacing.one,
    bottom: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  tileBadgeText: { fontSize: 11, lineHeight: 14, fontWeight: 600 },
  // 앨범 화면의 단계 버튼(ZoomBar)과 같은 모양
  choice: { flexDirection: 'row', padding: Spacing.half, borderRadius: Spacing.two },
  choiceItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.one,
    borderRadius: Spacing.two - Spacing.half,
  },
  defaultTag: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: 700,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
