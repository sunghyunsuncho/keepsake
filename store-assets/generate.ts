import { chromium, type Page } from 'playwright';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSlides, STORE_LOCALES, type StoreLocale } from './slides.ts';
import { FEATURE_GRAPHIC_SIZE, IOS_SIZE, PLAY_SIZE, renderFeatureGraphic, renderSlide, type FeatureGraphicContent } from './render.ts';

const target = process.argv.find((arg) => arg.startsWith('--target='))?.split('=')[1] ?? 'play';
const requested = process.argv.find((arg) => arg.startsWith('--locale='))?.split('=')[1] ?? 'all';
// 스크린샷은 건드리지 않고 Play 그래픽 이미지만 다시 만든다(캡처 원본 불필요).
const featureGraphicOnly = process.argv.includes('--feature-graphic-only');
if (!['play', 'ios', 'all'].includes(target)) throw new Error('--target는 play, ios, all 중 하나여야 합니다.');
if (requested !== 'all' && !STORE_LOCALES.includes(requested as StoreLocale)) throw new Error('--locale는 ko, en, ja, all 중 하나여야 합니다.');
if (featureGraphicOnly && target === 'ios') throw new Error('--feature-graphic-only는 --target=play 또는 --target=all과 함께 사용해야 합니다.');
const locales = requested === 'all' ? STORE_LOCALES : [requested as StoreLocale];
const runPlay = target !== 'ios';
const root = import.meta.dirname;
// 공개 웹은 atelierlabs 저장소에 있다. 두 저장소가 같은 폴더에 나란히 있다고 보고, 다른 곳이면 ATELIERLABS_DIR로 지정한다.
const atelierlabsDir = process.env.ATELIERLABS_DIR ?? resolve(root, '../../atelierlabs');
const webSiteDir = resolve(atelierlabsDir, 'sites/keepsake');
const storeLocale = (locale: StoreLocale) => locale === 'en' ? 'en-US' : locale;
const rawDir = (locale: StoreLocale) => resolve(root, 'raw', locale === 'ko' ? '' : locale);
const outputDir = (locale: StoreLocale, kind: 'play' | 'ios') => resolve(root, 'output', kind === 'play' ? 'playstore' : 'appstore', locale === 'ko' ? '' : storeLocale(locale), kind === 'ios' ? '6.5-inch' : '');
// 공개 웹에서 앱 화면을 보여주는 곳: Keepsake 홈페이지의 "앱을 미리 둘러보세요" 갤러리와 Atelier Labs 홈페이지의 앱 소개.
// Play 스크린샷을 줄인 JPEG를 ko는 폴더 바로 아래, en·ja는 <언어>/ 아래에 둔다.
const webScreensDirs = (locale: StoreLocale) => [resolve(webSiteDir, 'assets/screens'), resolve(atelierlabsDir, 'sites/atelierlabs/assets/apps/keepsake')]
  .map((dir) => resolve(dir, locale === 'ko' ? '' : locale));
const WEB_SCREEN_SIZE = { width: 675, height: 1200 }; // index.html의 <img width height>와 맞춘다

async function syncWebScreen(page: Page, pngPath: string, jpgPath: string) {
  await page.setViewportSize(WEB_SCREEN_SIZE);
  await page.setContent(`<body style="margin:0"><img style="display:block;width:100%;height:100%" src="data:image/png;base64,${readFileSync(pngPath).toString('base64')}"></body>`, { waitUntil: 'load' });
  await page.screenshot({ path: jpgPath, type: 'jpeg', quality: 86 });
}

// 그래픽 이미지는 같은 언어 Keepsake 홈페이지(ko는 index.html, en·ja는 <언어>/index.html) 상단 히어로를
// 그대로 옮긴다. 첫 번째 배경 사진·아이콘·현지어 이름·워드마크·슬로건·설명 문구를 읽어, 웹 히어로가 바뀌면
// 다시 생성만 하면 따라가게 한다.
function readWebHero(locale: StoreLocale): FeatureGraphicContent {
  const htmlPath = resolve(webSiteDir, locale === 'ko' ? '' : locale, 'index.html');
  if (!existsSync(htmlPath)) throw new Error(`그래픽 이미지에 필요한 공개 웹 페이지가 없습니다: ${htmlPath}\nATELIERLABS_DIR을 확인하세요 (현재: ${atelierlabsDir}).`);
  const hero = readFileSync(htmlPath, 'utf8').match(/<div class="hero">([\s\S]*?)<div class="cta"/)?.[1];
  if (!hero) throw new Error(`${htmlPath}에서 히어로 영역을 찾지 못했습니다.`);
  const pick = (re: RegExp, what: string) => {
    const value = hero.match(re)?.[1]?.trim();
    if (value === undefined) throw new Error(`${htmlPath} 히어로에서 ${what}을(를) 찾지 못했습니다.`);
    return value;
  };
  // Chromium은 없는 file:// 이미지를 조용히 빈 칸으로 그리므로, 빈 그래픽이 만들어지기 전에 알린다.
  const toLocal = (src: string) => {
    const path = resolve(webSiteDir, src.replace(/^\//, '').split('?')[0]);
    if (!existsSync(path)) throw new Error(`그래픽 이미지에 필요한 공개 웹 자산이 없습니다: ${path}`);
    return path;
  };
  // 첫 슬라이드만 src가 바로 있고 나머지는 data-src로 늦게 불러온다.
  const reading = pick(/<p class="hero-reading"[^>]*>([\s\S]*?)<\/p>/, '현지어 이름').replace(/&nbsp;/g, '').trim();
  return {
    bgImagePath: toLocal(pick(/<img class="hero-slide[^"]*"[^>]*?\ssrc="([^"]+)"/, '첫 번째 히어로 이미지')),
    markPath: toLocal(pick(/<img class="hero-mark"[^>]*?\ssrc="([^"]+)"/, '히어로 아이콘')),
    reading: reading || undefined,
    title: pick(/<h1 class="hero-title">([\s\S]*?)<\/h1>/, '워드마크'),
    taglineHtml: pick(/<p class="hero-tagline">([\s\S]*?)<\/p>/, '슬로건'),
    lead: pick(/<p class="lead">([\s\S]*?)<\/p>/, '설명 문구'),
    lang: locale,
  };
}

if (!featureGraphicOnly) for (const locale of locales) for (const slide of getSlides(locale)) if (!existsSync(resolve(rawDir(locale), slide.rawFile))) throw new Error(`캡처 원본이 없습니다: raw/${locale}/${slide.rawFile}. 먼저 npm run capture를 실행하세요.`);
const webHeroes = runPlay ? new Map(locales.map((locale) => [locale, readWebHero(locale)])) : undefined;
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); const tmp = resolve(root, '.tmp'); mkdirSync(tmp, { recursive: true }); mkdirSync(resolve(root, 'output'), { recursive: true });
  for (const locale of locales) for (const [kind, size] of [['play', PLAY_SIZE], ['ios', IOS_SIZE]] as const) {
    if (target !== 'all' && target !== kind) continue;
    if (kind === 'ios' && featureGraphicOnly) continue;
    if (!featureGraphicOnly) {
      const out = outputDir(locale, kind); mkdirSync(out, { recursive: true });
      const slides = getSlides(locale);
      for (const slide of slides) { const html = renderSlide(slide, resolve(rawDir(locale), slide.rawFile), slides.length, size, locale); const file = resolve(tmp, `${kind}-${locale}-${slide.no}.html`); writeFileSync(file, html); await page.setViewportSize(size); await page.goto(`file://${file}`); await page.screenshot({ path: resolve(out, `${slide.no}.png`) }); }
      console.log(`✓ ${kind}/${storeLocale(locale)}: ${out}`);
      if (kind === 'play') {
        // 두 사이트가 같은 이미지를 쓰므로 한 번만 줄이고 나머지 폴더에는 복사한다.
        const [first, ...rest] = webScreensDirs(locale);
        for (const dir of [first, ...rest]) mkdirSync(dir, { recursive: true });
        for (const slide of slides) {
          const jpg = resolve(first, `${slide.no}.jpg`);
          await syncWebScreen(page, resolve(out, `${slide.no}.png`), jpg);
          for (const dir of rest) copyFileSync(jpg, resolve(dir, `${slide.no}.jpg`));
        }
        for (const dir of [first, ...rest]) console.log(`✓ web/${locale}: ${dir}`);
      }
    }
    if (kind === 'play') {
      // 한국어 기본 등록정보는 feature-graphic.png, 영어·일본어 번역 등록정보는 feature-graphic.<언어>.png.
      const name = locale === 'ko' ? 'feature-graphic.png' : `feature-graphic.${storeLocale(locale)}.png`;
      const file = resolve(tmp, `feature-graphic-${locale}.html`); writeFileSync(file, renderFeatureGraphic(webHeroes!.get(locale)!));
      await page.setViewportSize(FEATURE_GRAPHIC_SIZE); await page.goto(`file://${file}`, { waitUntil: 'load' }); await page.screenshot({ path: resolve(root, 'output', name) });
      console.log(`✓ ${name}`);
    }
  }
} finally { await browser.close(); rmSync(resolve(root, '.tmp'), { recursive: true, force: true }); }
