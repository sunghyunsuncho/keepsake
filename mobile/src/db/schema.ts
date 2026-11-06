import { Directory, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'keepsake.db';

/** 계정 Cloud의 기기 사본. 계정마다 파일이 따로 있어 기록이 섞이지 않는다 (db/spaces.ts). */
export function accountDatabaseName(userId: string) {
  return `keepsake-account-${userId}.db`;
}
export const ACCOUNT_DATABASE_PATTERN = /^keepsake-account-[^/]+\.db$/;

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
  // 5: 사진을 앱에 복사하지 않고 기기 사진첩 원본을 가리킨다 (docs/PLAN.md §0 '사진 보관').
  // source_uri: 사진첩 사진을 그릴 주소. source_missing: 사진첩에서 원본을 찾지 못함 (지워진 사진).
  // 둘 다 source_asset_id처럼 이 기기에서만 의미가 있어 동기화하지 않는다.
  `
  ALTER TABLE moments DROP COLUMN local_original_path;
  ALTER TABLE moments DROP COLUMN local_display_path;
  ALTER TABLE moments ADD COLUMN source_uri TEXT;
  ALTER TABLE moments ADD COLUMN source_missing INTEGER NOT NULL DEFAULT 0;
  `,
  // 6: 계정 공간. source_link_synced: 사진첩 연결을 서버에 보냈는지. local_imports: 이 계정에 물어본 Local 기록.
  `
  ALTER TABLE moments ADD COLUMN source_link_synced INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE local_imports (
    local_moment_id TEXT PRIMARY KEY NOT NULL,
    decision TEXT NOT NULL,
    decided_at TEXT NOT NULL
  );
  `,
  // 7: 사진 정리가 파일 이름으로 남긴 사진을 찾는다.
  `
  CREATE INDEX idx_moments_original_filename ON moments(original_filename) WHERE deleted_at IS NULL;
  `,
  // 8: 앨범 표지. 최신 사진, 앨범 안의 특정 사진, 기본 이모지 디자인 중 하나를 고른다.
  `
  ALTER TABLE albums ADD COLUMN cover_mode TEXT NOT NULL DEFAULT 'latest';
  ALTER TABLE albums ADD COLUMN cover_moment_id TEXT;
  ALTER TABLE albums ADD COLUMN cover_emoji TEXT;
  `,
  // 9: 안전 앨범 (kind 'cloud'). photo_quality: 'original'(원본 + 표시용) | 'display'(표시용만).
  // source_album_id: 기기 앨범을 연결해 만든 안전 앨범이면 그 기기 앨범. 기기 앨범에 넣은 사진을 따라 담는다.
  `
  ALTER TABLE albums ADD COLUMN photo_quality TEXT;
  ALTER TABLE albums ADD COLUMN source_album_id TEXT;
  `,
  // 10: 받은 알림 내역 (알림 화면). 기기 설정처럼 Local DB에만 쓴다 (db/notifications.ts).
  `
  CREATE TABLE notification_log (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT,
    received_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX notification_log_received ON notification_log (received_at);
  `,
  // 11: 안전 사진첩 목록·업로드 후보는 moment_id로 앨범 연결을 자주 찾는다.
  // 기본키(album_id, moment_id)는 이 방향의 EXISTS 조회를 돕지 못하므로 활성 연결 전용 인덱스를 둔다.
  `
  CREATE INDEX idx_album_moments_moment_active
    ON album_moments (moment_id, album_id) WHERE deleted_at IS NULL;
  `,
];

export async function migrateDb(db: SQLiteDatabase) {
  // Fast Refresh·공간 전환 때 이전 연결이 WAL 정리를 끝내기 전이면 PRAGMA/ALTER가 잠깐 잠긴다.
  // 마이그레이션은 멱등적으로 user_version을 올리므로, 짧게 기다렸다 같은 작업을 다시 시도해도 안전하다.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await migrateDbOnce(db);
      return;
    } catch (error) {
      const locked = /database is locked|database is busy|SQLITE_BUSY/i.test(String(error));
      if (!locked || attempt === 4) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
}

async function migrateDbOnce(db: SQLiteDatabase) {
  // busy_timeout: 다른 연결이 쓰는 동안 기본 연결의 쓰기가 바로 실패하지 않고 기다리게 한다.
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
  // 4까지 앱 안에 두던 사진 사본(<document>/library). 5부터 쓰지 않는다.
  if (current < 5) {
    try {
      const legacy = new Directory(Paths.document, 'library');
      if (legacy.exists) legacy.delete();
    } catch {
      // 지우지 못해도 앱은 열려야 한다. 쓰지 않는 파일이 남을 뿐이다.
    }
  }
}
