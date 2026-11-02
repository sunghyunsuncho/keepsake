import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList, type ViewToken } from '@shopify/flash-list';
import type { Asset } from 'expo-media-library';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { DateSheet } from '@/components/date-sheet';
import {
  BottomBar,
  Centered,
  ColumnToggle,
  DayDots,
  GRID_GAP,
  IconButton,
  LimitedAccessBanner,
  PhotoTile,
  SavedTray,
  tileHeightFor,
  useTileWidth,
} from '@/components/pick';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { activeMomentIds, momentIdsByAsset } from '@/db/moments';
import { getSettings, setSetting, type Settings } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { dayKeyOf, usePhotoSelection, type SavedItem } from '@/hooks/use-photo-selection';
import { formatDay, formatTime, toDateKey, todayKey } from '@/lib/dates';
import { photosLeftBehind, setCleanupPhotos } from '@/lib/cleanup';
import { getPhotosSince, subscribeLibraryChanges, usePhotoAccess } from '@/lib/photos';
import { checkMissedPhotos, clearMissedPhotos, loadMissedPhotos } from '@/lib/missed-photos';
import { markReviewed, offerReminders } from '@/lib/reminders';

export default function PickScreen() {
  const db = useSQLiteContext();
  const { access, canAskAgain, request } = usePhotoAccess();
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);

  let content;
  if (access === null || !settings) {
    content = (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  } else if (access === 'undetermined' || access === 'denied') {
    content = (
      <PermissionIntro denied={access === 'denied'} canAskAgain={canAskAgain} onRequest={request} />
    );
  } else if (settings.review_cursor === null) {
    content = <StartPoint />;
  } else {
    content = (
      <Inbox limited={access === 'limited'} cursor={settings.review_cursor} settings={settings} />
    );
  }

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        {content}
      </SafeAreaView>
    </ThemedView>
  );
}

function PermissionIntro({
  denied,
  canAskAgain,
  onRequest,
}: {
  denied: boolean;
  canAskAgain: boolean;
  onRequest: () => void;
}) {
  // 한 번 거절하면 iOS는 다시 묻지 않으므로 설정 앱으로 보낸다.
  const openSettings = denied && !canAskAgain;
  return (
    <Centered>
      <ThemedText type="subtitle">Keepsake</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.center}>
        휴대폰에 쌓여 가는 수많은 사진 중{'\n'}
        십 년 뒤에도 다시 보고 싶은 몇 장만 골라 남겨요.{'\n'}
        필름 사진을 골라 인화하던 때처럼요.
      </ThemedText>
      {denied && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          사진에 접근할 수 없어요. 고를 사진을 보여드리려면 사진 접근을 허용해 주세요.{'\n'}
          일부 사진만 허용해도 괜찮아요.
        </ThemedText>
      )}
      <Button
        label={openSettings ? '설정에서 허용하기' : '사진 보관함 열기'}
        onPress={openSettings ? () => Linking.openSettings() : onRequest}
      />
    </Centered>
  );
}

/** 처음 실행할 때 어느 사진부터 살펴볼지 정한다. 이후로는 '여기까지 봤어요' 지점부터 이어서 보여준다. */
function StartPoint() {
  const db = useSQLiteContext();
  const [choosingDate, setChoosingDate] = useState(false);

  // 고른 날 0시 직전을 '여기까지 봤다'로 두면 그날 사진부터 보인다.
  const startFrom = (date: Date) => {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    setSetting(db, 'review_cursor', new Date(start.getTime() - 1).toISOString());
  };
  const daysAgo = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  };

  return (
    <Centered style={styles.startPoint}>
      <ThemedText type="subtitle" style={styles.center}>
        어디서부터 고를까요?
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.center}>
        필름 한 롤을 다 찍고 나서 남길 사진을 고르듯,{'\n'}
        Keepsake는 지난번에 살펴본 다음 사진부터 차례로 보여드려요.
      </ThemedText>
      <View style={styles.startOptions}>
        <Button label="오늘 찍은 사진부터" onPress={() => startFrom(new Date())} />
        <Button label="최근 1주" variant="secondary" onPress={() => startFrom(daysAgo(6))} />
        <Button label="최근 한 달" variant="secondary" onPress={() => startFrom(daysAgo(30))} />
        <Button label="날짜 고르기" variant="secondary" onPress={() => setChoosingDate(true)} />
      </View>
      <DateSheet
        visible={choosingDate}
        value={daysAgo(7)}
        mode="date"
        maximumDate={new Date()}
        onConfirm={(date) => {
          setChoosingDate(false);
          startFrom(date);
        }}
        onCancel={() => setChoosingDate(false)}
      />
    </Centered>
  );
}

type DayRow = { type: 'day'; key: string; dateKey: string; assets: Asset[] };
type Row =
  | DayRow
  | { type: 'missed'; key: string; assets: Asset[] }
  | { type: 'photo'; key: string; asset: Asset };

type Roll = { assets: Asset[]; endCursor?: string; hasNextPage: boolean; totalCount: number };

/**
 * 아직 살펴보지 않은 사진(review_cursor 이후)을 날짜별로 이어서 보여준다.
 * 스크롤해서 지나간 사진은 '봤다'로 치고, [남기기]나 [여기까지 봤어요]를 누르면 그 지점까지 기억한다.
 * 중간에 그만둬도 다음에 그 뒤부터 이어서 볼 수 있다.
 */
function Inbox({
  limited,
  cursor,
  settings,
}: {
  limited: boolean;
  cursor: string;
  settings: Settings;
}) {
  const db = useSQLiteContext();
  // 예전에 미래 시각으로 저장된 지점이 있어도 지금 찍는 사진이 숨지 않게 현재 시각을 넘지 않게 한다.
  const cursorMs = useMemo(() => Math.min(new Date(cursor).getTime(), Date.now()), [cursor]);
  const [roll, setRoll] = useState<Roll | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [seenUntil, setSeenUntil] = useState(cursorMs);
  const [justSaved, setJustSaved] = useState<SavedItem[]>([]);
  // 방금 살펴보고 남기지 않은 사진. 지점을 옮기면 목록에서 사라지므로 옮기기 전에 잡아 둔다.
  const [leftBehind, setLeftBehind] = useState<Asset[]>([]);
  const loadingMore = useRef(false);
  // 다시 읽기를 시작할 때마다 올린다. 늦게 끝난 이전 요청(다시 읽기·다음 쪽)이 결과를 덮지 않게 한다.
  const generation = useRef(0);
  const rollRef = useRef(roll);
  rollRef.current = roll;
  const loadedCursor = useRef(cursorMs);

  useEffect(() => subscribeLibraryChanges(() => setLibraryVersion((v) => v + 1)), []);

  useEffect(() => {
    const gen = ++generation.current;
    const cursorChanged = loadedCursor.current !== cursorMs;
    loadedCursor.current = cursorMs;
    if (cursorChanged) {
      setRoll(null);
      setSeenUntil(cursorMs);
    }
    // 보관함이 바뀌어 다시 읽을 때는(iCloud 동기화, 새 사진) 화면을 비우지 않고, 이미 보여준 만큼
    // 다시 읽어서 스크롤 위치와 '여기까지 봤어요' 진행을 지킨다.
    const keep = cursorChanged ? 0 : (rollRef.current?.assets.length ?? 0);
    fetchRoll(new Date(cursorMs), keep)
      .then((next) => gen === generation.current && setRoll(next))
      .catch(
        () =>
          gen === generation.current &&
          setRoll((prev) => prev ?? { assets: [], hasNextPage: false, totalCount: 0 }),
      );
  }, [cursorMs, libraryVersion, limited]);

  // 지점보다 이전 시각으로 나중에 들어온 사진은 위쪽에 '놓친 사진'으로 따로 보여준다.
  useEffect(() => {
    checkMissedPhotos(db, { limited });
  }, [db, cursor, libraryVersion, limited]);
  const missedKey = settings.missed_photo_ids.join(',');
  const [missed, setMissed] = useState<Asset[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadMissedPhotos(missedKey ? missedKey.split(',') : [])
      .then((result) => !cancelled && setMissed(result))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [missedKey, libraryVersion]);

  const loadMore = async () => {
    const current = rollRef.current;
    if (!current?.hasNextPage || loadingMore.current) return;
    loadingMore.current = true;
    const gen = generation.current;
    try {
      const page = await getPhotosSince(new Date(cursorMs), current.endCursor);
      if (gen !== generation.current) return;
      // 그 사이 목록이 바뀌었으면(다시 읽기) 이어 붙이지 않는다.
      setRoll((prev) =>
        prev && prev.endCursor === current.endCursor
          ? { ...page, assets: [...prev.assets, ...page.assets] }
          : prev,
      );
    } catch {
      // 다음 쪽을 못 읽으면 스크롤 끝에서 다시 시도된다.
    } finally {
      loadingMore.current = false;
    }
  };

  const assets = useMemo(() => roll?.assets ?? [], [roll]);
  // 화면에 있는 모든 사진 (놓친 사진 + 새로 찍은 사진). 고른 사진을 찾을 때 쓴다.
  const shown = useMemo(() => [...missed, ...assets], [missed, assets]);
  const assetIds = useMemo(() => shown.map((a) => a.id), [shown]);
  const { data: saved = new Map<string, string>() } = useDbQuery(
    () => momentIdsByAsset(db, assetIds),
    [db, assetIds],
  );
  const selection = usePhotoSelection(db, saved);
  // 방금 남긴 사진 중 그 사이(상세 화면 등에서) 기록에서 뺀 것은 목록에서 뺀다.
  const justSavedIds = useMemo(() => justSaved.map((item) => item.momentId), [justSaved]);
  const { data: alive } = useDbQuery(() => activeMomentIds(db, justSavedIds), [db, justSavedIds]);
  const recentlySaved = alive ? justSaved.filter((item) => alive.has(item.momentId)) : justSaved;
  const columns = settings.pick_grid_columns;
  const tileWidth = useTileWidth(columns);

  const rows = useMemo(() => {
    const result: Row[] = [];
    if (missed.length > 0) {
      result.push({ type: 'missed', key: 'missed', assets: missed });
      for (const asset of missed) result.push({ type: 'photo', key: asset.id, asset });
    }
    let day = null as DayRow | null;
    for (const asset of assets) {
      const dateKey = dayKeyOf(asset);
      if (day?.dateKey !== dateKey) {
        day = { type: 'day', key: `d-${dateKey}`, dateKey, assets: [] };
        result.push(day);
      }
      day.assets.push(asset);
      result.push({ type: 'photo', key: asset.id, asset });
    }
    return result;
  }, [assets, missed]);

  // 화면에 보인 사진 중 가장 늦게 찍은 시각 = 여기까지 봤다.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
      let latest = 0;
      for (const token of viewableItems) {
        if (token.item?.type === 'photo') {
          latest = Math.max(latest, token.item.asset.creationTime);
        }
      }
      if (latest > 0) setSeenUntil((prev) => Math.max(prev, latest));
    },
    [],
  );

  const moveCursor = async (seen: number) => {
    // 촬영 시각이 미래로 잘못 찍힌 사진 때문에 지점이 앞서 나가면, 지금 찍는 사진이 숨겨진다.
    const until = Math.min(seen, Date.now());
    if (until > cursorMs) await setSetting(db, 'review_cursor', new Date(until).toISOString());
    // 놓친 사진은 맨 위에 있으니 함께 본 것으로 친다.
    if (settings.missed_photo_ids.length > 0) await clearMissedPhotos(db);
  };

  // 아직 정리하지 않은 사진이 있으면 이어 붙인다. 바꿔 버리면 앞서 살펴본 사진은 정리할 기회가 없어진다.
  const addLeftBehind = (next: Asset[]) =>
    setLeftBehind((prev) => {
      const known = new Set(prev.map((a) => a.id));
      return [...prev, ...next.filter((a) => !known.has(a.id))];
    });

  const complete = async () => {
    const picked = shown.filter((a) => selection.draft.includes(a.id));
    const items = await selection.complete(shown);
    // 고른 사진이 그 사이 모두 지워졌으면 선택만 비운다. 지점을 옮기거나 정리를 권하지 않는다.
    if (picked.length === 0) return;
    setJustSaved((prev) => [...items, ...prev]);
    // 실패해서 선택에 남은 사진이 있으면, 그 사진이 사라지지 않도록 지점을 옮기지 않는다.
    if (items.length === picked.length) {
      const seen = Math.max(seenUntil, ...picked.map((a) => a.creationTime));
      addLeftBehind(
        photosLeftBehind(
          shown,
          [...saved.keys(), ...picked.map((a) => a.id)],
          Math.min(seen, Date.now()),
        ),
      );
      await moveCursor(seen);
    }
    if (items.length > 0) {
      await markReviewed(db);
      offerReminders(db);
    }
  };

  const markSeen = async () => {
    addLeftBehind(photosLeftBehind(shown, saved.keys(), Math.min(seenUntil, Date.now())));
    await moveCursor(seenUntil);
    await markReviewed(db);
  };

  const header = (
    <View style={styles.header}>
      <View style={styles.flex}>
        <ThemedText style={styles.title}>새로 찍은 사진</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {roll && roll.assets.length > 0
            ? `${formatDay(dayKeyOf(roll.assets[0]))}부터 ${roll.totalCount}장`
            : ' '}
        </ThemedText>
      </View>
      <ColumnToggle value={columns} onChange={(next) => setSetting(db, 'pick_grid_columns', next)} />
      <IconButton icon="calendar-outline" label="날짜로 보기" onPress={() => router.push('/day')} />
    </View>
  );

  if (!roll) {
    return (
      <View style={styles.flex}>
        {header}
        <Centered>
          <ActivityIndicator />
        </Centered>
      </View>
    );
  }

  const seenLabel = formatMoment(seenUntil);

  return (
    <View style={styles.flex}>
      {header}
      {limited && <LimitedAccessBanner onChanged={() => setLibraryVersion((v) => v + 1)} />}

      {assets.length === 0 && missed.length === 0 ? (
        <AllCaughtUp cursor={cursorMs} />
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary" style={styles.prompt}>
            십 년 뒤에도 다시 보고 싶은 사진만 골라 남겨 보세요. 하루 {settings.daily_recommended_count}
            장쯤이면 충분해요.
          </ThemedText>
          <FlashList
            // 열 수가 바뀌면 배치를 처음부터 다시 계산한다.
            key={columns}
            data={rows}
            numColumns={columns}
            keyExtractor={(row) => row.key}
            getItemType={(row) => row.type}
            overrideItemLayout={(layout, row) => {
              if (row.type !== 'photo') layout.span = columns;
            }}
            // 놓친 사진이 맨 위에 늘어날 때, 위쪽을 보고 있었다면 가려지지 않게 위로 올린다.
            maintainVisibleContentPosition={{ autoscrollToTopThreshold: TOP_THRESHOLD }}
            extraData={{ saved, draft: selection.draft }}
            contentContainerStyle={{ padding: GRID_GAP / 2, paddingBottom: Spacing.four }}
            onEndReached={loadMore}
            onEndReachedThreshold={1}
            viewabilityConfig={VIEWABILITY}
            onViewableItemsChanged={onViewableItemsChanged}
            renderItem={({ item }) =>
              item.type === 'missed' ? (
                <MissedHeader count={item.assets.length} />
              ) : item.type === 'day' ? (
                <DayHeader
                  dateKey={item.dateKey}
                  count={item.assets.length}
                  saved={item.assets.filter((a) => saved.has(a.id)).length}
                  picked={item.assets.filter((a) => selection.draft.includes(a.id)).length}
                  recommended={settings.daily_recommended_count}
                />
              ) : (
                <PhotoTile
                  asset={item.asset}
                  width={tileWidth}
                  height={tileHeightFor(item.asset, tileWidth, columns)}
                  state={
                    saved.has(item.asset.id)
                      ? 'saved'
                      : selection.draft.includes(item.asset.id)
                        ? 'picked'
                        : 'none'
                  }
                  order={selection.draft.indexOf(item.asset.id) + 1}
                  onPress={() => selection.toggle(item.asset)}
                />
              )
            }
          />
        </>
      )}

      {recentlySaved.length > 0 && selection.draft.length === 0 && !selection.saving && (
        <SavedTray
          items={recentlySaved}
          title={`${recentlySaved.length}장을 남겼어요. 눌러서 그때의 기억을 적어 보세요`}
          onOpen={(id) => router.push({ pathname: '/moment/[id]', params: { id } })}
          onClose={() => setJustSaved([])}
        />
      )}

      {leftBehind.length > 0 && selection.draft.length === 0 && !selection.saving && (
        <BottomBar
          title={`남기지 않은 사진 ${leftBehind.length}장`}
          subtitle="살펴보고 지우면 휴대폰이 가벼워져요"
          secondary={{ label: '그냥 둘게요', onPress: () => setLeftBehind([]) }}
          action={{
            label: '정리하기',
            onPress: () => {
              setCleanupPhotos(leftBehind);
              setLeftBehind([]);
              router.push('/cleanup');
            },
          }}
        />
      )}

      {selection.draft.length > 0 || selection.saving ? (
        <BottomBar
          title={
            selection.saving
              ? `남기는 중… ${selection.saving.done}/${selection.saving.total}`
              : `${selection.draft.length}장 골랐어요`
          }
          subtitle={`${seenLabel} 사진까지 본 걸로 기억해요`}
          secondary={{ label: '선택 해제', onPress: selection.clear }}
          action={{ label: '남기기', onPress: complete, loading: !!selection.saving }}
        />
      ) : seenUntil > cursorMs || missed.length > 0 ? (
        <BottomBar
          title={seenUntil > cursorMs ? `${seenLabel} 사진까지` : `놓친 사진 ${missed.length}장`}
          subtitle={seenUntil > cursorMs ? '다음엔 그 뒤부터 보여드려요' : '다음엔 보여드리지 않아요'}
          action={{
            label: '여기까지 봤어요',
            onPress: markSeen,
          }}
        />
      ) : null}
    </View>
  );
}

/** since 이후 사진을 최소 minCount장(또는 끝까지) 읽는다. */
async function fetchRoll(since: Date, minCount: number): Promise<Roll> {
  let roll: Roll = await getPhotosSince(since);
  while (roll.hasNextPage && roll.assets.length < minCount) {
    const page = await getPhotosSince(since, roll.endCursor);
    roll = { ...page, assets: [...roll.assets, ...page.assets] };
  }
  return roll;
}

const TOP_THRESHOLD = 120;

// 사진이 절반 이상 보이면 '봤다'로 친다.
const VIEWABILITY = { itemVisiblePercentThreshold: 50 };

function DayHeader({
  dateKey,
  count,
  saved,
  picked,
  recommended,
}: {
  dateKey: string;
  count: number;
  saved: number;
  picked: number;
  recommended: number;
}) {
  return (
    <View style={styles.dayHeader}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">
          {dateKey === todayKey() ? `오늘 · ${formatDay(dateKey)}` : formatDay(dateKey)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          사진 {count}장
        </ThemedText>
      </View>
      <DayDots saved={saved} picked={picked} recommended={recommended} />
    </View>
  );
}

function MissedHeader({ count }: { count: number }) {
  return (
    <View style={styles.dayHeader}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">놓친 사진 {count}장</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          예전에 찍었지만 나중에 보관함에 들어온 사진이에요
        </ThemedText>
      </View>
    </View>
  );
}

function AllCaughtUp({ cursor }: { cursor: number }) {
  const theme = useTheme();
  return (
    <Centered>
      <Ionicons name="checkmark-circle-outline" size={40} color={theme.accent} />
      <ThemedText style={styles.center}>새로 찍은 사진을 모두 살펴봤어요</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {formatMoment(cursor)} 사진까지 봤어요.{'\n'}새 사진을 찍으면 여기에서 이어서 고를 수 있어요.
      </ThemedText>
      <Pressable onPress={() => router.push('/day')} hitSlop={8}>
        <ThemedText type="small" style={{ color: theme.accent }}>
          지난 날짜의 사진 다시 보기
        </ThemedText>
      </Pressable>
    </Centered>
  );
}

/** "오늘 15:12", "10월 24일 15:12" */
function formatMoment(ms: number) {
  const date = new Date(ms);
  const day =
    toDateKey(date) === todayKey() ? '오늘' : `${date.getMonth() + 1}월 ${date.getDate()}일`;
  return `${day} ${formatTime(date.toISOString())}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  startPoint: { paddingHorizontal: Spacing.four },
  startOptions: { alignSelf: 'stretch', gap: Spacing.two },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingTop: Spacing.two,
  },
  title: { fontSize: 22, lineHeight: 30, fontWeight: 700 },
  prompt: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
