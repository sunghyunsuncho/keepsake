import { FlashList } from '@shopify/flash-list';
import type { Asset } from 'expo-media-library';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

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
import { momentIdsByAsset } from '@/db/moments';
import { DEFAULT_SETTINGS, getSettings, setSetting } from '@/db/settings';
import { usePhotoSelection, type SavedItem } from '@/hooks/use-photo-selection';
import { addDays, formatDay, isDateKey, parseDateKey, toDateKey, todayKey } from '@/lib/dates';
import { getDayPhotos, subscribeLibraryChanges, usePhotoAccess } from '@/lib/photos';

// 날짜로 보기: 특정 날의 사진을 다시 살펴보고 고른다. 고르기 화면의 '어디까지 봤는지'와는 상관없다.
export default function DayScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const db = useSQLiteContext();
  const { access } = usePhotoAccess();
  const [dateKey, setDateKey] = useState(isDateKey(params.date) ? params.date : todayKey());
  const [choosingDate, setChoosingDate] = useState(false);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [justSaved, setJustSaved] = useState<SavedItem[]>([]);

  useEffect(() => subscribeLibraryChanges(() => setLibraryVersion((v) => v + 1)), []);

  // 날짜가 바뀔 때만 화면을 비운다. 보관함 변경으로 다시 읽을 때는 이전 목록을 둔 채 바꾼다.
  useEffect(() => setAssets(null), [dateKey]);

  useEffect(() => {
    // 권한 상태를 확인하기 전에 한 번, 확인한 뒤에 또 한 번 읽지 않도록 기다린다.
    if (access === null) return;
    let cancelled = false;
    getDayPhotos(dateKey)
      .then((result) => !cancelled && setAssets(result))
      .catch(() => !cancelled && setAssets((prev) => prev ?? []));
    return () => {
      cancelled = true;
    };
  }, [dateKey, libraryVersion, access]);

  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const assetIds = useMemo(() => assets?.map((a) => a.id) ?? [], [assets]);
  const { data: saved = new Map<string, string>() } = useDbQuery(
    () => momentIdsByAsset(db, assetIds),
    [db, assetIds],
  );
  const selection = usePhotoSelection(db, saved);

  const recommended = settings?.daily_recommended_count ?? DEFAULT_SETTINGS.daily_recommended_count;
  const columns = settings?.pick_grid_columns ?? DEFAULT_SETTINGS.pick_grid_columns;
  const tileWidth = useTileWidth(columns);
  const savedAssets = assets?.filter((a) => saved.has(a.id)) ?? [];
  const isToday = dateKey === todayKey();

  // 완료하지 않은 선택이 있으면 다른 날로 가기 전에 묻는다.
  const goToDay = (next: string) => {
    if (next === dateKey) return;
    const move = () => {
      selection.clear();
      setJustSaved([]);
      setDateKey(next);
    };
    if (selection.draft.length === 0) return move();
    Alert.alert(
      '고른 사진을 남기지 않고 이동할까요?',
      `${selection.draft.length}장을 골랐지만 아직 남기지 않았어요.`,
      [
        { text: '머무르기', style: 'cancel' },
        { text: '이동', style: 'destructive', onPress: move },
      ],
    );
  };

  const complete = async () => {
    setJustSaved(await selection.complete(assets ?? []));
  };

  const savedItems = savedAssets.map((a) => ({ momentId: saved.get(a.id)!, uri: a.uri }));

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.dayHeader}>
        <IconButton
          icon="chevron-back"
          label="이전 날"
          onPress={() => goToDay(addDays(dateKey, -1))}
        />
        <Pressable onPress={() => setChoosingDate(true)} style={styles.dayTitle} hitSlop={8}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {isToday ? '오늘' : ' '}
          </ThemedText>
          <ThemedText style={styles.dayText}>{formatDay(dateKey)}</ThemedText>
        </Pressable>
        <IconButton
          icon="chevron-forward"
          label="다음 날"
          disabled={isToday}
          onPress={() => goToDay(addDays(dateKey, 1))}
        />
      </View>

      <View style={styles.toolbar}>
        <DayDots
          saved={savedAssets.length}
          picked={selection.draft.length}
          recommended={recommended}
        />
        <ColumnToggle
          value={columns}
          onChange={(next) => setSetting(db, 'pick_grid_columns', next)}
        />
      </View>

      {access === 'limited' && (
        <LimitedAccessBanner onChanged={() => setLibraryVersion((v) => v + 1)} />
      )}

      {assets === null ? (
        <Centered>
          <ActivityIndicator />
        </Centered>
      ) : assets.length === 0 ? (
        <Centered>
          <ThemedText themeColor="textSecondary">이날 찍은 사진이 없어요.</ThemedText>
          <Button label="다른 날 보기" variant="secondary" onPress={() => setChoosingDate(true)} />
        </Centered>
      ) : (
        <FlashList
          // 열 수가 바뀌면 배치를 처음부터 다시 계산한다.
          key={columns}
          data={assets}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          extraData={{ saved, draft: selection.draft }}
          contentContainerStyle={{ padding: GRID_GAP / 2 }}
          renderItem={({ item }) => (
            <PhotoTile
              asset={item}
              width={tileWidth}
              height={tileHeightFor(item, tileWidth, columns)}
              state={
                saved.has(item.id) ? 'saved' : selection.draft.includes(item.id) ? 'picked' : 'none'
              }
              order={selection.draft.indexOf(item.id) + 1}
              onPress={() => selection.toggle(item)}
            />
          )}
        />
      )}

      {selection.draft.length > 0 || selection.saving ? (
        <BottomBar
          title={
            selection.saving
              ? `남기는 중… ${selection.saving.done}/${selection.saving.total}`
              : `${selection.draft.length}장 골랐어요`
          }
          subtitle="남기면 사진첩 탭에서 다시 볼 수 있어요"
          secondary={{ label: '선택 해제', onPress: selection.clear }}
          action={{ label: '남기기', onPress: complete, loading: !!selection.saving }}
        />
      ) : savedItems.length > 0 ? (
        <SavedTray
          items={savedItems}
          title={
            justSaved.length > 0
              ? `${justSaved.length}장을 남겼어요. 눌러서 그때의 기억을 적어 보세요`
              : '남긴 사진을 눌러 그때의 기억을 적어 보세요'
          }
          onOpen={(id) => router.push({ pathname: '/moment/[id]', params: { id } })}
        />
      ) : null}

      <DateSheet
        visible={choosingDate}
        value={parseDateKey(dateKey)}
        mode="date"
        maximumDate={new Date()}
        onConfirm={(date) => {
          setChoosingDate(false);
          goToDay(toDateKey(date));
        }}
        onCancel={() => setChoosingDate(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
  },
  dayTitle: { alignItems: 'center' },
  dayText: { fontSize: 20, lineHeight: 28, fontWeight: 700 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
