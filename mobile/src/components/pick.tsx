import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import type { Asset } from 'expo-media-library';
import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { GRID_COLUMN_OPTIONS, type GridColumns } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { presentLimitedPicker } from '@/lib/photos';

// 고르기 화면(새 사진)과 날짜로 보기 화면이 함께 쓰는 조각들.

export const GRID_GAP = Spacing.one;

export function useTileWidth(columns: GridColumns) {
  const { width } = useWindowDimensions();
  return Math.floor((width - GRID_GAP * (columns + 1)) / columns);
}

/** 한 줄에 한 장일 때는 잘리지 않게 원래 비율로, 여러 장일 때는 정사각형으로 보여준다. */
export function tileHeightFor(asset: Asset, width: number, columns: GridColumns) {
  if (columns !== 1) return width;
  const ratio = asset.width && asset.height ? asset.height / asset.width : 1;
  // 아주 긴 사진(파노라마·스크린샷)이 화면을 넘지 않도록 제한한다.
  return Math.round(width * Math.min(Math.max(ratio, 0.5), 1.5));
}

export type TileState = 'none' | 'picked' | 'saved';

export function PhotoTile({
  asset,
  width,
  height,
  state,
  order,
  onPress,
}: {
  asset: Asset;
  width: number;
  height: number;
  state: TileState;
  order: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: state !== 'none' }}
      accessibilityLabel={state === 'saved' ? '남긴 사진' : '사진'}
      style={{ width, height, margin: GRID_GAP / 2 }}>
      <Image
        source={{ uri: asset.uri }}
        style={styles.fill}
        contentFit="cover"
        recyclingKey={asset.id}
      />
      {state === 'picked' && (
        <View style={[styles.fill, styles.pickedFrame, { borderColor: theme.accent }]} />
      )}
      {state === 'saved' && (
        <View style={[styles.fill, styles.savedOverlay]}>
          <View style={[styles.savedBadge, { backgroundColor: theme.accent }]}>
            <Ionicons name="bookmark" size={12} color={theme.onAccent} />
            <ThemedText type="smallBold" style={[styles.badgeText, { color: theme.onAccent }]}>
              남김
            </ThemedText>
          </View>
        </View>
      )}
      {state !== 'saved' && (
        <View
          style={[
            styles.check,
            state === 'picked'
              ? { backgroundColor: theme.accent, borderColor: theme.accent }
              : { borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.15)' },
          ]}>
          {state === 'picked' && (
            <ThemedText type="smallBold" style={[styles.orderText, { color: theme.onAccent }]}>
              {order}
            </ThemedText>
          )}
        </View>
      )}
    </Pressable>
  );
}

const COLUMN_ICONS: Record<GridColumns, keyof typeof Ionicons.glyphMap> = {
  1: 'square-outline',
  2: 'grid-outline',
  3: 'apps-outline',
};

export function ColumnToggle({
  value,
  onChange,
}: {
  value: GridColumns;
  onChange: (value: GridColumns) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.segment, { backgroundColor: theme.backgroundElement }]}
      accessibilityRole="radiogroup">
      {GRID_COLUMN_OPTIONS.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`한 줄에 ${option}장`}
            hitSlop={4}
            style={[styles.segmentItem, active && { backgroundColor: theme.background }]}>
            <Ionicons
              name={COLUMN_ICONS[option]}
              size={16}
              color={active ? theme.text : theme.textSecondary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** 화면 아래에 붙는 막대. 왼쪽에 상태 설명, 오른쪽에 동작 버튼. */
export function BottomBar({
  title,
  subtitle,
  secondary,
  action,
}: {
  title: string;
  subtitle?: string;
  secondary?: { label: string; onPress: () => void };
  action: { label: string; onPress: () => void; loading?: boolean };
}) {
  const theme = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {subtitle && (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        )}
      </View>
      {secondary && !action.loading && (
        <Pressable onPress={secondary.onPress} hitSlop={8} style={styles.secondary}>
          <ThemedText type="small" themeColor="textSecondary">
            {secondary.label}
          </ThemedText>
        </Pressable>
      )}
      <Button label={action.label} loading={action.loading} onPress={action.onPress} />
    </View>
  );
}

/** 고르기 뒤에만 보이는 사진 정리 제안. 삭제 화면으로 가기 전에는 사진을 전혀 건드리지 않는다. */
export function CleanupSuggestion({
  count,
  onDismiss,
  onCleanup,
}: {
  count: number;
  onDismiss: () => void;
  onCleanup: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.cleanupSuggestion, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <View style={styles.cleanupHeading}>
        <View style={[styles.cleanupIcon, { backgroundColor: theme.accent + '18' }]}>
          <Ionicons name="leaf-outline" size={20} color={theme.accent} />
        </View>
        <View style={styles.flex}>
          <ThemedText type="smallBold">남기지 않은 사진 {count}장</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            필요한 사진만 남기고, 나머지는 한 번 더 확인해 정리할 수 있어요.
          </ThemedText>
        </View>
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityLabel="정리 제안 닫기">
          <Ionicons name="close" size={18} color={theme.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.cleanupActions}>
        <Pressable onPress={onDismiss} style={styles.cleanupSecondary} accessibilityRole="button">
          <ThemedText type="smallBold" themeColor="textSecondary">이번엔 그냥 둘게요</ThemedText>
        </Pressable>
        <Pressable
          onPress={onCleanup}
          style={[styles.cleanupPrimary, { backgroundColor: theme.accent }]}
          accessibilityRole="button">
          <Ionicons name="options-outline" size={17} color={theme.onAccent} />
          <ThemedText type="smallBold" style={{ color: theme.onAccent }}>사진 정리</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/** 남긴 사진 썸네일 줄. 누르면 기억을 적는 화면으로 간다. */
export function SavedTray({
  items,
  title,
  onOpen,
  onClose,
}: {
  items: { momentId: string; uri: string }[];
  title: string;
  onOpen: (momentId: string) => void;
  onClose?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.tray, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
      <View style={styles.trayHeader}>
        <ThemedText type="smallBold" style={styles.flex}>
          {title}
        </ThemedText>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="닫기">
            <Ionicons name="close" size={18} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.trayRow}>
        {items.map((item) => (
          <Pressable
            key={item.momentId}
            onPress={() => onOpen(item.momentId)}
            accessibilityLabel="기억 적기">
            <Image source={{ uri: item.uri }} style={styles.trayThumb} contentFit="cover" />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function LimitedAccessBanner({ onChanged }: { onChanged: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => presentLimitedPicker().finally(onChanged)}
      style={[styles.limitedBanner, { backgroundColor: theme.backgroundElement }]}>
      <Ionicons name="add-circle-outline" size={20} color={theme.accent} />
      <ThemedText type="small" style={styles.flex}>
        일부 사진만 볼 수 있어요. 보이지 않는 사진이 있다면{' '}
        <ThemedText type="smallBold" style={{ color: theme.accent }}>
          사진 추가 선택
        </ThemedText>
      </ThemedText>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      hitSlop={12}
      style={{ opacity: disabled ? 0.25 : 1, padding: Spacing.two }}>
      <Ionicons name={icon} size={24} color={theme.text} />
    </Pressable>
  );
}

export function Centered({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.centered, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fill: { ...StyleSheet.absoluteFillObject },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  segment: { flexDirection: 'row', borderRadius: Spacing.two, padding: 2 },
  segmentItem: {
    width: 32,
    height: 28,
    borderRadius: Spacing.two - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.two,
  },
  pickedFrame: { borderWidth: 3 },
  savedOverlay: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'flex-end',
    padding: Spacing.one + 2,
  },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: Spacing.two - 2,
    paddingVertical: 2,
    borderRadius: Spacing.two,
  },
  badgeText: { fontSize: 12, lineHeight: 16 },
  orderText: { fontSize: 13, lineHeight: 16 },
  check: {
    position: 'absolute',
    top: Spacing.one + 2,
    right: Spacing.one + 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  secondary: { paddingVertical: Spacing.two },
  cleanupSuggestion: {
    margin: Spacing.two,
    padding: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.four,
    gap: Spacing.three,
    shadowColor: '#140F0A',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cleanupHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cleanupIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cleanupActions: { flexDirection: 'row', gap: Spacing.two },
  cleanupSecondary: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  cleanupPrimary: { flex: 1, minHeight: 42, borderRadius: Spacing.two, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  tray: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  trayHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  trayRow: { gap: Spacing.two },
  trayThumb: { width: 56, height: 56, borderRadius: Spacing.two },
});
