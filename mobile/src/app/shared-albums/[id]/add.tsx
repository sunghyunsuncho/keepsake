import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';

import { GalleryHeader, TileRow } from '@/components/gallery';
import { PHOTO_QUALITY } from '@/components/photo-quality';
import { CloseButton } from '@/components/stack-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { listMoments } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { syncCloud } from '@/lib/cloud/engine';
import { CloudError } from '@/lib/cloud/session';
import { addToSharedAlbum, getSharedAlbum, mySharedMomentIds } from '@/lib/cloud/shared';
import { galleryRows } from '@/lib/gallery';
import { formatBytes, formatSize } from '@/lib/storage';

// 공유 앨범에 내 기록을 담는다. 이미 담은 사진은 체크된 채로 보이고, 빼기는 앨범 화면에서 한다.
// 이미 안전 보관한 파일은 다시 올리지 않고, 없는 파일은 다음 동기화에서 앨범 화질로 올린다. 용량은 앨범에서 센다.
export default function SharedAlbumAddScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: album } = useDbQuery(() => getSharedAlbum(id), [id]);
  const { data: moments } = useDbQuery(() => listMoments(db), [db]);
  const { data: already } = useDbQuery(() => mySharedMomentIds(db, id), [db, id]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => (moments ? galleryRows(moments, 'month') : []), [moments]);
  const stickyHeaderIndices = useMemo(
    () => rows.flatMap((row, index) => (row.type === 'header' ? [index] : [])),
    [rows],
  );
  const checked = useMemo(() => new Set([...(already ?? []), ...picked]), [already, picked]);

  const toggle = (momentId: string) => {
    if (already?.has(momentId)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(momentId)) next.delete(momentId);
      else next.add(momentId);
      return next;
    });
  };

  const save = async () => {
    if (!album || picked.size === 0) return router.back();
    setSaving(true);
    try {
      await addToSharedAlbum(db, id, [...picked], album.photo_quality);
      syncCloud(db);
      router.back();
    } catch (e) {
      const full = e instanceof CloudError && e.status === 413;
      Alert.alert(
        '사진을 담지 못했어요',
        full
          ? '앨범 용량이 모자라요. 앨범 관리에서 용량을 더 나눠 주거나, 사진을 조금만 골라 주세요.'
          : '잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen
        options={{
          title: album?.title ?? '',
          headerLeft: () => <CloseButton label="취소" onPress={() => router.back()} />,
          headerRight: () =>
            saving ? (
              <ActivityIndicator />
            ) : (
              <Pressable onPress={save} hitSlop={8} disabled={!album}>
                <ThemedText style={{ color: theme.accent, fontWeight: 700 }}>
                  담기{picked.size > 0 ? ` (${picked.size})` : ''}
                </ThemedText>
              </Pressable>
            ),
        }}
      />
      {!moments || !already ? (
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
            구성원과 함께 볼 사진을 골라 주세요.
            {album
              ? ` ${PHOTO_QUALITY[album.photo_quality].label}로 보관하고, 앨범 용량(${formatBytes(album.storage.bytes_total)} / ${formatSize(album.storage.capacity_bytes)})에서 세요. 이미 안전 보관한 사진은 다시 올리지 않아요.`
              : ''}{' '}
            메모와 장소는 함께 보내지 않아요.
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
                <TileRow moments={item.moments} columns={item.columns} checked={checked} onPress={(moment) => toggle(moment.id)} />
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
