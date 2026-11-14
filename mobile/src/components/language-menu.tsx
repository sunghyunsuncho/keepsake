import { CaretDownIcon, CheckIcon, GlobeSimpleIcon } from 'phosphor-react-native';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { APP_LANGUAGES } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { registerPushToken } from '@/lib/cloud/push';
import { LANGUAGE_LABELS, useTranslation } from '@/lib/i18n';

type Anchor = { top: number; right: number };

/** 웹사이트 머리글처럼 [🌐 한국어 ▾]를 누르면 바로 아래에 언어 목록이 펼쳐진다. */
export function LanguageMenu() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { language, setLanguage, t } = useTranslation();
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  // 모달은 화면 전체 기준으로 그리므로, 버튼의 창 좌표를 재서 그 바로 아래에 목록을 둔다.
  const open = () =>
    trigger.current?.measureInWindow((x, y, w, h) => setAnchor({ top: y + h + Spacing.one, right: width - x - w }));
  const close = () => setAnchor(null);

  return (
    <>
      <Pressable
        ref={trigger}
        onPress={open}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={t('chooseLanguage')}
        accessibilityState={{ expanded: anchor !== null }}
        style={({ pressed }) => [styles.trigger, { borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}>
        <GlobeSimpleIcon size={16} color={theme.text} />
        <ThemedText type="smallBold" localize={false}>
          {LANGUAGE_LABELS[language]}
        </ThemedText>
        <CaretDownIcon
          size={12}
          weight="bold"
          color={theme.textSecondary}
          style={anchor ? styles.caretOpen : undefined}
        />
      </Pressable>

      {/* statusBarTranslucent: Android에서도 모달 좌표가 measureInWindow와 같은 기준이 되도록 */}
      <Modal visible={anchor !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('close')} />
        {anchor && (
          <View
            style={[
              styles.menu,
              { top: anchor.top, right: anchor.right, backgroundColor: theme.background, borderColor: theme.border, shadowColor: theme.text },
            ]}>
            {APP_LANGUAGES.map((option) => {
              const selected = option === language;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    close();
                    // 저장 실패 시 Provider가 이전 언어로 되돌린다.
                    // 서버가 보내는 알림 문구도 새 언어로 받게 다시 알린다.
                    void setLanguage(option)
                      .then(() => registerPushToken({ ask: false }))
                      .catch(() => {});
                  }}
                  style={({ pressed }) => [styles.item, pressed && { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText localize={false} type={selected ? 'smallBold' : 'small'} themeColor={selected ? 'text' : 'textSecondary'}>
                    {LANGUAGE_LABELS[option]}
                  </ThemedText>
                  {selected && <CheckIcon size={16} weight="bold" color={theme.accent} />}
                </Pressable>
              );
            })}
          </View>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
  },
  caretOpen: { transform: [{ rotate: '180deg' }] },
  menu: {
    position: 'absolute',
    minWidth: 160,
    paddingVertical: Spacing.one,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    height: 44,
  },
});
