import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { CloudSection } from '@/components/cloud-section';
import { MomentPhoto } from '@/components/moment-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ALL_ALBUM_ID, listAlbums, type AlbumSummary } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { useTheme } from '@/hooks/use-theme';
import { useCloudState } from '@/lib/cloud/engine';
import { useCloudSession } from '@/lib/cloud/session';

/** 계정의 안전 보관 공간에 동기화된 앨범을 보는 탭. */
export default function CloudLibraryScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const session = useCloudSession();
  const { account } = useCloudState();
  const { data: albums } = useDbQuery(() => listAlbums(db), [db]);
  const canView = Boolean(session && account?.subscription.can_download);

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <ThemedText type="subtitle">안전 보관 사진첩</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            이 계정의 안전 보관 공간에 저장된 사진과 앨범이에요. 기기를 바꿔도 로그인하면 다시 볼 수 있어요.
          </ThemedText>
        </View>

        {canView ? (
          <CloudAlbums albums={albums} />
        ) : (
          <View style={styles.empty}>
            <Ionicons name="cloud-outline" size={40} color={theme.textSecondary} />
            <ThemedText type="smallBold">아직 안전 보관 사진첩이 없어요</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              안전 보관을 시작하면 고른 사진과 앨범을 이 계정에 저장하고, 다른 기기에서도 볼 수 있어요.
            </ThemedText>
          </View>
        )}

        <View style={styles.management}>
          <ThemedText type="smallBold">안전 보관 관리</ThemedText>
          <CloudSection />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function CloudAlbums({ albums }: { albums: AlbumSummary[] | undefined }) {
  const { width } = useWindowDimensions();
  if (!albums) return <ActivityIndicator />;
  const cardWidth = (width - Spacing.three * 2 - Spacing.three) / 2;
  return (
    <View style={styles.albumSection}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        안전 보관한 앨범
      </ThemedText>
      <View style={styles.albumGrid}>
        {albums.map((album) => (
          <CloudAlbumCard key={album.id} album={album} width={cardWidth} />
        ))}
      </View>
    </View>
  );
}

function CloudAlbumCard({ album, width }: { album: AlbumSummary; width: number }) {
  const theme = useTheme();
  const height = Math.min(Math.round(width * 0.72), 128);
  const title = album.id === ALL_ALBUM_ID ? '안전 보관한 순간들' : album.title;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/albums/[id]', params: { id: album.id, source: 'cloud' } })}
      accessibilityRole="button"
      style={({ pressed }) => [{ width, opacity: pressed ? 0.8 : 1 }]}>
      {album.cover ? (
        <MomentPhoto moment={album.cover} style={[styles.cover, { width, height }]} transition={150} />
      ) : (
        <View style={[styles.cover, styles.emptyCover, { width, height, backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="cloud-outline" size={28} color={theme.textSecondary} />
        </View>
      )}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.albumTitle}>
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {album.count}장
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.five, paddingBottom: Spacing.six },
  intro: { gap: Spacing.two },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  center: { textAlign: 'center' },
  albumSection: { gap: Spacing.three },
  albumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  cover: { borderRadius: Spacing.three, overflow: 'hidden' },
  emptyCover: { alignItems: 'center', justifyContent: 'center' },
  albumTitle: { marginTop: Spacing.two },
  management: { gap: Spacing.three },
});
