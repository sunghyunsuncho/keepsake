import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { listMoments, type Moment } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { formatDay, formatMonth, formatTime, localDateKey } from '@/lib/dates';
import { libraryUri } from '@/lib/storage';

type Row =
  | { type: 'month'; key: string; label: string }
  | { type: 'day'; key: string; label: string }
  | { type: 'moment'; key: string; moment: Moment };

// 시간순 사진첩: 최근 기록부터, 달과 날짜로 나눠 보여준다.
function toRows(moments: Moment[]): Row[] {
  // DB는 UTC 시각순이지만 묶음은 촬영지 날짜 기준이다. 시간대가 다른 사진이 섞이면 같은 날이
  // 두 번 나뉠 수 있으므로, 촬영지 날짜로 먼저 정렬한다(같은 날 안에서는 UTC 시각순 유지).
  const keyed = moments
    .map((moment) => ({ moment, dayKey: localDateKey(moment.taken_at, moment.taken_tz_offset) }))
    .sort((a, b) => (a.dayKey === b.dayKey ? 0 : a.dayKey < b.dayKey ? 1 : -1));

  const rows: Row[] = [];
  let month = '';
  let day = '';
  for (const { moment, dayKey } of keyed) {
    const monthKey = dayKey.slice(0, 7);
    if (monthKey !== month) {
      month = monthKey;
      rows.push({ type: 'month', key: `m-${monthKey}`, label: formatMonth(dayKey) });
    }
    if (dayKey !== day) {
      day = dayKey;
      rows.push({ type: 'day', key: `d-${dayKey}`, label: formatDay(dayKey) });
    }
    rows.push({ type: 'moment', key: moment.id, moment });
  }
  return rows;
}

export default function AlbumScreen() {
  const db = useSQLiteContext();
  const { data: moments } = useDbQuery(() => listMoments(db), [db]);
  const rows = useMemo(() => (moments ? toRows(moments) : []), [moments]);
  const stickyHeaderIndices = useMemo(
    () => rows.flatMap((row, index) => (row.type === 'month' ? [index] : [])),
    [rows],
  );

  if (!moments) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (moments.length === 0) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText themeColor="textSecondary" style={styles.center}>
          아직 남긴 사진이 없어요.{'\n'}십 년 뒤에도 다시 보고 싶은 몇 장을 골라 보세요.
        </ThemedText>
        <Button label="사진 고르러 가기" onPress={() => router.navigate('/')} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.flex}>
      <FlashList
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.type}
        stickyHeaderIndices={stickyHeaderIndices}
        contentContainerStyle={{ paddingBottom: Spacing.five }}
        renderItem={({ item }) => {
          if (item.type === 'month') return <MonthHeader label={item.label} />;
          if (item.type === 'day') {
            return (
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.dayLabel}>
                {item.label}
              </ThemedText>
            );
          }
          return <MomentCard moment={item.moment} />;
        }}
      />
    </ThemedView>
  );
}

function MonthHeader({ label }: { label: string }) {
  return (
    <ThemedView style={styles.monthHeader}>
      <ThemedText style={styles.monthText}>{label}</ThemedText>
    </ThemedView>
  );
}

function MomentCard({ moment }: { moment: Moment }) {
  const theme = useTheme();
  const aspectRatio = moment.width && moment.height ? moment.width / moment.height : 1;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/moment/[id]', params: { id: moment.id } })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 },
      ]}>
      <Image
        source={{ uri: libraryUri(moment.local_display_path) }}
        // 너무 긴 세로 사진이 화면을 다 차지하지 않도록 비율을 제한한다.
        style={[styles.cardImage, { aspectRatio: Math.max(aspectRatio, 0.75) }]}
        contentFit="cover"
        recyclingKey={moment.id}
        transition={150}
      />
      <View style={styles.cardBody}>
        {moment.memo.trim() !== '' ? (
          <ThemedText numberOfLines={3}>{moment.memo}</ThemedText>
        ) : (
          <ThemedText themeColor="textSecondary">눌러서 그때의 기억을 적어 보세요</ThemedText>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          {[formatTime(moment.taken_at, moment.taken_tz_offset), moment.place_name].filter(Boolean).join(' · ')}
        </ThemedText>
      </View>
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
  monthHeader: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  monthText: { fontSize: 22, lineHeight: 30, fontWeight: 700 },
  dayLabel: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  card: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  cardImage: { width: '100%' },
  cardBody: { padding: Spacing.three, gap: Spacing.one },
});
