import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyChange } from '@/db/changes';

// settings 테이블은 key-value. 값은 JSON 문자열로 저장한다.
export type GridColumns = 1 | 2 | 3;

export type Settings = {
  daily_recommended_count: number;
  wifi_only_upload: boolean;
  last_exported_at: string | null;
  /** 고르기 화면에서 한 줄에 보여줄 사진 수 */
  pick_grid_columns: GridColumns;
  /**
   * 여기까지 찍은 사진은 이미 살펴봤다는 표시(ISO 시각). 고르기 화면은 이 뒤의 사진만 보여준다.
   * null이면 아직 어디서부터 볼지 정하지 않은 상태(처음 실행).
   */
  review_cursor: string | null;
};

export const DEFAULT_SETTINGS: Settings = {
  daily_recommended_count: 3,
  wifi_only_upload: true,
  last_exported_at: null,
  pick_grid_columns: 3,
  review_cursor: null,
};

export const RECOMMENDED_COUNT_RANGE = { min: 1, max: 10 } as const;
export const GRID_COLUMN_OPTIONS: readonly GridColumns[] = [1, 2, 3];

export async function getSettings(db: SQLiteDatabase): Promise<Settings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM settings',
  );
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
  last_exported_at: isIsoOrNull,
  pick_grid_columns: (v) => GRID_COLUMN_OPTIONS.includes(v as GridColumns),
  review_cursor: isIsoOrNull,
};

export async function setSetting<K extends keyof Settings>(
  db: SQLiteDatabase,
  key: K,
  value: Settings[K],
) {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
  notifyChange();
}
