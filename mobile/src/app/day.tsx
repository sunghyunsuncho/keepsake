import { FlashList } from '@shopify/flash-list';
import type { Asset } from 'expo-media-library';
import { router, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomBar, Centered, ColumnToggle, GRID_GAP, LimitedAccessBanner, PhotoTile, tileHeightFor, useTileWidth } from '@/components/pick';
import { BackButton } from '@/components/stack-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getAlbumTitle, updateAlbumMoments } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { momentIdsByAsset } from '@/db/moments';
import { DEFAULT_SETTINGS, getSettings, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { dayKeyOf, usePhotoSelection } from '@/hooks/use-photo-selection';
import { formatDay, formatMonth } from '@/lib/dates';
import { localizeText, photoCount, selectionSummary, useTranslation } from '@/lib/i18n';
import { getPhotosBefore, subscribeLibraryChanges, usePhotoAccess } from '@/lib/photos';

type Row =
  | { type: 'year'; key: string; dateKey: string }
  | { type: 'month'; key: string; dateKey: string }
  | { type: 'day'; key: string; dateKey: string; count: number }
  | { type: 'photo'; key: string; asset: Asset };
type Roll = { assets: Asset[]; endCursor?: string; hasNextPage: boolean };
const EMPTY_ASSETS: Asset[] = [];
type PastZoom = 'year' | 'month' | 'day';
const PAST_ZOOMS: readonly PastZoom[] = ['year', 'month', 'day'];
const PAST_ZOOM_LABELS: Record<PastZoom, string> = { year: '연도', month: '월', day: '일' };

/** 지난 사진을 가장 오래된 것부터 월·일 머리글 아래 세로로 계속 보여 준다. */
export default function DayScreen() {
  const db = useSQLiteContext();
  const { language } = useTranslation();
  const { access } = usePhotoAccess();
  const [before] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [zoom, setZoom] = useState<PastZoom>('month');
  const [roll, setRoll] = useState<Roll | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const loadingMore = useRef(false);
  const generation = useRef(0);

  useEffect(() => subscribeLibraryChanges(() => setLibraryVersion((value) => value + 1)), []);
  useEffect(() => {
    if (access === null) return;
    const current = ++generation.current;
    setRoll(null);
    getPhotosBefore(before)
      .then((page) => current === generation.current && setRoll(page))
      .catch(() => current === generation.current && setRoll({ assets: [], hasNextPage: false }));
  }, [before, libraryVersion, access]);

  const loadMore = async () => {
    if (!roll?.hasNextPage || loadingMore.current) return;
    loadingMore.current = true;
    const current = generation.current;
    try {
      const page = await getPhotosBefore(before, roll.endCursor);
      if (current !== generation.current) return;
      setRoll((previous) => previous && previous.endCursor === roll.endCursor
        ? { ...page, assets: [...previous.assets, ...page.assets] } : previous);
    } finally {
      loadingMore.current = false;
    }
  };

  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const assets = roll?.assets ?? EMPTY_ASSETS;
  const assetIds = useMemo(() => assets.map((asset) => asset.id), [assets]);
  const { data: saved = new Map<string, string>() } = useDbQuery(() => momentIdsByAsset(db, assetIds), [db, assetIds]);
  const selection = usePhotoSelection(db, saved);
  const columns = settings?.pick_grid_columns ?? DEFAULT_SETTINGS.pick_grid_columns;
  const tileWidth = useTileWidth(columns);

  const rows = useMemo(() => {
    const result: Row[] = [];
    // 일별 머리글의 개수는 미리 한 번만 센다. 사진이 많은 달에서 매 행마다 전체
    // 목록을 다시 훑으면 O(n²)이 되어 스크롤이 느려진다.
    const countByDay = new Map<string, number>();
    for (const asset of assets) {
      const day = dayKeyOf(asset);
      countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
    }
    let previousYear = '';
    let previousMonth = '';
    let previousDay = '';
    for (const asset of assets) {
      const dateKey = dayKeyOf(asset);
      const monthKey = dateKey.slice(0, 7);
      const yearKey = dateKey.slice(0, 4);
      if (yearKey !== previousYear) {
        result.push({ type: 'year', key: `year-${yearKey}`, dateKey });
        previousYear = yearKey;
        previousMonth = '';
        previousDay = '';
      }
      if (zoom !== 'year' && monthKey !== previousMonth) {
        result.push({ type: 'month', key: `month-${monthKey}`, dateKey: `${monthKey}-01` });
        previousMonth = monthKey;
        previousDay = '';
      }
      if (zoom === 'day' && dateKey !== previousDay) {
        result.push({ type: 'day', key: `day-${dateKey}`, dateKey, count: countByDay.get(dateKey) ?? 0 });
        previousDay = dateKey;
      }
      result.push({ type: 'photo', key: asset.id, asset });
    }
    return result;
  }, [assets, zoom]);

  // 앨범 메뉴의 [새 사진에서 고르기]로 담기를 시작했으면, 새 사진이 없어 여기로 온 경우에도 그 앨범에 함께 담는다.
  // (고르기 화면이 '모두 살펴봤어요'에서 이 화면을 권한다.) 지워진 앨범이면 담지 않는다.
  const targetAlbumId = settings?.picking_album_id ?? null;
  const { data: targetLookup } = useDbQuery(
    async () => (targetAlbumId ? { id: targetAlbumId, title: await getAlbumTitle(db, targetAlbumId) } : null),
    [db, targetAlbumId],
  );
  const targetAlbum =
    targetAlbumId && targetLookup?.id === targetAlbumId && targetLookup.title
      ? { id: targetAlbumId, title: targetLookup.title }
      : null;

  const complete = async () => {
    const items = await selection.complete(assets);
    // 위 조회가 끝나기 전에 눌러도 빠지지 않게, 담을 앨범이 아직 있는지 남길 때 다시 확인한다.
    if (items.length > 0 && targetAlbumId && (await getAlbumTitle(db, targetAlbumId))) {
      await updateAlbumMoments(db, targetAlbumId, { add: items.map((item) => item.momentId) });
    }
  };
  const savedHint = targetAlbum
    ? {
        ko: `남긴 사진은 ${targetAlbum.title}에도 담겨요`,
        en: `Kept photos also go into ${targetAlbum.title}`,
        ja: `残した写真は${targetAlbum.title}にも追加されます`,
      }[language]
    : '남기면 사진첩에서 다시 볼 수 있어요';

  // 탭 바가 없는 화면이라 아래 막대가 시스템 내비게이션 바(3버튼)에 가려지지 않게 아래 안전 영역을 둔다.
  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen
        options={{
          headerLeft: () => <BackButton label="고르기로 돌아가기" onPress={() => router.navigate('/')} />,
        }}
      />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        {/* 제목 '지난 사진'은 머리글에 있으므로 여기서는 설명만 둔다. */}
        <View style={styles.header}>
          <View style={styles.flex}>
            <ThemedText type="small" themeColor="textSecondary">최근 사진부터 시간 순서대로</ThemedText>
          </View>
          <ColumnToggle value={columns} onChange={(next) => setSetting(db, 'pick_grid_columns', next)} />
        </View>
        <PastZoomBar value={zoom} onChange={setZoom} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>아래로 내려가며 계속 볼 수 있어요.</ThemedText>
        {access === 'limited' && <LimitedAccessBanner onChanged={() => setLibraryVersion((value) => value + 1)} />}
        {!roll ? <Centered><ActivityIndicator /></Centered> : assets.length === 0 ? (
          <Centered><ThemedText themeColor="textSecondary">사진 보관함에 사진이 없어요.</ThemedText></Centered>
        ) : (
          <FlashList
            key={columns} data={rows} numColumns={columns} keyExtractor={(item) => item.key} getItemType={(item) => item.type}
            overrideItemLayout={(layout, item) => { if (item.type !== 'photo') layout.span = columns; }}
            extraData={{ saved, draft: selection.draft }} contentContainerStyle={{ padding: GRID_GAP / 2, paddingBottom: Spacing.four }}
            onEndReached={loadMore} onEndReachedThreshold={1}
            renderItem={({ item }) => {
              if (item.type === 'year') return <ThemedText style={styles.yearHeader}>{language === 'en' ? item.dateKey.slice(0, 4) : `${item.dateKey.slice(0, 4)}${language === 'ja' ? '年' : '년'}`}</ThemedText>;
              if (item.type === 'month') return <ThemedText style={styles.monthHeader}>{formatMonth(item.dateKey)}</ThemedText>;
              if (item.type === 'day') return <ThemedText type="smallBold" themeColor="textSecondary" style={styles.dayHeader}>{`${formatDay(item.dateKey)} · ${photoCount(language, item.count)}`}</ThemedText>;
              return <PhotoTile asset={item.asset} width={tileWidth} height={tileHeightFor(item.asset, tileWidth, columns)} state={saved.has(item.asset.id) ? 'saved' : selection.draft.includes(item.asset.id) ? 'picked' : 'none'} order={selection.draft.indexOf(item.asset.id) + 1} onPress={() => selection.toggle(item.asset)} />;
            }}
            ListFooterComponent={roll.hasNextPage ? <ActivityIndicator style={styles.more} /> : null}
          />
        )}
        {selection.draft.length > 0 || selection.saving ? (
          <BottomBar title={selection.saving ? `${localizeText(language, '남기는 중…')} ${selection.saving.done}/${selection.saving.total}` : selectionSummary(language, selection.draft.length)} subtitle={savedHint} secondary={{ label: '선택 해제', onPress: selection.clear }} action={{ label: '남기기', onPress: complete, loading: !!selection.saving }} />
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

function PastZoomBar({ value, onChange }: { value: PastZoom; onChange: (value: PastZoom) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.zoomBar, { backgroundColor: theme.backgroundElement }]} accessibilityRole="radiogroup">
      {PAST_ZOOMS.map((option) => {
        const selected = option === value;
        return (
          <Pressable key={option} onPress={() => onChange(option)} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.zoomItem, selected && { backgroundColor: theme.background }]}>
            <ThemedText type={selected ? 'smallBold' : 'small'} themeColor={selected ? 'text' : 'textSecondary'}>{PAST_ZOOM_LABELS[option]}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  zoomBar: { flexDirection: 'row', marginHorizontal: Spacing.three, marginTop: Spacing.two, padding: 2, borderRadius: Spacing.two },
  zoomItem: { flex: 1, minHeight: 32, borderRadius: Spacing.two - 2, alignItems: 'center', justifyContent: 'center' },
  hint: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  yearHeader: { fontSize: 24, lineHeight: 32, fontWeight: 700, paddingHorizontal: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.one },
  monthHeader: { fontSize: 20, lineHeight: 28, fontWeight: 700, paddingHorizontal: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.one },
  dayHeader: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.one },
  more: { marginVertical: Spacing.four },
});
