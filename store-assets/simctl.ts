import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export function bootedUdid() {
  const output = execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted'], { encoding: 'utf8' });
  if (!/\(Booted\)/.test(output)) throw new Error('부팅된 iOS 시뮬레이터가 없습니다. 앱을 설치한 시뮬레이터를 먼저 실행하세요.');
}
export function terminate() { try { execFileSync('xcrun', ['simctl', 'terminate', 'booted', 'com.atelierlabs.keepsake']); } catch {} }
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
  const url = appUrl(route, locale);
  console.log(`→ ${url}`);
  execFileSync('xcrun', ['simctl', 'openurl', 'booted', url], { stdio: 'inherit' });
  await sleep(delayMs);
  execFileSync('xcrun', ['simctl', 'io', 'booted', 'screenshot', resolve(rawDir, rawFile)], { stdio: 'inherit' });
}
