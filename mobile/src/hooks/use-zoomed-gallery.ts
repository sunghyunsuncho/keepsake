import type { FlashListRef, ViewToken } from '@shopify/flash-list';
import { useMemo, useRef, useState } from 'react';

import { STICKY_HEADER_HEIGHT } from '@/components/gallery';
import { ALBUM_ZOOMS, type AlbumSortOrder, type AlbumZoom } from '@/db/settings';
import { localDateKey } from '@/lib/dates';
import { anchorIndex, firstMomentOf, galleryRows, type Dated, type GalleryRow } from '@/lib/gallery';
import { useTranslation } from '@/lib/i18n';

// 위로 거의 지나간 줄을 '보던 사진'으로 잡지 않도록 반 이상 보이는 줄만 센다.
const VIEWABILITY = { itemVisiblePercentThreshold: 50 };

type Anchor = { id: string; day: string };

type Options = {
  /** 보여 줄 단계 (사진을 담는 화면은 이야기 단계가 없다) */
  zooms?: readonly AlbumZoom[];
  order?: AlbumSortOrder;
  /** 처음 단계 (앨범 화면은 저장해 둔 단계). 사용자가 바꾸기 전까지 쓴다. */
  initialZoom?: AlbumZoom;
  /** 단계를 바꿨을 때 (앨범 화면은 설정에 저장한다) */
  onZoomChange?: (zoom: AlbumZoom) => void;
  /** 해 단계에서 많으면 고르게 몇 장만 보여 준다. 고르는 화면은 모두 보여야 고를 수 있어 끈다. */
  sampleYears?: boolean;
};

/**
 * 해·달·날(·이야기) 보기. 내 앨범·공유 앨범 화면과 사진을 담는 화면이 함께 쓴다.
 * 단계를 바꾸면 바꾸기 직전에 보던 사진부터 보여 준다. 목록은 단계마다 새로 그리므로(key) 처음 위치만 정하면 된다.
 * FlashList에 key={zoom}과 돌려준 listProps를 넘긴다.
 */
export function useZoomedGallery<T extends Dated>(
  items: T[] | undefined,
  { zooms = ALBUM_ZOOMS, order = 'newest', initialZoom = 'month', onZoomChange, sampleYears = true }: Options = {},
) {
  // 단계를 바꾼 뒤 처음 보여줄 위치. 바꾸기 직전에 보던 사진이다.
  const [view, setView] = useState<{ zoom: AlbumZoom; anchor: Anchor | null } | null>(null);
  const zoom = view?.zoom ?? initialZoom;
  // 머리글(해·달·사진 수)은 언어에 따라 달라 언어를 바꾸면 다시 만든다.
  const { language } = useTranslation();
  const rows = useMemo(
    () => (items ? galleryRows(items, zoom, order, { sampleYears, language }) : []),
    [items, zoom, order, sampleYears, language],
  );
  const stickyHeaderIndices = useMemo(
    () => rows.flatMap((row, index) => (row.type === 'header' && row.sticky ? [index] : [])),
    [rows],
  );
  const initialIndex = useMemo(() => anchorIndex(rows, view?.anchor ?? null), [rows, view]);
  const list = useRef<FlashListRef<GalleryRow<T>>>(null);
  // 처음 위치는 줄 높이를 재기 전 추정값이라(이야기 카드) 그린 뒤 다시 맞춘다.
  // 묶음 중간에서 시작하면 위에 붙은 머리글이 첫 줄을 가리므로 그만큼 내려 보여준다.
  const onLoad = () => {
    if (initialIndex === 0) return;
    const row = rows[initialIndex];
    const covered = !(row?.type === 'header' && row.sticky);
    list.current?.scrollToIndex({ index: initialIndex, viewOffset: covered ? STICKY_HEADER_HEIGHT : 0, animated: false });
  };

  // 지금 화면 맨 위에 보이는 사진
  const visible = useRef<Anchor | null>(null);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<GalleryRow<T>>[] }) => {
    for (const token of viewableItems) {
      const item = token.item && firstMomentOf(token.item);
      if (item) {
        visible.current = { id: item.id, day: localDateKey(item.taken_at, item.taken_tz_offset) };
        return;
      }
    }
  }).current;

  /** anchor: 바꾼 뒤 보여 줄 사진 (해 단계에서 누른 사진 등). 없으면 지금 보던 사진. */
  const changeZoom = (next: AlbumZoom, anchor: Anchor | null = visible.current) => {
    if (next === zoom) return;
    setView({ zoom: next, anchor });
    onZoomChange?.(next);
  };
  const stepZoom = (delta: 1 | -1) => {
    const next = zooms[zooms.indexOf(zoom) + delta];
    if (next) changeZoom(next);
  };
  /** 해 단계에서 누른 사진이 있는 달로 당겨 본다. */
  const zoomIntoMonth = (item: T) =>
    changeZoom('month', { id: item.id, day: localDateKey(item.taken_at, item.taken_tz_offset) });

  return {
    zoom,
    rows,
    changeZoom,
    stepZoom,
    zoomIntoMonth,
    listProps: {
      ref: list,
      stickyHeaderIndices,
      initialScrollIndex: initialIndex,
      onLoad,
      viewabilityConfig: VIEWABILITY,
      onViewableItemsChanged,
    },
  };
}
