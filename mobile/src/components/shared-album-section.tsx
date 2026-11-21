import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AlbumSectionHeader } from '@/components/album-shelf';
import { EmojiCover, EmptyCover, SPRING_COVER_PHOTO, SpringCover } from '@/components/created-album-card';
import { PhotoQualityBadge } from '@/components/photo-quality';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { useTheme } from '@/hooks/use-theme';
import { listSharedAlbums, RELATIONS, sharedImageUri, type SharedAlbumSummary } from '@/lib/cloud/shared';
import { formatBytes, formatSize } from '@/lib/storage';
import { photoCount, useTranslation } from '@/lib/i18n';

/**
 * 안전 사진첩의 공유 앨범 목록. 나 혼자 쓰는 안전 앨범 아래에 둔다.
 * 구독하지 않은 계정도 초대받은 앨범은 보므로, 구독 여부와 관계없이 로그인하면 보여준다.
 */
export function SharedAlbumSection({ canCreate }: { canCreate: boolean }) {
  const theme = useTheme();
  const { data: albums, error } = useDbQuery(() => listSharedAlbums(), []);

  // 나만 보는 안전 앨범처럼 만들기·참여는 제목 오른쪽 버튼으로 둔다. 구독하지 않으면 참여만 한다.
  return (
    <View style={styles.section}>
      <AlbumSectionHeader
        title="함께 쓰는 공유 앨범"
        actions={[
          { icon: 'enter-outline', label: '코드로 참여', color: theme.navy, onPress: () => router.push('/shared-albums/join') },
          ...(canCreate
            ? [
                {
                  icon: 'add' as const,
                  label: '새 공유 앨범',
                  color: theme.navy,
                  onPress: () => router.push({ pathname: '/cloud-albums/new', params: { audience: 'shared' } }),
                },
              ]
            : []),
        ]}
      />
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
    </View>
  );
}

/**
 * 로그인하기 전에 보이는 공유 앨범 입구. 초대받은 사람은 구독 없이 로그인만 하면 함께 보므로,
 * 초대 링크 없이 코드만 받은 사람도 여기서 참여를 시작한다 (참여 화면이 로그인을 먼저 안내한다).
 */
export function SharedAlbumJoinPrompt() {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <AlbumSectionHeader
        title="함께 쓰는 공유 앨범"
        actions={[
          { icon: 'enter-outline', label: '코드로 참여', color: theme.navy, onPress: () => router.push('/shared-albums/join') },
        ]}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        공유 앨범에 초대받았다면 구독하지 않아도 로그인만 하면 함께 보고 담을 수 있어요.
      </ThemedText>
    </View>
  );
}

/** 나만 보는 안전 앨범과 같은 스프링 표지에, 책등만 네이비로 구분한다. */
function SharedAlbumCard({ album }: { album: SharedAlbumSummary }) {
  const theme = useTheme();
  const { language } = useTranslation();
  const relation = RELATIONS[album.relation];
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/shared-albums/[id]', params: { id: album.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.background, borderColor: theme.border, opacity: pressed ? 0.8 : 1 },
      ]}>
      <SpringCover spine={theme.navy}>
        <Cover album={album} />
      </SpringCover>
      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.title} localize={false}>
          {album.title}
        </ThemedText>
        <View style={styles.relation}>
          <Ionicons name={relation.icon} size={14} color={theme.navy} />
          <ThemedText type="small" themeColor="textSecondary">
            {relation.label} · {language === 'en' ? `${album.member_count} members` : language === 'ja' ? `${album.member_count}人` : `${album.member_count}명`} · {photoCount(language, album.item_count)}
          </ThemedText>
        </View>
        <ThemedText type="small" style={album.storage.over_capacity ? { color: theme.danger } : undefined} themeColor="textSecondary">
          {album.storage.over_capacity
            ? '앨범 용량이 넘쳤어요'
            : `${formatBytes(album.storage.bytes_total)} / ${formatSize(album.storage.capacity_bytes)}`}
        </ThemedText>
        {/* 나만 보는 안전 앨범 카드(CloudAlbumBadges)처럼 보관 화질을 태그로 보여 준다. */}
        <View style={styles.badges}>
          <PhotoQualityBadge quality={album.photo_quality} />
          {album.role === 'admin' && (
            <ThemedText type="small" style={[styles.admin, { color: theme.accent }]}>
              {album.is_owner ? '소유자' : '관리자'}
            </ThemedText>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

function Cover({ album }: { album: SharedAlbumSummary }) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const design = album.cover_mode === 'design';
  useEffect(() => {
    if (design || !album.cover_item_id) return setUri(null);
    let cancelled = false;
    const itemId = album.cover_item_id;
    // 썸네일이 아직 없는 표지(이전에 올린 사진)는 표시용으로 그린다.
    sharedImageUri(album.id, itemId, 'thumb')
      .catch(() => sharedImageUri(album.id, itemId, 'display'))
      .then((found) => !cancelled && setUri(found))
      .catch(() => !cancelled && setUri(null));
    return () => {
      cancelled = true;
    };
  }, [album.id, album.cover_item_id, design]);

  if (design) return <EmojiCover emoji={album.cover_emoji} />;
  if (uri) return <Image source={{ uri }} style={SPRING_COVER_PHOTO} contentFit="cover" transition={150} />;
  return <EmptyCover icon={RELATIONS[album.relation].icon} color={theme.navy} />;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  hint: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  stack: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  // 나만 보는 안전 앨범 카드(CreatedAlbumCard)와 같은 크기
  card: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: Spacing.one },
  title: { fontSize: 17, lineHeight: 24 },
  relation: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  admin: { fontSize: 12, lineHeight: 16, fontWeight: 700 },
});
