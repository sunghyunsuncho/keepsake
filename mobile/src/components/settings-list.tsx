import { CaretRightIcon, type Icon } from 'phosphor-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// 설정 탭의 목록 (Vernissage 마이 탭과 같은 모양): 작은 회색 제목 + 흰 카드(옅은 테두리·그림자) 안에
// 아이콘·이름·값·'>'이 한 줄씩. 설명 대신 행 이름과 오른쪽 값으로 뜻을 전한다.
// 행마다 위쪽 구분선을 그리고 카드가 첫 줄의 선을 가린다. 그래서 행을 묶어 돌려주는 컴포넌트도 그대로 넣을 수 있다.

export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionTitle}>
          {title}
        </ThemedText>
      )}
      <SettingsCard>
        <View style={styles.cardInner}>{children}</View>
      </SettingsCard>
    </View>
  );
}

/** 떠 있는 흰 카드. iOS는 overflow hidden이면 그림자가 잘려서, 그림자는 바깥에서 그리고 안쪽에서 모서리를 깎는다. */
export function SettingsCard({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <View style={styles.cardClip}>{children}</View>
    </View>
  );
}

export function SettingsRow({
  label,
  value,
  icon: Icon,
  onPress,
  destructive = false,
  disabled = false,
  loading = false,
  chevron,
  children,
}: {
  label: string;
  value?: string | null;
  icon?: Icon;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** 기본은 누를 수 있는 행에 붙인다. 스위치 행과 빨간 행(로그아웃·삭제)에는 붙이지 않는다. */
  chevron?: boolean;
  /** 오른쪽에 둘 요소 (스위치 등) */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const showChevron = chevron ?? (!!onPress && !children && !destructive);
  const tint = destructive ? theme.danger : theme.text;
  // 오른쪽에 Switch 같은 조작 요소만 둔 행은 부모 Pressable을 비활성화하지 않는다.
  // 비활성 부모가 자식의 터치를 가로채는 플랫폼에서도 스위치가 동작해야 한다.
  const rowDisabled = disabled || loading || (!onPress && !children);
  return (
    <Pressable
      onPress={onPress}
      disabled={rowDisabled}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, { opacity: rowDisabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <View style={[styles.divider, { backgroundColor: theme.border }]} />
      {Icon && <Icon size={18} color={destructive ? theme.danger : theme.textSecondary} weight="regular" />}
      <ThemedText style={[styles.label, { color: tint }]} numberOfLines={1}>
        {label}
      </ThemedText>
      {loading ? (
        <ActivityIndicator />
      ) : (
        !!value && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.value}>
            {value}
          </ThemedText>
        )
      )}
      {children}
      {showChevron && <CaretRightIcon size={18} color={theme.chevron} weight="regular" />}
    </Pressable>
  );
}

export function SettingsSwitchRow({
  label,
  icon,
  value,
  onValueChange,
}: {
  label: string;
  icon?: Icon;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <SettingsRow label={label} icon={icon}>
      <Switch value={value} onValueChange={onValueChange} />
    </SettingsRow>
  );
}

/** 오늘이면 시각, 아니면 날짜만. 목록 오른쪽 값처럼 좁은 자리에 쓴다. */
export function shortDateTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) return `오늘 ${time}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  return `${sameYear ? '' : `${date.getFullYear()}년 `}${date.getMonth() + 1}월 ${date.getDate()}일 ${time}`;
}

const CARD_RADIUS = 20;

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  sectionTitle: { paddingHorizontal: Spacing.one, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 1 },
  card: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOpacity: 0.09,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cardClip: { borderRadius: CARD_RADIUS - 1, overflow: 'hidden' },
  // 첫 행의 위쪽 구분선을 카드 밖으로 밀어 가린다.
  cardInner: { marginTop: -StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 54,
  },
  divider: { position: 'absolute', top: 0, left: Spacing.three, right: Spacing.three, height: StyleSheet.hairlineWidth },
  label: { flex: 1, fontSize: 16, lineHeight: 22 },
  value: { flexShrink: 1, textAlign: 'right', marginRight: Spacing.one },
});
