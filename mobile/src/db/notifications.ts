import { notifyChange } from '@/db/changes';
import { getLocalDb } from '@/db/spaces';

// 받은 알림 내역. 고르기 알림(로컬)과 안전 보관 알림(서버 푸시)을 함께 둔다.
// 계정을 바꿔도 같은 기기의 알림이므로 Local DB에만 쓴다. 오래된 내역은 쌓아 두지 않는다.

const KEEP = 100;

export type NotificationEntry = {
  id: string;
  title: string;
  body: string;
  /** 누르면 열 화면 ('/' 고르기, '/settings' 설정) */
  url: string | null;
  received_at: string;
  read_at: string | null;
};

/** 알림을 내역에 남긴다. 같은 알림(id)은 한 번만 남는다. */
export async function recordNotifications(entries: Omit<NotificationEntry, 'read_at'>[]) {
  if (entries.length === 0) return;
  const db = await getLocalDb();
  let added = 0;
  for (const entry of entries) {
    const result = await db.runAsync(
      'INSERT OR IGNORE INTO notification_log (id, title, body, url, received_at) VALUES (?, ?, ?, ?, ?)',
      entry.id,
      entry.title,
      entry.body,
      entry.url,
      entry.received_at,
    );
    added += result.changes;
  }
  if (added === 0) return;
  await db.runAsync(
    `DELETE FROM notification_log WHERE id NOT IN (
       SELECT id FROM notification_log ORDER BY received_at DESC LIMIT ${KEEP})`,
  );
  notifyChange();
}

export async function listNotifications() {
  const db = await getLocalDb();
  return db.getAllAsync<NotificationEntry>('SELECT * FROM notification_log ORDER BY received_at DESC');
}

export async function countUnreadNotifications() {
  const db = await getLocalDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM notification_log WHERE read_at IS NULL',
  );
  return row?.count ?? 0;
}

export async function markNotificationsRead() {
  const db = await getLocalDb();
  const result = await db.runAsync(
    'UPDATE notification_log SET read_at = ? WHERE read_at IS NULL',
    new Date().toISOString(),
  );
  if (result.changes > 0) notifyChange();
}
