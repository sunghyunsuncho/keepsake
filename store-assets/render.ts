import type { Slide } from './slides.ts';
import { pathToFileURL } from 'node:url';

export const PLAY_SIZE = { width: 1620, height: 2880 };
export const IOS_SIZE = { width: 1242, height: 2688 };
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function renderSlide(slide: Slide, rawPath: string, total: number, size: { width: number; height: number }) {
  const scale = Math.min(size.width / PLAY_SIZE.width, size.height / PLAY_SIZE.height);
  const px = (n: number) => Math.round(n * scale);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;background:#F4F1EC;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#171A1E}
    .canvas{width:${size.width}px;height:${size.height}px;padding:${px(108)}px ${px(96)}px ${px(86)}px;display:flex;flex-direction:column;background:linear-gradient(160deg,#F8F6F2,#EEE9E1)}
    .number{font-size:${px(24)}px;letter-spacing:.16em;color:#CD5837;font-weight:700}.title{font-size:${px(54)}px;line-height:1.24;font-weight:600;margin-top:${px(38)}px}.accent{font-size:${px(72)}px;line-height:1.18;font-weight:800;margin-top:${px(10)}px;color:#16212B;letter-spacing:-.035em}.desc{font-size:${px(31)}px;line-height:1.45;color:#5F6A75;margin-top:${px(28)}px}
    .phone{margin:auto;max-height:${px(1640)}px;aspect-ratio:1290/2796;padding:${px(10)}px;border-radius:${px(62)}px;background:#16191D;box-shadow:0 ${px(28)}px ${px(70)}px rgba(22,33,43,.25);overflow:hidden}.phone img{width:100%;height:100%;display:block;object-fit:cover;border-radius:${px(52)}px}.footer{font-size:${px(22)}px;color:#8A8177;letter-spacing:.12em;text-align:right}
  </style></head><body><main class="canvas"><div class="number">${slide.no} / ${String(total).padStart(2, '0')}</div><div class="title">${escape(slide.title)}</div><div class="accent">${escape(slide.accent)}</div><div class="desc">${escape(slide.description)}</div><div class="phone"><img src="${pathToFileURL(rawPath).href}"></div><div class="footer">KEEPSAKE</div></main></body></html>`;
}
