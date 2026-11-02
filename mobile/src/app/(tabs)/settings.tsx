import Ionicons from '@expo/vector-icons/Ionicons';
import * as Application from 'expo-application';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { CloudSection } from '@/components/cloud-section';
import { ReminderSection } from '@/components/reminder-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { libraryStats } from '@/db/moments';
import { getSettings, RECOMMENDED_COUNT_RANGE, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { formatFullDate, formatTime } from '@/lib/dates';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const { data: stats } = useDbQuery(() => libraryStats(db), [db]);

  const count = settings?.daily_recommended_count ?? 3;
  const changeCount = (delta: number) => {
    const next = Math.min(
      RECOMMENDED_COUNT_RANGE.max,
      Math.max(RECOMMENDED_COUNT_RANGE.min, count + delta),
    );
    if (next !== count) setSetting(db, 'daily_recommended_count', next);
  };

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="하루 권장 사진 수">
          <ThemedText type="small" themeColor="textSecondary">
            필름 한 롤처럼, 하루에 남길 사진 수의 기준이에요. 넘겨도 괜찮아요.
          </ThemedText>
          <View style={styles.stepper}>
            <StepButton icon="remove" label="줄이기" disabled={count <= RECOMMENDED_COUNT_RANGE.min} onPress={() => changeCount(-1)} />
            <ThemedText style={styles.count} accessibilityLabel={`${count}장`}>
              {count}장
            </ThemedText>
            <StepButton icon="add" label="늘리기" disabled={count >= RECOMMENDED_COUNT_RANGE.max} onPress={() => changeCount(1)} />
          </View>
        </Section>

        <Section title="고르기">
          <ThemedText type="small" themeColor="textSecondary">
            {settings?.review_cursor
              ? `${formatFullDate(settings.review_cursor)} ${formatTime(settings.review_cursor)}에 찍은 사진까지 살펴봤어요. 고르기 화면은 그 뒤의 사진부터 보여줘요.`
              : '아직 어디서부터 고를지 정하지 않았어요.'}
          </ThemedText>
          <Button
            label="시작 지점 다시 정하기"
            variant="secondary"
            disabled={!settings?.review_cursor}
            onPress={() =>
              Alert.alert(
                '어디서부터 고를지 다시 정할까요?',
                '이미 남긴 사진은 그대로 있어요. 고르기 화면에서 시작할 날짜를 다시 고르게 돼요.',
                [
                  { text: '취소', style: 'cancel' },
                  { text: '다시 정하기', onPress: () => setSetting(db, 'review_cursor', null) },
                ],
              )
            }
          />
        </Section>

        <Section title="알림">
          <ReminderSection settings={settings} />
        </Section>

        <Section title="기록 보관">
          <View style={[styles.statBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small">{stats ? `${stats.count}장 · ${stats.days}일의 기록` : ' '}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Keepsake는 사진을 따로 복사해 두지 않고 기기 사진첩의 원본을 그대로 보여줘요. 그래서 휴대폰 용량을
            거의 쓰지 않아요.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            기기 사진첩에서 사진을 지우면 기록의 사진도 보이지 않아요. 메모와 장소, 날짜는 남아요. 원본을 따로
            지켜 두고 싶다면 Cloud를 이용해 주세요.
          </ThemedText>
        </Section>

        <Section title="Cloud">
          <CloudSection />
        </Section>

        <ThemedText type="small" themeColor="textSecondary" style={styles.version}>
          Keepsake {Application.nativeApplicationVersion} ({Application.nativeBuildVersion})
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {children}
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={[styles.stepButton, { backgroundColor: theme.backgroundElement, opacity: disabled ? 0.3 : 1 }]}>
      <Ionicons name={icon} size={22} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.five, paddingBottom: Spacing.six },
  section: { gap: Spacing.three },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { fontSize: 22, lineHeight: 30, fontWeight: 700, minWidth: 48, textAlign: 'center' },
  statBox: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  version: { textAlign: 'center' },
});
