import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

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
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  heading: string;
  initial?: string;
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="닫기" />
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <ThemedText type="smallBold">{heading}</ThemedText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="예) 우리 가족, 2025 제주 여행"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            maxLength={ALBUM_TITLE_MAX}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
          />
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
