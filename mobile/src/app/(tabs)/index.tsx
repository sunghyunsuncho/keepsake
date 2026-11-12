import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList, type ViewToken } from '@shopify/flash-list';
import type { Asset } from 'expo-media-library';
import { router, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { AlbumNameSheet } from '@/components/album-name-sheet';
import { DateSheet } from '@/components/date-sheet';
import { AlbumSectionHeader, MomentsRowCard } from '@/components/album-shelf';
import {
  BottomBar,
  Centered,
  ColumnToggle,
  GRID_GAP,
  IconButton,
  LimitedAccessBanner,
  PhotoTile,
  tileHeightFor,
  useTileWidth,
} from '@/components/pick';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { createAlbum, getAlbumTitle, listAlbums, updateAlbumMoments } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { listRecentlySavedMoments, momentIdsByAsset } from '@/db/moments';
import { getSettings, setSetting, type Settings } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { dayKeyOf, usePhotoSelection } from '@/hooks/use-photo-selection';
import { formatDay, formatTime, toDateKey, todayKey } from '@/lib/dates';
import {
  addCleanupCandidates,
  keepCleanupCandidates,
  photosLeftBehind,
  setCleanupPhotos,
  withoutKeptPhotos,
} from '@/lib/cleanup';
import { firstPhotoDate, getPhotosSince, subscribeLibraryChanges, usePhotoAccess } from '@/lib/photos';
import { checkMissedPhotos, clearMissedPhotos, loadMissedPhotos } from '@/lib/missed-photos';
import { markReviewed, offerReminders } from '@/lib/reminders';
import { inboxTitle, photoCount, reviewedUntil, selectionSummary, useTranslation } from '@/lib/i18n';

export default function PickScreen() {
  const db = useSQLiteContext();
  const { access, canAskAgain, request } = usePhotoAccess();
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const targetAlbumId = settings?.picking_album_id ?? null;
  const { data: targetAlbumTitle } = useDbQuery(
    () => (targetAlbumId ? getAlbumTitle(db, targetAlbumId) : Promise.resolve(null)),
    [db, targetAlbumId],
  );

  // 앨범을 지운 뒤 고르기 화면이 남아 있으면 기기에 저장한 대상 ID가 오래된 값일 수 있다.
  // 그 상태에서 다음 사진을 엉뚱하게 기본 보관함에만 남기지 않도록 먼저 대상 확인을 끝낸다.
  useEffect(() => {
    if (targetAlbumId && targetAlbumTitle === null) {
      setSetting(db, 'picking_album_id', null).catch(() => {});
    }
  }, [db, targetAlbumId, targetAlbumTitle]);

  const loading = access === null || !settings || (targetAlbumId !== null && targetAlbumTitle === undefined);
  const needsPermission = access === 'undetermined' || access === 'denied';
  let content;
  if (loading) {
    content = (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  } else if (needsPermission) {
    content = (
      <PermissionIntro denied={access === 'denied'} canAskAgain={canAskAgain} onRequest={request} />
    );
  } else if (settings.review_cursor === null) {
    content = <StartPoint />;
  } else {
    content = (
      <Inbox
        limited={access === 'limited'}
        cursor={settings.review_cursor}
        settings={settings}
        targetAlbum={targetAlbumTitle ? { id: targetAlbumId!, title: targetAlbumTitle } : null}
      />
    );
  }

  return (
    // 머리글(제목·알림 버튼)은 다른 탭과 같은 탭 머리글을 쓴다. 사진 목록은 제목을 바꾼다(Inbox).
    <ThemedView style={styles.flex}>{content}</ThemedView>
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
  const theme = useTheme();
  const { language } = useTranslation();
  const [choosingDate, setChoosingDate] = useState(false);
  const [startingArchive, setStartingArchive] = useState(false);

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
  const startFromBeginning = async () => {
    setStartingArchive(true);
    try {
      const first = await firstPhotoDate();
      if (first) startFrom(first);
    } finally {
      setStartingArchive(false);
    }
  };

  const since = (date: Date) => {
    const locale = language === 'en' ? 'en-US' : language === 'ja' ? 'ja-JP' : 'ko-KR';
    const day = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(date);
    return language === 'en' ? `From ${day}` : language === 'ja' ? `${day}から` : `${day}부터`;
  };

  return (
    <ScrollView contentContainerStyle={styles.startPoint}>
      <View style={styles.startHeading}>
        <View style={[styles.startIcon, { backgroundColor: theme.accent + '18' }]}>
          <Ionicons name="film-outline" size={26} color={theme.accent} />
        </View>
        <ThemedText style={styles.startTitle} lineBreakStrategyIOS="hangul-word">
          어디서부터 고를까요?
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.center} lineBreakStrategyIOS="hangul-word">
          필름 한 롤을 다 찍고 고르듯, 살펴본 사진 다음부터 차례로 보여 드려요.
        </ThemedText>
      </View>
      {/* 항목 사이의 가는 선은 바탕(border)이 gap으로 비쳐 보이게 그린다. */}
      <View style={[styles.startOptions, { backgroundColor: theme.border }]}>
        <StartOption
          icon="today-outline"
          label="오늘 찍은 사진부터"
          detail="지금부터 찍는 사진을 가볍게 골라요"
          recommended
          onPress={() => startFrom(new Date())}
        />
        <StartOption icon="calendar-outline" label="최근 1주" detail={since(daysAgo(6))} onPress={() => startFrom(daysAgo(6))} />
        <StartOption icon="calendar-outline" label="최근 한 달" detail={since(daysAgo(30))} onPress={() => startFrom(daysAgo(30))} />
        <StartOption
          icon="calendar-number-outline"
          label="날짜 고르기"
          detail="원하는 날부터 시작해요"
          onPress={() => setChoosingDate(true)}
        />
        <StartOption
          icon="albums-outline"
          label="처음부터 조금씩 고르기"
          detail={startingArchive ? '사진을 찾는 중…' : '가장 오래된 사진부터 차례로 봐요'}
          loading={startingArchive}
          onPress={startFromBeginning}
        />
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center} lineBreakStrategyIOS="hangul-word">
        중간에 멈춰도 다음에 이어서 볼 수 있어요.
      </ThemedText>
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
    </ScrollView>
  );
}

function StartOption({
  icon,
  label,
  detail,
  recommended,
  loading,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  recommended?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.startOption,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <View style={[styles.startOptionIcon, { backgroundColor: recommended ? theme.accent : theme.background }]}>
        <Ionicons name={icon} size={18} color={recommended ? theme.onAccent : theme.textSecondary} />
      </View>
      <View style={styles.flex}>
        <View style={styles.startOptionLabel}>
          <ThemedText type="smallBold">{label}</ThemedText>
          {recommended && (
            <View style={[styles.startBadge, { backgroundColor: theme.accent + '18' }]}>
              <ThemedText style={[styles.startBadgeText, { color: theme.accent }]}>추천</ThemedText>
            </View>
          )}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      {loading ? <ActivityIndicator /> : <Ionicons name="chevron-forward" size={18} color={theme.chevron} />}
    </Pressable>
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
  targetAlbum,
}: {
  limited: boolean;
  cursor: string;
  settings: Settings;
  targetAlbum: { id: string; title: string } | null;
}) {
  const db = useSQLiteContext();
  const { language } = useTranslation();
  const navigation = useNavigation();
  const title = inboxTitle(language, targetAlbum?.title ?? null);
  // 제목은 탭 머리글에 둔다. 알림 버튼 위치가 다른 탭과 같아지도록 머리글을 직접 그리지 않는다.
  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: title });
    return () => navigation.setOptions({ headerTitle: undefined });
  }, [navigation, title]);
  // 예전에 미래 시각으로 저장된 지점이 있어도 지금 찍는 사진이 숨지 않게 현재 시각을 넘지 않게 한다.
  const cursorMs = useMemo(() => Math.min(new Date(cursor).getTime(), Date.now()), [cursor]);
  const [roll, setRoll] = useState<Roll | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [seenUntil, setSeenUntil] = useState(cursorMs);
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
  // 살펴보고 남기지 않은 사진은 정리 후보에 더한다 (기기 설정에 남아 [그대로 두기]나 정리 전까지 유지된다).
  const addLeftBehind = (next: Asset[]) => addCleanupCandidates(db, next);

  const complete = async () => {
    const picked = shown.filter((a) => selection.draft.includes(a.id));
    const items = await selection.complete(shown);
    // 고른 사진이 그 사이 모두 지워졌으면 선택만 비운다. 지점을 옮기거나 정리를 권하지 않는다.
    if (picked.length === 0) return;
    // 실패해서 선택에 남은 사진이 있으면, 그 사진이 사라지지 않도록 지점을 옮기지 않는다.
    if (items.length === picked.length) {
      const seen = Math.max(seenUntil, ...picked.map((a) => a.creationTime));
      await addLeftBehind(
        await withoutKeptPhotos(
          photosLeftBehind(
            shown,
            [...saved.keys(), ...picked.map((a) => a.id)],
            Math.min(seen, Date.now()),
          ),
        ),
      );
      await moveCursor(seen);
    }
    if (items.length > 0) {
      if (targetAlbum) await updateAlbumMoments(db, targetAlbum.id, { add: items.map((item) => item.momentId) });
      await markReviewed(db);
      offerReminders(db);
    }
  };

  const markSeen = async () => {
    await addLeftBehind(await withoutKeptPhotos(photosLeftBehind(shown, saved.keys(), Math.min(seenUntil, Date.now()))));
    await moveCursor(seenUntil);
    await markReviewed(db);
  };

  // 날짜 묶음에서 바로 진행을 확정한다. 이 날짜보다 앞선 사진도 함께 본 것으로 처리된다.
  const markSeenThroughDay = (dayAssets: Asset[]) => {
    if (selection.draft.length > 0) {
      Alert.alert('먼저 고른 사진을 남겨 주세요', '선택을 해제하거나 [남기기]를 누른 뒤 진행할 수 있어요.');
      return;
    }
    const through = Math.min(Math.max(...dayAssets.map((asset) => asset.creationTime)), Date.now());
    Alert.alert('이 날짜까지 확인할까요?', '이 날짜까지의 사진은 다음 고르기에서 건너뛰어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '확인',
        onPress: async () => {
          await addLeftBehind(await withoutKeptPhotos(photosLeftBehind(shown, saved.keys(), through)));
          setSeenUntil((previous) => Math.max(previous, through));
          await moveCursor(through);
          await markReviewed(db);
        },
      },
    ]);
  };

  // 살펴볼 사진이 있을 때만 사진 수와 보기(한 줄에 몇 장) 버튼을 보여준다. 모두 살펴봤으면 필요 없다.
  const hasPhotos = !!roll && (assets.length > 0 || missed.length > 0);
  const header = (hasPhotos || targetAlbum) && (
    <View style={styles.header}>
      <View style={styles.flex}>
        <ThemedText type="small" themeColor="textSecondary">
          {roll && roll.assets.length > 0
            ? `${formatDay(dayKeyOf(roll.assets[0]))}부터 ${roll.totalCount}장`
            : ' '}
        </ThemedText>
      </View>
      {hasPhotos && <ColumnToggle value={columns} onChange={(next) => setSetting(db, 'pick_grid_columns', next)} />}
      {targetAlbum && (
        <IconButton
          icon="close"
          label="앨범에 담기 마치기"
          onPress={() => setSetting(db, 'picking_album_id', null)}
        />
      )}
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
  // 정리 후보: 살펴보고 남기지 않은 사진. 지난 사진 다시 보기와 같은 카드로, 정리하거나 넘어갈 수 있다.
  const candidates = settings.cleanup_candidate_ids;
  const cleanupCard = candidates.length > 0 && (
    <CleanupCard
      count={candidates.length}
      onKeep={() => keepCleanupCandidates(db)}
      // 정리 화면에서 취소하고 돌아와도 카드는 남는다. 실제로 정리를 마치면 finishCleanup이 후보에서 뺀다.
      onCleanup={() => {
        setCleanupPhotos(candidates);
        router.push('/cleanup');
      }}
    />
  );

  return (
    <View style={styles.flex}>
      {header}
      {limited && <LimitedAccessBanner onChanged={() => setLibraryVersion((v) => v + 1)} />}

      {assets.length === 0 && missed.length === 0 ? (
        <AllCaughtUp cursor={cursorMs} cleanup={cleanupCard} />
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary" style={styles.prompt}>
            십 년 뒤에도 다시 보고 싶은 사진만 골라 남겨 보세요.
          </ThemedText>
          {cleanupCard && <View style={styles.inlineCleanup}>{cleanupCard}</View>}
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
                  onMarkSeen={() => markSeenThroughDay(item.assets)}
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

      {assets.length === 0 &&
        missed.length === 0 &&
        selection.draft.length === 0 &&
        !selection.saving && <SavedMomentsLink />}

      {selection.draft.length > 0 || selection.saving ? (
        <BottomBar
          title={
            selection.saving
              ? `남기는 중… ${selection.saving.done}/${selection.saving.total}`
              : selectionSummary(language, selection.draft.length)
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
  onMarkSeen,
}: {
  dateKey: string;
  count: number;
  saved: number;
  picked: number;
  onMarkSeen: () => void;
}) {
  const theme = useTheme();
  const { language } = useTranslation();
  return (
    <View style={styles.dayHeader}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">
          {dateKey === todayKey() ? `오늘 · ${formatDay(dateKey)}` : formatDay(dateKey)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {photoCount(language, count)}{saved > 0 ? (language === 'en' ? ` · ${photoCount(language, saved)} saved` : language === 'ja' ? ` · ${photoCount(language, saved)}を保存` : ` · ${photoCount(language, saved)} 남김`) : picked > 0 ? (language === 'en' ? ` · ${photoCount(language, picked)} selected` : language === 'ja' ? ` · ${photoCount(language, picked)}を選択` : ` · ${photoCount(language, picked)} 고름`) : ''}
        </ThemedText>
      </View>
      <Pressable
        onPress={onMarkSeen}
        accessibilityRole="button"
        accessibilityLabel="이 날짜까지 확인하고 다음부터 건너뛰기"
        hitSlop={8}
        style={styles.dayComplete}>
        <Ionicons name="checkmark-circle-outline" size={17} color={theme.accent} />
        <ThemedText type="smallBold" style={{ color: theme.accent }}>
          확인
        </ThemedText>
      </Pressable>
    </View>
  );
}

function MissedHeader({ count }: { count: number }) {
  const { language } = useTranslation();
  return (
    <View style={styles.dayHeader}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">{language === 'en' ? `${photoCount(language, count)} missed` : language === 'ja' ? `見逃した写真 ${photoCount(language, count)}` : `놓친 사진 ${photoCount(language, count)}`}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          예전에 찍었지만 나중에 보관함에 들어온 사진이에요
        </ThemedText>
      </View>
    </View>
  );
}

function AllCaughtUp({ cursor, cleanup }: { cursor: number; cleanup: React.ReactNode }) {
  const theme = useTheme();
  const { language } = useTranslation();
  return (
    <Centered>
      <Ionicons name="checkmark-circle-outline" size={40} color={theme.accent} />
      <ThemedText style={styles.center}>새로 찍은 사진을 모두 살펴봤어요</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {reviewedUntil(language, formatMoment(cursor))}
      </ThemedText>
      <Pressable
        onPress={() => router.push('/day')}
        accessibilityRole="button"
        style={[styles.pastPhotosCard, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.pastPhotosIcon, { backgroundColor: theme.accent + '18' }]}>
          <Ionicons name="time-outline" size={20} color={theme.accent} />
        </View>
        <View style={styles.flex}>
          <ThemedText type="smallBold">지난 사진 다시 보기</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            예전 사진도 다시 골라 남겨요
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </Pressable>
      {cleanup}
    </Centered>
  );
}

/** 살펴보고 남기지 않은 사진을 정리할지 묻는 카드. 지난 사진 다시 보기 카드와 같은 모양이다. 정리 화면으로 가기 전에는 사진을 전혀 건드리지 않는다. */
function CleanupCard({ count, onCleanup, onKeep }: { count: number; onCleanup: () => void; onKeep: () => void }) {
  const theme = useTheme();
  const { language } = useTranslation();
  return (
    <View style={[styles.pastPhotosCard, styles.cleanupCard, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.cleanupHeading}>
        <View style={[styles.pastPhotosIcon, { backgroundColor: theme.accent + '18' }]}>
          <Ionicons name="leaf-outline" size={20} color={theme.accent} />
        </View>
        <View style={styles.flex}>
          <ThemedText type="smallBold">{language === 'en' ? `${photoCount(language, count)} to review` : language === 'ja' ? `整理候補 ${photoCount(language, count)}` : `정리 후보 ${photoCount(language, count)}`}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            남기지 않은 사진을 정리해요
          </ThemedText>
        </View>
      </View>
      <View style={styles.cleanupActions}>
        <Pressable onPress={onKeep} style={styles.cleanupButton} accessibilityRole="button">
          <ThemedText type="smallBold" themeColor="textSecondary">
            그대로 두기
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={onCleanup}
          style={[styles.cleanupButton, { backgroundColor: theme.accent }]}
          accessibilityRole="button">
          <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
            정리하기
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/** 고르기에서 남긴 사진은 사진첩의 기본 보관함으로 이어진다. 기기 사진첩 탭 맨 위와 같은 한 줄 카드와 새 앨범 버튼이다. */
function SavedMomentsLink() {
  const db = useSQLiteContext();
  const [naming, setNaming] = useState(false);
  const { data: albums } = useDbQuery(() => listAlbums(db), [db]);
  const { data: recentMoments } = useDbQuery(() => listRecentlySavedMoments(db, 3), [db]);
  const momentsAlbum = albums?.[0];

  const create = async (title: string) => {
    setNaming(false);
    const id = await createAlbum(db, title);
    router.push({ pathname: '/albums/[id]/add', params: { id } });
  };

  if (!momentsAlbum) return null;
  return (
    <>
      <View style={styles.momentsShortcut}>
        <AlbumSectionHeader title="기기 사진첩" actions={[{ icon: 'add', label: '새 앨범', onPress: () => setNaming(true) }]} />
        <MomentsRowCard album={momentsAlbum} moments={recentMoments} />
      </View>

      <AlbumNameSheet
        visible={naming}
        heading="새 앨범"
        confirmLabel="만들기"
        onSubmit={create}
        onCancel={() => setNaming(false)}
      />
    </>
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
  startPoint: { flexGrow: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.four },
  startHeading: { alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two },
  startIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  startTitle: { fontSize: 24, lineHeight: 32, fontWeight: 700, textAlign: 'center' },
  startOptions: { borderRadius: 16, overflow: 'hidden', gap: StyleSheet.hairlineWidth },
  startOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  startOptionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  startOptionLabel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.two },
  startBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  startBadgeText: { fontSize: 12, lineHeight: 18, fontWeight: 600 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
  },
  prompt: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  dayComplete: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  pastPhotosCard: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  momentsShortcut: { gap: Spacing.two, marginVertical: Spacing.three },
  pastPhotosIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  inlineCleanup: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  cleanupCard: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.three },
  cleanupHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cleanupActions: { flexDirection: 'row', gap: Spacing.two },
  cleanupButton: { flex: 1, minHeight: 40, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
});
