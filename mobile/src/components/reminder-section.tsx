import * as Notifications from 'expo-notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Switch, View } from 'react-native';

import { DateSheet } from '@/components/date-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { REMINDER_FREQUENCIES, type Settings } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import {
  dateToReminderTime,
  enableRemindersFromSettings,
  formatReminderTime,
  REMINDER_FREQUENCY_LABEL,
  reminderTimeToDate,
  setReminderEnabled,
  setReminderSchedule,
} from '@/lib/reminders';

export function ReminderSection({ settings }: { settings: Settings | undefined }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [choosingTime, setChoosingTime] = useState(false);
  const permitted = useNotificationPermission();
  const enabled = settings?.reminder_enabled ?? false;
  const time = settings?.reminder_time ?? '21:00';

  return (
    <>
      <View style={styles.row}>
        <ThemedText type="small" style={styles.flex}>
          새로 찍은 사진을 고를 때가 되면 알려 주기
        </ThemedText>
        <Switch
          value={enabled}
          onValueChange={(value) =>
            value ? enableRemindersFromSettings(db) : setReminderEnabled(db, false)
          }
        />
      </View>

      {enabled && (
        <>
          <View style={styles.options}>
            {REMINDER_FREQUENCIES.map((frequency) => {
              const selected = settings?.reminder_frequency === frequency;
              return (
                <Pressable
                  key={frequency}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setReminderSchedule(db, { frequency })}
                  style={[
                    styles.option,
                    { backgroundColor: selected ? theme.accent : theme.backgroundElement },
                  ]}>
                  <ThemedText
                    type="small"
                    style={{ color: selected ? theme.onAccent : theme.text, fontWeight: 700 }}>
                    {REMINDER_FREQUENCY_LABEL[frequency]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setChoosingTime(true)}
            style={[styles.row, styles.timeRow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" style={styles.flex}>
              알림 시각
            </ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {formatReminderTime(time)}
            </ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary">
            마지막으로 고른 뒤 {REMINDER_FREQUENCY_LABEL[settings?.reminder_frequency ?? 'every_2_days']}이 지나고
            새 사진이 있으면 알려드려요. 사진을 고르지 않은 지 한 달이 되면 한 번 더 알려드려요.
          </ThemedText>
          {permitted === false && (
            // 아직 묻지 않았으면 묻고, 거절했으면 설정 앱으로 안내한다.
            <Pressable onPress={() => enableRemindersFromSettings(db)} hitSlop={8}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                알림이 허용되지 않았어요. 눌러서 허용해 주세요.
              </ThemedText>
            </Pressable>
          )}
        </>
      )}

      <DateSheet
        visible={choosingTime}
        value={reminderTimeToDate(time)}
        mode="time"
        onConfirm={(date) => {
          setChoosingTime(false);
          setReminderSchedule(db, { time: dateToReminderTime(date) });
        }}
        onCancel={() => setChoosingTime(false)}
      />
    </>
  );
}

/** 휴대폰 설정에서 알림을 끈 경우를 보여주기 위해, 앱으로 돌아올 때마다 다시 확인한다. */
function useNotificationPermission() {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => Notifications.getPermissionsAsync().then((p) => setGranted(p.granted));
    check();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && check());
    return () => sub.remove();
  }, []);
  return granted;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  options: { flexDirection: 'row', gap: Spacing.two },
  option: {
    flex: 1,
    minHeight: 40,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeRow: { padding: Spacing.three, borderRadius: Spacing.three },
});
