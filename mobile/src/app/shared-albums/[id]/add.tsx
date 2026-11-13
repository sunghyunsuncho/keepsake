import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ImageStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { usePinchZoom, ZoomBar } from '@/components/album-controls';
import { GalleryHeader, TileRow } from '@/components/gallery';
import { MomentPhoto } from '@/components/moment-photo';
import { PHOTO_QUALITY, QualityChoice, QualityTileBadge } from '@/components/photo-quality';
import { CloseButton } from '@/components/stack-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { PhotoQuality } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { listMoments, type Moment } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { useZoomedGallery } from '@/hooks/use-zoomed-gallery';
import { syncCloud } from '@/lib/cloud/engine';
import { CloudError } from '@/lib/cloud/session';
import { addToSharedAlbum, getSharedAlbum, mySharedQualities } from '@/lib/cloud/shared';
import { formatBytes, formatSize } from '@/lib/storage';
import { localizeText, showAlert, useTranslation } from '@/lib/i18n';

// 공유 앨범에 내 기록을 담는다. 이미 담은 사진은 체크된 채로 보이고, 빼기는 앨범 화면에서 한다.
// 이미 안전 보관한 파일은 다시 올리지 않고, 없는 파일은 다음 동기화에서 고른 화질(기본은 앨범 화질)로 올린다.
// 용량은 앨범에서 센다.
/** 고르면서 보는 단계. 이야기 단계는 한 장씩 크게 보여 고르기에 맞지 않는다. */
const PICK_ZOOMS = ['year', 'month', 'day'] as const;

export default function SharedAlbumAddScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const { language } = useTranslation();
  const { data: album } = useDbQuery(() => getSharedAlbum(id), [id]);
  const { data: moments } = useDbQuery(() => listMoments(db), [db]);
  // 이미 담은 사진과 그 화질
  const { data: already } = useDbQuery(() => mySharedQualities(db, id), [db, id]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [quality, setQuality] = useState<PhotoQuality | null>(null);

  const gallery = useZoomedGallery(moments ?? undefined, { zooms: PICK_ZOOMS, sampleYears: false });
  const { gesture: pinch, style: pinchStyle } = usePinchZoom(gallery.stepZoom);
  const checked = useMemo(() => new Set([...(already?.keys() ?? []), ...picked]), [already, picked]);

  const toggle = (momentId: string) => {
    if (already?.has(momentId)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(momentId)) next.delete(momentId);
      else next.add(momentId);
      return next;
    });
  };

  // 체크한 사진이 이 앨범에서 어떤 화질로 보관될지 (구성원 모두에게 같다).
  const renderTile = (moment: Moment, style: ImageStyle) => {
    const shown = already?.get(moment.id) ?? (picked.has(moment.id) && album ? (quality ?? album.photo_quality) : null);
    return (
      <View>
        <MomentPhoto moment={moment} variant="thumb" style={style} transition={100} />
        {shown && <QualityTileBadge quality={shown} />}
      </View>
    );
  };

  const save = async () => {
    if (!album || picked.size === 0) return router.back();
    setSaving(true);
    try {
      await addToSharedAlbum(db, id, [...picked], album.photo_quality, quality);
      syncCloud(db);
      router.back();
    } catch (e) {
      const full = e instanceof CloudError && e.status === 413;
      showAlert(
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
              ? (() => {
                  const label = localizeText(language, PHOTO_QUALITY[quality ?? album.photo_quality].label);
                  const usage = `${formatBytes(album.storage.bytes_total)} / ${formatSize(album.storage.capacity_bytes)}`;
                  return {
                    ko: ` ${label}로 보관하고, 앨범 용량(${usage})에서 세요. 이미 안전 보관한 사진은 다시 올리지 않아요.`,
                    en: ` Photos are stored as ${label} and count against the album’s storage (${usage}). Photos already in secure storage won’t be uploaded again.`,
                    ja: `「${label}」で保管し、アルバムの容量（${usage}）で数えます。安全保管済みの写真は再アップロードしません。`,
                  }[language];
                })()
              : ''}{' '}
            메모와 장소는 함께 보내지 않아요.
          </ThemedText>
          {/* 고른 화질은 구성원 모두에게 같다 (파일은 사진마다 하나). 담은 뒤에도 사진을 크게 보며 바꿀 수 있다. */}
          {album && (
            <View style={styles.quality}>
              <QualityChoice albumQuality={album.photo_quality} value={quality} onChange={setQuality} />
            </View>
          )}
          <ZoomBar value={gallery.zoom} onChange={gallery.changeZoom} zooms={PICK_ZOOMS} />
          <GestureDetector gesture={pinch}>
            <Animated.View style={[styles.flex, pinchStyle]}>
              <FlashList
                key={gallery.zoom}
                data={gallery.rows}
                {...gallery.listProps}
                keyExtractor={(row) => row.key}
                getItemType={(row) => (row.type === 'tiles' ? `tiles-${row.columns}` : row.type)}
                extraData={[checked, quality]}
                contentContainerStyle={{ paddingBottom: Spacing.five }}
                renderItem={({ item }) =>
                  item.type === 'header' ? (
                    <GalleryHeader title={item.title} subtitle={item.subtitle} sticky={item.sticky} />
                  ) : item.type === 'tiles' ? (
                    <TileRow
                      moments={item.moments}
                      columns={item.columns}
                      checked={checked}
                      renderPhoto={renderTile}
                      onPress={(moment) => toggle(moment.id)}
                    />
                  ) : null
                }
              />
            </Animated.View>
          </GestureDetector>
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
  quality: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
});
