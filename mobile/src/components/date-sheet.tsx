import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  visible: boolean;
  value: Date;
  /** 'datetime'이면 날짜와 시각을 함께 고른다. 'time'은 시각만 고른다. */
  mode: 'date' | 'datetime' | 'time';
  maximumDate?: Date;
  /** 촬영지 시간대(UTC 기준 분). 주면 그 시간대의 날짜·시각으로 보여주고 고르게 한다. */
  timeZoneOffsetInMinutes?: number;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
};

/**
 * 날짜 선택. iOS는 아래에서 올라오는 시트에 달력을, Android는 시스템 대화상자를 띄운다
 * (Android는 날짜와 시각 대화상자가 따로라 차례로 연다).
 */
export function DateSheet(props: Props) {
  return Platform.OS === 'android' ? <AndroidDateDialog {...props} /> : <IosDateSheet {...props} />;
}

function AndroidDateDialog({
  visible,
  value,
  mode,
  maximumDate,
  timeZoneOffsetInMinutes,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!visible) return;
    // Android 구현은 timeZoneOffsetInMinutes를 받지만(DateTimePickerAndroid.android.js) 타입 정의에 빠져 있다.
    const timeZone = { timeZoneOffsetInMinutes } as object;
    if (mode === 'time') {
      DateTimePickerAndroid.open({
        value,
        mode: 'time',
        is24Hour: true,
        ...timeZone,
        onChange: (event, time) => (event.type === 'set' && time ? onConfirm(time) : onCancel()),
      });
      return;
    }
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      maximumDate,
      ...timeZone,
      onChange: (event, date) => {
        if (event.type !== 'set' || !date) return onCancel();
        if (mode === 'date') return onConfirm(date);
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          is24Hour: true,
          ...timeZone,
          onChange: (timeEvent, time) => {
            onConfirm(timeEvent.type === 'set' && time ? time : date);
          },
        });
      },
    });
    // 열릴 때 한 번만 띄운다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  return null;
}

function IosDateSheet({
  visible,
  value,
  mode,
  maximumDate,
  timeZoneOffsetInMinutes,
  onConfirm,
  onCancel,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(value);

  // 열릴 때만 값을 맞춘다. value는 부모가 렌더할 때마다 새 Date라서, 의존하면 고르는 중에 되돌아간다.
  useEffect(() => {
    if (visible) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="닫기" />
      <View
        style={[
          styles.sheet,
          { backgroundColor: theme.background, paddingBottom: insets.bottom + Spacing.three },
        ]}>
        <View style={styles.toolbar}>
          <Pressable onPress={onCancel} hitSlop={12}>
            <ThemedText themeColor="textSecondary">취소</ThemedText>
          </Pressable>
          <Pressable onPress={() => onConfirm(draft)} hitSlop={12}>
            <ThemedText style={{ color: theme.accent, fontWeight: 700 }}>완료</ThemedText>
          </Pressable>
        </View>
        <DateTimePicker
          value={draft}
          mode={mode}
          // 시각만 고를 때 inline은 시계 버튼만 보여서 돌림판을 쓴다.
          display={mode === 'time' ? 'spinner' : 'inline'}
          locale="ko-KR"
          maximumDate={maximumDate}
          timeZoneOffsetInMinutes={timeZoneOffsetInMinutes}
          accentColor={theme.accent}
          onChange={(_, date) => date && setDraft(date)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
  },
});
