import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { MomentPhoto } from '@/components/moment-photo';
import { GRID_GAP } from '@/components/pick';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Moment } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { formatFullDate, formatTime, localDateKey } from '@/lib/dates';

// 앨범 화면과 앨범에 사진 넣기 화면이 함께 쓰는 조각들 (줄 목록은 lib/gallery.ts).

/**
 * 일·이야기 단계의 폴라로이드 인화지. 다크 모드에서도 종이는 흰색이라 그 위 글자색도 고정한다.
 * (밝은 모드에서는 흰 바탕 위라 그림자로 테두리를 드러낸다)
 */
const PRINT = { paper: '#FFFFFF', ink: '#1C1C1E', inkSecondary: '#6B6F76' } as const;
const PRINT_SHADOW = {
  shadowColor: '#140F0A',
  shadowOpacity: 0.16,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 1 },
  elevation: 2,
} as const;
/** 일 단계 폴라로이드: 사진 둘레와 아래 여백 */
const TILE_FRAME = 4;
const TILE_FRAME_BOTTOM = 13;
const FRAMED_GAP = Spacing.two;
const FRAMED_SIDE = 10;

/** 위에 붙는 머리글(해·달)의 높이. 아래 header 스타일의 여백 + 글자 줄 높이 */
export const STICKY_HEADER_HEIGHT = Spacing.three + 30 + Spacing.two;

export function GalleryHeader({ title, subtitle, sticky }: { title: string; subtitle?: string; sticky: boolean }) {
  if (!sticky) {
    return (
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.dayLabel}>
        {title}
      </ThemedText>
    );
  }
  return (
    <ThemedView style={styles.header}>
      <ThemedText style={styles.headerText}>{title}</ThemedText>
      {subtitle && (
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      )}
    </ThemedView>
  );
}

export function useGridTileSize(columns: number) {
  const { width } = useWindowDimensions();
  return Math.floor((width - GRID_GAP * (columns + 1)) / columns);
}

/** 정사각형 사진 한 줄. 마지막 줄이 덜 차도 같은 크기로 왼쪽부터 채운다. */
export function TileRow({
  moments,
  columns,
  checked,
  framed,
  onPress,
  onLongPress,
}: {
  moments: Moment[];
  columns: number;
  /** 고르는 화면이면 체크 표시할 기록 */
  checked?: Set<string>;
  /** 작은 폴라로이드로 (일 단계) */
  framed?: boolean;
  onPress: (moment: Moment) => void;
  onLongPress?: (moment: Moment) => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const gridSize = useGridTileSize(columns);
  if (framed) {
    const outer = Math.floor((width - FRAMED_SIDE * 2 - FRAMED_GAP * (columns - 1)) / columns);
    const size = outer - TILE_FRAME * 2;
    return (
      <View style={styles.framedRow}>
        {moments.map((moment) => (
          <Pressable
            key={moment.id}
            onPress={() => onPress(moment)}
            onLongPress={onLongPress && (() => onLongPress(moment))}
            accessibilityRole="imagebutton"
            accessibilityLabel={formatFullDate(moment.taken_at, moment.taken_tz_offset)}
            style={({ pressed }) => [styles.framedTile, { opacity: pressed ? 0.8 : 1 }]}>
            <MomentPhoto
              moment={moment}
              style={{ width: size, height: size, backgroundColor: theme.backgroundElement }}
              transition={100}
            />
          </Pressable>
        ))}
      </View>
    );
  }
  const size = gridSize;
  return (
    <View style={styles.tileRow}>
      {moments.map((moment) => {
        const isChecked = checked?.has(moment.id);
        return (
          <Pressable
            key={moment.id}
            onPress={() => onPress(moment)}
            onLongPress={onLongPress && (() => onLongPress(moment))}
            accessibilityRole={checked ? 'checkbox' : 'imagebutton'}
            accessibilityLabel={formatFullDate(moment.taken_at, moment.taken_tz_offset)}
            accessibilityState={checked ? { checked: isChecked } : undefined}
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
            <MomentPhoto
              moment={moment}
              style={{ width: size, height: size, backgroundColor: theme.backgroundElement }}
              transition={100}
            />
            {checked && (
              <View
                style={[
                  styles.check,
                  isChecked
                    ? { backgroundColor: theme.accent, borderColor: theme.accent }
                    : { borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.2)' },
                ]}>
                {isChecked && <Ionicons name="checkmark" size={16} color={theme.onAccent} />}
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 메모와 함께 한 장씩, 폴라로이드처럼. 사진은 정사각형으로 보여주고(전체는 크게 보기에서),
 * 아래 여백에 메모를 적는다. 사진을 누르면 크게 보고, 아래를 누르면 기록을 연다.
 */
export function StoryCard({
  moment,
  onOpenPhoto,
  onOpenMoment,
  onLongPress,
}: {
  moment: Moment;
  onOpenPhoto: () => void;
  onOpenMoment: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const day = localDateKey(moment.taken_at, moment.taken_tz_offset);
  // 카드마다 아주 살짝 다르게 기울인다. id로 정해서 다시 그려도 같다.
  const tilt = moment.id.charCodeAt(moment.id.length - 1) % 2 ? '0.5deg' : '-0.5deg';
  return (
    <View style={[styles.print, { transform: [{ rotate: tilt }] }]}>
      <Pressable onPress={onOpenPhoto} onLongPress={onLongPress} accessibilityLabel="사진 크게 보기">
        <MomentPhoto
          moment={moment}
          style={[styles.printImage, { backgroundColor: theme.backgroundElement }]}
          transition={150}
        />
      </Pressable>
      <Pressable
        onPress={onOpenMoment}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.printBody, { opacity: pressed ? 0.7 : 1 }]}>
        {moment.memo.trim() !== '' ? (
          <ThemedText numberOfLines={3} style={{ color: PRINT.ink }}>
            {moment.memo}
          </ThemedText>
        ) : (
          <ThemedText style={{ color: PRINT.inkSecondary }}>눌러서 그때의 기억을 적어 보세요</ThemedText>
        )}
        <View style={styles.printFoot}>
          <ThemedText type="small" style={[styles.flex, { color: PRINT.inkSecondary }]} numberOfLines={1}>
            {[formatTime(moment.taken_at, moment.taken_tz_offset), moment.place_name].filter(Boolean).join(' · ')}
          </ThemedText>
          <ThemedText type="small" style={{ color: PRINT.inkSecondary }}>
            {day.slice(5).replace('-', '.')}
          </ThemedText>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerText: { fontSize: 22, lineHeight: 30, fontWeight: 700 },
  dayLabel: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  tileRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
    paddingHorizontal: GRID_GAP,
    paddingBottom: GRID_GAP,
  },
  check: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  framedRow: {
    flexDirection: 'row',
    gap: FRAMED_GAP,
    paddingHorizontal: FRAMED_SIDE,
    paddingBottom: FRAMED_GAP,
  },
  framedTile: {
    backgroundColor: PRINT.paper,
    padding: TILE_FRAME,
    paddingBottom: TILE_FRAME_BOTTOM,
    ...PRINT_SHADOW,
  },
  flex: { flex: 1 },
  print: {
    marginHorizontal: 22,
    marginTop: Spacing.one,
    marginBottom: 26,
    padding: 12,
    paddingBottom: 0,
    backgroundColor: PRINT.paper,
    ...PRINT_SHADOW,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  printImage: { width: '100%', aspectRatio: 1 },
  printBody: { paddingHorizontal: Spacing.one, paddingTop: 14, paddingBottom: Spacing.three, gap: 10, minHeight: 64 },
  printFoot: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
});
