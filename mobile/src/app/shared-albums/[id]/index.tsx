import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageStyle,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheetHost, showActionSheet } from '@/components/action-sheet';
import { AlbumActionButton, SortOrderButton, usePinchZoom, ZoomBar } from '@/components/album-controls';
import { AlbumCoverSheet, type AlbumCoverChoice } from '@/components/album-cover-sheet';
import { AlbumNameSheet } from '@/components/album-name-sheet';
import { Button } from '@/components/button';
import { GalleryHeader, TileRow } from '@/components/gallery';
import { PHOTO_QUALITY, PhotoQualityBadge } from '@/components/photo-quality';
import { SharedItemPhoto } from '@/components/shared-item-photo';
import { SharedStoryCard } from '@/components/shared-story-card';
import { HeaderButton } from '@/components/stack-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { DEFAULT_SETTINGS, getSettings, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useZoomedGallery } from '@/hooks/use-zoomed-gallery';
import { syncCloud, useCloudState } from '@/lib/cloud/engine';
import { CloudError } from '@/lib/cloud/session';
import {
  getSharedAlbum,
  listSharedItems,
  RELATIONS,
  DISPLAY_NAME_MAX,
  removeAuthorItems,
  removeSharedItem,
  removeSharedItems,
  saveSharedItemsToLibrary,
  setSharedItemsQuality,
  SharedSaveError,
  unsavedSharedItems,
  updateMember,
  updateSharedAlbum,
  type SharedAlbumDetail,
  type SharedItem,
} from '@/lib/cloud/shared';
import { formatFullDate } from '@/lib/dates';
import { sortForGallery } from '@/lib/gallery';
import { formatBytes, formatSize } from '@/lib/storage';

/** 촬영 시각이 없는 항목은 담은 시각으로 묶는다. */
type DatedItem = SharedItem & { taken_at: string };

// 공유 앨범: 구성원이 함께 담은 사진을 내 앨범처럼 해 → 달 → 날 → 이야기 순으로 당겨 본다.
// 사진마다 누가 담았는지 보이고, 사진은 올린 사람이나 관리자만 앨범에서 뺄 수 있다 (서버가 다시 확인한다).
// 단계와 정렬은 내 앨범과 같은 설정을 쓴다.
export default function SharedAlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const { account } = useCloudState();
  const { data: album, error } = useDbQuery(() => getSharedAlbum(id), [id]);
  const { data: items } = useDbQuery(() => listSharedItems(id), [id]);
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const [author, setAuthor] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [choosingCover, setChoosingCover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const order = settings?.album_sort_order ?? DEFAULT_SETTINGS.album_sort_order;

  const shown = useMemo(
    () =>
      (items ?? [])
        .filter((item) => !author || item.author_id === author)
        .map((item): DatedItem => ({ ...item, taken_at: item.taken_at ?? item.added_at })),
    [items, author],
  );
  // 크게 볼 때도 목록과 같은 순서로 넘긴다.
  const sorted = useMemo(() => sortForGallery(shown, order), [shown, order]);
  // 단계는 내 앨범 화면과 같은 설정에 저장한다.
  const gallery = useZoomedGallery(shown, {
    order,
    initialZoom: settings?.album_zoom ?? DEFAULT_SETTINGS.album_zoom,
    onZoomChange: (next) => setSetting(db, 'album_zoom', next),
  });
  const zoom = gallery.zoom;
  const { gesture: pinch, style: pinchStyle } = usePinchZoom(gallery.stepZoom);

  const canUpload = account?.subscription.can_upload ?? false;

  if (error && !album) {
    const gone = error instanceof CloudError && error.status === 404;
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title: '' }} />
        <Ionicons name={gone ? 'people-outline' : 'cloud-offline-outline'} size={40} color={theme.textSecondary} />
        <ThemedText themeColor="textSecondary" style={styles.center}>
          {gone ? '더 이상 이 공유 앨범의 구성원이 아니에요.' : '공유 앨범을 불러오지 못했어요.\n인터넷 연결을 확인해 주세요.'}
        </ThemedText>
      </ThemedView>
    );
  }
  // 설정을 읽기 전에 그리면 기본 단계로 그렸다가 저장된 단계로 다시 그린다.
  if (!album || !items || !settings) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const admin = album.role === 'admin';
  const canRemoveAny = items.some((item) => item.can_delete);

  const openAdd = () => {
    // 앨범 용량은 구성원이 나눠 준 용량의 합이라, 내가 구독하지 않아도 앨범에 공간이 있으면 담는다.
    if (!album.writable) {
      Alert.alert(
        album.storage.capacity_bytes === 0 ? '앨범에 나눠 준 용량이 없어요' : '앨범 용량이 가득 찼어요',
        canUpload
          ? '앨범 관리에서 내 용량을 더 나눠 주거나, 담긴 사진을 정리하면 다시 담을 수 있어요.'
          : '구성원이 용량을 더 나눠 주거나 사진을 정리하면 다시 담을 수 있어요. 안전 보관을 구독하면 내 용량도 나눠 줄 수 있어요.',
        [
          { text: '닫기', style: 'cancel' },
          { text: '앨범 관리', onPress: () => router.push({ pathname: '/shared-albums/[id]/members', params: { id } }) },
        ],
      );
      return;
    }
    router.push({ pathname: '/shared-albums/[id]/add', params: { id } });
  };
  const openManage = () => router.push({ pathname: '/shared-albums/[id]/members', params: { id } });
  const openViewer = (item: DatedItem) => setViewing(sorted.findIndex((entry) => entry.id === item.id));

  const toggleEditing = () => {
    setEditing((current) => !current);
    setSelectedIds(new Set());
  };
  // 남이 담은 사진은 관리자만 뺄 수 있어 고르지 못하게 한다.
  const toggleSelected = (item: SharedItem) => {
    if (!item.can_delete) {
      Alert.alert('뺄 수 없는 사진이에요', `${item.author_name}님이 담은 사진은 올린 사람이나 관리자만 앨범에서 뺄 수 있어요.`);
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(item.id)) next.add(item.id);
      return next;
    });
  };
  const removeSelected = () => {
    if (selectedIds.size === 0) return;
    const othersCount = items.filter((item) => selectedIds.has(item.id) && !item.is_mine).length;
    Alert.alert(
      `${selectedIds.size}장을 공유 앨범에서 뺄까요?`,
      '구성원 모두에게서 사라져요. 올린 사람의 기록과 기기 사진첩의 사진은 그대로예요.' +
        (othersCount > 0 ? `\n\n다른 구성원이 담은 사진 ${othersCount}장도 관리자로서 함께 빠져요.` : ''),
      [
        { text: '취소', style: 'cancel' },
        {
          text: '앨범에서 빼기',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await removeSharedItems(id, [...selectedIds]);
              setSelectedIds(new Set());
              setEditing(false);
            } catch {
              Alert.alert('사진을 빼지 못했어요', '잠시 후 다시 시도해 주세요.');
            } finally {
              setRemoving(false);
            }
          },
        },
      ],
    );
  };

  // 앨범 이름·표지는 구성원 모두에게 보이므로 관리자만 바꾼다 (서버가 다시 확인한다).
  const update = (body: Parameters<typeof updateSharedAlbum>[1], what: string) =>
    updateSharedAlbum(id, body).catch(() => Alert.alert(`${what}을 바꾸지 못했어요`, '잠시 후 다시 시도해 주세요.'));
  const chooseCover = (choice: AlbumCoverChoice) => {
    setChoosingCover(false);
    update(
      choice.mode === 'photo'
        ? { cover_mode: 'photo', cover_item_id: choice.momentId }
        : choice.mode === 'design'
          ? { cover_mode: 'design', cover_emoji: choice.emoji }
          : { cover_mode: 'latest' },
      '표지',
    );
  };
  const downloadToLibrary = async () => {
    if (downloading) return;
    const downloadable = await unsavedSharedItems(db, items);
    if (downloadable.length === 0) {
      Alert.alert('다운로드할 사진이 없어요', '다른 구성원의 사진은 이미 모두 기기 사진첩에 저장했어요.');
      return;
    }
    Alert.alert(
      `사진 ${downloadable.length}장을 기기 사진첩으로 다운로드할까요?`,
      '원본이 있으면 원본을, 효율 보관 사진은 저장된 효율 파일을 내려받아요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '다운로드',
          onPress: async () => {
            setDownloading(true);
            try {
              const result = await saveSharedItemsToLibrary(db, id, downloadable, () => {});
              Alert.alert(
                result.failed > 0 ? '일부 사진을 다운로드하지 못했어요' : '기기 사진첩으로 다운로드했어요',
                result.failed > 0 ? `${result.failed}장은 잠시 후 다시 시도해 주세요.` : undefined,
              );
            } catch (e) {
              Alert.alert('사진을 다운로드하지 못했어요', e instanceof SharedSaveError ? e.message : '잠시 후 다시 시도해 주세요.');
            } finally {
              setDownloading(false);
            }
          },
        },
      ],
    );
  };
  const showAlbumMenu = () =>
    showActionSheet(album.title, undefined, [
      { text: downloading ? '기기 사진첩으로 다운로드 중…' : '기기 사진첩으로 다운로드', onPress: downloadToLibrary },
      ...(admin
        ? [
            { text: '표지 바꾸기', onPress: () => setChoosingCover(true) },
            { text: '이름 바꾸기', onPress: () => setRenaming(true) },
            { text: '구성원과 앨범 관리', onPress: openManage },
          ]
        : []),
      { text: '취소', style: 'cancel' },
    ]);

  // 표지로 고를 수 있는 사진: 표시용 사진이 올라간 것 (서버가 그 사진으로 표지를 그린다).
  const coverable = sorted.filter((item) => item.stored_variants.includes('display'));
  // 해 단계는 칸이 작아 이름표를 붙이지 않는다.
  const renderTile = (item: DatedItem, style: ImageStyle) => (
    <View>
      <SharedItemPhoto albumId={id} item={item} variant="thumb" style={style} />
      {zoom !== 'year' && (
        <View style={styles.authorTag} pointerEvents="none">
          <ThemedText style={styles.authorTagText} numberOfLines={1}>
            {item.is_mine ? '나' : item.author_name}
          </ThemedText>
        </View>
      )}
    </View>
  );

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen
        options={{
          title: album.title,
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderButton
                icon="map-outline"
                label="앨범 지도"
                onPress={() => router.push({ pathname: '/album-map', params: { id, kind: 'shared' } })}
              />
              <HeaderButton icon="people-outline" label="구성원과 앨범 관리" size={22} onPress={openManage} />
              <HeaderButton icon="ellipsis-horizontal" label="앨범 메뉴" onPress={showAlbumMenu} />
            </View>
          ),
        }}
      />
      <ZoomBar value={zoom} onChange={(next) => gallery.changeZoom(next)} />
      <View style={styles.compactControls}>
        <View style={styles.albumToolbar}>
          <AlbumActionButton icon="add" label="추가" onPress={openAdd} />
          {canRemoveAny && (
            <AlbumActionButton
              icon={editing ? 'close' : 'remove'}
              label={editing ? '빼기 취소' : '빼기'}
              active={editing}
              onPress={toggleEditing}
            />
          )}
        </View>
        <SortOrderButton value={order} onChange={(next) => setSetting(db, 'album_sort_order', next)} />
      </View>
      {editing && (
        <View style={[styles.editBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">{selectedIds.size}장 선택됨</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {admin ? '구성원 모두에게서 빠져요. 올린 사람의 기록은 남아요.' : '내가 담은 사진만 뺄 수 있어요.'}
            </ThemedText>
          </View>
          <Button
            label="앨범에서 빼기"
            variant="danger"
            loading={removing}
            disabled={selectedIds.size === 0}
            onPress={removeSelected}
          />
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
            ListHeaderComponent={
              <AlbumHeader album={album} items={items} author={author} onAuthor={setAuthor} onAdd={openAdd} />
            }
            ListEmptyComponent={
              <ThemedText themeColor="textSecondary" style={[styles.center, styles.empty]}>
                {author ? '이 구성원이 담은 사진이 없어요.' : '아직 담은 사진이 없어요.\n위의 [추가]로 함께 볼 사진을 담아 보세요.'}
              </ThemedText>
            }
            renderItem={({ item: row }) => {
              if (row.type === 'header') {
                return <GalleryHeader title={row.title} subtitle={row.subtitle} sticky={row.sticky} />;
              }
              if (row.type === 'card') {
                return (
                  <SharedStoryCard
                    albumId={id}
                    item={row.moment}
                    takenAt={row.moment.taken_at}
                    onOpen={() => openViewer(row.moment)}
                    selecting={editing}
                    selected={selectedIds.has(row.moment.id)}
                    onSelect={() => toggleSelected(row.moment)}
                  />
                );
              }
              return (
                <TileRow
                  moments={row.moments}
                  columns={row.columns}
                  checked={editing ? selectedIds : undefined}
                  // 고르는 동안에는 체크 표시가 보이도록 폴라로이드 대신 칸으로 그린다.
                  framed={zoom === 'day' && !editing}
                  renderPhoto={renderTile}
                  // 해 단계에서 누르면 그 달로 당겨 보고, 그 밖에는 크게 본다.
                  onPress={(item) =>
                    editing
                      ? toggleSelected(item)
                      : zoom === 'year'
                        ? gallery.zoomIntoMonth(item)
                        : openViewer(item)
                  }
                />
              );
            }}
          />
        </Animated.View>
      </GestureDetector>
      <SharedViewer
        albumId={id}
        albumQuality={album.photo_quality}
        items={sorted}
        index={viewing}
        onClose={() => setViewing(null)}
      />
      {admin && (
        <>
          <AlbumNameSheet
            visible={renaming}
            heading="앨범 이름 바꾸기"
            initial={album.title}
            description="구성원 모두에게 바뀐 이름으로 보여요."
            confirmLabel="바꾸기"
            onSubmit={(next) => {
              setRenaming(false);
              if (next !== album.title) update({ title: next }, '이름');
            }}
            onCancel={() => setRenaming(false)}
          />
          <AlbumCoverSheet
            visible={choosingCover}
            items={coverable}
            renderPhoto={(item, style) => <SharedItemPhoto albumId={id} item={item} variant="thumb" style={style} />}
            onChoose={chooseCover}
            onCancel={() => setChoosingCover(false)}
          />
        </>
      )}
    </ThemedView>
  );
}

function AlbumHeader({
  album,
  items,
  author,
  onAuthor,
  onAdd,
}: {
  album: SharedAlbumDetail;
  items: SharedItem[];
  author: string | null;
  onAuthor: (id: string | null) => void;
  onAdd: () => void;
}) {
  const theme = useTheme();
  const [renaming, setRenaming] = useState(false);
  const me = album.members.find((member) => member.is_me);
  const relation = RELATIONS[album.relation];
  const counts = new Map<string, number>();
  items.forEach((item) => counts.set(item.author_id, (counts.get(item.author_id) ?? 0) + 1));
  const alone = album.member_count === 1;
  const memberIds = new Set(album.members.map((member) => member.user_id));
  const departed = [...counts.keys()].filter((authorId) => !memberIds.has(authorId));

  return (
    <View style={styles.header}>
      <View style={styles.summary}>
        <Ionicons name={relation.icon} size={16} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">
          {relation.label} · {album.member_count}명 · 사진 {items.length}장
        </ThemedText>
        <PhotoQualityBadge quality={album.photo_quality} />
      </View>

      <StorageBar album={album} />
      <SaveToLibrary album={album} items={items} />

      {/* 이름은 앨범마다 따로 정한다 (가족 앨범에선 '엄마', 친구 앨범에선 '지민'). */}
      {me && (
        <Pressable
          onPress={() => setRenaming(true)}
          accessibilityRole="button"
          accessibilityLabel="이 앨범에서 보일 내 이름 바꾸기"
          style={({ pressed }) => [styles.myName, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.flex} numberOfLines={1}>
            이 앨범에서 나는 <ThemedText type="smallBold" localize={false}>{me.display_name}</ThemedText>(으)로 보여요
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.accent, fontWeight: 700 }}>
            바꾸기
          </ThemedText>
        </Pressable>
      )}
      {me && (
        <AlbumNameSheet
          visible={renaming}
          heading="이 앨범에서 보일 내 이름"
          initial={me.display_name}
          placeholder="예) 엄마, 지민"
          maxLength={DISPLAY_NAME_MAX}
          description="이 앨범에만 적용돼요. 내가 담은 사진의 이름표가 모두 바뀌어요."
          confirmLabel="바꾸기"
          onSubmit={(next) => {
            setRenaming(false);
            updateMember(album.id, me.user_id, { display_name: next }).catch(() =>
              Alert.alert('이름을 바꾸지 못했어요', '잠시 후 다시 시도해 주세요.'),
            );
          }}
          onCancel={() => setRenaming(false)}
        />
      )}

      {alone && album.role === 'admin' ? (
        <View style={[styles.inviteCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">함께 담을 사람을 초대해 보세요</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            초대 코드를 받은 사람이 참여하면 서로 담은 사진을 함께 볼 수 있어요. 담은 사진은 앨범 용량에서 세고, 참여한 사람이
            용량을 나눠 주면 앨범 용량도 늘어나요.
          </ThemedText>
          <Button
            label="초대하기"
            onPress={() => router.push({ pathname: '/shared-albums/[id]/members', params: { id: album.id, invite: '1' } })}
          />
        </View>
      ) : (
        items.length === 0 && <Button label="사진 담기" variant="secondary" onPress={onAdd} />
      )}

      {album.members.length + departed.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={`모두 ${items.length}`} selected={author === null} onPress={() => onAuthor(null)} />
          {album.members.map((member) => (
            <Chip
              key={member.user_id}
              label={`${member.is_me ? '나' : member.display_name} ${counts.get(member.user_id) ?? 0}`}
              selected={author === member.user_id}
              onPress={() => onAuthor(member.user_id)}
            />
          ))}
          {/* 사진을 남기고 나간 사람도 따로 볼 수 있게 한다 (용량을 정리할 때 무엇이 남았는지 본다). */}
          {departed.map((authorId, index) => (
            <Chip
              key={authorId}
              label={`나간 구성원${departed.length > 1 ? ` ${index + 1}` : ''} ${counts.get(authorId) ?? 0}`}
              selected={author === authorId}
              onPress={() => onAuthor(authorId)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * 다른 구성원이 담은 사진을 기기 사진첩에 저장한다. 앨범 용량이 없어 정리될 예정이면 기한과 함께 먼저 권한다.
 * 저장한 사진은 기억해 두고 다시 받지 않는다 (shared_downloads).
 */
function SaveToLibrary({ album, items }: { album: SharedAlbumDetail; items: SharedItem[] }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: unsaved } = useDbQuery(() => unsavedSharedItems(db, items), [db, items]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cleanup = album.storage.cleanup_after;
  const unfunded = album.storage.capacity_bytes === 0 && album.storage.bytes_total > 0;

  const save = async () => {
    if (!unsaved?.length) return;
    try {
      const result = await saveSharedItemsToLibrary(db, album.id, unsaved, (done, total) => setProgress({ done, total }));
      Alert.alert(
        result.failed > 0 ? `${result.total - result.failed}장을 저장했어요` : '기기 사진첩에 저장했어요',
        result.failed > 0 ? `${result.failed}장은 저장하지 못했어요. 잠시 후 다시 눌러 주세요.` : undefined,
      );
    } catch (e) {
      Alert.alert('저장하지 못했어요', e instanceof SharedSaveError ? e.message : '잠시 후 다시 시도해 주세요.');
    } finally {
      setProgress(null);
    }
  };

  if (!unfunded && !unsaved?.length) return null;
  return (
    <View style={[styles.saveCard, unfunded && { borderColor: theme.danger, borderWidth: 1 }, { backgroundColor: theme.backgroundElement }]}>
      {unfunded && (
        <>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            {cleanup ? `${formatFullDate(cleanup)}에 이 앨범의 사진이 지워져요` : '이 앨범에 나눠 준 용량이 없어요'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            용량을 나눠 준 구성원이 모두 나갔거나 구독이 끝나 새 사진도 담을 수 없어요. 그 전에 누군가 용량을 나눠 주면 그대로
            이어져요. 간직할 사진은 기기 사진첩에 저장해 두세요.
          </ThemedText>
          <Button
            label="앨범 관리에서 용량 나눠 주기"
            variant="secondary"
            onPress={() => router.push({ pathname: '/shared-albums/[id]/members', params: { id: album.id } })}
          />
        </>
      )}
      {!!unsaved?.length && (
        <Button
          label={
            progress
              ? `저장하는 중… ${progress.done}/${progress.total}`
              : `다른 구성원의 사진 ${unsaved.length}장을 기기 사진첩에 저장`
          }
          variant={unfunded ? 'primary' : 'secondary'}
          disabled={!!progress}
          onPress={save}
        />
      )}
    </View>
  );
}

/** 앨범 용량(구성원이 나눠 준 용량의 합)과 사용량. 넘쳤으면 푸는 방법을 함께 보여 준다. */
function StorageBar({ album }: { album: SharedAlbumDetail }) {
  const theme = useTheme();
  const { bytes_total: used, capacity_bytes: capacity, over_capacity: over } = album.storage;
  const ratio = capacity > 0 ? Math.min(used / capacity, 1) : 1;
  const admin = album.role === 'admin';
  const departed = album.contributors.filter((c) => !c.is_member && c.bytes > 0);
  const mine = album.contributors.find((c) => c.is_me);
  const manage = () => router.push({ pathname: '/shared-albums/[id]/members', params: { id: album.id } });

  const clean = (authorId: string, label: string, bytes: number) =>
    Alert.alert(`${label} 사진을 앨범에서 뺄까요?`, `${formatBytes(bytes)}가 비워져요. 올린 사람의 기록은 그대로 남아요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '빼기',
        style: 'destructive',
        onPress: () => removeAuthorItems(album.id, authorId).catch(() => Alert.alert('사진을 빼지 못했어요', '잠시 후 다시 시도해 주세요.')),
      },
    ]);

  return (
    <View style={styles.storage}>
      <View style={styles.storageLabels}>
        <ThemedText type="small" themeColor="textSecondary">
          앨범 용량
        </ThemedText>
        <ThemedText type="small">
          {formatBytes(used)} / {formatSize(capacity)}
        </ThemedText>
      </View>
      <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
        <View
          style={[
            styles.fill,
            { width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%`, backgroundColor: over || ratio > 0.9 ? theme.danger : theme.accent },
          ]}
        />
      </View>
      {/* 나눠 준 용량이 하나도 없으면 정리 예정 안내(SaveToLibrary)가 대신 보여 준다. */}
      {over && capacity > 0 && (
        <View style={[styles.overCard, { borderColor: theme.danger }]}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            앨범 용량을 {formatBytes(used - capacity)} 넘었어요
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            구성원이 나가거나 구독이 끝나 앨범 용량이 줄었어요. 사진은 그대로 볼 수 있지만, 정리하기 전까지 새 사진은 담을 수
            없어요. 아래 중에서 골라 주세요.
          </ThemedText>
          {admin &&
            departed.map((c) => (
              <Button
                key={c.author_id}
                label={`나간 구성원의 사진 정리 (${c.item_count}장, ${formatBytes(c.bytes)})`}
                variant="secondary"
                onPress={() => clean(c.author_id, '나간 구성원의', c.bytes)}
              />
            ))}
          <Button label="내 용량을 더 나눠 주기" variant="secondary" onPress={manage} />
          {mine && mine.bytes > 0 && (
            <Button
              label={`내가 담은 사진 빼기 (${mine.item_count}장)`}
              variant="secondary"
              onPress={() => clean(mine.author_id, '내가 담은', mine.bytes)}
            />
          )}
          {admin && <Button label="구성원 초대하기" variant="secondary" onPress={manage} />}
          <ThemedText type="small" themeColor="textSecondary">
            사진을 한 장씩 빼려면 사진을 눌러 크게 본 뒤 휴지통을 눌러요. 공유 앨범 용량만 따로 늘리는 추가 결제는 준비하고
            있어요.
          </ThemedText>
        </View>
      )}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        { backgroundColor: selected ? theme.accent : theme.backgroundElement },
      ]}>
      <ThemedText type="small" style={{ color: selected ? theme.onAccent : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** 전체 화면으로 옆으로 넘겨 본다. 아래에 누가 언제 담았는지와, 뺄 수 있으면 [앨범에서 빼기]를 둔다. */
function SharedViewer({
  albumId,
  albumQuality,
  items,
  index,
  onClose,
}: {
  albumId: string;
  albumQuality: SharedAlbumDetail['photo_quality'];
  items: SharedItem[];
  index: number | null;
  onClose: () => void;
}) {
  const db = useSQLiteContext();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(0);
  const [removing, setRemoving] = useState(false);
  const item = index === null ? undefined : items[current];

  const confirmRemove = (target: SharedItem) => {
    Alert.alert(
      '공유 앨범에서 뺄까요?',
      target.is_mine
        ? '구성원 모두에게서 사라져요. 내 기록과 기기 사진첩의 사진은 그대로예요.'
        : `${target.author_name}님이 담은 사진이에요. 관리자로서 구성원 모두에게서 뺄까요? ${target.author_name}님의 기록은 그대로 남아요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '빼기',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await removeSharedItem(albumId, target.id);
              onClose();
            } catch {
              Alert.alert('사진을 빼지 못했어요', '잠시 후 다시 시도해 주세요.');
            } finally {
              setRemoving(false);
            }
          },
        },
      ],
    );
  };

  // 화질은 사진마다 하나라 구성원 모두 같은 파일을 본다. 빼기처럼 올린 사람이나 관리자만 바꾼다.
  const chooseQuality = (target: SharedItem) => {
    // 앨범 화질과 같은 쪽을 고르면 앨범 화질을 따르게 한다 (나중에 앨범 화질을 바꾸면 이 사진도 따라간다).
    const option = (quality: SharedItem['photo_quality']) => ({
      text: `${PHOTO_QUALITY[quality].label}${quality === albumQuality ? ' · 앨범 기본' : ''}${quality === target.photo_quality ? ' (지금)' : ''}`,
      onPress: () => {
        const next = quality === albumQuality ? null : quality;
        // 지금과 같은 화질·같은 방식(앨범 기본 따르기/따로 고름)이면 바꿀 것이 없다.
        const unchanged = quality === target.photo_quality && (next !== null) === target.quality_chosen;
        if (unchanged) return;
        // 앨범 화질 바꾸기(members.tsx)처럼, 이미 올라간 원본이 지워질 수 있으면 먼저 묻는다.
        if (quality === 'display' && target.stored_variants.includes('original')) {
          Alert.alert(
            '효율 보관으로 바꿀까요?',
            '원본은 앨범 용량에서 빠지고, 다른 앨범에 필요 없는 원본은 담은 사람의 기기가 지워요. 지운 원본은 되돌릴 수 없어요.',
            [
              { text: '취소', style: 'cancel' },
              { text: '바꾸기', style: 'destructive', onPress: () => change(next) },
            ],
          );
          return;
        }
        change(next);
      },
    });
    const change = (quality: SharedItem['photo_quality'] | null) =>
      setSharedItemsQuality(albumId, [target.id], quality)
        // 올린 사람이 나면 바로 원본을 올리거나 정리하도록 내 항목 목록을 다시 받는다.
        .then(() => syncCloud(db))
        .catch(() => Alert.alert('화질을 바꾸지 못했어요', '잠시 후 다시 시도해 주세요.'));
    showActionSheet(
      '이 사진의 보관 화질',
      `구성원 모두에게 같은 화질로 보여요. 원본 그대로는 앨범 용량을 더 써요.${
        target.is_mine ? '' : `\n원본은 ${target.author_name}님의 기기에 원본이 있을 때 올라가요.`
      }`,
      [option('original'), option('display'), { text: '취소', style: 'cancel' }],
    );
  };

  return (
    <Modal visible={index !== null} animationType="fade" onRequestClose={onClose} onShow={() => setCurrent(index ?? 0)}>
      <View style={styles.viewer}>
        {index !== null && (
          <FlatList
            data={items}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(entry) => entry.id}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item: entry, index: i }) => (
              <SharedItemPhoto
                albumId={albumId}
                item={entry}
                variant="full"
                contentFit="contain"
                active={i === current}
                style={{ width, height }}
              />
            )}
          />
        )}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="닫기"
          style={[styles.viewerClose, { top: insets.top + Spacing.two }]}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        {item && (
          // 동영상은 아래쪽에 재생 막대가 있어 정보를 위에 둔다 (닫기 버튼 아래).
          <View
            style={[
              styles.viewerInfo,
              item.media_type === 'video'
                ? { top: insets.top + Spacing.two + 48, paddingBottom: Spacing.three }
                : { bottom: 0, paddingBottom: insets.bottom + Spacing.three },
            ]}>
            <View style={styles.flex}>
              <ThemedText style={styles.viewerAuthor}>{item.is_mine ? '내가 담았어요' : `${item.author_name}님이 담았어요`}</ThemedText>
              {item.taken_at && (
                <ThemedText type="small" style={styles.viewerDate}>
                  {formatFullDate(item.taken_at, item.taken_tz_offset)}
                </ThemedText>
              )}
              <Pressable
                onPress={() => chooseQuality(item)}
                disabled={!item.can_delete}
                hitSlop={8}
                accessibilityRole={item.can_delete ? 'button' : 'text'}
                accessibilityLabel={`보관 화질: ${PHOTO_QUALITY[item.photo_quality].label}${item.can_delete ? '. 눌러서 바꾸기' : ''}`}
                style={styles.viewerQuality}>
                <Ionicons name={PHOTO_QUALITY[item.photo_quality].icon} size={13} color="rgba(255,255,255,0.8)" />
                <ThemedText type="small" style={styles.viewerDate}>
                  {PHOTO_QUALITY[item.photo_quality].badge}
                  {item.can_delete ? ' · 바꾸기' : ''}
                </ThemedText>
              </Pressable>
            </View>
            {item.can_delete &&
              (removing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Pressable
                  onPress={() => confirmRemove(item)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="공유 앨범에서 빼기"
                  style={styles.viewerAction}>
                  <Ionicons name="trash-outline" size={22} color="#fff" />
                </Pressable>
              ))}
          </View>
        )}
        {/* 화질 고르기 시트를 이 Modal 위에 띄운다. */}
        <ActionSheetHost />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  center: { textAlign: 'center' },
  empty: { paddingVertical: Spacing.five, paddingHorizontal: Spacing.four },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  compactControls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  albumToolbar: { flexDirection: 'row', gap: Spacing.one },
  editBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: StyleSheet.hairlineWidth, borderRadius: Spacing.two, marginHorizontal: Spacing.three, marginBottom: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  header: { gap: Spacing.three, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.three },
  summary: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  storage: { gap: Spacing.one },
  saveCard: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  storageLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  overCard: { gap: Spacing.two, marginTop: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three, borderWidth: 1 },
  myName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  inviteCard: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  chips: { gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: 16 },
  // 동영상 재생 시간은 왼쪽 아래에 있으므로 이름표는 왼쪽 위에 둔다.
  authorTag: {
    position: 'absolute',
    left: Spacing.one,
    top: Spacing.one,
    maxWidth: '85%',
    paddingHorizontal: Spacing.one + 2,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  authorTagText: { color: '#fff', fontSize: 11, lineHeight: 15, fontWeight: 600 },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerClose: { position: 'absolute', right: Spacing.three },
  // 위(동영상)나 아래(사진) 중 한쪽에만 붙인다. 둘 다 주면 막대가 화면 높이로 늘어난다.
  viewerInfo: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  viewerAuthor: { color: '#fff', fontWeight: 700 },
  viewerDate: { color: 'rgba(255,255,255,0.8)' },
  viewerQuality: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', marginTop: 2 },
  viewerAction: { padding: Spacing.one },
});
