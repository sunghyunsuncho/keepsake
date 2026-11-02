import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { BottomBar, Centered, GRID_GAP, useTileWidth } from '@/components/pick';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Moment } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { syncCloud, useCloudState } from '@/lib/cloud/engine';
import { importMoments, listImportable } from '@/lib/cloud/imports';

const COLUMNS = 3;

/** 이 기기의 Local 기록 중 계정 Cloud에 복사할 것을 고른다. Local 기록은 그대로 남는다. */
export default function CloudImportScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const params = useLocalSearchParams<{ all?: string }>();
  const includeSkipped = params.all === '1';
  const { account } = useCloudState();
  // 처음 쓰는 Cloud면 모두 고른 채로, 이미 내용이 있는 계정이면 다른 사람의 기록이 섞이지 않게 아무것도 고르지 않고 시작한다.
  const selectAll = (account?.usage.object_count ?? 0) === 0;
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const tileWidth = useTileWidth(COLUMNS);

  useEffect(() => {
    listImportable(db, { skipped: includeSkipped })
      .then((rows) => {
        setMoments(rows);
        if (selectAll) setSelectedIds(new Set(rows.map((row) => row.id)));
      })
      .catch(() => setMoments([]));
    // 고른 상태의 기본값은 화면을 열 때 한 번만 정한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, includeSkipped]);

  const selected = useMemo(
    () => (moments ?? []).filter((moment) => selectedIds.has(moment.id)),
    [moments, selectedIds],
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const finish = async (chosen: Moment[]) => {
    if (saving || !moments) return;
    setSaving(true);
    try {
      const chosenIds = new Set(chosen.map((moment) => moment.id));
      await importMoments(db, chosen, moments.filter((moment) => !chosenIds.has(moment.id)));
      if (chosen.length > 0) syncCloud(db);
      if (router.canGoBack()) router.back();
    } catch {
      Alert.alert('올리지 못했어요', '잠시 후 다시 시도해 주세요.');
      setSaving(false);
    }
  };

  let content;
  if (moments === null) {
    content = (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  } else if (moments.length === 0) {
    content = (
      <Centered>
        <ThemedText style={styles.center}>올릴 기록이 없어요</ThemedText>
        <Button label="닫기" onPress={() => router.back()} />
      </Centered>
    );
  } else {
    content = (
      <>
        <View style={styles.header}>
          <ThemedText type="small">이 기기의 기록을 이 계정의 Cloud에 복사할까요?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            고른 기록의 사진 원본과 메모가 Cloud에 복사돼요. 기기의 기록은 그대로 남고, 올린 뒤에는 서로 따로
            고쳐져요. 앱을 다시 설치해도 사진첩 원본을 찾을 수 있도록 이 기기의 사진 연결 정보도 함께 저장해요.
          </ThemedText>
        </View>
        <FlashList
          data={moments}
          numColumns={COLUMNS}
          keyExtractor={(moment) => moment.id}
          extraData={selectedIds}
          contentContainerStyle={{ padding: GRID_GAP / 2, paddingBottom: Spacing.four }}
          renderItem={({ item }) => {
            const checked = selectedIds.has(item.id);
            return (
              <Pressable
                onPress={() => toggle(item.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                style={{ width: tileWidth, height: tileWidth, margin: GRID_GAP / 2 }}>
                <Image
                  source={{ uri: item.source_uri ?? undefined }}
                  style={styles.fill}
                  contentFit="cover"
                  recyclingKey={item.id}
                />
                {checked && (
                  <View style={[styles.fill, styles.checked]}>
                    <Ionicons name="checkmark-circle" size={24} color={theme.accent} />
                  </View>
                )}
              </Pressable>
            );
          }}
        />
        <BottomBar
          title={`${moments.length}개 중 ${selected.length}개를 올려요`}
          secondary={{ label: '나중에', onPress: () => finish([]) }}
          action={{
            label: selected.length > 0 ? '올리기' : '닫기',
            onPress: () => finish(selected),
            loading: saving,
          }}
        />
      </>
    );
  }

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        {content}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  fill: { ...StyleSheet.absoluteFillObject },
  header: { gap: Spacing.one, padding: Spacing.three },
  checked: { backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'flex-end', padding: Spacing.one },
});
