import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ALBUM_TITLE_MAX } from '@/db/albums';
import { useTheme } from '@/hooks/use-theme';
import { localizeText, useTranslation } from '@/lib/i18n';

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
  const { language } = useTranslation();
  const [title, setTitle] = useState(initial);
  useEffect(() => {
    if (visible) setTitle(initial);
  }, [visible, initial]);
  const trimmed = title.trim();
  const submit = () => trimmed && onSubmit(trimmed);
  const keyboard = useAndroidKeyboardHeight(visible);
  const bottomInset = useSheetBottomInset(visible);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.flex, { paddingBottom: keyboard }]}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel={localizeText(language, '닫기')} />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Spacing.five + bottomInset }]}>
          <ThemedText type="smallBold">{heading}</ThemedText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={localizeText(language, placeholder)}
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
 * 입력창이 있는 아래 시트의 아래 여백. 키보드가 닫혀 있으면 시스템 내비게이션 바·홈 인디케이터만큼 띄우고
 * (Android edge-to-edge에서 버튼이 가려지지 않게), 키보드가 열려 있으면 키보드가 그 자리를 덮으므로 더하지 않는다.
 * iOS의 KeyboardAvoidingView도 홈 인디케이터를 포함한 키보드 높이만큼 띄우므로, 더하면 키보드 위에 빈 틈이 생긴다.
 */
export function useSheetBottomInset(active: boolean) {
  const insets = useSafeAreaInsets();
  const [keyboardShown, setKeyboardShown] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    if (!active) return;
    setKeyboardShown(Keyboard.isVisible());
    const ios = Platform.OS === 'ios';
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardShown(true));
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardShown(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [active]);
  return keyboardShown ? 0 : insets.bottom;
}

/**
 * 안드로이드에서 Modal 안의 입력창은 키보드에 밀려 올라가지 않는다 (KeyboardAvoidingView가 창 크기 변화를 받지 못함).
 * 키보드 높이만큼 아래를 띄운다.
 */
export function useAndroidKeyboardHeight(active: boolean) {
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
