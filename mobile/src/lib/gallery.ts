import type { Moment } from '@/db/moments';
import type { AlbumSortOrder, AlbumZoom } from '@/db/settings';
import { formatDay, formatMonth, localDateKey } from '@/lib/dates';

// 앨범 화면의 줄 목록. 당긴 정도(zoom)에 따라 같은 기록을 다르게 묶는다.
//   year: 해마다 몇 장만 (많으면 고르게 뽑는다)   month: 달마다 전부, 작게
//   day: 날마다 크게                            story: 메모와 함께 한 장씩

export type GalleryRow =
  | {
      type: 'header';
      key: string;
      title: string;
      subtitle?: string;
      /** 화면 위에 붙여 둘 머리글 (달·해). 날짜 머리글은 붙이지 않는다. */
      sticky: boolean;
      /** 이 묶음에서 가장 최근 날짜. 다른 단계로 바꿀 때 위치를 맞추는 데 쓴다. */
      firstDay: string;
    }
  | { type: 'tiles'; key: string; moments: Moment[]; columns: number; firstDay: string }
  | { type: 'card'; key: string; moment: Moment; firstDay: string };

export const ZOOM_COLUMNS: Record<Exclude<AlbumZoom, 'story'>, number> = { year: 6, month: 5, day: 3 };
/** 해 단계에서 한 해에 보여줄 최대 줄 수 */
const YEAR_ROWS = 3;

type Keyed = { moment: Moment; day: string };

/**
 * 사용자가 고른 방향으로, 촬영지 날짜 기준으로 정렬한다. DB는 UTC 시각순이라 시간대가 다른 사진이 섞이면
 * 같은 날이 두 번 나뉠 수 있다 (같은 날 안에서는 UTC 시각순 유지).
 */
function byLocalDay(moments: Moment[], order: AlbumSortOrder): Keyed[] {
  return moments
    .map((moment) => ({ moment, day: localDateKey(moment.taken_at, moment.taken_tz_offset) }))
    .sort((a, b) => (a.day === b.day ? 0 : order === 'newest' ? (a.day < b.day ? 1 : -1) : (a.day < b.day ? -1 : 1)));
}

/** 앨범 화면과 같은 순서. 전체 화면으로 넘겨 볼 때 쓴다. */
export function sortForGallery(moments: Moment[], order: AlbumSortOrder = 'newest') {
  return byLocalDay(moments, order).map((k) => k.moment);
}

function groupBy(items: Keyed[], keyOf: (day: string) => string) {
  const groups: { key: string; items: Keyed[] }[] = [];
  for (const item of items) {
    const key = keyOf(item.day);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

function tileRows(items: Keyed[], columns: number, keyPrefix: string): GalleryRow[] {
  const rows: GalleryRow[] = [];
  for (let i = 0; i < items.length; i += columns) {
    const chunk = items.slice(i, i + columns);
    rows.push({
      type: 'tiles',
      key: `${keyPrefix}-${chunk[0].moment.id}`,
      moments: chunk.map((k) => k.moment),
      columns,
      firstDay: chunk[0].day,
    });
  }
  return rows;
}

/** 많으면 고르게 count장을 뽑는다 (처음과 끝 포함). */
function sample<T>(items: T[], count: number) {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, i) => items[Math.round((i * (items.length - 1)) / (count - 1))]);
}

export function galleryRows(moments: Moment[], zoom: AlbumZoom, order: AlbumSortOrder = 'newest'): GalleryRow[] {
  const keyed = byLocalDay(moments, order);
  const rows: GalleryRow[] = [];

  if (zoom === 'year') {
    const columns = ZOOM_COLUMNS.year;
    const max = columns * YEAR_ROWS;
    for (const group of groupBy(keyed, (day) => day.slice(0, 4))) {
      const shown = sample(group.items, max);
      rows.push({
        type: 'header',
        key: `y-${group.key}`,
        title: `${group.key}년`,
        subtitle:
          shown.length < group.items.length
            ? `${group.items.length}장 중 ${shown.length}장`
            : `${group.items.length}장`,
        sticky: true,
        firstDay: group.items[0].day,
      });
      rows.push(...tileRows(shown, columns, 'y'));
    }
    return rows;
  }

  if (zoom === 'month') {
    for (const group of groupBy(keyed, (day) => day.slice(0, 7))) {
      rows.push({
        type: 'header',
        key: `m-${group.key}`,
        title: formatMonth(group.items[0].day),
        subtitle: `${group.items.length}장`,
        sticky: true,
        firstDay: group.items[0].day,
      });
      rows.push(...tileRows(group.items, ZOOM_COLUMNS.month, 'm'));
    }
    return rows;
  }

  // day, story: 달 머리글을 붙여 두고 그 아래 날짜별로 보여준다.
  for (const month of groupBy(keyed, (day) => day.slice(0, 7))) {
    rows.push({
      type: 'header',
      key: `m-${month.key}`,
      title: formatMonth(month.items[0].day),
      sticky: true,
      firstDay: month.items[0].day,
    });
    for (const day of groupBy(month.items, (d) => d)) {
      rows.push({
        type: 'header',
        key: `d-${day.key}`,
        title: formatDay(day.key),
        sticky: false,
        firstDay: day.key,
      });
      if (zoom === 'day') {
        rows.push(...tileRows(day.items, ZOOM_COLUMNS.day, 'd'));
      } else {
        for (const { moment } of day.items) {
          rows.push({ type: 'card', key: moment.id, moment, firstDay: day.key });
        }
      }
    }
  }
  return rows;
}

/** 줄에 들어 있는 첫 기록 (머리글이면 null) */
export function firstMomentOf(row: GalleryRow) {
  if (row.type === 'tiles') return row.moments[0];
  if (row.type === 'card') return row.moment;
  return null;
}

/**
 * 다른 단계로 바꿨을 때 보던 기록이 있는 줄. 해 단계처럼 그 기록이 보이지 않으면
 * 그 기록이 속한 묶음(그 날짜 이후로 시작하는 마지막 줄)으로 간다.
 */
export function anchorIndex(rows: GalleryRow[], anchor: { id: string; day: string } | null) {
  if (!anchor) return 0;
  const exact = rows.findIndex((row) =>
    row.type === 'tiles' ? row.moments.some((m) => m.id === anchor.id) : row.type === 'card' && row.moment.id === anchor.id,
  );
  if (exact >= 0) {
    // 바로 위가 머리글이면 머리글부터 보여준다 (달의 첫 날이면 달 머리글까지).
    let index = exact;
    while (index > 0 && rows[index - 1].type === 'header') index--;
    return index;
  }
  const older = rows.findIndex((row) => row.firstDay < anchor.day);
  return older === -1 ? Math.max(rows.length - 1, 0) : Math.max(older - 1, 0);
}
