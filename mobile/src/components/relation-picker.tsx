import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { RELATION_ORDER, RELATIONS, type Relation } from '@/lib/cloud/shared';

/** 공유 앨범을 누구와 쓰는지. 목록의 아이콘과 문구만 바꾼다. */
export function RelationPicker({ value, onChange }: { value: Relation; onChange: (value: Relation) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {RELATION_ORDER.map((relation) => {
        const selected = relation === value;
        return (
          <Pressable
            key={relation}
            onPress={() => onChange(relation)}
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
            <Ionicons name={RELATIONS[relation].icon} size={20} color={selected ? theme.accent : theme.textSecondary} />
            <ThemedText type="small" style={selected && { fontWeight: 700 }}>
              {RELATIONS[relation].label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  option: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
  },
});
