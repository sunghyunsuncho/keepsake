import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MomentPhoto } from '@/components/moment-photo';
import { Spacing } from '@/constants/theme';
import { ALL_ALBUM_ID, listAlbumMoments, listOnThisDay } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import type { Moment } from '@/db/moments';
import { formatFullDate } from '@/lib/dates';
import { sortForGallery } from '@/lib/gallery';

// 전체 화면으로 보기: 앨범(또는 '몇 년 전 오늘')의 사진을 옆으로 넘겨 본다.
// 사진을 누르면 위아래 정보가 숨고, [기록 보기]로 메모를 열 수 있다.
export default function ViewerScreen() {
  const params = useLocalSearchParams<{ album?: string; onThisDay?: string; moment: string }>();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const [chrome, setChrome] = useState(true);
  // 기록 화면을 위에 띄웠을 때는 그 화면의 상태 표시줄을 쓴다.
  const focused = useIsFocused();
  const [index, setIndex] = useState(0);

  const { data: loaded } = useDbQuery(
    () =>
      params.onThisDay
        ? listOnThisDay(db, params.onThisDay).then((groups) => groups.flatMap((g) => g.moments))
        : listAlbumMoments(db, params.album ?? ALL_ALBUM_ID).then(sortForGallery),
    [db, params.album, params.onThisDay],
  );
  const moments = loaded ?? null;
  // 기록 화면에서 지우고 돌아오면 목록이 줄어들 수 있다.
  // iOS는 맨 앞에서 더 당기면 스크롤 위치가 음수가 되어 index가 -1이 될 수 있다.
  const currentIndex = Math.max(Math.min(index, (moments?.length ?? 1) - 1), 0);
  const current: Moment | undefined = moments?.[currentIndex];

  return (
    <View style={styles.screen}>
      {focused && <StatusBar style="light" hidden={!chrome} />}
      {!moments ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : moments.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.caption}>보여줄 사진이 없어요.</Text>
        </View>
      ) : (
        <Pager
          moments={moments}
          initialId={params.moment}
          onIndexChange={setIndex}
          onTap={() => setChrome((v) => !v)}
        />
      )}

      {chrome && (
        <View style={[styles.top, { paddingTop: insets.top + Spacing.two }]} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} hitSlop={16} accessibilityLabel="닫기">
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {moments && moments.length > 1 && (
            <Text style={styles.counter}>
              {currentIndex + 1} / {moments.length}
            </Text>
          )}
        </View>
      )}

      {chrome && current && (
        <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.flex}>
            <Text style={styles.caption}>
              {[formatFullDate(current.taken_at, current.taken_tz_offset), current.place_name]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {current.memo.trim() !== '' && (
              <Text style={styles.memo} numberOfLines={2}>
                {current.memo}
              </Text>
            )}
          </View>
          <Pressable
            onPress={() => router.push({ pathname: '/moment/[id]', params: { id: current.id } })}
            style={({ pressed }) => [styles.open, { opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name="document-text-outline" size={18} color="#fff" />
            <Text style={styles.openText}>기록 보기</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Pager({
  moments,
  initialId,
  onIndexChange,
  onTap,
}: {
  moments: Moment[];
  initialId: string;
  onIndexChange: (index: number) => void;
  onTap: () => void;
}) {
  const { width, height } = useWindowDimensions();
  // 처음 연 사진에서 시작한다. 그 사이 기록이 지워져 없으면 맨 앞에서.
  const [start] = useState(() => Math.max(moments.findIndex((m) => m.id === initialId), 0));
  useEffect(() => onIndexChange(start), [start, onIndexChange]);

  return (
    <FlatList
      data={moments}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      initialScrollIndex={start}
      getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      keyExtractor={(m) => m.id}
      windowSize={3}
      initialNumToRender={1}
      maxToRenderPerBatch={2}
      // 넘기는 도중 반을 넘으면 바뀐 사진으로 친다 (같은 값이면 다시 그리지 않는다).
      scrollEventThrottle={32}
      onScroll={(e) => onIndexChange(Math.round(e.nativeEvent.contentOffset.x / width))}
      renderItem={({ item }) => (
        <Pressable onPress={onTap} style={{ width, height }}>
          <MomentPhoto moment={item} variant="original" style={{ width, height }} contentFit="contain" explainMissing />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  counter: { color: '#fff', fontSize: 15, fontWeight: 600 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  caption: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: 600 },
  memo: { color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 20, marginTop: Spacing.one },
  open: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  openText: { color: '#fff', fontSize: 14, fontWeight: 700 },
});
