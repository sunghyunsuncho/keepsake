import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { PhotoQuality } from '@/db/albums';
import { useTheme } from '@/hooks/use-theme';

// 안전 앨범의 보관 화질. 숫자는 docs/PLAN.md §2.2의 추정치다.
export const PHOTO_QUALITY: Record<
  PhotoQuality,
  { label: string; badge: string; icon: keyof typeof Ionicons.glyphMap; description: string; size: string }
> = {
  original: {
    label: '원본 그대로',
    badge: '원본 보관',
    icon: 'diamond-outline',
    description: '찍은 그대로의 원본과 보기용 사진을 함께 보관해요. 인화하거나 원본을 다시 내려받을 때 좋아요.',
    size: '1장에 약 3~5MB',
  },
  display: {
    label: '효율 보관',
    badge: '효율 보관',
    icon: 'leaf-outline',
    description: '휴대폰에서 볼 때 뭉개지지 않는 크기(긴 변 1600px)로만 보관해요. 같은 용량에 훨씬 많이 담을 수 있어요.',
    size: '1장에 약 0.5MB',
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
});
