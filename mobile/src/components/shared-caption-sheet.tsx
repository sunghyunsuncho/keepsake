import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { useSheetBottomInset } from '@/components/album-name-sheet';
import { useAndroidKeyboardHeight } from '@/hooks/use-keyboard-inset';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CAPTION_MAX, myMemo, setSharedItemCaption, type SharedItem } from '@/lib/cloud/shared';
import { localizeText, showAlert, useTranslation } from '@/lib/i18n';

/**
 * 내가 담은 사진에 구성원이 볼 글을 쓴다. 개인 메모는 구성원에게 보내지 않으므로, 메모가 있으면
 * [내 메모 가져오기]로 입력 칸에 옮겨 고친 뒤 올릴 수 있게 한다 (저장할 때만 공유된다).
 * 열려 있을 때만 그린다.
 */
export function SharedCaptionSheet({ albumId, item, onClose }: { albumId: string; item: SharedItem; onClose: () => void }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { language } = useTranslation();
  const keyboard = useAndroidKeyboardHeight(true);
  const bottomInset = useSheetBottomInset(true);
  const [text, setText] = useState(item.caption ?? '');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    myMemo(db, item.moment_id).then(setMemo).catch(() => {});
  }, [db, item.moment_id]);
  const trimmed = text.trim();
  const unchanged = trimmed === (item.caption ?? '');

  const save = async () => {
    setSaving(true);
    try {
      await setSharedItemCaption(albumId, item.id, trimmed || null);
      onClose();
    } catch {
      showAlert('글을 올리지 못했어요', '잠시 후 다시 시도해 주세요.');
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.flex, { paddingBottom: keyboard }]}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={localizeText(language, '닫기')} />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Spacing.five + bottomInset }]}>
          <ThemedText type="smallBold">구성원에게 보일 글</ThemedText>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={localizeText(language, '이 사진에 얽힌 이야기를 들려주세요')}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            maxLength={CAPTION_MAX}
            multiline
            autoFocus
          />
          {!!memo && memo !== trimmed && (
            <Pressable
              onPress={() => setText(memo.slice(0, CAPTION_MAX))}
              accessibilityRole="button"
              style={({ pressed }) => [styles.memo, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText type="small" style={{ color: theme.accent, fontWeight: 700 }}>
                내 메모 가져오기
              </ThemedText>
              {/* 사용자가 쓴 메모라 번역하지 않는다. */}
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} localize={false}>
                {memo}
              </ThemedText>
            </Pressable>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            개인 메모는 나만 봐요. 여기에 쓴 글만 구성원 모두에게 보여요.
          </ThemedText>
          <View style={styles.buttons}>
            <View style={styles.flex}>
              <Button label="취소" variant="secondary" onPress={onClose} />
            </View>
            <View style={styles.flex}>
              <Button label={item.caption && !trimmed ? '글 지우기' : '올리기'} loading={saving} disabled={unchanged} onPress={save} />
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
  input: { fontSize: 16, minHeight: 96, maxHeight: 180, padding: Spacing.three, borderRadius: Spacing.three, textAlignVertical: 'top' },
  memo: { gap: 2, padding: Spacing.three, borderRadius: Spacing.three, borderWidth: StyleSheet.hairlineWidth },
  buttons: { flexDirection: 'row', gap: Spacing.two },
});
