import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { useTheme } from '@/hooks/use-theme';
import { listSharedAlbums, RELATIONS, sharedDisplayUri, type SharedAlbumSummary } from '@/lib/cloud/shared';
import { formatBytes, formatSize } from '@/lib/storage';

/**
 * 안전 사진첩의 공유 앨범 목록. 나 혼자 쓰는 안전 앨범 아래에 둔다.
 * 구독하지 않은 계정도 초대받은 앨범은 보므로, 구독 여부와 관계없이 로그인하면 보여준다.
 */
export function SharedAlbumSection({ canCreate }: { canCreate: boolean }) {
  const { data: albums, error } = useDbQuery(() => listSharedAlbums(), []);

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          함께 쓰는 공유 앨범
        </ThemedText>
      </View>
      {albums === undefined && !error ? (
        <ActivityIndicator />
      ) : error && !albums ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          공유 앨범을 불러오지 못했어요. 잠시 후 다시 열어 주세요.
        </ThemedText>
      ) : albums && albums.length > 0 ? (
        <View style={styles.stack}>
          {albums.map((album) => (
            <SharedAlbumCard key={album.id} album={album} />
          ))}
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          가족·친구·파트너와 함께 사진을 담는 앨범이에요.{'\n'}누가 담았는지 사진마다 보이고, 각자 담은 사진은 각자 관리해요.
        </ThemedText>
      )}
      <View style={styles.buttons}>
        {canCreate && (
          <View style={styles.flex}>
            <Button label="새 공유 앨범" onPress={() => router.push({ pathname: '/cloud-albums/new', params: { audience: 'shared' } })} />
          </View>
        )}
        <View style={styles.flex}>
          <Button label="초대 코드로 참여" variant="secondary" onPress={() => router.push('/shared-albums/join')} />
        </View>
      </View>
    </View>
  );
}

function SharedAlbumCard({ album }: { album: SharedAlbumSummary }) {
  const theme = useTheme();
  const relation = RELATIONS[album.relation];
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/shared-albums/[id]', params: { id: album.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.background, borderColor: theme.border, opacity: pressed ? 0.8 : 1 },
      ]}>
      <Cover album={album} />
      <View style={styles.flex}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {album.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {relation.label} · {album.member_count}명 · 사진 {album.item_count}장
        </ThemedText>
        <ThemedText type="small" style={album.storage.over_capacity ? { color: theme.danger } : undefined} themeColor="textSecondary">
          {album.storage.over_capacity
            ? '앨범 용량이 넘쳤어요'
            : `${formatBytes(album.storage.bytes_total)} / ${formatSize(album.storage.capacity_bytes)}`}
        </ThemedText>
        {album.role === 'admin' && (
          <ThemedText type="small" style={[styles.admin, { color: theme.accent }]}>
            {album.is_owner ? '소유자' : '관리자'}
          </ThemedText>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.chevron} />
    </Pressable>
  );
}

function Cover({ album }: { album: SharedAlbumSummary }) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!album.cover_item_id) return setUri(null);
    let cancelled = false;
    sharedDisplayUri(album.id, album.cover_item_id)
      .then((found) => !cancelled && setUri(found))
      .catch(() => !cancelled && setUri(null));
    return () => {
      cancelled = true;
    };
  }, [album.id, album.cover_item_id]);

  if (uri) return <Image source={{ uri }} style={styles.cover} contentFit="cover" transition={100} />;
  return (
    <View style={[styles.cover, styles.coverEmpty, { backgroundColor: theme.backgroundElement }]}>
      <Ionicons name={RELATIONS[album.relation].icon} size={24} color={theme.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { paddingVertical: Spacing.two },
  stack: { gap: Spacing.two },
  buttons: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cover: { width: 64, height: 64, borderRadius: Spacing.two, overflow: 'hidden' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  admin: { fontSize: 12, lineHeight: 16, fontWeight: 700 },
});
