import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AlbumNameSheet } from '@/components/album-name-sheet';
import { Button } from '@/components/button';
import { GalleryHeader, STICKY_HEADER_HEIGHT, StoryCard, TileRow } from '@/components/gallery';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  ALL_ALBUM_ID,
  deleteAlbum,
  getAlbumTitle,
  listAlbumMoments,
  renameAlbum,
  updateAlbumMoments,
} from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import type { Moment } from '@/db/moments';
import { ALBUM_ZOOMS, DEFAULT_SETTINGS, getSettings, setSetting, type AlbumZoom } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { localDateKey } from '@/lib/dates';
import { anchorIndex, firstMomentOf, galleryRows, type GalleryRow } from '@/lib/gallery';

const ZOOM_LABELS: Record<AlbumZoom, string> = { year: '연도', month: '월', day: '일', story: '이야기' };
/** 손가락을 이만큼 벌리거나 모으면 한 단계 바꾼다. */
const PINCH_STEP = 1.25;
const VIEWABILITY = { itemVisiblePercentThreshold: 50 };

type Anchor = { id: string; day: string };

// 앨범 하나: 해 → 달 → 날 → 이야기 순으로 당겨 보고(두 손가락 또는 위의 단계 버튼), 사진을 누르면 크게 본다.
export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { data: title } = useDbQuery(() => getAlbumTitle(db, id), [db, id]);
  const { data: moments } = useDbQuery(() => listAlbumMoments(db, id), [db, id]);
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const [renaming, setRenaming] = useState(false);
  // 단계를 바꾼 뒤 처음 보여줄 위치. 바꾸기 직전에 보던 기록이다.
  const [view, setView] = useState<{ zoom: AlbumZoom; anchor: Anchor | null } | null>(null);
  const zoom = view?.zoom ?? settings?.album_zoom ?? DEFAULT_SETTINGS.album_zoom;
  const isCustom = id !== ALL_ALBUM_ID;

  const rows = useMemo(() => (moments ? galleryRows(moments, zoom) : []), [moments, zoom]);
  const stickyHeaderIndices = useMemo(
    () => rows.flatMap((row, index) => (row.type === 'header' && row.sticky ? [index] : [])),
    [rows],
  );
  // 목록은 단계마다 새로 그리므로(key) 처음 위치만 정하면 된다.
  const initialIndex = useMemo(() => anchorIndex(rows, view?.anchor ?? null), [rows, view]);
  const list = useRef<FlashListRef<GalleryRow>>(null);
  // 처음 위치는 줄 높이를 재기 전 추정값이라(이야기 카드) 그린 뒤 다시 맞춘다.
  // 묶음 중간에서 시작하면 위에 붙은 머리글이 첫 줄을 가리므로 그만큼 내려 보여준다.
  const onLoad = () => {
    if (initialIndex === 0) return;
    const row = rows[initialIndex];
    const covered = !(row?.type === 'header' && row.sticky);
    list.current?.scrollToIndex({
      index: initialIndex,
      viewOffset: covered ? STICKY_HEADER_HEIGHT : 0,
      animated: false,
    });
  };

  // 지금 화면 맨 위에 보이는 기록
  const visible = useRef<Anchor | null>(null);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<GalleryRow>[] }) => {
    for (const token of viewableItems) {
      const moment = token.item && firstMomentOf(token.item);
      if (moment) {
        visible.current = { id: moment.id, day: localDateKey(moment.taken_at, moment.taken_tz_offset) };
        return;
      }
    }
  }).current;

  const changeZoom = (next: AlbumZoom, anchor: Anchor | null = visible.current) => {
    if (next === zoom) return;
    setView({ zoom: next, anchor });
    setSetting(db, 'album_zoom', next);
  };
  const stepZoom = (delta: 1 | -1) => {
    const next = ALBUM_ZOOMS[ALBUM_ZOOMS.indexOf(zoom) + delta];
    if (next) changeZoom(next);
  };

  // 두 손가락: 벌리면 가깝게, 모으면 넓게. 손을 떼면 한 단계 바꾼다. 움직이는 동안은 살짝 커지고 작아져 보이게 한다.
  const scale = useSharedValue(1);
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(e.scale, 0.85), 1.15);
    })
    .onEnd((e) => {
      if (e.scale >= PINCH_STEP) stepZoom(1);
      else if (e.scale <= 1 / PINCH_STEP) stepZoom(-1);
    })
    .onFinalize(() => {
      scale.value = withTiming(1, { duration: 150 });
    });
  const pinchStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const openViewer = (moment: Moment) =>
    router.push({ pathname: '/viewer', params: { album: id, moment: moment.id } });
  const openMoment = (moment: Moment) => router.push({ pathname: '/moment/[id]', params: { id: moment.id } });

  // 꾹 누르기: 기록 열기, 만든 앨범이면 앨범에서 빼기도.
  const showActions = (moment: Moment) => {
    Alert.alert('', undefined, [
      { text: '기록 열기', onPress: () => openMoment(moment) },
      ...(isCustom
        ? [
            {
              text: '이 앨범에서 빼기',
              style: 'destructive' as const,
              onPress: () => updateAlbumMoments(db, id, { remove: [moment.id] }),
            },
          ]
        : []),
      { text: '취소', style: 'cancel' },
    ]);
  };

  const showAlbumMenu = () => {
    Alert.alert(title ?? '', undefined, [
      { text: '이름 바꾸기', onPress: () => setRenaming(true) },
      {
        text: '앨범 지우기',
        style: 'destructive',
        onPress: () =>
          Alert.alert('앨범을 지울까요?', '앨범만 지워지고, 들어 있던 기록은 그대로 남아요.', [
            { text: '취소', style: 'cancel' },
            {
              text: '지우기',
              style: 'destructive',
              onPress: () => {
                router.back();
                deleteAlbum(db, id);
              },
            },
          ]),
      },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const header = (
    <Stack.Screen
      options={{
        title: title ?? '',
        headerRight: isCustom
          ? () => (
              <View style={styles.headerButtons}>
                <HeaderIcon
                  icon="add"
                  label="사진 넣고 빼기"
                  onPress={() => router.push({ pathname: '/albums/[id]/add', params: { id } })}
                />
                <HeaderIcon icon="ellipsis-horizontal" label="앨범 메뉴" onPress={showAlbumMenu} />
              </View>
            )
          : undefined,
      }}
    />
  );

  if (title === null) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title: '' }} />
        <ThemedText themeColor="textSecondary">이 앨범을 찾을 수 없어요.</ThemedText>
      </ThemedView>
    );
  }
  // 설정을 읽기 전에 그리면 기본 단계로 그렸다가 저장된 단계로 다시 그린다.
  if (!moments || !settings) {
    return (
      <ThemedView style={styles.centered}>
        {header}
        <ActivityIndicator />
      </ThemedView>
    );
  }
  if (moments.length === 0) {
    return (
      <ThemedView style={styles.centered}>
        {header}
        {isCustom ? (
          <>
            <ThemedText themeColor="textSecondary" style={styles.center}>
              아직 넣은 사진이 없어요.{'\n'}남긴 사진 중에서 이 앨범에 넣을 사진을 골라 보세요.
            </ThemedText>
            <Button
              label="사진 넣기"
              onPress={() => router.push({ pathname: '/albums/[id]/add', params: { id } })}
            />
          </>
        ) : (
          <>
            <ThemedText themeColor="textSecondary" style={styles.center}>
              아직 남긴 사진이 없어요.{'\n'}십 년 뒤에도 다시 보고 싶은 몇 장을 골라 보세요.
            </ThemedText>
            <Button label="사진 고르러 가기" onPress={() => router.navigate('/')} />
          </>
        )}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.flex}>
      {header}
      <ZoomBar value={zoom} onChange={(next) => changeZoom(next)} />
      <GestureDetector gesture={pinch}>
        <Animated.View style={[styles.flex, pinchStyle]}>
          <FlashList
            ref={list}
            key={zoom}
            data={rows}
            keyExtractor={(row) => row.key}
            getItemType={(row) => (row.type === 'tiles' ? `tiles-${row.columns}` : row.type)}
            stickyHeaderIndices={stickyHeaderIndices}
            initialScrollIndex={initialIndex}
            onLoad={onLoad}
            // 위로 거의 지나간 줄을 '보던 기록'으로 잡지 않도록 반 이상 보이는 줄만 센다.
            viewabilityConfig={VIEWABILITY}
            onViewableItemsChanged={onViewableItemsChanged}
            contentContainerStyle={{ paddingBottom: Spacing.five }}
            renderItem={({ item }) => {
              if (item.type === 'header') {
                return <GalleryHeader title={item.title} subtitle={item.subtitle} sticky={item.sticky} />;
              }
              if (item.type === 'card') {
                return (
                  <StoryCard
                    moment={item.moment}
                    onOpenPhoto={() => openViewer(item.moment)}
                    onOpenMoment={() => openMoment(item.moment)}
                    onLongPress={() => showActions(item.moment)}
                  />
                );
              }
              return (
                <TileRow
                  moments={item.moments}
                  columns={item.columns}
                  framed={zoom === 'day'}
                  // 해 단계에서 누르면 그 달로 당겨 보고, 그 밖에는 크게 본다.
                  onPress={(moment) =>
                    zoom === 'year'
                      ? changeZoom('month', {
                          id: moment.id,
                          day: localDateKey(moment.taken_at, moment.taken_tz_offset),
                        })
                      : openViewer(moment)
                  }
                  onLongPress={showActions}
                />
              );
            }}
          />
        </Animated.View>
      </GestureDetector>

      <AlbumNameSheet
        visible={renaming}
        heading="앨범 이름 바꾸기"
        initial={title ?? ''}
        confirmLabel="바꾸기"
        onSubmit={(next) => {
          setRenaming(false);
          renameAlbum(db, id, next);
        }}
        onCancel={() => setRenaming(false)}
      />
    </ThemedView>
  );
}

function ZoomBar({ value, onChange }: { value: AlbumZoom; onChange: (zoom: AlbumZoom) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.zoomBar, { backgroundColor: theme.backgroundElement }]}>
      {ALBUM_ZOOMS.map((zoom) => {
        const selected = zoom === value;
        return (
          <Pressable
            key={zoom}
            onPress={() => onChange(zoom)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[styles.zoomItem, selected && { backgroundColor: theme.background }]}>
            <ThemedText type={selected ? 'smallBold' : 'small'} themeColor={selected ? 'text' : 'textSecondary'}>
              {ZOOM_LABELS[zoom]}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function HeaderIcon({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel={label} style={styles.headerIcon}>
      <Ionicons name={icon} size={24} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  headerButtons: { flexDirection: 'row', gap: Spacing.two },
  headerIcon: { padding: Spacing.one },
  zoomBar: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    marginVertical: Spacing.two,
    padding: Spacing.half,
    borderRadius: Spacing.two,
  },
  zoomItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two - Spacing.half,
  },
});
