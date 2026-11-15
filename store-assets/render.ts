import type { Slide } from './slides.ts';
import { pathToFileURL } from 'node:url';

export const PLAY_SIZE = { width: 1620, height: 2880 };
export const IOS_SIZE = { width: 1242, height: 2688 };
// Vernissage 스토어 스크린샷과 같은 거의 흰 단색 배경. 공개 웹 갤러리에서도 두 앱이 같은 톤으로 보인다.
const SLIDE_BACKGROUND = '#F7F7F8';
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function renderSlide(slide: Slide, rawPath: string, total: number, size: { width: number; height: number }, lang: string) {
  const scale = Math.min(size.width / PLAY_SIZE.width, size.height / PLAY_SIZE.height);
  const px = (n: number) => Math.round(n * scale);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;background:${SLIDE_BACKGROUND};font-family:-apple-system,BlinkMacSystemFont,${lang === 'ja' ? '"Hiragino Sans","Noto Sans JP",' : ''}"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#171A1E}
    .canvas{width:${size.width}px;height:${size.height}px;padding:${px(120)}px ${px(90)}px ${px(90)}px;display:flex;flex-direction:column;background:${SLIDE_BACKGROUND}}
    .number{font-size:${px(34)}px;letter-spacing:.16em;color:#CD5837;font-weight:700}.title{font-size:${px(74)}px;line-height:1.22;font-weight:600;margin-top:${px(36)}px}.accent{font-size:${px(104)}px;line-height:1.14;font-weight:800;margin-top:${px(12)}px;color:#16212B;letter-spacing:-.035em}.desc{font-size:${px(44)}px;line-height:1.42;color:#5F6A75;margin-top:${px(30)}px}
    :lang(ko) :is(.title,.accent,.desc){word-break:keep-all} :lang(ja) :is(.title,.accent,.desc){word-break:auto-phrase}
    /* 휴대폰은 문구 아래 남은 높이를 모두 쓴다. 폭은 화면 비율로 정해지고 가운데 둔다. */
    .stage{flex:1;min-height:0;display:flex;justify-content:center;margin-top:${px(64)}px}
    .phone{height:100%;max-width:100%;aspect-ratio:1290/2796;padding:${px(14)}px;border-radius:${px(84)}px;background:#16191D;box-shadow:0 ${px(32)}px ${px(80)}px rgba(22,33,43,.25);overflow:hidden}.phone img{width:100%;height:100%;display:block;object-fit:cover;border-radius:${px(70)}px}
  </style></head><body><main class="canvas"><div class="number">${slide.no} / ${String(total).padStart(2, '0')}</div><div class="title">${escape(slide.title)}</div><div class="accent">${escape(slide.accent)}</div><div class="desc">${escape(slide.description)}</div><div class="stage"><div class="phone"><img src="${pathToFileURL(rawPath).href}"></div></div></main></body></html>`;
}

export const FEATURE_GRAPHIC_SIZE = { width: 1024, height: 500 }; // Play Console 고정 규격

// 공개 웹(keepsake.atelierlabs.co.kr) 히어로에서 읽어 온 값. generate.ts가 언어별 index.html에서 뽑는다.
export interface FeatureGraphicContent {
  bgImagePath: string; // 히어로 첫 번째 배경 사진
  markPath: string; // 히어로 아이콘
  reading?: string; // 워드마크 위 현지어 이름, 예: "킵세이크" (영어판은 없음)
  title: string; // 큰 워드마크 "Keepsake"
  taglineHtml: string; // 웹 히어로 슬로건 마크업 그대로(<br>, <em> 강조 포함)
  lead: string; // 슬로건 아래 설명 문구
  lang: string; // html lang — 일본어 슬로건이 한국어 글꼴로 대체되지 않게 한다
}

// 웹 히어로(atelierlabs sites/keepsake/index.html의 .hero-frame·.hero-copy)와 같은 배경 사진·흰 그러데이션·
// 아이콘→현지어 이름→워드마크→슬로건→설명 순서를 1024x500 한 장에 맞춰 다시 그린다.
// 스토어 배지는 Play 그래픽 이미지에서는 의미가 없어 뺀다.
export function renderFeatureGraphic(content: FeatureGraphicContent) {
  const { width, height } = FEATURE_GRAPHIC_SIZE;
  const bodyFonts = content.lang === 'ja'
    ? '"Pretendard Variable",-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif'
    : '"Pretendard Variable","SUIT",-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
  return `<!doctype html><html lang="${content.lang}"><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box} body{font-family:${bodyFonts};overflow:hidden;color:#151515;letter-spacing:-.025em;-webkit-font-smoothing:antialiased}
    .canvas{width:${width}px;height:${height}px;position:relative;overflow:hidden;background:#FAF8F4}
    .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center}
    /* 웹보다 화면이 작아 글자가 사진과 겹치는 왼쪽만 조금 더 밝힌다. */
    .wash{position:absolute;inset:0;background:linear-gradient(90deg,rgba(255,252,247,.84) 0%,rgba(255,252,247,.6) 42%,rgba(255,252,247,.14) 70%,rgba(255,252,247,.08) 100%)}
    .content{position:absolute;z-index:1;left:64px;top:50%;transform:translateY(-50%);max-width:580px}
    .mark{display:block;width:64px;height:64px;margin:0 0 18px}
    .reading{margin:0 0 6px;color:#5c5c5c;font-size:18px;font-weight:700;line-height:1.3;letter-spacing:.02em}
    /* 영문 워드마크는 언어와 상관없이 같은 글꼴로 그린다. */
    .title{font-family:"Pretendard Variable","SUIT",-apple-system,"Apple SD Gothic Neo",sans-serif;margin:0 0 16px;font-size:84px;font-weight:700;line-height:.92;letter-spacing:-.05em}
    .title::after{content:".";color:#CD5837}
    .tagline{margin:0 0 12px;font-size:27px;font-weight:700;line-height:1.35;letter-spacing:-.045em}
    .tagline em{font-style:normal;color:#CD5837}
    /* 사진 속 인물과 겹치지 않게 폭을 줄인다. */
    .lead{max-width:390px;color:#3a3a3a;font-size:15.5px;font-weight:500;line-height:1.55}
    :lang(ko) :is(.tagline,.lead){word-break:keep-all} :lang(ja) :is(.tagline,.lead){word-break:auto-phrase}
  </style></head><body><div class="canvas">
    <img class="bg" src="${pathToFileURL(content.bgImagePath).href}"><div class="wash"></div>
    <div class="content"><img class="mark" src="${pathToFileURL(content.markPath).href}">${content.reading ? `<p class="reading">${content.reading}</p>` : ''}<h1 class="title">${content.title}</h1><p class="tagline">${content.taglineHtml}</p><p class="lead">${content.lead}</p></div>
  </div></body></html>`;
}
