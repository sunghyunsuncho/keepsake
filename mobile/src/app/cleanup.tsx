import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import type { Asset } from 'expo-media-library';
import { router, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import {
  BottomBar,
  Centered,
  ColumnToggle,
  GRID_GAP,
  tileHeightFor,
  useTileWidth,
} from '@/components/pick';
import { CloseButton } from '@/components/stack-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { getSettings, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import {
  CLEANUP_GUIDE,
  DELETE_NOTICE,
  clearCleanupPhotos,
  deleteLeftBehindPhotos,
  finishCleanup,
  loadCleanupPhotos,
} from '@/lib/cleanup';
import { useCloudSession } from '@/lib/cloud/session';

/** 고르기를 마친 뒤 남기지 않은 사진을 살펴보고 지운다. 누른 사진은 지우지 않는다. */
export default function CleanupScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const session = useCloudSession();
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const [photos, setPhotos] = useState<Asset[] | null>(null);
  const [keptIds, setKeptIds] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [notDeleted, setNotDeleted] = useState(false);
  const [deletedCount, setDeletedCount] = useState<number | null>(null);

  const cancel = () => {
    clearCleanupPhotos();
    router.back();
  };

  // 전부 남기기로 고른 뒤 닫는 것도 정리를 마친 것이다. 헤더의 취소와 달리 후보를 비운다.
  const closeAfterReview = async () => {
    await finishCleanup();
    router.back();
  };

  useEffect(() => {
    loadCleanupPhotos()
      .then((loaded) => {
        setPhotos(loaded);
        // 다시 확인해 보니 지울 사진이 없다(그 사이 남겼거나 즐겨찾기). 고르기 화면의 후보도 비운다.
        if (loaded.length === 0) finishCleanup().catch(() => {});
      })
      .catch(() => setPhotos([]));
  }, []);

  const targets = useMemo(
    () => (photos ?? []).filter((asset) => !keptIds.has(asset.id)),
    [photos, keptIds],
  );
  const columns = settings?.pick_grid_columns ?? 3;
  const tileWidth = useTileWidth(columns);

  const toggle = (id: string) => {
    setKeptIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const remove = async () => {
    setDeleting(true);
    setNotDeleted(false);
    try {
      setDeletedCount(await deleteLeftBehindPhotos(targets));
    } catch {
      // OS 확인 창에서 취소해도 여기로 온다. 사용자가 다시 시도할 수 있게 화면을 그대로 둔다.
      setNotDeleted(true);
    } finally {
      setDeleting(false);
    }
  };

  let content;
  if (deletedCount !== null) {
    content = (
      <Centered>
        <Ionicons name="checkmark-circle-outline" size={40} color={theme.accent} />
        <ThemedText style={styles.center}>사진 {deletedCount}장을 비웠어요</ThemedText>
        {!session && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            남긴 사진의 원본은 기기 사진첩에 그대로 있어요.{'\n'}
            Cloud를 쓰면 남긴 사진은 기기에서 지워도 지켜져요.
          </ThemedText>
        )}
        <View style={styles.doneButtons}>
          <Button label="닫기" onPress={() => router.back()} />
          {!session && (
            <Button
              label="안전 보관 알아보기"
              variant="secondary"
              onPress={() => router.replace('/cloud')}
            />
          )}
        </View>
      </Centered>
    );
  } else if (photos === null) {
    content = (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  } else if (photos.length === 0) {
    content = (
      <Centered>
        <ThemedText style={styles.center}>정리할 사진이 없어요</ThemedText>
        <Button label="닫기" onPress={() => router.back()} />
      </Centered>
    );
  } else {
    content = (
      <>
        <View style={styles.header}>
          <View style={styles.flex}>
            <ThemedText type="small">{CLEANUP_GUIDE}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {DELETE_NOTICE}
            </ThemedText>
          </View>
          <ColumnToggle
            value={columns}
            onChange={(next) => setSetting(db, 'pick_grid_columns', next)}
          />
        </View>
        <FlashList
          key={columns}
          data={photos}
          numColumns={columns}
          keyExtractor={(asset) => asset.id}
          extraData={keptIds}
          contentContainerStyle={{ padding: GRID_GAP / 2, paddingBottom: Spacing.four }}
          renderItem={({ item }) => (
            <CleanupTile
              asset={item}
              width={tileWidth}
              height={tileHeightFor(item, tileWidth, columns)}
              marked={!keptIds.has(item.id)}
              onPress={() => toggle(item.id)}
            />
          )}
        />
        <BottomBar
          title={targets.length > 0 ? `${photos.length}장 중 ${targets.length}장을 지워요` : '지울 사진이 없어요'}
          subtitle={
            notDeleted ? '지우지 않았어요. 다시 시도할 수 있어요.' : '한 번 더 확인한 뒤에 지워요'
          }
          action={
            targets.length > 0
              ? { label: '지우기', onPress: remove, loading: deleting }
              : { label: '닫기', onPress: closeAfterReview }
          }
        />
      </>
    );
  }

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen
        options={{
          headerRight: () => <CloseButton label="취소" onPress={cancel} />,
        }}
      />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        {content}
      </SafeAreaView>
    </ThemedView>
  );
}

function CleanupTile({
  asset,
  width,
  height,
  marked,
  onPress,
}: {
  asset: Asset;
  width: number;
  height: number;
  marked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: marked }}
      accessibilityLabel={marked ? '지울 사진' : '지우지 않을 사진'}
      style={{ width, height, margin: GRID_GAP / 2 }}>
      <Image source={{ uri: asset.uri }} style={styles.fill} contentFit="cover" recyclingKey={asset.id} />
      {marked && (
        <View style={[styles.fill, styles.markedOverlay]}>
          <View style={[styles.badge, { backgroundColor: theme.danger }]}>
            <Ionicons name="trash-outline" size={14} color="#fff" />
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  fill: { ...StyleSheet.absoluteFillObject },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  doneButtons: { alignSelf: 'stretch', gap: Spacing.two },
  markedOverlay: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'flex-end',
    padding: Spacing.one + 2,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
