import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ALBUM_ZOOMS, type AlbumSortOrder, type AlbumZoom } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { localizeText, useTranslation } from '@/lib/i18n';

// 앨범 화면(내 앨범·공유 앨범)이 함께 쓰는 단계 버튼, 정렬, 추가·빼기 버튼.

const ZOOM_LABELS: Record<AlbumZoom, string> = { year: '연도', month: '월', day: '일', story: '이야기' };
/** 손가락을 이만큼 벌리거나 모으면 한 단계 바꾼다. */
const PINCH_STEP = 1.25;

/** 두 손가락: 벌리면 가깝게(+1), 모으면 넓게(-1). 손을 떼면 한 단계 바꾼다. 움직이는 동안은 살짝 커지고 작아져 보이게 한다. */
export function usePinchZoom(onStep: (delta: 1 | -1) => void) {
  const scale = useSharedValue(1);
  const gesture = Gesture.Pinch()
    .runOnJS(true)
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(e.scale, 0.85), 1.15);
    })
    .onEnd((e) => {
      if (e.scale >= PINCH_STEP) onStep(1);
      else if (e.scale <= 1 / PINCH_STEP) onStep(-1);
    })
    .onFinalize(() => {
      scale.value = withTiming(1, { duration: 150 });
    });
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return { gesture, style };
}

export function ZoomBar({
  value,
  onChange,
  zooms = ALBUM_ZOOMS,
}: {
  value: AlbumZoom;
  onChange: (zoom: AlbumZoom) => void;
  /** 보여 줄 단계 (사진을 담는 화면은 이야기 단계가 없다) */
  zooms?: readonly AlbumZoom[];
}) {
  const theme = useTheme();
  return (
    <View style={[styles.zoomBar, { backgroundColor: theme.backgroundElement }]}>
      {zooms.map((zoom) => {
        const selected = zoom === value;
        return (
          <Pressable
            key={zoom}
            onPress={() => onChange(zoom)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[styles.zoomItem, selected && { backgroundColor: theme.background }]}>
            <ThemedText type={selected ? 'smallBold' : 'small'} themeColor={selected ? 'text' : 'textSecondary'}>
              {ZOOM_LABELS[zoom]}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SortOrderButton({ value, onChange }: { value: AlbumSortOrder; onChange: (value: AlbumSortOrder) => void }) {
  const theme = useTheme();
  const { language } = useTranslation();
  const next = value === 'newest' ? 'oldest' : 'newest';
  const current = localizeText(language, value === 'newest' ? '최신순' : '오래된순');
  const accessibilityLabel = { ko: `정렬: ${current}. 눌러서 바꾸기`, en: `Sort: ${current}. Tap to change`, ja: `並び順：${current}。タップで切り替え` }[language];
  return (
    <Pressable onPress={() => onChange(next)} style={styles.sortOrder} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      <Ionicons name="swap-vertical" size={16} color={theme.accent} />
      <ThemedText type="smallBold" style={{ color: theme.accent }}>{value === 'newest' ? '최신순' : '오래된순'}</ThemedText>
    </Pressable>
  );
}

export function AlbumActionButton({
  icon,
  label,
  active = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { language } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // 아이콘 글꼴 글자가 이름에 섞이지 않게 글만으로 이름을 준다.
      accessibilityLabel={localizeText(language, label)}
      style={({ pressed }) => [
        styles.albumActionButton,
        { backgroundColor: active ? theme.accent : theme.backgroundElement, opacity: pressed ? 0.72 : 1 },
      ]}>
      <Ionicons name={icon} size={18} color={active ? theme.onAccent : theme.accent} />
      <ThemedText type="smallBold" style={{ color: active ? theme.onAccent : theme.text }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  albumActionButton: { minHeight: 32, paddingHorizontal: Spacing.two, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  zoomBar: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    marginVertical: Spacing.two,
    padding: Spacing.half,
    borderRadius: Spacing.two,
  },
  zoomItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two - Spacing.half,
  },
  sortOrder: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: Spacing.two, minHeight: 32 },
});
