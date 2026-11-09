import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ALLOCATION_STEPS } from '@/lib/cloud/shared';
import { formatBytes, formatSize } from '@/lib/storage';

/**
 * 공유 앨범에 내 안전 보관 용량을 얼마나 떼어 줄지. 앨범 용량은 구성원이 떼어 준 할당의 합이다.
 * available: 지금 할당을 포함해 내가 이 앨범에 줄 수 있는 최대. allowZero: 참여할 때 할당하지 않기 (다른 구성원의 할당으로 함께 쓴다).
 */
export function AllocationPicker({
  value,
  onChange,
  available,
  allowZero = false,
}: {
  value: number;
  onChange: (value: number) => void;
  available: number;
  allowZero?: boolean;
}) {
  const theme = useTheme();
  const steps = [...(allowZero ? [0] : []), ...ALLOCATION_STEPS.filter((step) => step <= available)];
  // 지금 값이 단계에 없으면(이전에 정한 값) 그대로 보여 준다.
  if (!steps.includes(value)) steps.push(value);
  steps.sort((a, b) => a - b);

  return (
    <View style={styles.wrap}>
      <View style={styles.row} accessibilityRole="radiogroup">
        {steps.map((step) => {
          const selected = step === value;
          return (
            <Pressable
              key={step}
              onPress={() => onChange(step)}
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
              <ThemedText type="small" style={selected && { fontWeight: 700 }}>
                {step === 0 ? '할당 안 함' : formatSize(step)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        내 안전 보관에서 쓸 수 있는 용량: {formatBytes(Math.max(available, 0))}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  option: {
    minWidth: 64,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
  },
});
