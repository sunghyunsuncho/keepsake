import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert, Linking, Platform } from 'react-native';

import { getSettings, setSetting, type ReminderFrequency, type Settings } from '@/db/settings';
import { countPhotosSince } from '@/lib/photos';

// 고르기 리마인더 (로컬 알림, 서버 없음). docs/PLAN.md Phase 3.
// 앱이 백그라운드로 갈 때·설정을 바꿀 때·[남기기] 후에 예약을 모두 지우고 다음 몇 회분을 다시 예약한다.
// 알림 내용(새 사진 수)은 예약할 때 정해지므로, 앱을 자주 열수록 정확해진다.

const IDENTIFIER_PREFIX = 'review-reminder-';
const CHANNEL_ID = 'reminders';
// iOS는 앱당 예약 알림을 64개까지 둔다. 다시 예약할 기회가 없어도 한동안은 알림이 가도록 7회분.
const SCHEDULE_COUNT = 7;

export const REMINDER_INTERVAL_DAYS: Record<ReminderFrequency, number> = {
  daily: 1,
  every_2_days: 2,
  weekly: 7,
};

export const REMINDER_FREQUENCY_LABEL: Record<ReminderFrequency, string> = {
  daily: '매일',
  every_2_days: '이틀마다',
  weekly: '매주',
};

const GENERIC_BODY = '최근 찍은 사진 중 남기고 싶은 순간이 있나요?';

// 백그라운드 전환과 [남기기]가 겹치면 지우기·예약이 섞이므로 차례로 실행한다.
let queue: Promise<void> = Promise.resolve();

export function rescheduleReminders(db: SQLiteDatabase) {
  queue = queue.then(() => reschedule(db)).catch(() => {
    // 알림은 부가 기능이라 실패해도 다음 예약 때 다시 시도한다.
  });
  return queue;
}

async function reschedule(db: SQLiteDatabase) {
  const settings = await getSettings(db);
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(IDENTIFIER_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  if (!settings.reminder_enabled) return;
  if (!(await Notifications.getPermissionsAsync()).granted) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '고르기 알림',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const now = new Date();
  const cursor = settings.review_cursor
    ? new Date(Math.min(new Date(settings.review_cursor).getTime(), now.getTime()))
    : null;
  const unseen = cursor ? await countPhotosSince(cursor) : null;

  for (const [index, date] of reminderDates(settings, now).entries()) {
    let body = GENERIC_BODY;
    // 첫 회에만 지금 쌓인 사진 수를 넣는다. 0장이면 알릴 것이 없으니 건너뛴다.
    if (index === 0 && cursor && unseen !== null) {
      if (unseen === 0) continue;
      body = unseenBody(unseen, cursor, date);
    }
    await Notifications.scheduleNotificationAsync({
      identifier: `${IDENTIFIER_PREFIX}${index}`,
      content: { body, data: { url: '/' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL_ID },
    });
  }
}

/**
 * 다음 알림 시각들. 마지막으로 고른 날로부터 빈도만큼 지난 날의 알림 시각부터 시작한다.
 * 오늘 이미 골랐으면 오늘은 건너뛰고, 한 번도 고른 적이 없으면 오늘부터 알린다.
 */
export function reminderDates(
  settings: Pick<Settings, 'last_reviewed_at' | 'reminder_time' | 'reminder_frequency'>,
  now: Date,
) {
  const interval = REMINDER_INTERVAL_DAYS[settings.reminder_frequency];
  const [hours, minutes] = settings.reminder_time.split(':').map(Number);
  const anchor = settings.last_reviewed_at ? new Date(settings.last_reviewed_at) : now;
  const at = (k: number) =>
    new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + k * interval, hours, minutes);

  const daysSinceAnchor = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()).getTime()) /
      (24 * 60 * 60 * 1000),
  );
  let k = Math.max(settings.last_reviewed_at ? 1 : 0, Math.floor(daysSinceAnchor / interval));
  while (at(k) <= now) k++;
  return Array.from({ length: SCHEDULE_COUNT }, (_, i) => at(k + i));
}

/** "지난 3일 동안 찍은 사진 24장 중 …" */
function unseenBody(count: number, since: Date, at: Date) {
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(since.getFullYear(), since.getMonth(), since.getDate()).getTime()) /
      (24 * 60 * 60 * 1000),
  );
  const period = days <= 0 ? '오늘' : days === 1 ? '어제부터' : `지난 ${days}일 동안`;
  return `${period} 찍은 사진 ${count}장 중 십 년 뒤에도 보고 싶은 사진이 있나요?`;
}

/** [남기기]·[여기까지 봤어요]를 누른 뒤. 알림 기준 시각을 옮기고 다시 예약한다. */
export async function markReviewed(db: SQLiteDatabase) {
  await setSetting(db, 'last_reviewed_at', new Date().toISOString());
  await rescheduleReminders(db);
}

/** 처음 [남기기]를 마친 뒤 한 번만 알림을 받을지 묻는다. 이후로는 설정에서만 바꾼다. */
export async function offerReminders(db: SQLiteDatabase) {
  const settings = await getSettings(db);
  if (settings.reminder_prompted || settings.reminder_enabled) return;
  await setSetting(db, 'reminder_prompted', true);
  const label = REMINDER_FREQUENCY_LABEL[settings.reminder_frequency];
  Alert.alert(
    '알림으로 알려드릴까요?',
    `${label} ${formatReminderTime(settings.reminder_time)}에 새로 찍은 사진을 고를 때가 되었다고 알려드려요. 설정에서 언제든 바꿀 수 있어요.`,
    [
      { text: '괜찮아요', style: 'cancel' },
      {
        text: '알려 주세요',
        onPress: async () => {
          const { granted } = await Notifications.requestPermissionsAsync();
          if (granted) await setReminderEnabled(db, true);
        },
      },
    ],
  );
}

/** 설정에서 알림을 켠다. 권한이 없으면 묻고, 더 물을 수 없으면 설정 앱으로 안내한다. */
export async function enableRemindersFromSettings(db: SQLiteDatabase) {
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) {
    Alert.alert('알림이 꺼져 있어요', '휴대폰 설정에서 Keepsake 알림을 허용해 주세요.', [
      { text: '취소', style: 'cancel' },
      { text: '설정 열기', onPress: () => Linking.openSettings() },
    ]);
    return;
  }
  await setReminderEnabled(db, true);
}

export async function setReminderEnabled(db: SQLiteDatabase, enabled: boolean) {
  await setSetting(db, 'reminder_enabled', enabled);
  await rescheduleReminders(db);
}

export async function setReminderSchedule(
  db: SQLiteDatabase,
  change: { time?: string; frequency?: ReminderFrequency },
) {
  if (change.time) await setSetting(db, 'reminder_time', change.time);
  if (change.frequency) await setSetting(db, 'reminder_frequency', change.frequency);
  await rescheduleReminders(db);
}

/** "21:00" → "밤 9시", "08:30" → "오전 8시 30분" */
export function formatReminderTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours < 12 ? '오전' : hours < 18 ? '오후' : hours < 21 ? '저녁' : '밤';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${period} ${hour12}시${minutes ? ` ${minutes}분` : ''}`;
}

export function reminderTimeToDate(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function dateToReminderTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
