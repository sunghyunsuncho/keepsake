import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showActionSheet } from '@/components/action-sheet';
import { AlbumChooserRow } from '@/components/album-chooser';
import { Button } from '@/components/button';
import { DateSheet } from '@/components/date-sheet';
import { MomentPhoto } from '@/components/moment-photo';
import { PHOTO_QUALITY } from '@/components/photo-quality';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { momentQualityInfo, type PhotoQuality } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { getMoment, updateMoment, type Moment, type MomentEdit } from '@/db/moments';
import type { AppLanguage } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { fillPlaceFromPhoto, removeMoment } from '@/lib/capture';
import { useCloudState } from '@/lib/cloud/engine';
import { removeFromSharedAlbums, sharedAlbumCount } from '@/lib/cloud/shared';
import { formatFullDate, formatTime, localDateKey } from '@/lib/dates';
import { localizeText, showAlert, useTranslation } from '@/lib/i18n';

export default function MomentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { data: moment } = useDbQuery(() => getMoment(db, id), [db, id]);

  if (moment === undefined) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }
  if (moment === null) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText themeColor="textSecondary">이 기록을 찾을 수 없어요.</ThemedText>
      </ThemedView>
    );
  }
  // 다른 기록으로 바뀌면 입력 상태를 새로 시작한다.
  return <MomentEditor key={moment.id} moment={moment} />;
}

const SAVE_DELAY_MS = 600;

function MomentEditor({ moment }: { moment: Moment }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { language } = useTranslation();
  const { width } = useWindowDimensions();
  const [memo, setMemo] = useState(moment.memo);
  const [place, setPlace] = useState(moment.place_name ?? '');
  const [editingDate, setEditingDate] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [locating, setLocating] = useState(false);
  const offset = moment.taken_tz_offset;

  // 입력하는 동안 잠깐 멈추면 저장하고, 화면을 떠날 때 남은 변경을 마저 저장한다.
  const pending = useRef<MomentEdit>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useRef(() => {
    clearTimeout(timer.current);
    const edit = pending.current;
    pending.current = {};
    if (Object.keys(edit).length > 0) updateMoment(db, moment.id, edit);
  });
  const queue = (edit: MomentEdit) => {
    pending.current = { ...pending.current, ...edit };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush.current(), SAVE_DELAY_MS);
  };
  useEffect(() => {
    const save = flush.current;
    return () => save();
  }, []);

  // 장소는 기록을 만든 뒤 따로 찾으므로, 화면을 연 뒤에 채워질 수 있다. 입력 중이 아니면 반영한다.
  useEffect(() => {
    if (moment.place_name && place === '' && pending.current.place_name === undefined) {
      setPlace(moment.place_name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment.place_name]);

  const aspectRatio = moment.width && moment.height ? moment.width / moment.height : 1;

  const fillFromPhoto = async () => {
    setLocating(true);
    const found = await fillPlaceFromPhoto(db, moment).catch(() => false);
    setLocating(false);
    if (!found) {
      showAlert('장소를 찾지 못했어요', '인터넷 연결을 확인하거나 직접 입력해 주세요.');
    }
  };

  const remove = () => {
    pending.current = {};
    // 먼저 닫는다. 지운 뒤 닫으면 잠깐 '이 기록을 찾을 수 없어요'가 보인다.
    router.back();
    removeMoment(db, moment.id, localDateKey(moment.taken_at)).catch(() => {
      showAlert('기록에서 빼지 못했어요', '잠시 후 다시 시도해 주세요.');
    });
  };

  const confirmRemove = async () => {
    const message = '모든 앨범에서 사라지고, 남긴 메모와 장소도 지워져요. 기기 사진첩의 사진은 그대로예요.';
    // 공유 앨범에 담은 사진은 구성원과 함께 보는 사진이라 기본으로 앨범에 남긴다. 함께 뺄지 묻는다.
    const shared = await sharedAlbumCount(db, moment.id).catch(() => 0);
    if (shared === 0) {
      showAlert('기록에서 뺄까요?', message, [
        { text: '취소', style: 'cancel' },
        { text: '빼기', style: 'destructive', onPress: remove },
      ]);
      return;
    }
    showAlert(
      '기록에서 뺄까요?',
      `${localizeText(language, message)}\n\n${{
        ko: `이 사진은 공유 앨범 ${shared}개에 담겨 있어요. 공유 앨범에서도 뺄까요? 남기면 구성원은 계속 볼 수 있어요.`,
        en: `This photo is in ${shared} shared ${shared === 1 ? 'album' : 'albums'}. Remove it from ${shared === 1 ? 'that album' : 'those albums'} too? If you keep it there, members can still see it.`,
        ja: `この写真は${shared}個の共有アルバムに入っています。共有アルバムからも外しますか？残すと、メンバーは引き続き見られます。`,
      }[language]}`,
      [
        { text: '공유 앨범에는 남기기', onPress: remove },
        {
          text: '공유 앨범에서도 빼기',
          style: 'destructive',
          onPress: () =>
            removeFromSharedAlbums(db, [moment.id]).then(remove, () =>
              showAlert('공유 앨범에서 빼지 못했어요', '인터넷 연결을 확인해 주세요. 기록은 그대로예요.'),
            ),
        },
        { text: '취소', style: 'cancel' },
      ],
    );
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: formatFullDate(moment.taken_at, offset) }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <Pressable onPress={() => setViewing(true)} accessibilityLabel={localizeText(language, '사진 크게 보기')}>
          <MomentPhoto
            moment={moment}
            style={{ width, height: Math.min(width / aspectRatio, width * 1.25) }}
            explainMissing
          />
        </Pressable>

        <View style={styles.fields}>
          <Pressable
            onPress={() => setEditingDate(true)}
            style={[styles.row, { borderColor: theme.border }]}>
            <Ionicons name="calendar-outline" size={20} color={theme.textSecondary} />
            <ThemedText style={styles.flex}>
              {formatFullDate(moment.taken_at, offset)} {formatTime(moment.taken_at, offset)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              바꾸기
            </ThemedText>
          </Pressable>

          <View style={[styles.row, { borderColor: theme.border }]}>
            <Ionicons name="location-outline" size={20} color={theme.textSecondary} />
            <TextInput
              value={place}
              onChangeText={(text) => {
                setPlace(text);
                queue({ place_name: text.trim() || null });
              }}
              placeholder={localizeText(language, '사진을 찍은 곳')}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text }]}
              returnKeyType="done"
              maxLength={100}
            />
            {moment.lat !== null && place === '' && (
              <Pressable onPress={fillFromPhoto} disabled={locating} hitSlop={8}>
                {locating ? (
                  <ActivityIndicator />
                ) : (
                  <ThemedText type="small" style={{ color: theme.accent }}>
                    사진 위치로 채우기
                  </ThemedText>
                )}
              </Pressable>
            )}
          </View>

          <AlbumChooserRow momentId={moment.id} />
          <CloudQualityRow moment={moment} />

          <TextInput
            value={memo}
            onChangeText={(text) => {
              setMemo(text);
              queue({ memo: text });
            }}
            placeholder={localizeText(language, '이 순간을 남기고 싶은 이유, 그때의 생각이나 기억을 적어 보세요.')}
            placeholderTextColor={theme.textSecondary}
            style={[styles.memo, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            multiline
            textAlignVertical="top"
            maxLength={5000}
          />

          <ThemedText type="small" themeColor="textSecondary">
            {moment.original_uploaded
              ? '원본이 안전 보관함에 있어요. 기기 사진첩에서 지워도 남아요.'
              : '사진은 기기 사진첩의 원본을 그대로 보여줘요. 기기 사진첩에서 지우면 여기서도 보이지 않아요.'}
          </ThemedText>

          <Button label="기록에서 빼기" variant="danger" onPress={confirmRemove} />
        </View>
      </ScrollView>

      <DateSheet
        visible={editingDate}
        value={new Date(moment.taken_at)}
        mode="datetime"
        maximumDate={new Date()}
        timeZoneOffsetInMinutes={offset ?? undefined}
        onConfirm={(date) => {
          setEditingDate(false);
          updateMoment(db, moment.id, { taken_at: date.toISOString() });
        }}
        onCancel={() => setEditingDate(false)}
      />

      <PhotoViewer
        visible={viewing}
        moment={moment}
        onClose={() => setViewing(false)}
      />
    </ThemedView>
  );
}

/**
 * 이 사진만 원본 그대로 / 효율 보관으로 남기기. 안전 앨범에 담긴 사진이고 사진을 올릴 수 있을 때만 보인다.
 * 원본은 기기 사진첩에 있어야 올릴 수 있으므로, 원본을 지운 뒤에는 효율 보관에서 되돌릴 수 없다고 먼저 알린다.
 */
function CloudQualityRow({ moment }: { moment: Moment }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { language } = useTranslation();
  const canUpload = useCloudState().account?.subscription.can_upload ?? false;
  const { data: info } = useDbQuery(() => momentQualityInfo(db, moment.id), [db, moment.id]);
  if (!canUpload || !info || info.albums === 0) return null;

  const video = moment.media_type === 'video';
  const onDevice = !!moment.source_asset_id && !moment.source_missing;
  const current = moment.cloud_quality ?? info.albumDefault;
  const save = (next: PhotoQuality | null) => updateMoment(db, moment.id, { cloud_quality: next });

  const choose = (next: PhotoQuality | null) => {
    // 같은 것을 다시 고르면 기록을 고치지 않는다 (다른 기기와 동기화할 변경이 생기지 않게).
    if (next === moment.cloud_quality) return;
    const effective = next ?? info.albumDefault;
    if (effective === 'original' && !moment.original_uploaded && !onDevice) {
      showAlert('원본을 보관할 수 없어요', '기기 사진첩에 원본이 없어요. 원본은 기기 사진첩에 있을 때만 올릴 수 있어요.');
      return;
    }
    // 원본 보관 공유 앨범이 쓰는 원본은 지우지 않으므로 묻지 않는다.
    if (effective === 'display' && moment.original_uploaded && !info.sharedOriginal) {
      showAlert(
        '안전 보관한 원본을 지울까요?',
        [
          video ? '720p로 줄인 영상과 대표 장면만 남아요. 720p 영상을 올린 뒤에 원본을 지워요.' : '긴 변 2048px 보기용 사진만 남아요.',
          onDevice
            ? '기기 사진첩에 원본이 있는 동안에는 다시 원본으로 바꿀 수 있어요.'
            : video
              ? '기기 사진첩에 원본이 없어 720p 영상을 만들 수 없으니, 원본은 그대로 남겨 둬요.'
              : '기기 사진첩에도 원본이 없어서 지우면 되돌릴 수 없어요.',
        ].map((part) => localizeText(language, part)).join(' '),
        [
          { text: '취소', style: 'cancel' },
          { text: '효율 보관으로', style: 'destructive', onPress: () => save(next) },
        ],
      );
      return;
    }
    save(next);
  };

  // 앨범 화질과 같은 쪽을 고르면 앨범 화질을 따르게 한다 (나중에 앨범 화질을 바꾸면 이 사진도 따라간다).
  const option = (quality: PhotoQuality) => ({
    text: `${localizeText(language, PHOTO_QUALITY[quality].label)}${quality === info.albumDefault ? ` · ${localizeText(language, '앨범 기본')}` : ''}${quality === current ? ` ${localizeText(language, '(지금)')}` : ''}`,
    onPress: () => choose(quality === info.albumDefault ? null : quality),
  });
  const open = () =>
    showActionSheet(
      '이 사진의 보관 화질',
      qualityGuide(language, video) +
        (info.sharedOriginal ? `\n\n${localizeText(language, '원본 보관 공유 앨범에 담겨 있어서 원본은 늘 함께 남아요.')}` : ''),
      [option('original'), option('display'), { text: '취소', style: 'cancel' }],
    );

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={{
        ko: `보관 화질: ${PHOTO_QUALITY[current].label}. 눌러서 바꾸기`,
        en: `Storage quality: ${localizeText(language, PHOTO_QUALITY[current].label)}. Tap to change`,
        ja: `保存画質：${localizeText(language, PHOTO_QUALITY[current].label)}。タップで変更`,
      }[language]}
      style={[styles.row, { borderColor: theme.border }]}>
      <Ionicons name={PHOTO_QUALITY[current].icon} size={20} color={theme.textSecondary} />
      <ThemedText style={styles.flex}>
        {PHOTO_QUALITY[current].label}
        {current === info.albumDefault && (
          <ThemedText type="small" themeColor="textSecondary">
            {'  '}앨범 기본
          </ThemedText>
        )}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        바꾸기
      </ThemedText>
    </Pressable>
  );
}

/** 사진별 화질 시트의 설명. 화질 이름이 문장 앞에 오므로 언어마다 문장을 쓴다. */
function qualityGuide(language: AppLanguage, video: boolean) {
  const original = localizeText(language, PHOTO_QUALITY.original.label);
  const display = localizeText(language, PHOTO_QUALITY.display.label);
  if (language === 'en') {
    return `${original}: Keeps the original and a viewing copy.\n${display}: Keeps only a viewing copy (${video ? '720p video' : '2048px on the long edge'}) to save space.`;
  }
  if (language === 'ja') {
    return `${original}：オリジナルと表示用を一緒に保管します。\n${display}：表示用（${video ? '720pの動画' : '長辺2048px'}）だけを保管して容量を節約します。`;
  }
  return `${original}: 원본과 보기용을 함께 보관해요.\n${display}: 보기용(${video ? '720p 영상' : '긴 변 2048px'})만 보관해 용량을 아껴요.`;
}

function PhotoViewer({
  visible,
  moment,
  onClose,
}: {
  visible: boolean;
  moment: Moment;
  onClose: () => void;
}) {
  // Modal 안에서는 SafeAreaView가 상단 여백을 받지 못해 닫기 버튼이 상태 표시줄에 겹친다.
  // 바깥(화면)에서 읽은 여백으로 위치를 잡는다.
  const insets = useSafeAreaInsets();
  const { language } = useTranslation();
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait']}>
      <View style={styles.viewer}>
        {visible && (
          <MomentPhoto moment={moment} variant="original" style={styles.flex} contentFit="contain" explainMissing />
        )}
        <Pressable
          onPress={onClose}
          hitSlop={16}
          accessibilityLabel={localizeText(language, '닫기')}
          style={[styles.viewerClose, { top: insets.top + Spacing.two }]}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: Spacing.six },
  fields: { padding: Spacing.three, gap: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: Spacing.one },
  memo: {
    minHeight: 160,
    fontSize: 16,
    lineHeight: 24,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerClose: { position: 'absolute', right: Spacing.three },
});
