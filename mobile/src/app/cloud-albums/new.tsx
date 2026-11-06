import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { MomentPhoto } from '@/components/moment-photo';
import { PhotoQualityPicker } from '@/components/photo-quality';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  ALBUM_TITLE_MAX,
  connectAlbumToCloud,
  createAlbum,
  linkedDeviceAlbumIds,
  listAlbums,
  type AlbumSummary,
  type PhotoQuality,
} from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { useTheme } from '@/hooks/use-theme';

type Start = 'link' | 'new';

// 안전 앨범 만들기: 기기 앨범을 연결하거나 안전 보관에만 있는 앨범을 새로 만들고, 앨범의 보관 화질을 고른다.
// source: 기기 앨범 화면의 [안전 보관에 연결]로 들어오면 그 앨범을 골라 둔다.
export default function NewCloudAlbumScreen() {
  const { source } = useLocalSearchParams<{ source?: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: albums } = useDbQuery(() => listAlbums(db), [db]);
  const { data: linked } = useDbQuery(() => linkedDeviceAlbumIds(db), [db]);
  const [start, setStart] = useState<Start>(source ? 'link' : 'new');
  const [sourceId, setSourceId] = useState<string | null>(source ?? null);
  const [title, setTitle] = useState('');
  const [quality, setQuality] = useState<PhotoQuality>('original');
  const [saving, setSaving] = useState(false);

  const deviceAlbums = albums?.slice(1) ?? [];
  const trimmed = title.trim();
  const ready = start === 'new' ? trimmed !== '' : sourceId !== null && !linked?.has(sourceId);

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      if (start === 'new') {
        const id = await createAlbum(db, trimmed, { quality });
        // 새 안전 앨범은 나의 순간들에서 올릴 사진을 고르며 시작한다.
        router.replace({ pathname: '/albums/[id]/add', params: { id } });
      } else {
        const id = await connectAlbumToCloud(db, sourceId!, quality);
        router.replace({ pathname: '/albums/[id]', params: { id, source: 'cloud' } });
      }
    } catch {
      Alert.alert('앨범을 만들지 못했어요', '잠시 후 다시 시도해 주세요.');
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.flex}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.section}>
            <ThemedText type="smallBold">어떻게 만들까요?</ThemedText>
            <View style={styles.startRow}>
              <StartCard
                icon="cloud-outline"
                title="새로 만들기"
                description="안전 보관에만 있는 앨범"
                selected={start === 'new'}
                onPress={() => setStart('new')}
              />
              <StartCard
                icon="link-outline"
                title="기기 앨범 연결"
                description="기기 앨범을 안전 보관에 동기화"
                selected={start === 'link'}
                onPress={() => setStart('link')}
              />
            </View>
          </View>

          {start === 'new' ? (
            <View style={styles.section}>
              <ThemedText type="smallBold">앨범 이름</ThemedText>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="예) 아이의 첫 해, 부모님 사진"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                maxLength={ALBUM_TITLE_MAX}
                returnKeyType="done"
              />
              <ThemedText type="small" themeColor="textSecondary">
                만든 뒤 나의 순간들에서 안전 보관할 사진을 골라요. 기기 사진첩의 앨범에는 보이지 않아요.
              </ThemedText>
            </View>
          ) : (
            <View style={styles.section}>
              <ThemedText type="smallBold">연결할 기기 앨범</ThemedText>
              {deviceAlbums.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  아직 기기 사진첩에 만든 앨범이 없어요. 기기 사진첩에서 앨범을 만들거나, 새로 만들기를 골라 주세요.
                </ThemedText>
              ) : (
                <View style={styles.albumList}>
                  {deviceAlbums.map((album) => (
                    <DeviceAlbumOption
                      key={album.id}
                      album={album}
                      connected={!!linked?.has(album.id)}
                      selected={album.id === sourceId}
                      onPress={() => setSourceId(album.id)}
                    />
                  ))}
                </View>
              )}
              <ThemedText type="small" themeColor="textSecondary">
                지금 담긴 사진을 모두 올리고, 앞으로 기기 앨범에 넣는 사진도 따라 올려요. 기기 앨범에서 빼도 안전 앨범의
                사진은 그대로 남아요.
              </ThemedText>
            </View>
          )}

          <View style={styles.section}>
            <ThemedText type="smallBold">보관 화질</ThemedText>
            <PhotoQualityPicker value={quality} onChange={setQuality} />
            <ThemedText type="small" themeColor="textSecondary">
              앨범마다 다르게 고를 수 있고, 나중에 앨범 메뉴에서 바꿀 수 있어요. 원본을 보관해도 빠르게 보여 줄 보기용
              사진을 함께 만들어 둬요.
            </ThemedText>
          </View>

          <Button
            label={start === 'new' ? '만들고 사진 고르기' : '연결하기'}
            disabled={!ready}
            loading={saving}
            onPress={submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

function StartCard({
  icon,
  title,
  description,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.startCard,
        {
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: selected ? theme.backgroundElement : theme.background,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <Ionicons name={icon} size={24} color={selected ? theme.accent : theme.textSecondary} />
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {description}
      </ThemedText>
    </Pressable>
  );
}

function DeviceAlbumOption({
  album,
  connected,
  selected,
  onPress,
}: {
  album: AlbumSummary;
  connected: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={connected}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: connected }}
      style={({ pressed }) => [
        styles.albumOption,
        { borderColor: selected ? theme.accent : theme.border, opacity: connected ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      {album.coverMode === 'design' ? (
        <View style={[styles.albumThumb, styles.thumbCenter, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>{album.coverEmoji ?? '✨'}</ThemedText>
        </View>
      ) : album.cover ? (
        <MomentPhoto moment={album.cover} style={styles.albumThumb} />
      ) : (
        <View style={[styles.albumThumb, styles.thumbCenter, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="images-outline" size={18} color={theme.textSecondary} />
        </View>
      )}
      <View style={styles.flex}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {album.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {connected ? '이미 연결했어요' : `사진 ${album.count}장`}
        </ThemedText>
      </View>
      {!connected && (
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={22}
          color={selected ? theme.accent : theme.textSecondary}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.six },
  section: { gap: Spacing.two },
  startRow: { flexDirection: 'row', gap: Spacing.two },
  startCard: { flex: 1, gap: Spacing.one, padding: Spacing.three, borderRadius: Spacing.three, borderWidth: 1.5 },
  input: { fontSize: 16, padding: Spacing.three, borderRadius: Spacing.three },
  albumList: { gap: Spacing.two },
  albumOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
  },
  albumThumb: { width: 48, height: 48, borderRadius: Spacing.two, overflow: 'hidden' },
  thumbCenter: { alignItems: 'center', justifyContent: 'center' },
});
