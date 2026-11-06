import * as Notifications from 'expo-notifications';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { BellIcon, ClockIcon, RepeatIcon, WarningCircleIcon } from 'phosphor-react-native';

import { DateSheet } from '@/components/date-sheet';
import { SettingsRow, SettingsSwitchRow } from '@/components/settings-list';
import { REMINDER_FREQUENCIES, type Settings } from '@/db/settings';
import {
  dateToReminderTime,
  enableRemindersFromSettings,
  formatReminderTime,
  REMINDER_FREQUENCY_LABEL,
  reminderTimeToDate,
  setReminderEnabled,
  setReminderSchedule,
} from '@/lib/reminders';

/** 설정 목록의 고르기 알림 행들: 켜기, 빈도, 시각. 알림을 허용하지 않았으면 허용 행을 보여준다. */
export function ReminderRows({ settings }: { settings: Settings | undefined }) {
  const db = useSQLiteContext();
  const [choosingTime, setChoosingTime] = useState(false);
  const permitted = useNotificationPermission();
  const enabled = settings?.reminder_enabled ?? false;
  const time = settings?.reminder_time ?? '21:00';
  const frequency = settings?.reminder_frequency ?? 'every_2_days';

  const chooseFrequency = () =>
    Alert.alert('알림 빈도', '마지막으로 고른 뒤 이 기간이 지나고 새 사진이 있으면 알려드려요.', [
      ...REMINDER_FREQUENCIES.map((option) => ({
        text: `${REMINDER_FREQUENCY_LABEL[option]}${option === frequency ? ' ✓' : ''}`,
        onPress: () => setReminderSchedule(db, { frequency: option }),
      })),
      { text: '취소', style: 'cancel' as const },
    ]);

  return (
    <>
      <SettingsSwitchRow
        label="고르기 알림"
        icon={BellIcon}
        value={enabled}
        onValueChange={(value) => (value ? enableRemindersFromSettings(db) : setReminderEnabled(db, false))}
      />
      {enabled && (
        <>
          <SettingsRow label="알림 빈도" icon={RepeatIcon} value={REMINDER_FREQUENCY_LABEL[frequency]} onPress={chooseFrequency} />
          <SettingsRow label="알림 시각" icon={ClockIcon} value={formatReminderTime(time)} onPress={() => setChoosingTime(true)} />
          {permitted === false && (
            // 아직 묻지 않았으면 묻고, 거절했으면 설정 앱으로 안내한다.
            <SettingsRow label="알림 허용하기" icon={WarningCircleIcon} destructive onPress={() => enableRemindersFromSettings(db)} />
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
