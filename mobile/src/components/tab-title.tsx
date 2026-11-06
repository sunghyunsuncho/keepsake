import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** 탭 머리글 제목 + 바로 오른쪽의 (i) 안내 버튼 */
export function TabTitle({ title, infoLabel, onInfo }: { title: string; infoLabel: string; onInfo: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ThemedText style={styles.title}>{title}</ThemedText>
      <Pressable onPress={onInfo} hitSlop={10} accessibilityRole="button" accessibilityLabel={infoLabel}>
        <Ionicons name="information-circle-outline" size={22} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

/** 탭 머리글 제목. Vernissage 탭 제목과 같은 크기다. 탭 레이아웃의 headerTitleStyle도 이 값을 쓴다. */
export const TAB_TITLE_STYLE = { fontSize: 27, lineHeight: 34, fontWeight: '700', letterSpacing: -0.5 } as const;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  title: TAB_TITLE_STYLE,
});
