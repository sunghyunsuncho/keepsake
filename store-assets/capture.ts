import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSlides, STORE_LOCALES, type StoreLocale } from './slides.ts';
import { bootedUdid, capture, launchDevelopmentBuild, readSystemLanguages, setSystemLanguage, setSystemLanguages, sleep, terminate } from './simctl.ts';

const requested = process.argv.find((arg) => arg.startsWith('--locale='))?.split('=')[1] ?? 'all';
if (requested !== 'all' && !STORE_LOCALES.includes(requested as StoreLocale)) throw new Error('--locale는 ko, en, ja, all 중 하나여야 합니다.');
const locales = requested === 'all' ? STORE_LOCALES : [requested as StoreLocale];
const delay = Number(process.env.CAPTURE_DELAY_MS ?? 1800);
// Development Build의 첫 URL은 Metro 연결·JS 번들 로딩까지 끝난 뒤 찍어야 한다.
// 이후 화면은 이미 실행 중이므로 일반 화면 전환 대기만 적용한다.
const startupDelay = Number(process.env.CAPTURE_STARTUP_DELAY_MS ?? 10000);

async function assertDevServer() {
  if (process.env.CAPTURE_USE_APP_SCHEME === '1') return;
  // npm start는 18082를 쓰지만, `npx expo start`의 기본 포트 8081도 흔하다.
  // 명시값이 있으면 그것만 존중하고, 없으면 두 개발 포트를 안전하게 탐색한다.
  const configured = process.env.CAPTURE_DEV_SERVER_URL;
  const candidates = configured ? [configured] : ['http://localhost:18082', 'http://localhost:8081'];
  for (const candidate of candidates) {
    const url = candidate.replace(/\/$/, '');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) continue;
      process.env.CAPTURE_DEV_SERVER_URL = url;
      console.log(`Metro 서버: ${url}`);
      return;
    } catch {
      // 다음 후보를 확인한다.
    }
  }
  const expected = configured ?? 'http://localhost:18082 또는 http://localhost:8081';
  throw new Error(`Metro 개발 서버에 연결할 수 없습니다: ${expected}\n다른 터미널에서 'cd mobile && npm start'를 실행하거나 CAPTURE_DEV_SERVER_URL을 올바른 주소로 지정하세요.`);
}

await assertDevServer();
bootedUdid();
const systemLanguages = readSystemLanguages();
try {
  for (const locale of locales) {
    const rawDir = resolve(import.meta.dirname, 'raw', locale === 'ko' ? '' : locale);
    mkdirSync(rawDir, { recursive: true });
    terminate();
    // 지도 지명은 시스템 언어를 따르므로 앱을 다시 켜기 전에 맞춘다.
    setSystemLanguage(locale);
    if (process.env.CAPTURE_USE_APP_SCHEME !== '1') {
      // Metro bundle을 먼저 연 뒤 앱 scheme으로 Router 화면을 이동한다.
      launchDevelopmentBuild();
      await sleep(startupDelay);
    }
    for (const slide of getSlides(locale)) {
      await capture(rawDir, slide.route, slide.rawFile, locale, slide.delayMs ?? delay);
    }
    console.log(`✓ ${locale} 캡처 완료: ${rawDir}`);
  }
} finally {
  if (systemLanguages?.length) setSystemLanguages(systemLanguages);
}
