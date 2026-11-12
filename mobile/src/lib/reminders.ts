import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert, Linking, Platform } from 'react-native';

import { getSettings, setSetting, type AppLanguage, type ReminderFrequency, type Settings } from '@/db/settings';
import { countPhotosSince } from '@/lib/photos';

// 고르기 리마인더 (로컬 알림, 서버 없음). docs/PLAN.md Phase 3.
// 앱이 백그라운드로 갈 때·설정을 바꿀 때·[남기기] 후에 다음 한 회만 다시 예약한다.
// 사진 보관함은 앱이 닫혀 있을 때 바뀐 것을 항상 알려 주지 않으므로, 앱이 사진 수를 확인한
// 시점에만 예약한다. 사진이 없는데 보내는 주기 알림보다, 다음 앱 전환 때 다시 확인하는 편을 택한다.

const IDENTIFIER_PREFIX = 'review-reminder-';
const CHANNEL_ID = 'reminders';
const MONTHLY_NUDGE_DAYS = 30;

export const REMINDER_INTERVAL_DAYS: Record<ReminderFrequency, number> = {
  daily: 1,
  every_2_days: 2,
  weekly: 7,
};

export const REMINDER_FREQUENCY_LABEL: Record<ReminderFrequency, string> = { daily: '매일', every_2_days: '이틀마다', weekly: '매주' };

export function reminderFrequencyLabel(frequency: ReminderFrequency, language: AppLanguage) {
  const labels: Record<AppLanguage, Record<ReminderFrequency, string>> = {
    ko: REMINDER_FREQUENCY_LABEL,
    en: { daily: 'Daily', every_2_days: 'Every 2 days', weekly: 'Weekly' },
    ja: { daily: '毎日', every_2_days: '2日ごと', weekly: '毎週' },
  };
  return labels[language][frequency];
}

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
      name: notificationChannelName(settings.language),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const now = new Date();
  const cursor = settings.review_cursor
    ? new Date(Math.min(new Date(settings.review_cursor).getTime(), now.getTime()))
    : null;
  // 새 사진이 있고 일정 기간이 지났을 때 먼저 알린다. 사진 보관함 변경을 놓쳤더라도
  // 마지막으로 고른 지 한 달이 되는 날에는 한 번 부드럽게 다시 고르도록 알린다.
  if (!cursor) return;
  const unseen = await countPhotosSince(cursor);
  const reviewDate = nextReminderDate(settings, now);
  const monthlyDate = monthlyNudgeDate(settings, now);
  const date = unseen ? earliestDate(reviewDate, monthlyDate) : monthlyDate;
  if (!date) return;
  await Notifications.scheduleNotificationAsync({
    identifier: `${IDENTIFIER_PREFIX}next`,
    content: {
      body: unseen ? unseenBody(unseen, cursor, date, settings.language) : monthlyNudgeBody(settings.language),
      data: { url: '/' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL_ID },
  });
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
  return [at(k)];
}

/** 다음 한 번의 알림 시각. 앱이 다시 열리거나 백그라운드로 갈 때 다시 판단한다. */
export function nextReminderDate(
  settings: Pick<Settings, 'last_reviewed_at' | 'reminder_time' | 'reminder_frequency'>,
  now: Date,
) {
  return reminderDates(settings, now)[0];
}

function notificationChannelName(language: AppLanguage) {
  return language === 'en' ? 'Photo review reminders' : language === 'ja' ? '写真を選ぶリマインダー' : '고르기 알림';
}

function monthlyNudgeBody(language: AppLanguage) {
  if (language === 'en') return 'It’s been a month since you last reviewed your photos. Any new moments worth keeping?';
  if (language === 'ja') return '最後に写真を選んでから1か月です。残しておきたい新しい写真はありますか？';
  return '마지막으로 사진을 고른 지 한 달이 되었어요. 새로 찍은 사진 중 남기고 싶은 순간이 있나요?';
}

/** 새 사진 감지가 늦어져도 한 달 뒤 한 번은 다시 고르기를 제안한다. 이미 지난 알림은 되살리지 않는다. */
export function monthlyNudgeDate(
  settings: Pick<Settings, 'last_reviewed_at' | 'reminder_time'>,
  now: Date,
) {
  if (!settings.last_reviewed_at) return null;
  const anchor = new Date(settings.last_reviewed_at);
  const [hours, minutes] = settings.reminder_time.split(':').map(Number);
  const date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + MONTHLY_NUDGE_DAYS, hours, minutes);
  return date > now ? date : null;
}

function earliestDate(...dates: (Date | null)[]) {
  const available = dates.filter((date): date is Date => date !== null);
  return available.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

/** "지난 3일 동안 찍은 사진 24장 중 …" */
function unseenBody(count: number, since: Date, at: Date, language: AppLanguage) {
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(since.getFullYear(), since.getMonth(), since.getDate()).getTime()) /
      (24 * 60 * 60 * 1000),
  );
  if (language === 'en') {
    const period = days <= 0 ? 'Today' : days === 1 ? 'Since yesterday' : `In the past ${days} days`;
    return `${period}, you took ${count} new ${count === 1 ? 'photo' : 'photos'}. Any you’ll want to revisit years from now?`;
  }
  if (language === 'ja') {
    const period = days <= 0 ? '今日' : days === 1 ? '昨日から' : `この${days}日間で`;
    return `${period}${count}枚の新しい写真があります。何年後も見返したい写真を選びませんか？`;
  }
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
  const label = reminderFrequencyLabel(settings.reminder_frequency, settings.language);
  Alert.alert(
    settings.language === 'en' ? 'Turn on reminders?' : settings.language === 'ja' ? 'リマインダーをオンにしますか？' : '알림으로 알려드릴까요?',
    reminderPromptMessage(settings.language, label, settings.reminder_time),
    [
      { text: settings.language === 'en' ? 'Not now' : settings.language === 'ja' ? '今はしない' : '괜찮아요', style: 'cancel' },
      {
        text: settings.language === 'en' ? 'Turn on' : settings.language === 'ja' ? 'オンにする' : '알려 주세요',
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
  const { language } = await getSettings(db);
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) {
    Alert.alert(notificationDisabledTitle(language), notificationDisabledMessage(language), [
      { text: language === 'en' ? 'Cancel' : language === 'ja' ? 'キャンセル' : '취소', style: 'cancel' },
      { text: language === 'en' ? 'Open Settings' : language === 'ja' ? '設定を開く' : '설정 열기', onPress: () => Linking.openSettings() },
    ]);
    return;
  }
  await setReminderEnabled(db, true);
}

function reminderPromptMessage(language: AppLanguage, frequency: string, time: string) {
  const formattedTime = formatReminderTime(time, language);
  if (language === 'en') return `We’ll remind you at ${formattedTime} ${frequency.toLowerCase()} when it may be time to review new photos. You can change this anytime in Settings.`;
  if (language === 'ja') return `${frequency}、${formattedTime}に新しい写真を選ぶ頃をお知らせします。設定からいつでも変更できます。`;
  return `${frequency} ${formattedTime}에 새로 찍은 사진을 고를 때가 되었다고 알려드려요. 설정에서 언제든 바꿀 수 있어요.`;
}

function notificationDisabledTitle(language: AppLanguage) {
  return language === 'en' ? 'Notifications are off' : language === 'ja' ? '通知がオフです' : '알림이 꺼져 있어요';
}

function notificationDisabledMessage(language: AppLanguage) {
  return language === 'en' ? 'Allow Keepsake notifications in your device settings.' : language === 'ja' ? '端末の設定でKeepsakeの通知を許可してください。' : '휴대폰 설정에서 Keepsake 알림을 허용해 주세요.';
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
export function formatReminderTime(time: string, language: 'ko' | 'en' | 'ja' = 'ko') {
  const [hours, minutes] = time.split(':').map(Number);
  if (language !== 'ko') {
    const locale = language === 'ja' ? 'ja-JP' : 'en-US';
    const date = new Date(2000, 0, 1, hours, minutes);
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
  }
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
