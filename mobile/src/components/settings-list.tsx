import { CaretRightIcon, type Icon } from 'phosphor-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localizeText, useTranslation } from '@/lib/i18n';

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
  switchValue,
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
  /** 스위치 행처럼 행 전체를 하나의 조작으로 읽게 할 때 (TalkBack·VoiceOver) */
  switchValue?: boolean;
}) {
  const theme = useTheme();
  const { language } = useTranslation();
  const showChevron = chevron ?? (!!onPress && !children && !destructive);
  const tint = destructive ? theme.danger : theme.text;
  // 오른쪽에 Switch 같은 조작 요소만 둔 행은 부모 Pressable을 비활성화하지 않는다.
  // 비활성 부모가 자식의 터치를 가로채는 플랫폼에서도 스위치가 동작해야 한다.
  const rowDisabled = disabled || loading || (!onPress && !children);
  return (
    <Pressable
      onPress={onPress}
      disabled={rowDisabled}
      accessibilityRole={switchValue !== undefined ? 'switch' : onPress ? 'button' : undefined}
      accessibilityLabel={switchValue !== undefined ? localizeText(language, label) : undefined}
      accessibilityState={switchValue !== undefined ? { checked: switchValue } : undefined}
      style={({ pressed }) => [styles.row, { opacity: rowDisabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <View style={[styles.divider, { backgroundColor: theme.border }]} />
      {Icon && <Icon size={18} color={destructive ? theme.danger : theme.textSecondary} weight="regular" />}
      {/* 현지화 문구는 언어에 따라 길이가 크게 달라진다. 제목을 자르지 않고 두 줄까지 보여 준다. */}
      <ThemedText style={[styles.label, { color: tint }]} numberOfLines={2}>
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
  const theme = useTheme();
  // Android 테마에는 강조색이 없어 기본 청록색 스위치가 된다. 앱의 강조색으로 맞춘다 (iOS는 시스템 스위치 그대로).
  const androidColors =
    Platform.OS === 'android'
      ? { trackColor: { false: theme.backgroundSelected, true: theme.accent + '80' }, thumbColor: value ? theme.accent : '#f4f3f4' }
      : null;
  return (
    // 스위치만이 아니라 행 어디를 눌러도 바뀐다. 접근성에서는 행 하나를 스위치로 읽고, 안의 Switch는 따로 읽지 않는다.
    // 터치도 행이 받는다: Switch가 따로 받으면 Switch와 행이 한 번씩 onValueChange를 불러 알림 권한 요청 같은 동작이 겹친다.
    <SettingsRow label={label} icon={icon} onPress={() => onValueChange(!value)} chevron={false} switchValue={value}>
      <Switch
        value={value}
        {...androidColors}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </SettingsRow>
  );
}

/** 오늘이면 시각, 아니면 날짜만. 목록 오른쪽 값처럼 좁은 자리에 쓴다. */
export function shortDateTime(iso: string, language: 'ko' | 'en' | 'ja' = 'ko') {
  const date = new Date(iso);
  const now = new Date();
  const locale = language === 'ko' ? 'ko-KR' : language === 'ja' ? 'ja-JP' : 'en-US';
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
  if (date.toDateString() === now.toDateString()) return language === 'ko' ? `오늘 ${time}` : language === 'ja' ? `今日 ${time}` : `Today, ${time}`;
  return new Intl.DateTimeFormat(locale, { year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
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
