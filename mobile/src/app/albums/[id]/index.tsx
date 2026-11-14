import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { AlbumNameSheet } from '@/components/album-name-sheet';
import { AlbumCoverSheet } from '@/components/album-cover-sheet';
import { AlbumActionButton, SortOrderButton, usePinchZoom, ZoomBar } from '@/components/album-controls';
import { showActionSheet } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { BackButton, HeaderButton } from '@/components/stack-header';
import { PHOTO_QUALITY, PHOTO_QUALITIES, PhotoQualityBadge } from '@/components/photo-quality';
import { GalleryHeader, StoryCard, TileRow } from '@/components/gallery';
import { MomentPhoto } from '@/components/moment-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  ALL_ALBUM_ID,
  deleteAlbum,
  getAlbum,
  isBuiltInAlbum,
  listAlbumMoments,
  listCloudAlbumPending,
  renameAlbum,
  setAlbumCover,
  setAlbumQuality,
  updateAlbumMoments,
  type AlbumInfo,
  type PhotoQuality,
} from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import type { Moment } from '@/db/moments';
import { DEFAULT_SETTINGS, getSettings, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useZoomedGallery } from '@/hooks/use-zoomed-gallery';
import { syncCloud, useCloudState } from '@/lib/cloud/engine';
import { PhotoSaveError, saveOriginalsToLibrary } from '@/lib/cloud/photos';
import { localizeText, photoCount, selectionSummary, showAlert, useTranslation } from '@/lib/i18n';

// 앨범 하나: 해 → 달 → 날 → 이야기 순으로 당겨 보고(두 손가락 또는 위의 단계 버튼), 사진을 누르면 크게 본다.
export default function AlbumScreen() {
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const { language } = useTranslation();
  const { data: album } = useDbQuery(() => getAlbum(db, id), [db, id]);
  const title = album === undefined ? undefined : (album?.title ?? null);
  const { data: moments } = useDbQuery(() => listAlbumMoments(db, id), [db, id]);
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const [renaming, setRenaming] = useState(false);
  const [choosingCover, setChoosingCover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(false);
  const order = settings?.album_sort_order ?? DEFAULT_SETTINGS.album_sort_order;
  const gallery = useZoomedGallery(moments ?? undefined, {
    order,
    initialZoom: settings?.album_zoom ?? DEFAULT_SETTINGS.album_zoom,
    onZoomChange: (next) => setSetting(db, 'album_zoom', next),
  });
  const zoom = gallery.zoom;
  const { gesture: pinch, style: pinchStyle } = usePinchZoom(gallery.stepZoom);
  const isCustom = !isBuiltInAlbum(id);
  const isCloud = album?.kind === 'cloud';
  const subscription = useCloudState().account?.subscription;
  const canUpload = subscription?.can_upload ?? false;
  const canDownload = subscription?.can_download ?? false;
  const fromCloud = source === 'cloud' || isCloud;
  const parentAlbumRoute = fromCloud ? '/cloud-library' : '/album';
  const parentAlbumLabel = fromCloud ? '안전 사진첩으로 돌아가기' : '사진첩으로 돌아가기';

  const openViewer = (moment: Moment) =>
    router.push({ pathname: '/viewer', params: { album: id, moment: moment.id } });
  const openMoment = (moment: Moment) => router.push({ pathname: '/moment/[id]', params: { id: moment.id } });
  const pickForAlbum = async () => {
    await setSetting(db, 'picking_album_id', id);
    router.navigate('/');
  };

  const toggleEditing = () => {
    setEditing((current) => !current);
    setSelectedIds(new Set());
  };
  const toggleSelected = (momentId: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(momentId)) next.add(momentId);
      return next;
    });
  const removeSelected = () => {
    if (selectedIds.size === 0) return;
    showAlert(
      '앨범에서 뺄까요?',
      isCloud
        ? '다른 안전 앨범에 없는 사진은 안전 보관에서 삭제돼 용량이 돌아와요. 기록(메모·장소)과 기기 사진첩의 원본은 그대로예요.'
        : '사진이나 기록은 삭제되지 않아요. 이 앨범에 연결된 사진만 빠져요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '앨범에서 빼기',
          style: 'destructive',
          onPress: async () => {
            await updateAlbumMoments(db, id, { remove: [...selectedIds] });
            setSelectedIds(new Set());
            setEditing(false);
          },
        },
      ],
    );
  };

  // 꾹 누르기: 기록을 연다. 앨범에서 빼기는 여러 장을 고르는 편집 모드에서만 한다.
  const showActions = (moment: Moment) => {
    showAlert('', undefined, [
      { text: '기록 열기', onPress: () => openMoment(moment) },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const chooseQuality = () => {
    if (!album?.photoQuality) return;
    const current = album.photoQuality;
    const describe = (quality: PhotoQuality) =>
      `${localizeText(language, PHOTO_QUALITY[quality].label)}: ${localizeText(language, PHOTO_QUALITY[quality].description)}`;
    showAlert(
      '보관 화질',
      [
        describe('original'),
        describe('display'),
        current === 'original' &&
          localizeText(language, '효율 보관으로 바꾸면 다른 원본 보관 앨범에 없는 사진의 원본은 안전 보관에서 삭제돼요. 사진에서 따로 ‘원본 그대로’를 고른 사진은 남아요. 동영상 원본은 720p 영상을 올린 뒤에 지워요.'),
      ].filter(Boolean).join('\n\n'),
      [
        ...PHOTO_QUALITIES.map((quality) => ({
          text: `${localizeText(language, PHOTO_QUALITY[quality].label)}${quality === current ? ` ${localizeText(language, '(지금)')}` : ''}`,
          onPress: () => {
            if (quality !== current) setAlbumQuality(db, id, quality);
          },
        })),
        { text: '취소', style: 'cancel' as const },
      ],
    );
  };

  // 기기 앨범: 안전 보관에 연결하거나, 이미 연결한 안전 앨범으로 간다.
  const cloudLink = () => {
    if (isCloud || !canUpload) return [];
    const linkedId = album?.linkedCloudAlbumId;
    return linkedId
      ? [
          {
            text: '연결된 안전 앨범 보기',
            icon: 'shield-checkmark-outline' as const,
            onPress: () => router.push({ pathname: '/albums/[id]', params: { id: linkedId, source: 'cloud' } }),
          },
        ]
      : [{ text: '안전 보관에 연결', icon: 'cloud-upload-outline' as const, onPress: () => router.push({ pathname: '/cloud-albums/new', params: { source: id } }) }];
  };

  // 원본이 있으면 원본을, 효율 보관만 했으면 그 JPEG·720p 영상을 기기 사진첩에 내려받는다.
  const restoreOriginals = () => {
    if (restoring) return;
    const restoreIds = (moments ?? [])
      .filter(
        (moment) =>
          (moment.original_uploaded === 1 || moment.display_uploaded === 1 || moment.compact_uploaded === 1) &&
          (!moment.source_asset_id || moment.source_missing === 1),
      )
      .map((moment) => moment.id);
    if (restoreIds.length === 0) {
      showAlert('다운로드할 사진이 없어요', '이 앨범의 보관 파일은 이미 모두 기기 사진첩에 연결되어 있어요.');
      return;
    }
    showAlert(
      {
        ko: `사진 ${restoreIds.length}장을 기기 사진첩으로 다운로드할까요?`,
        en: `Download ${photoCount(language, restoreIds.length)} to your device library?`,
        ja: `写真${restoreIds.length}枚をデバイスのライブラリにダウンロードしますか？`,
      }[language],
      '원본 보관 사진은 같은 원본인지 확인해 연결하고, 효율 보관 파일은 같은 파일명으로 이미 받은 사진을 찾아 다시 저장하지 않아요. 다운로드 뒤에는 이 기기의 사진첩 연결도 동기화해요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '다운로드',
          onPress: async () => {
            setRestoring(true);
            try {
              const result = await saveOriginalsToLibrary(db, () => {}, { momentIds: restoreIds, includeEfficient: true });
              // source_link_synced = 0으로 표시한 연결을 바로 계정에 보낸다.
              await syncCloud(db);
              const saved = result.total - result.failed - result.linked;
              showAlert(
                result.failed > 0 ? '일부 사진을 다운로드하지 못했어요' : '기기 사진첩으로 다운로드했어요',
                {
                  ko: `${saved}장을 저장하고, 같은 파일 ${result.linked}장은 기존 사진에 연결했어요.` +
                    (result.failed > 0 ? `\n${result.failed}장은 잠시 후 다시 시도해 주세요.` : ''),
                  en: `Saved ${photoCount(language, saved)} and linked ${photoCount(language, result.linked)} that were already on your device.` +
                    (result.failed > 0 ? `\nPlease try the other ${photoCount(language, result.failed)} again in a moment.` : ''),
                  ja: `${saved}枚を保存し、同じファイル${result.linked}枚は既存の写真にひも付けました。` +
                    (result.failed > 0 ? `\n${result.failed}枚は、しばらくしてからもう一度お試しください。` : ''),
                }[language],
              );
            } catch (e) {
              showAlert('사진을 다운로드하지 못했어요', e instanceof PhotoSaveError ? e.message : '잠시 후 다시 시도해 주세요.');
            } finally {
              setRestoring(false);
            }
          },
        },
      ],
    );
  };

  // 선택지가 많아 Alert 대신 시트로 연다 (안드로이드 Alert는 버튼을 3개까지만 보여 준다).
  const showAlbumMenu = () => {
    showActionSheet(title ?? '', undefined, [
      { text: '새 사진에서 고르기', icon: 'add-circle-outline', onPress: pickForAlbum },
      ...(isCloud ? [{ text: '보관 화질 바꾸기', icon: 'options-outline' as const, onPress: chooseQuality }] : cloudLink()),
      ...(isCloud && canDownload
        ? [
            {
              text: restoring ? '기기 사진첩으로 다운로드 중…' : '기기 사진첩으로 다운로드',
              icon: 'download-outline' as const,
              onPress: restoreOriginals,
            },
          ]
        : []),
      // 나만 보던 안전 앨범을 가족·친구와 함께 쓰는 공유 앨범으로 바꾼다 (같은 파일을 그대로 쓴다).
      ...(isCloud && canUpload
        ? [
            {
              text: '공유 앨범으로 바꾸기',
              icon: 'people-outline' as const,
              onPress: () => router.push({ pathname: '/cloud-albums/new', params: { convert: id } }),
            },
          ]
        : []),
      { text: '표지 바꾸기', icon: 'image-outline', onPress: () => setChoosingCover(true) },
      { text: '이름 바꾸기', icon: 'pencil-outline', onPress: () => setRenaming(true) },
      {
        text: '앨범 지우기',
        style: 'destructive',
        icon: 'trash-outline',
        onPress: () =>
          showAlert(
            '앨범을 지울까요?',
            isCloud
              ? '다른 안전 앨범에 없는 사진은 안전 보관에서 삭제돼요. 기록과 기기 사진첩의 원본은 그대로예요.'
              : '앨범만 지워지고, 들어 있던 기록은 그대로 남아요.',
            [
            { text: '취소', style: 'cancel' },
            {
              text: '지우기',
              style: 'destructive',
              onPress: () => {
                router.back();
                deleteAlbum(db, id);
              },
            },
          ],
          ),
      },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const header = (
    <Stack.Screen
      options={{
        title: title ?? '',
        // 탭 전환으로 들어온 경우에도 기본 back stack에 의존하지 않고 들어온 사진첩으로 돌아간다.
        headerLeft: () => <BackButton label={parentAlbumLabel} onPress={() => router.navigate(parentAlbumRoute)} />,
        headerRight: () => (
          <View style={styles.headerButtons}>
            <HeaderButton
              icon="map-outline"
              label="앨범 지도"
              onPress={() => router.push({ pathname: '/album-map', params: { id, kind: 'album' } })}
            />
            {isCustom && <HeaderButton icon="ellipsis-horizontal" label="앨범 메뉴" onPress={showAlbumMenu} />}
          </View>
        ),
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
              {isCloud
                ? '아직 안전 보관한 사진이 없어요.\n나의 순간들에서 안전 보관할 사진을 골라 보세요.'
                : '아직 담은 사진이 없어요.\n나의 순간들에서 고르거나 새 사진을 담아 보세요.'}
            </ThemedText>
            <Button
              label={isCloud ? '나의 순간들에서 사진 올리기' : '나의 순간들에서 사진 추가'}
              onPress={() => router.push({ pathname: '/albums/[id]/add', params: { id } })}
            />
            <Button
              label="새 사진에서 고르기"
              variant="secondary"
              onPress={pickForAlbum}
            />
          </>
        ) : id !== ALL_ALBUM_ID ? (
          <ThemedText themeColor="textSecondary" style={styles.center}>
            아직 안전 보관한 사진이 없어요.{'\n'}안전 앨범을 만들고 사진을 담으면 여기에 모여요.
          </ThemedText>
        ) : (
          <>
            <ThemedText themeColor="textSecondary" style={styles.center}>
              아직 남긴 사진이 없어요.{'\n'}십 년 뒤에도 다시 보고 싶은 몇 장을 골라 보세요.
            </ThemedText>
            <Button label="사진 고르러 가기" onPress={() => router.navigate('/')} />
          </>
        )}
        {isCustom && (
          <AlbumCoverSheet
            visible={choosingCover}
            items={moments}
            renderPhoto={(moment, style) => <MomentPhoto moment={moment} variant="thumb" style={style} transition={100} />}
            onChoose={(cover) => {
              setChoosingCover(false);
              setAlbumCover(db, id, cover);
            }}
            onCancel={() => setChoosingCover(false)}
          />
        )}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.flex}>
      {header}
      {album && isCloud && isCustom && <CloudAlbumInfo album={album} onPressQuality={chooseQuality} />}
      <ZoomBar value={zoom} onChange={(next) => gallery.changeZoom(next)} />
      <View style={styles.compactControls}>
        {isCustom && (
          <View style={styles.albumToolbar}>
          <AlbumActionButton
            icon="add"
            label="추가"
            onPress={() => router.push({ pathname: '/albums/[id]/add', params: { id } })}
          />
          <AlbumActionButton
            icon={editing ? 'close' : 'remove'}
            label={editing ? '빼기 취소' : '빼기'}
            active={editing}
            onPress={toggleEditing}
          />
          </View>
        )}
        <SortOrderButton value={order} onChange={(next) => setSetting(db, 'album_sort_order', next)} />
      </View>
      {editing && (
        <View style={[styles.editBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">{selectionSummary(language, selectedIds.size)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {isCloud ? '다른 안전 앨범에 없는 사진은 안전 보관에서 삭제돼요.' : '사진과 기록은 남고, 이 앨범에서만 빠져요.'}
            </ThemedText>
          </View>
          <Button label="앨범에서 빼기" variant="danger" disabled={selectedIds.size === 0} onPress={removeSelected} />
        </View>
      )}
      <GestureDetector gesture={pinch}>
        <Animated.View style={[styles.flex, pinchStyle]}>
          <FlashList
            key={zoom}
            data={gallery.rows}
            {...gallery.listProps}
            keyExtractor={(row) => row.key}
            getItemType={(row) => (row.type === 'tiles' ? `tiles-${row.columns}` : row.type)}
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
                    onLongPress={editing ? undefined : () => showActions(item.moment)}
                    selecting={editing}
                    selected={selectedIds.has(item.moment.id)}
                    onSelect={() => toggleSelected(item.moment.id)}
                  />
                );
              }
              return (
                <TileRow
                  moments={item.moments}
                  columns={item.columns}
                  checked={editing ? selectedIds : undefined}
                  framed={zoom === 'day'}
                  // 해 단계에서 누르면 그 달로 당겨 보고, 그 밖에는 크게 본다.
                  onPress={(moment) =>
                    editing
                      ? toggleSelected(moment.id)
                      : zoom === 'year'
                        ? gallery.zoomIntoMonth(moment)
                        : openViewer(moment)
                  }
                  onLongPress={editing ? undefined : showActions}
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
      {isCustom && (
        <AlbumCoverSheet
          visible={choosingCover}
          items={moments}
          renderPhoto={(moment, style) => <MomentPhoto moment={moment} variant="thumb" style={style} transition={100} />}
          onChoose={(cover) => {
            setChoosingCover(false);
            setAlbumCover(db, id, cover);
          }}
          onCancel={() => setChoosingCover(false)}
        />
      )}
    </ThemedView>
  );
}

/** 안전 앨범의 보관 화질과 연결, 아직 올리지 않은 사진 수. 누르면 화질을 바꾼다. */
function CloudAlbumInfo({ album, onPressQuality }: { album: AlbumInfo; onPressQuality: () => void }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { language } = useTranslation();
  const { data: pending } = useDbQuery(() => listCloudAlbumPending(db), [db]);
  const waiting = pending?.get(album.id) ?? 0;
  return (
    <Pressable
      onPress={onPressQuality}
      accessibilityRole="button"
      accessibilityLabel={localizeText(language, '보관 화질 바꾸기')}
      style={({ pressed }) => [styles.cloudInfo, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 }]}>
      <View style={styles.cloudInfoRow}>
        {album.photoQuality && <PhotoQualityBadge quality={album.photoQuality} />}
        {album.sourceAlbumTitle && (
          <View style={styles.cloudInfoRow}>
            <Ionicons name="link-outline" size={14} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} localize={false}>
              {{
                ko: `기기 앨범 ‘${album.sourceAlbumTitle}’과 연결`,
                en: `Linked to device album “${album.sourceAlbumTitle}”`,
                ja: `デバイスのアルバム「${album.sourceAlbumTitle}」と連携`,
              }[language]}
            </ThemedText>
          </View>
        )}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {waiting > 0
          ? {
              ko: `올릴 사진 ${waiting}장 · 동기화할 때 올려요`,
              en: `${photoCount(language, waiting)} to upload · Uploads when syncing`,
              ja: `アップロード待ち ${waiting}枚 · 同期時にアップロードします`,
            }[language]
          : '담은 사진을 모두 안전 보관했어요'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  center: { textAlign: 'center' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  compactControls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  albumToolbar: { flexDirection: 'row', gap: Spacing.one },
  editBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: StyleSheet.hairlineWidth, borderRadius: Spacing.two, marginHorizontal: Spacing.three, marginBottom: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  cloudInfo: {
    gap: Spacing.one,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.two,
  },
  cloudInfoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
});
