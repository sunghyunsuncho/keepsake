import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ALBUM_TITLE_MAX } from '@/db/albums';
import { useTheme } from '@/hooks/use-theme';

/** 앨범 이름을 짓거나 바꾸는 창 (Alert.prompt는 iOS에만 있다). */
export function AlbumNameSheet({
  visible,
  heading,
  initial = '',
  confirmLabel,
  placeholder = '예) 우리 가족, 2025 제주 여행',
  maxLength = ALBUM_TITLE_MAX,
  description,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  heading: string;
  initial?: string;
  placeholder?: string;
  maxLength?: number;
  /** 입력 칸 아래 설명 */
  description?: string;
  confirmLabel: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [title, setTitle] = useState(initial);
  useEffect(() => {
    if (visible) setTitle(initial);
  }, [visible, initial]);
  const trimmed = title.trim();
  const submit = () => trimmed && onSubmit(trimmed);
  const keyboard = useAndroidKeyboardHeight(visible);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.flex, { paddingBottom: keyboard }]}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="닫기" />
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <ThemedText type="smallBold">{heading}</ThemedText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={placeholder}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            maxLength={maxLength}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          {description && (
            <ThemedText type="small" themeColor="textSecondary">
              {description}
            </ThemedText>
          )}
          <View style={styles.buttons}>
            <View style={styles.flex}>
              <Button label="취소" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.flex}>
              <Button label={confirmLabel} disabled={!trimmed} onPress={submit} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * 안드로이드에서 Modal 안의 입력창은 키보드에 밀려 올라가지 않는다 (KeyboardAvoidingView가 창 크기 변화를 받지 못함).
 * 키보드 높이만큼 아래를 띄운다.
 */
function useAndroidKeyboardHeight(active: boolean) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android' || !active) return;
    // 보고되는 높이에 아래 내비게이션 영역이 빠지는 기기가 있어, 화면 아래에서 키보드 윗변까지를 함께 본다.
    const shown = Keyboard.addListener('keyboardDidShow', (e) =>
      setHeight(Math.max(e.endCoordinates.height, Dimensions.get('screen').height - e.endCoordinates.screenY)),
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
      setHeight(0);
    };
  }, [active]);
  return height;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    marginTop: 'auto',
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
  },
  input: { fontSize: 16, padding: Spacing.three, borderRadius: Spacing.three },
  buttons: { flexDirection: 'row', gap: Spacing.two },
});
