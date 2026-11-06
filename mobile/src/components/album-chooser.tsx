import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumNameSheet } from '@/components/album-name-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ALL_ALBUM_TITLE, createAlbum, listCustomAlbums, momentAlbumIds, updateAlbumMoments } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { useCloudState } from '@/lib/cloud/engine';
import { useTheme } from '@/hooks/use-theme';

/** 기록 화면의 '앨범' 줄. 누르면 이 기록을 넣을 앨범을 고른다 (누르는 즉시 넣고 뺀다). */
export function AlbumChooserRow({ momentId }: { momentId: string }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const { data: albums } = useDbQuery(() => listCustomAlbums(db), [db]);
  // 구독 중이면 안전 앨범에도 바로 넣는다 (넣은 사진은 그 앨범의 화질로 안전 보관된다).
  const canUpload = useCloudState().account?.subscription.can_upload ?? false;
  const { data: cloudAlbums } = useDbQuery(() => listCustomAlbums(db, 'cloud'), [db]);
  const { data: memberOf } = useDbQuery(() => momentAlbumIds(db, momentId), [db, momentId]);

  const names = [...(albums ?? []), ...(cloudAlbums ?? [])].filter((a) => memberOf?.has(a.id)).map((a) => a.title);
  const toggle = (albumId: string) =>
    updateAlbumMoments(db, albumId, memberOf?.has(albumId) ? { remove: [momentId] } : { add: [momentId] });

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={[styles.row, { borderColor: theme.border }]}>
        <Ionicons name="albums-outline" size={20} color={theme.textSecondary} />
        <ThemedText style={styles.flex} themeColor={names.length ? 'text' : 'textSecondary'} numberOfLines={1}>
          {names.length ? names.join(', ') : '앨범에 넣기'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {names.length ? '바꾸기' : ''}
        </ThemedText>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="닫기" />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.sheetHeader}>
            <ThemedText type="smallBold">앨범에 넣기</ThemedText>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <ThemedText style={{ color: theme.accent, fontWeight: 700 }}>완료</ThemedText>
            </Pressable>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            한 기록을 여러 앨범에 넣어도 사진은 하나예요. 이 기록은 언제나 {ALL_ALBUM_TITLE}에도 있어요.
          </ThemedText>
          <ScrollView style={styles.list}>
            {canUpload && !!cloudAlbums?.length && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.group}>
                기기 앨범
              </ThemedText>
            )}
            {albums?.map((album) => {
              const checked = !!memberOf?.has(album.id);
              return (
                <Pressable
                  key={album.id}
                  onPress={() => toggle(album.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  style={[styles.option, { borderColor: theme.border }]}>
                  <ThemedText style={styles.flex} numberOfLines={1}>
                    {album.title}
                  </ThemedText>
                  <Ionicons
                    name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={checked ? theme.accent : theme.textSecondary}
                  />
                </Pressable>
              );
            })}
            {canUpload && !!cloudAlbums?.length && (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.group}>
                  안전 앨범
                </ThemedText>
                {cloudAlbums.map((album) => {
                  const checked = !!memberOf?.has(album.id);
                  return (
                    <Pressable
                      key={album.id}
                      onPress={() => toggle(album.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      style={[styles.option, { borderColor: theme.border }]}>
                      <Ionicons name="cloud-outline" size={18} color={theme.textSecondary} />
                      <ThemedText style={styles.flex} numberOfLines={1}>
                        {album.title}
                      </ThemedText>
                      <Ionicons
                        name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={checked ? theme.accent : theme.textSecondary}
                      />
                    </Pressable>
                  );
                })}
              </>
            )}
            <Pressable onPress={() => setNaming(true)} style={styles.option}>
              <Ionicons name="add" size={22} color={theme.accent} />
              <ThemedText style={{ color: theme.accent, fontWeight: 700 }}>새 앨범 만들기</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
        <AlbumNameSheet
          visible={naming}
          heading="새 앨범"
          confirmLabel="만들고 넣기"
          onSubmit={async (title) => {
            setNaming(false);
            const albumId = await createAlbum(db, title);
            await updateAlbumMoments(db, albumId, { add: [momentId] });
          }}
          onCancel={() => setNaming(false)}
        />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    marginTop: 'auto',
    maxHeight: '70%',
    padding: Spacing.four,
    gap: Spacing.two,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { marginTop: Spacing.two },
  group: { marginTop: Spacing.three },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
