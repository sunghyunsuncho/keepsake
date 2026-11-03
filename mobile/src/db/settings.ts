import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyChange } from '@/db/changes';

// settings 테이블은 key-value. 값은 JSON 문자열로 저장한다.
// 설정은 기기에 하나다: 계정을 바꿔도 알림·고르기 지점이 달라지지 않게 항상 Local DB에 둔다.
// 동기화 상태(ACCOUNT_KEYS)만 그 계정 공간의 DB에 둔다.
export type GridColumns = 1 | 2 | 3;

export type Settings = {
  daily_recommended_count: number;
  wifi_only_upload: boolean;
  /** 고르기 화면에서 한 줄에 보여줄 사진 수 */
  pick_grid_columns: GridColumns;
  /**
   * 여기까지 찍은 사진은 이미 살펴봤다는 표시(ISO 시각). 고르기 화면은 이 뒤의 사진만 보여준다.
   * null이면 아직 어디서부터 볼지 정하지 않은 상태(처음 실행).
   */
  review_cursor: string | null;
  /** 서버에서 어디까지 받았는지 (서버가 매기는 변경 번호). 기기별 값이다. */
  cloud_pull_cursor: number;
  /**
   * 이 계정 공간이 맞춰진 서버 데이터 세대("user_id:generation").
   * 바뀌면(유예 만료로 서버 데이터 삭제) 공간을 비운다.
   */
  cloud_account_key: string | null;
  /** 이 계정 공간에서 기기 사진 연결을 되살리는 일을 마쳤는지 */
  cloud_links_restored: boolean;
  /** 서버 데이터가 지워져 파일을 지울 계정 공간의 user_id */
  retired_spaces: string[];
  /** 남길 기록을 Local로 옮기는 중인 계정 공간의 user_id. 실패하면 다음 실행 때 다시 옮긴다. */
  retiring_spaces: string[];
  /** 마지막으로 [남기기]나 [여기까지 봤어요]를 누른 시각. 고르기 알림의 기준이다. */
  last_reviewed_at: string | null;
  reminder_enabled: boolean;
  /** 고르기 알림 시각 "HH:MM" (기기 시간대) */
  reminder_time: string;
  reminder_frequency: ReminderFrequency;
  /** 처음 [남기기]를 마친 뒤 알림을 받을지 이미 물어봤는지 */
  reminder_prompted: boolean;
  /** 고르기 지점보다 이전 시각으로 나중에 들어온 사진(놓친 사진)의 asset id */
  missed_photo_ids: string[];
  /**
   * 놓친 사진을 찾는 기준: 지점(cursor) 이전에 찍은 사진이 마지막 확인(checked_at, ms) 때 몇 장이었는지.
   * 지점이 바뀌면 다시 센다.
   */
  missed_baseline: { cursor: string; count: number; checked_at: number } | null;
  /** 앨범을 얼마나 당겨서 볼지. 마지막으로 본 단계를 기억한다. */
  album_zoom: AlbumZoom;
  /** '몇 년 전 오늘'을 닫은 날 ("YYYY-MM-DD"). 그날은 다시 보여주지 않는다. */
  on_this_day_hidden: string | null;
};

export type ReminderFrequency = 'daily' | 'every_2_days' | 'weekly';
export const REMINDER_FREQUENCIES: readonly ReminderFrequency[] = ['daily', 'every_2_days', 'weekly'];

/** 넓게 → 가깝게: 해마다 몇 장, 달마다 전체, 날마다 크게, 메모와 함께 한 장씩 */
export type AlbumZoom = 'year' | 'month' | 'day' | 'story';
export const ALBUM_ZOOMS: readonly AlbumZoom[] = ['year', 'month', 'day', 'story'];

export const DEFAULT_SETTINGS: Settings = {
  daily_recommended_count: 3,
  wifi_only_upload: true,
  pick_grid_columns: 3,
  review_cursor: null,
  cloud_pull_cursor: 0,
  cloud_account_key: null,
  cloud_links_restored: false,
  retired_spaces: [],
  retiring_spaces: [],
  last_reviewed_at: null,
  reminder_enabled: false,
  reminder_time: '21:00',
  reminder_frequency: 'every_2_days',
  reminder_prompted: false,
  missed_photo_ids: [],
  missed_baseline: null,
  album_zoom: 'month',
  on_this_day_hidden: null,
};

export const RECOMMENDED_COUNT_RANGE = { min: 1, max: 10 } as const;
export const GRID_COLUMN_OPTIONS: readonly GridColumns[] = [1, 2, 3];

const ACCOUNT_KEYS: readonly (keyof Settings)[] = [
  'cloud_pull_cursor',
  'cloud_account_key',
  'cloud_links_restored',
];

let deviceDb: SQLiteDatabase | null = null;

/** 기기 설정을 둘 Local DB 연결. 앱을 시작할 때 db/spaces.ts가 정한다. */
export function setDeviceDb(db: SQLiteDatabase) {
  deviceDb = db;
}

export async function getSettings(db: SQLiteDatabase): Promise<Settings> {
  const accountKeys = ACCOUNT_KEYS.map((key) => `'${key}'`).join(', ');
  const [deviceRows, accountRows] = await Promise.all([
    (deviceDb ?? db).getAllAsync<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key NOT IN (${accountKeys})`,
    ),
    db.getAllAsync<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key IN (${accountKeys})`,
    ),
  ]);
  const rows = [...deviceRows, ...accountRows];
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!(key in VALIDATORS)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue; // 깨진 값은 기본값으로 둔다.
    }
    if (VALIDATORS[key as keyof Settings](parsed)) {
      (settings as Record<string, unknown>)[key] = parsed;
    }
  }
  return settings;
}

const isIsoOrNull = (v: unknown) =>
  v === null || (typeof v === 'string' && !Number.isNaN(new Date(v).getTime()));

// 저장된 값이 깨졌거나 이전 버전 형식이면 기본값을 쓴다 (화면 계산이 NaN이 되지 않도록).
const VALIDATORS: Record<keyof Settings, (value: unknown) => boolean> = {
  daily_recommended_count: (v) =>
    Number.isInteger(v) &&
    (v as number) >= RECOMMENDED_COUNT_RANGE.min &&
    (v as number) <= RECOMMENDED_COUNT_RANGE.max,
  wifi_only_upload: (v) => typeof v === 'boolean',
  pick_grid_columns: (v) => GRID_COLUMN_OPTIONS.includes(v as GridColumns),
  review_cursor: isIsoOrNull,
  cloud_pull_cursor: (v) => Number.isInteger(v) && (v as number) >= 0,
  cloud_account_key: (v) => v === null || typeof v === 'string',
  cloud_links_restored: (v) => typeof v === 'boolean',
  retired_spaces: (v) => Array.isArray(v) && v.every((id) => typeof id === 'string'),
  retiring_spaces: (v) => Array.isArray(v) && v.every((id) => typeof id === 'string'),
  last_reviewed_at: isIsoOrNull,
  reminder_enabled: (v) => typeof v === 'boolean',
  reminder_time: (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  reminder_frequency: (v) => REMINDER_FREQUENCIES.includes(v as ReminderFrequency),
  reminder_prompted: (v) => typeof v === 'boolean',
  missed_photo_ids: (v) => Array.isArray(v) && v.every((id) => typeof id === 'string'),
  missed_baseline: (v) => {
    if (v === null) return true;
    const b = v as Record<string, unknown>;
    return (
      typeof b === 'object' &&
      typeof b.cursor === 'string' &&
      Number.isInteger(b.count) &&
      typeof b.checked_at === 'number'
    );
  },
  album_zoom: (v) => ALBUM_ZOOMS.includes(v as AlbumZoom),
  on_this_day_hidden: (v) => v === null || typeof v === 'string',
};

export async function setSetting<K extends keyof Settings>(
  db: SQLiteDatabase,
  key: K,
  value: Settings[K],
) {
  const target = ACCOUNT_KEYS.includes(key) ? db : (deviceDb ?? db);
  await target.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
  notifyChange();
}
