import { chromium } from 'playwright';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSlides, STORE_LOCALES, type StoreLocale } from './slides.ts';
import { IOS_SIZE, PLAY_SIZE, renderSlide } from './render.ts';

const target = process.argv.find((arg) => arg.startsWith('--target='))?.split('=')[1] ?? 'play';
const requested = process.argv.find((arg) => arg.startsWith('--locale='))?.split('=')[1] ?? 'all';
if (!['play', 'ios', 'all'].includes(target)) throw new Error('--target는 play, ios, all 중 하나여야 합니다.');
if (requested !== 'all' && !STORE_LOCALES.includes(requested as StoreLocale)) throw new Error('--locale는 ko, en, ja, all 중 하나여야 합니다.');
const locales = requested === 'all' ? STORE_LOCALES : [requested as StoreLocale];
const root = import.meta.dirname;
const storeLocale = (locale: StoreLocale) => locale === 'en' ? 'en-US' : locale;
const rawDir = (locale: StoreLocale) => resolve(root, 'raw', locale === 'ko' ? '' : locale);
const outputDir = (locale: StoreLocale, kind: 'play' | 'ios') => resolve(root, 'output', kind === 'play' ? 'playstore' : 'appstore', locale === 'ko' ? '' : storeLocale(locale), kind === 'ios' ? '6.5-inch' : '');

for (const locale of locales) for (const slide of getSlides(locale)) if (!existsSync(resolve(rawDir(locale), slide.rawFile))) throw new Error(`캡처 원본이 없습니다: raw/${locale}/${slide.rawFile}. 먼저 npm run capture를 실행하세요.`);
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); const tmp = resolve(root, '.tmp'); mkdirSync(tmp, { recursive: true });
  for (const locale of locales) for (const [kind, size] of [['play', PLAY_SIZE], ['ios', IOS_SIZE]] as const) {
    if (target !== 'all' && target !== kind) continue;
    const out = outputDir(locale, kind); mkdirSync(out, { recursive: true });
    const slides = getSlides(locale);
    for (const slide of slides) { const html = renderSlide(slide, resolve(rawDir(locale), slide.rawFile), slides.length, size); const file = resolve(tmp, `${kind}-${locale}-${slide.no}.html`); writeFileSync(file, html); await page.setViewportSize(size); await page.goto(`file://${file}`); await page.screenshot({ path: resolve(out, `${slide.no}.png`) }); }
    console.log(`✓ ${kind}/${storeLocale(locale)}: ${out}`);
  }
} finally { await browser.close(); rmSync(resolve(root, '.tmp'), { recursive: true, force: true }); }
