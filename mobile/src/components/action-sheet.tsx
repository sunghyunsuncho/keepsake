import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// 선택지가 많은 메뉴. 안드로이드의 Alert는 버튼을 3개까지만 보여 줘서(나머지는 사라진다) 메뉴는 이 시트로 연다.
// Alert.alert와 같은 모양으로 부른다: showActionSheet(제목, 설명, [{ text, style, onPress }]).
// 화면 맨 위(app/_layout.tsx)에 ActionSheetHost를 하나 둔다. 전체 화면 Modal 안에서 열 때는 그 Modal 안에도 하나 둔다
// (iOS는 떠 있는 Modal 위에 다른 Modal을 형제로 띄우지 못한다). 가장 나중에 붙은 호스트가 연다.

export type SheetAction = { text: string; style?: 'default' | 'destructive' | 'cancel'; onPress?: () => void };
type Sheet = { title?: string; message?: string; actions: SheetAction[] };

const hosts: ((sheet: Sheet) => void)[] = [];

export function showActionSheet(title: string | undefined, message: string | undefined, actions: SheetAction[]) {
  hosts[hosts.length - 1]?.({ title, message, actions });
}

export function ActionSheetHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<Sheet | null>(null);

  useEffect(() => {
    hosts.push(setSheet);
    return () => {
      hosts.splice(hosts.indexOf(setSheet), 1);
    };
  }, []);

  const close = () => setSheet(null);
  // 닫은 뒤에 실행한다. 이어서 Alert나 다른 시트를 열어도 겹치지 않게 한다.
  const run = (action: SheetAction) => {
    setSheet(null);
    if (action.onPress) setTimeout(action.onPress, 250);
  };
  const actions = sheet?.actions.filter((action) => action.style !== 'cancel') ?? [];
  const cancel = sheet?.actions.find((action) => action.style === 'cancel');

  return (
    <Modal visible={sheet !== null} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="닫기" />
      <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + Spacing.three }]}>
        {(sheet?.title || sheet?.message) && (
          <View style={styles.header}>
            {!!sheet?.title && (
              <ThemedText type="smallBold" style={styles.center}>
                {sheet.title}
              </ThemedText>
            )}
            {!!sheet?.message && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                {sheet.message}
              </ThemedText>
            )}
          </View>
        )}
        {actions.map((action) => (
          <Pressable
            key={action.text}
            onPress={() => run(action)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.action, { borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText style={[styles.center, action.style === 'destructive' && { color: theme.danger }]}>
              {action.text}
            </ThemedText>
          </Pressable>
        ))}
        <Pressable
          onPress={() => (cancel ? run(cancel) : close())}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cancel, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.6 : 1 }]}>
          <ThemedText type="smallBold" style={styles.center}>
            {cancel?.text ?? '취소'}
          </ThemedText>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    marginTop: 'auto',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
  },
  header: { gap: Spacing.one, paddingBottom: Spacing.two },
  center: { textAlign: 'center' },
  action: { paddingVertical: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  cancel: { marginTop: Spacing.two, paddingVertical: Spacing.three, borderRadius: Spacing.three },
});
