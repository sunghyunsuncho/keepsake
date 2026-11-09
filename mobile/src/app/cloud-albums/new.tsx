import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { MomentPhoto } from '@/components/moment-photo';
import { AllocationPicker } from '@/components/allocation-picker';
import { PhotoQualityPicker } from '@/components/photo-quality';
import { RelationPicker } from '@/components/relation-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  ALBUM_TITLE_MAX,
  connectAlbumToCloud,
  createAlbum,
  getAlbum,
  linkedDeviceAlbumIds,
  listAlbums,
  type AlbumSummary,
  type PhotoQuality,
} from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { useTheme } from '@/hooks/use-theme';
import { syncCloud, useCloudState } from '@/lib/cloud/engine';
import { CloudError } from '@/lib/cloud/session';
import {
  convertToSharedAlbum,
  createSharedAlbum,
  DISPLAY_NAME_MAX,
  RELATIONS,
  sharedAlbumOverview,
  type Relation,
} from '@/lib/cloud/shared';
import { formatSize } from '@/lib/storage';

type Audience = 'personal' | 'shared';
type Start = 'link' | 'new';

// 안전 앨범 만들기. 먼저 누가 볼지 고른다:
// - 나만 보기: 기기 앨범을 연결하거나 안전 보관에만 있는 앨범을 새로 만든다.
// - 함께 쓰기(공유 앨범): 가족·친구·파트너와 함께 사진을 담는다. 서버에 만들고, 만든 사람이 관리자다.
// 보관 화질은 둘 다 앨범마다 고른다.
// source: 기기 앨범 화면의 [안전 보관에 연결]로 들어오면 그 앨범을 골라 둔다.
// audience=shared: 공유 앨범 쪽을 골라 둔다. convert: 이미 있는 안전 앨범을 공유 앨범으로 바꾼다.
export default function NewCloudAlbumScreen() {
  const params = useLocalSearchParams<{ source?: string; audience?: string; convert?: string }>();
  const db = useSQLiteContext();
  const theme = useTheme();
  const navigation = useNavigation();
  const { data: albums } = useDbQuery(() => listAlbums(db), [db]);
  const { data: linked } = useDbQuery(() => linkedDeviceAlbumIds(db), [db]);
  const { data: converting } = useDbQuery(
    async () => (params.convert ? getAlbum(db, params.convert) : null),
    [db, params.convert],
  );
  const convert = Boolean(params.convert);
  const [audience, setAudience] = useState<Audience>(convert || params.audience === 'shared' ? 'shared' : 'personal');
  const [start, setStart] = useState<Start>(params.source ? 'link' : 'new');
  const [sourceId, setSourceId] = useState<string | null>(params.source ?? null);
  const [title, setTitle] = useState('');
  const [relation, setRelation] = useState<Relation>('family');
  const [name, setName] = useState('');
  const [quality, setQuality] = useState<PhotoQuality>('original');
  const [allocation, setAllocation] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const { account } = useCloudState();
  const { data: overview } = useDbQuery(() => sharedAlbumOverview(), []);
  // 바꾸는 앨범의 사진이 쓰던 개인 용량은 앨범으로 옮겨 오므로 그만큼 더 떼어 줄 수 있다 (서버가 정확히 확인한다).
  const available = (overview?.free_bytes ?? 0) + (params.convert ? (account?.usage.bytes_total ?? 0) : 0);
  const limitReached = overview ? overview.owned >= overview.limit : false;
  useEffect(() => {
    if (overview && allocation === null) setAllocation(Math.min(overview.suggested_allocation, available));
  }, [overview, allocation, available]);

  // 바꿀 앨범의 이름과 화질에서 시작한다.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!converting || prefilled.current) return;
    prefilled.current = true;
    setTitle(converting.title);
    if (converting.photoQuality) setQuality(converting.photoQuality);
  }, [converting]);
  useLayoutEffect(() => {
    if (convert) navigation.setOptions({ title: '공유 앨범으로 바꾸기' });
  }, [convert, navigation]);

  const shared = audience === 'shared';
  const deviceAlbums = albums?.slice(1) ?? [];
  const trimmed = title.trim();
  const ready = shared
    ? trimmed !== '' && name.trim() !== '' && !!allocation && allocation > 0 && !limitReached
    : start === 'new'
      ? trimmed !== ''
      : sourceId !== null && !linked?.has(sourceId);

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      if (shared) {
        const body = {
          title: trimmed,
          relation,
          display_name: name.trim(),
          photo_quality: quality,
          allocated_bytes: allocation ?? 0,
        };
        const album = convert
          ? await convertToSharedAlbum(db, params.convert!, body)
          : await createSharedAlbum(body);
        if (convert) {
          syncCloud(db);
          // 바꾼 안전 앨범은 지워졌다. 그 화면이 뒤에 남지 않게 안전 사진첩까지 닫고 새 공유 앨범을 연다.
          router.dismissTo('/cloud-library');
          router.push({ pathname: '/shared-albums/[id]', params: { id: album.id } });
        } else {
          router.replace({ pathname: '/shared-albums/[id]', params: { id: album.id } });
        }
      } else if (start === 'new') {
        const id = await createAlbum(db, trimmed, { quality });
        // 새 안전 앨범은 나의 순간들에서 올릴 사진을 고르며 시작한다.
        router.replace({ pathname: '/albums/[id]/add', params: { id } });
      } else {
        const id = await connectAlbumToCloud(db, sourceId!, quality);
        router.replace({ pathname: '/albums/[id]', params: { id, source: 'cloud' } });
      }
    } catch (e) {
      const reason =
        e instanceof CloudError && e.status === 413
          ? e.message === 'shared album storage is full'
            ? '할당한 용량이 이 앨범의 사진보다 작아요. 더 크게 골라 주세요.'
            : '내 안전 보관에 남은 용량보다 크게 할당할 수 없어요.'
          : e instanceof CloudError && e.status === 409
            ? '지금 요금제로 가질 수 있는 공유 앨범을 모두 만들었어요.'
            : null;
      Alert.alert(
        convert ? '공유 앨범으로 바꾸지 못했어요' : '앨범을 만들지 못했어요',
        reason ??
          (shared ? '원래 앨범은 그대로예요. 구독 상태와 인터넷 연결을 확인해 주세요.' : '잠시 후 다시 시도해 주세요.'),
      );
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];
  return (
    <ThemedView style={styles.flex}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {convert ? (
            <View style={[styles.rules, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary">
                {`'${converting?.title ?? ''}'의 사진을 모두 담은 공유 앨범을 만들고, 나만 보던 안전 앨범은 정리해요. 이미 올린 파일은 다시 올리지 않고, 기록과 사진은 그대로예요.`}
                {converting?.sourceAlbumTitle ? ' 기기 앨범 연결은 공유 앨범에서 이어지지 않아요. 이후 사진은 공유 앨범에서 직접 담아 주세요.' : ''}
              </ThemedText>
            </View>
          ) : (
            <View style={styles.section}>
              <ThemedText type="smallBold">누가 보는 앨범인가요?</ThemedText>
              <View style={styles.startRow}>
                <StartCard
                  icon="lock-closed-outline"
                  title="나만 보기"
                  description="내 계정에서만 보는 앨범"
                  selected={!shared}
                  onPress={() => setAudience('personal')}
                />
                <StartCard
                  icon="people-outline"
                  title="함께 쓰기"
                  description="가족·친구·파트너와 함께 담는 공유 앨범"
                  selected={shared}
                  onPress={() => setAudience('shared')}
                />
              </View>
            </View>
          )}

          {shared && limitReached && (
            <View style={[styles.rules, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                지금 요금제로는 공유 앨범을 {overview?.limit ?? 1}개까지 가질 수 있어요. 다른 사람의 공유 앨범에 참여하는
                것은 개수에 들어가지 않아요. 더 많은 공유 앨범을 쓰는 요금제는 준비하고 있어요.
              </ThemedText>
            </View>
          )}

          {shared ? (
            <>
              <View style={styles.section}>
                <ThemedText type="smallBold">누구와 함께 쓰나요?</ThemedText>
                <RelationPicker value={relation} onChange={setRelation} />
              </View>
              <View style={styles.section}>
                <ThemedText type="smallBold">앨범 이름</ThemedText>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder={
                    relation === 'partner'
                      ? '예) 우리 둘의 여행'
                      : relation === 'friends'
                        ? '예) 대학 동기 모임'
                        : `예) 우리 ${RELATIONS[relation].label}`
                  }
                  placeholderTextColor={theme.textSecondary}
                  style={inputStyle}
                  maxLength={ALBUM_TITLE_MAX}
                />
              </View>
              <View style={styles.section}>
                <ThemedText type="smallBold">이 앨범에서 보일 내 이름</ThemedText>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder={relation === 'family' ? '예) 엄마, 큰딸' : relation === 'partner' ? '예) 자기, 지민' : '예) 지민'}
                  placeholderTextColor={theme.textSecondary}
                  style={inputStyle}
                  maxLength={DISPLAY_NAME_MAX}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  이름은 앨범마다 따로 정해요. 가족 앨범에선 ‘엄마’, 친구 앨범에선 ‘지민’처럼요. 내가 담은 사진에 표시되고, 계정
                  이메일은 다른 구성원에게 보이지 않아요. 나중에 앨범 화면에서 바꿀 수 있어요.
                </ThemedText>
              </View>
              <View style={styles.section}>
                <ThemedText type="smallBold">이 앨범에 나눠 줄 내 용량</ThemedText>
                {allocation !== null && (
                  <AllocationPicker value={allocation} onChange={setAllocation} available={available} />
                )}
                <ThemedText type="small" themeColor="textSecondary">
                  앨범 용량은 구성원이 각자 나눠 준 용량을 합한 만큼이에요. 나눠 준 용량은 내 안전 보관에서 미리 빠지고,
                  앨범에 담긴 사진은 내 개인 용량이 아니라 앨범 용량에서 세요.
                  {convert ? ` 이 앨범의 사진이 쓰던 용량도 앨범으로 옮겨 가므로, 그보다 크게 골라 주세요.` : ''}
                  {allocation ? ` 지금은 ${formatSize(allocation)}로 시작해요.` : ''}
                </ThemedText>
              </View>
            </>
          ) : (
            <>
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
                    style={inputStyle}
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
            </>
          )}

          <View style={styles.section}>
            <ThemedText type="smallBold">보관 화질</ThemedText>
            <PhotoQualityPicker value={quality} onChange={setQuality} />
            <ThemedText type="small" themeColor="textSecondary">
              {shared
                ? '구성원이 담는 사진은 이 화질로 보관하고, 구성원이 나눠 준 앨범 용량에서 세요. 관리자는 나중에 바꿀 수 있어요.'
                : '앨범마다 다르게 고를 수 있고, 나중에 앨범 메뉴에서 바꿀 수 있어요. 원본을 보관해도 빠르게 보여 줄 보기용 사진을 함께 만들어 둬요.'}
            </ThemedText>
          </View>

          {shared && (
            <View style={[styles.rules, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary">
                • 만든 사람이 소유자이자 관리자예요. 관리자는 여러 명 둘 수 있고, 구성원을 초대·내보내고 모든 사진을 뺄 수
                있어요.{'\n'}• 다른 구성원은 자기가 담은 사진만 뺄 수 있어요.{'\n'}• 앨범 용량에 여유가 있으면 구독하지 않은
                구성원도 보고 담을 수 있어요.{'\n'}• 메모와 장소는 함께 보내지 않아요.
              </ThemedText>
            </View>
          )}

          <Button
            label={
              convert
                ? '공유 앨범으로 바꾸기'
                : shared
                  ? '만들고 초대하기'
                  : start === 'new'
                    ? '만들고 사진 고르기'
                    : '연결하기'
            }
            disabled={!ready || (convert && !converting)}
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
  rules: { padding: Spacing.three, borderRadius: Spacing.three },
});
