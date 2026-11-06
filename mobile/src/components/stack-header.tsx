import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// 뒤로 가기가 있는 화면과 아래에서 올라오는 창(모달)의 머리글. iOS 기본 머리글 버튼은 iOS 26부터
// 동그란 유리 배경이 생기는데, 지금 쓰는 react-native-screens(4.16)에는 이를 끄는 옵션이 없어 머리글을 직접 그린다.
// 버튼은 배경 없이 '<'(뒤로), '×'(닫기) 아이콘만 쓴다.

type ItemProps = { canGoBack: boolean; tintColor?: string };
type Props = {
  options: {
    title?: string;
    headerTitle?: string | ((props: { children: string; tintColor?: string }) => ReactNode);
    headerLeft?: (props: ItemProps) => ReactNode;
    headerRight?: (props: ItemProps) => ReactNode;
  };
  navigation: { goBack: () => void };
  back?: unknown;
};

/** 배경 없는 '<' 버튼. 앱의 모든 뒤로 가기는 이 모양이다. */
export function BackButton({ onPress, label = '뒤로 가기' }: { onPress: () => void; label?: string }) {
  const theme = useTheme();
  return <HeaderButton icon="chevron-back" label={label} onPress={onPress} color={theme.text} size={28} />;
}

/** 배경 없는 '×' 버튼. 모달을 닫거나 취소한다. */
export function CloseButton({ onPress, label = '닫기' }: { onPress: () => void; label?: string }) {
  const theme = useTheme();
  return <HeaderButton icon="close" label={label} onPress={onPress} color={theme.text} size={26} />;
}

/** 배경 없는 머리글 아이콘 버튼 (누르는 동안만 흐려진다) */
export function HeaderButton({
  icon,
  label,
  onPress,
  color,
  size = 24,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.4 : 1 }]}>
      <Ionicons name={icon} size={size} color={color ?? theme.text} />
    </Pressable>
  );
}

/** 모달 머리글. 왼쪽 '<' 대신 오른쪽 위에 '×'를 기본으로 둔다. */
export function ModalHeader(props: Props) {
  return <StackHeader {...props} modal />;
}

export function StackHeader({ options, navigation, back, modal = false }: Props & { modal?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const itemProps = { canGoBack: Boolean(back), tintColor: theme.text };
  const title = typeof options.headerTitle === 'string' ? options.headerTitle : (options.title ?? '');
  const left = options.headerLeft
    ? options.headerLeft(itemProps)
    : back && !modal
      ? <BackButton onPress={navigation.goBack} />
      : null;
  const right = options.headerRight
    ? options.headerRight(itemProps)
    : modal
      ? <CloseButton onPress={navigation.goBack} />
      : null;
  // iOS 모달은 화면 위쪽이 비어 있는 시트라 상태 표시줄 여백이 필요 없다. Android 모달은 전체 화면이다.
  const top = modal && Platform.OS === 'ios' ? Spacing.two : insets.top;

  return (
    <View style={[styles.bar, { paddingTop: top, backgroundColor: theme.background }]}>
      {/* 모달 시트는 모서리가 둥글어서 버튼을 안쪽으로 더 들인다. */}
      <View style={[styles.row, modal && styles.modalRow]}>
        <View style={[styles.side, styles.left]}>{left}</View>
        <View style={styles.title}>
          {typeof options.headerTitle === 'function' ? (
            options.headerTitle({ children: title, tintColor: theme.text })
          ) : (
            <ThemedText type="smallBold" numberOfLines={1} style={styles.titleText}>
              {title}
            </ThemedText>
          )}
        </View>
        <View style={[styles.side, styles.right]}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {},
  row: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.two },
  modalRow: { paddingHorizontal: Spacing.four },
  side: { minWidth: 56, flexDirection: 'row', alignItems: 'center' },
  left: { justifyContent: 'flex-start' },
  right: { justifyContent: 'flex-end' },
  title: { flex: 1, alignItems: 'center' },
  titleText: { fontSize: 17, lineHeight: 22 },
  button: { minWidth: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
});
