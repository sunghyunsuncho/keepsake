import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View, type ImageStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { usePinchZoom, ZoomBar } from '@/components/album-controls';
import { Button } from '@/components/button';
import { GalleryHeader, TileRow } from '@/components/gallery';
import { MomentPhoto } from '@/components/moment-photo';
import { PHOTO_QUALITY, QualityChoice, QualityTileBadge } from '@/components/photo-quality';
import { CloseButton } from '@/components/stack-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { albumMomentIds, getAlbum, originalElsewhereIds, updateAlbumMoments, type PhotoQuality } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { listMoments, setMomentsCloudQuality, type Moment } from '@/db/moments';
import { setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useZoomedGallery } from '@/hooks/use-zoomed-gallery';

// 앨범에 넣을 기록을 고른다. 남긴 기록 전체에서 고르고, 이미 들어 있는 것은 체크된 채로 시작한다.
// 체크를 풀면 앨범에서 빠진다 (기록은 그대로). 안전 앨범이면 고른 사진을 그 앨범의 화질로 Cloud에 올린다.
// 위에서 원본·효율을 고르면 이번에 새로 담는 사진에 사진별 화질로 정해 둔다 (moments.cloud_quality).
/** 고르면서 보는 단계. 이야기 단계는 한 장씩 크게 보여 고르기에 맞지 않는다. */
const PICK_ZOOMS = ['year', 'month', 'day'] as const;

export default function AlbumAddScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: album } = useDbQuery(() => getAlbum(db, id), [db, id]);
  const title = album?.title;
  const { data: moments } = useDbQuery(() => listMoments(db), [db]);
  const { data: initial } = useDbQuery(() => albumMomentIds(db, id), [db, id]);
  const { data: originalElsewhere } = useDbQuery(() => originalElsewhereIds(db, id), [db, id]);
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [quality, setQuality] = useState<PhotoQuality | null>(null);

  // 처음 읽은 상태에서 시작한다. 이후 다시 읽어도 고르던 것을 덮어쓰지 않는다.
  useEffect(() => {
    if (initial && !checked) setChecked(new Set(initial));
  }, [initial, checked]);

  const gallery = useZoomedGallery(moments ?? undefined, { zooms: PICK_ZOOMS, sampleYears: false });
  const { gesture: pinch, style: pinchStyle } = usePinchZoom(gallery.stepZoom);

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
      const added = [...checked].filter((m) => !initial.has(m));
      // 화질을 먼저 정해 두어야 담자마자 앨범 화질로 올리지 않는다.
      if (album?.photoQuality && quality) await setMomentsCloudQuality(db, added, quality);
      await updateAlbumMoments(db, id, {
        add: added,
        remove: [...initial].filter((m) => !checked.has(m)),
      });
      router.back();
    } catch {
      Alert.alert('앨범을 저장하지 못했어요', '잠시 후 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  // 체크한 사진이 이 앨범에서 어떤 화질로 보관될지. 새로 담는 사진은 위에서 고른 화질이 먼저다.
  const storedQuality = (moment: Moment): PhotoQuality | null => {
    if (!album?.photoQuality || !checked?.has(moment.id)) return null;
    // 원본 보관 공유 앨범이 쓰는 원본은 사진에서 고른 화질과 관계없이 남는다.
    if (originalElsewhere?.shared.has(moment.id)) return 'original';
    const picked = !initial?.has(moment.id);
    const chosen = (picked ? quality : null) ?? moment.cloud_quality;
    if (chosen) return chosen;
    return album.photoQuality === 'original' || originalElsewhere?.albums.has(moment.id) ? 'original' : 'display';
  };
  const renderTile = (moment: Moment, style: ImageStyle) => {
    const shown = storedQuality(moment);
    return (
      <View>
        <MomentPhoto moment={moment} variant="thumb" style={style} transition={100} />
        {shown && <QualityTileBadge quality={shown} />}
      </View>
    );
  };

  const pickNewPhotos = async () => {
    // 설정 저장이 끝난 뒤 이동해야 고르기 화면이 잠깐 기본 보관함 모드로 열리지 않는다.
    await setSetting(db, 'picking_album_id', id);
    router.navigate('/');
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen
        options={{
          title: title ?? '',
          headerLeft: () => <CloseButton label="취소" onPress={() => router.back()} />,
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
          <Button label="새 사진에서 고르기" onPress={pickNewPhotos} />
        </ThemedView>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary" style={styles.guide}>
            {album?.photoQuality
              ? `안전 보관할 사진을 골라 주세요. 새로 담는 사진을 ${PHOTO_QUALITY[quality ?? album.photoQuality].label}로 보관해요` +
                ((quality ?? album.photoQuality) === 'display'
                  ? ' (사진은 긴 변 2048px, 동영상은 720p).'
                  : ' (보기용 사진도 함께). 원본은 기기 사진첩에 있는 사진만 올릴 수 있어요.')
              : '이 앨범에 넣을 사진을 골라 주세요. 사진은 복사되지 않고, 앨범에서 빼도 기록은 그대로 남아요.'}
          </ThemedText>
          {album?.photoQuality && (
            <View style={styles.quality}>
              <QualityChoice albumQuality={album.photoQuality} value={quality} onChange={setQuality} />
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
                extraData={[checked, quality, originalElsewhere]}
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
