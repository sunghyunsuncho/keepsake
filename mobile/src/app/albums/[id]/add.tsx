import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';

import { GalleryHeader, TileRow } from '@/components/gallery';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { albumMomentIds, getAlbumTitle, updateAlbumMoments } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { listMoments } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { galleryRows } from '@/lib/gallery';

// 앨범에 넣을 기록을 고른다. 남긴 기록 전체에서 고르고, 이미 들어 있는 것은 체크된 채로 시작한다.
// 체크를 풀면 앨범에서 빠진다 (기록은 그대로).
export default function AlbumAddScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: title } = useDbQuery(() => getAlbumTitle(db, id), [db, id]);
  const { data: moments } = useDbQuery(() => listMoments(db), [db]);
  const { data: initial } = useDbQuery(() => albumMomentIds(db, id), [db, id]);
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  // 처음 읽은 상태에서 시작한다. 이후 다시 읽어도 고르던 것을 덮어쓰지 않는다.
  useEffect(() => {
    if (initial && !checked) setChecked(new Set(initial));
  }, [initial, checked]);

  const rows = useMemo(() => (moments ? galleryRows(moments, 'month') : []), [moments]);
  const stickyHeaderIndices = useMemo(
    () => rows.flatMap((row, index) => (row.type === 'header' ? [index] : [])),
    [rows],
  );

  const toggle = (momentId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(momentId)) next.delete(momentId);
      else next.add(momentId);
      return next;
    });

  const save = async () => {
    if (!checked || !initial) return;
    setSaving(true);
    try {
      await updateAlbumMoments(db, id, {
        add: [...checked].filter((m) => !initial.has(m)),
        remove: [...initial].filter((m) => !checked.has(m)),
      });
      router.back();
    } catch {
      Alert.alert('앨범을 저장하지 못했어요', '잠시 후 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen
        options={{
          title: title ?? '',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <ThemedText>취소</ThemedText>
            </Pressable>
          ),
          headerRight: () =>
            saving ? (
              <ActivityIndicator />
            ) : (
              <Pressable onPress={save} hitSlop={8} disabled={!checked}>
                <ThemedText style={{ color: theme.accent, fontWeight: 700 }}>
                  완료{checked ? ` (${checked.size})` : ''}
                </ThemedText>
              </Pressable>
            ),
        }}
      />
      {!moments || !checked ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator />
        </ThemedView>
      ) : moments.length === 0 ? (
        <ThemedView style={styles.centered}>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            아직 남긴 사진이 없어요.{'\n'}고르기 탭에서 사진을 먼저 남겨 주세요.
          </ThemedText>
        </ThemedView>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary" style={styles.guide}>
            이 앨범에 넣을 사진을 골라 주세요. 사진은 복사되지 않고, 앨범에서 빼도 기록은 그대로 남아요.
          </ThemedText>
          <FlashList
            data={rows}
            keyExtractor={(row) => row.key}
            getItemType={(row) => row.type}
            stickyHeaderIndices={stickyHeaderIndices}
            extraData={checked}
            contentContainerStyle={{ paddingBottom: Spacing.five }}
            renderItem={({ item }) =>
              item.type === 'header' ? (
                <GalleryHeader title={item.title} subtitle={item.subtitle} sticky />
              ) : item.type === 'tiles' ? (
                <TileRow
                  moments={item.moments}
                  columns={item.columns}
                  checked={checked}
                  onPress={(moment) => toggle(moment.id)}
                />
              ) : null
            }
          />
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  guide: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
