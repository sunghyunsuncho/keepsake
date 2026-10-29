import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'keepsake.db';

// 스키마를 바꾸면 MIGRATIONS에 항목을 추가한다. 이미 배포된 항목은 수정하지 않는다.
// 동기화 규칙(docs/PLAN.md §3.2): ID는 클라이언트 UUID, 모든 행에 updated_at, 삭제는 deleted_at.
// 시각은 모두 ISO 8601 UTC 문자열(`toISOString()`)이라 문자열 비교로 정렬된다.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE moments (
    id TEXT PRIMARY KEY NOT NULL,
    source_asset_id TEXT,
    local_original_path TEXT,
    local_display_path TEXT NOT NULL,
    original_filename TEXT,
    width INTEGER,
    height INTEGER,
    taken_at TEXT NOT NULL,
    lat REAL,
    lng REAL,
    place_name TEXT,
    memo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    sync_state TEXT NOT NULL DEFAULT 'local_only',
    original_uploaded INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX moments_taken_at ON moments (taken_at) WHERE deleted_at IS NULL;
  CREATE INDEX moments_source_asset ON moments (source_asset_id) WHERE deleted_at IS NULL;

  CREATE TABLE albums (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE album_moments (
    album_id TEXT NOT NULL,
    moment_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (album_id, moment_id)
  );

  CREATE TABLE review_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    date TEXT NOT NULL UNIQUE,
    reviewed_at TEXT NOT NULL,
    selected_count INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE upload_queue (
    moment_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    PRIMARY KEY (moment_id, variant)
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
  // 2: 촬영지 시간대 (UTC 기준 분). NULL이면 기기 시간대로 보여준다.
  `
  ALTER TABLE moments ADD COLUMN taken_tz_offset INTEGER;
  `,
  // 3: 업로드 재시도 간격 (Cloud)
  `
  ALTER TABLE upload_queue ADD COLUMN next_attempt_at TEXT;
  ALTER TABLE upload_queue ADD COLUMN created_at TEXT;
  `,
  // 4: Cloud 동기화. 표시용 사진 업로드 여부와, moments 외 테이블의 동기화 상태.
  `
  ALTER TABLE moments ADD COLUMN display_uploaded INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE review_sessions ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local_only';
  ALTER TABLE albums ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local_only';
  ALTER TABLE album_moments ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local_only';
  `,
];

export async function migrateDb(db: SQLiteDatabase) {
  // busy_timeout: 가져오기처럼 별도 연결에서 쓰는 동안 기본 연결의 쓰기가 바로 실패하지 않고 기다리게 한다.
  await db.execAsync(`PRAGMA journal_mode = 'wal'; PRAGMA busy_timeout = 5000;`);
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let version = current; version < MIGRATIONS.length; version++) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(MIGRATIONS[version]);
      // PRAGMA는 바인딩 파라미터를 받지 않는다. version은 내부 정수라 안전하다.
      await txn.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}
