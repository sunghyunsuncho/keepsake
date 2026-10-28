import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { DateSheet } from '@/components/date-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { getMoment, updateMoment, type Moment, type MomentEdit } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { fillPlaceFromPhoto, removeMoment } from '@/lib/capture';
import { formatFullDate, formatTime, localDateKey } from '@/lib/dates';
import { libraryUri } from '@/lib/storage';

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
  const displayUri = libraryUri(moment.local_display_path);

  const fillFromPhoto = async () => {
    setLocating(true);
    const found = await fillPlaceFromPhoto(db, moment).catch(() => false);
    setLocating(false);
    if (!found) {
      Alert.alert('장소를 찾지 못했어요', '인터넷 연결을 확인하거나 직접 입력해 주세요.');
    }
  };

  const confirmRemove = () => {
    Alert.alert('기록에서 뺄까요?', '사진첩에서 사라지고, 남긴 메모와 장소도 지워져요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '빼기',
        style: 'destructive',
        onPress: () => {
          pending.current = {};
          // 먼저 닫는다. 지운 뒤 닫으면 잠깐 '이 기록을 찾을 수 없어요'가 보인다.
          router.back();
          removeMoment(db, moment.id, localDateKey(moment.taken_at)).catch(() => {
            Alert.alert('기록에서 빼지 못했어요', '잠시 후 다시 시도해 주세요.');
          });
        },
      },
    ]);
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: formatFullDate(moment.taken_at, offset) }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <Pressable onPress={() => setViewing(true)} accessibilityLabel="사진 크게 보기">
          <Image
            source={{ uri: displayUri }}
            style={{ width, height: Math.min(width / aspectRatio, width * 1.25) }}
            contentFit="cover"
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
              placeholder="사진을 찍은 곳"
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

          <TextInput
            value={memo}
            onChangeText={(text) => {
              setMemo(text);
              queue({ memo: text });
            }}
            placeholder="이 순간을 남기고 싶은 이유, 그때의 생각이나 기억을 적어 보세요."
            placeholderTextColor={theme.textSecondary}
            style={[styles.memo, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            multiline
            textAlignVertical="top"
            maxLength={5000}
          />

          <ThemedText type="small" themeColor="textSecondary">
            {moment.local_original_path
              ? '원본 사진이 앱 안에 보관되어 있어요.'
              : '원본 없이 표시용 사진만 보관되어 있어요.'}
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
        uri={libraryUri(moment.local_original_path) ?? displayUri}
        onClose={() => setViewing(false)}
      />
    </ThemedView>
  );
}

function PhotoViewer({
  visible,
  uri,
  onClose,
}: {
  visible: boolean;
  uri: string | undefined;
  onClose: () => void;
}) {
  // Modal 안에서는 SafeAreaView가 상단 여백을 받지 못해 닫기 버튼이 상태 표시줄에 겹친다.
  // 바깥(화면)에서 읽은 여백으로 위치를 잡는다.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait']}>
      <View style={styles.viewer}>
        <Image source={{ uri }} style={styles.flex} contentFit="contain" />
        <Pressable
          onPress={onClose}
          hitSlop={16}
          accessibilityLabel="닫기"
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
