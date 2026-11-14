import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BUNDLE_ID = 'com.atelierlabs.keepsake';
const SYSTEM_LANGUAGES = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP' } as const;

/** 시스템 언어(AppleLanguages)를 돌려준다. 캡처가 끝나면 이 값으로 되돌린다. */
export function readSystemLanguages() {
  try {
    const output = execFileSync('xcrun', ['simctl', 'spawn', 'booted', 'defaults', 'read', '-g', 'AppleLanguages'], { encoding: 'utf8' });
    // ( "ko-KR", "en-KR" ) 모양의 plist 배열을 줄 단위로 읽는다.
    return output.split('\n').map((line) => line.trim().replace(/,$/, '').replace(/^"|"$/g, '')).filter((line) => line && line !== '(' && line !== ')');
  } catch {
    return null;
  }
}

/** 지도 지명처럼 앱 밖(MapKit)이 그리는 글자는 previewLanguage가 아니라 시스템 언어를 따른다. 앱을 다시 켜야 반영된다. */
export function setSystemLanguages(languages: string[]) {
  execFileSync('xcrun', ['simctl', 'spawn', 'booted', 'defaults', 'write', '-g', 'AppleLanguages', '-array', ...languages]);
}

export function setSystemLanguage(locale: keyof typeof SYSTEM_LANGUAGES) {
  setSystemLanguages([SYSTEM_LANGUAGES[locale]]);
}

/** 앨범 ID는 데모를 만들 때마다 바뀌므로, 슬라이드 경로의 {album:제목}을 시뮬레이터 DB에서 찾은 ID로 바꾼다. */
export function resolveRoute(route: string) {
  return route
    .replace(/\{album:([^}]+)\}/g, (_, title: string) => albumId(title))
    .replace(/\{shared:([^}]+)\}/g, (_, title: string) => sharedAlbumId(title));
}

/** 공유 앨범은 서버에만 이름이 있어 로컬 개발 서버의 Postgres(docker compose)에서 찾는다. */
function sharedAlbumId(title: string) {
  const sql = `SELECT id FROM shared_albums WHERE title = '${title.replace(/'/g, "''")}' AND owner_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`;
  const id = execFileSync('docker', ['compose', '-f', resolve(import.meta.dirname, '../docker-compose.yml'), 'exec', '-T', 'postgres', 'psql', '-U', 'keepsake', '-tAc', sql], { encoding: 'utf8' }).trim();
  if (!id) throw new Error(`로컬 서버에 '${title}' 공유 앨범이 없습니다. README의 데모 구성과 make demo-family를 먼저 실행하세요.`);
  return id;
}

function albumId(title: string) {
  const container = execFileSync('xcrun', ['simctl', 'get_app_container', 'booted', BUNDLE_ID, 'data'], { encoding: 'utf8' }).trim();
  const dir = resolve(container, 'Documents/SQLite');
  // 로그인한 계정마다 DB가 따로 있다. 이름이 같은 앨범이 여러 DB에 있으면 가장 최근에 만든 것(지금 데모)을 쓴다.
  const sql = `SELECT created_at, id FROM albums WHERE kind = 'custom' AND deleted_at IS NULL AND title = '${title.replace(/'/g, "''")}' ORDER BY created_at DESC LIMIT 1`;
  const found = readdirSync(dir)
    .filter((name) => /^keepsake.*\.db$/.test(name))
    .map((name) => {
      // 지금 열려 있지 않은 예전 계정 DB(-shm 없음)는 읽기 전용으로 열리지 않는다. 데모가 있는 DB는 앱이 열어 둔 DB다.
      try {
        return execFileSync('sqlite3', ['-separator', '\t', `file:${resolve(dir, name)}?mode=ro`, sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!found) throw new Error(`시뮬레이터에 '${title}' 앨범이 없습니다. README의 데모 구성(storeCapture=1&storeReset=1)을 먼저 실행하세요.`);
  return found.split('\t')[1];
}

export function bootedUdid() {
  const output = execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted'], { encoding: 'utf8' });
  if (!/\(Booted\)/.test(output)) throw new Error('부팅된 iOS 시뮬레이터가 없습니다. 앱을 설치한 시뮬레이터를 먼저 실행하세요.');
}
export function terminate() { try { execFileSync('xcrun', ['simctl', 'terminate', 'booted', BUNDLE_ID]); } catch {} }
export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Development Client에는 Metro 프로젝트 URL만 넘긴다. Router 경로를 여기에 붙이면
 * 그 경로를 manifest URL로 해석해 "There was a problem loading the project"가 난다. */
export function launchDevelopmentBuild() {
  const devServer = (process.env.CAPTURE_DEV_SERVER_URL ?? 'http://localhost:18082').replace(/\/$/, '');
  const url = `keepsake://expo-development-client/?url=${encodeURIComponent(devServer)}`;
  console.log(`→ Development Build: ${url}`);
  execFileSync('xcrun', ['simctl', 'openurl', 'booted', url], { stdio: 'inherit' });
}

function appUrl(route: string, locale: string) {
  const join = route.includes('?') ? '&' : '?';
  const appRoute = `${route}${join}previewLanguage=${encodeURIComponent(locale)}&storeCapture=1`;

  // 프로젝트가 이미 로드된 Development Build와 preview/production 빌드 모두에서
  // 앱 scheme은 Expo Router 화면 전환용으로만 쓴다.
  return `keepsake://${appRoute}`;
}

export async function capture(rawDir: string, route: string, rawFile: string, locale: string, delayMs: number) {
  const url = appUrl(resolveRoute(route), locale);
  console.log(`→ ${url}`);
  execFileSync('xcrun', ['simctl', 'openurl', 'booted', url], { stdio: 'inherit' });
  await sleep(delayMs);
  execFileSync('xcrun', ['simctl', 'io', 'booted', 'screenshot', resolve(rawDir, rawFile)], { stdio: 'inherit' });
}
