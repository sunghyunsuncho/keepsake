import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, type ImageStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { AlbumSummary } from '@/db/albums';
import { useTheme } from '@/hooks/use-theme';
import { localizeText, useTranslation } from '@/lib/i18n';

const EMOJIS = ['🌿', '☕️', '✈️', '🎞️', '🎂', '🐚', '🏡', '✨'];

/** momentId: 고른 사진의 id (공유 앨범에서는 항목 id) */
export type AlbumCoverChoice = { mode: AlbumSummary['coverMode']; momentId?: string | null; emoji?: string | null };

/**
 * 최신 사진, 앨범 안의 사진, 이모지 디자인 중 표지 방식을 고르는 시트.
 * 사진은 renderPhoto로 그린다 (내 기록과 공유 앨범 항목이 그리는 방법이 다르다).
 */
export function AlbumCoverSheet<T extends { id: string }>({
  visible,
  items,
  renderPhoto,
  onChoose,
  onCancel,
}: {
  visible: boolean;
  items: T[];
  renderPhoto: (item: T, style: ImageStyle) => ReactNode;
  onChoose: (choice: AlbumCoverChoice) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { language } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel={localizeText(language, '닫기')} />
      <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Spacing.five + insets.bottom }]}>
        <ThemedText type="smallBold">앨범 표지</ThemedText>
        <Pressable onPress={() => onChoose({ mode: 'latest' })} style={[styles.option, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">최신 사진으로 자동 설정</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">앨범에 가장 최근에 담긴 사진을 표지로 써요.</ThemedText>
          </View>
        </Pressable>
        <ThemedText type="smallBold">기본 디자인</ThemedText>
        <View style={styles.emojis}>
          {EMOJIS.map((emoji) => (
            <Pressable key={emoji} onPress={() => onChoose({ mode: 'design', emoji })} style={[styles.emoji, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.emojiText}>{emoji}</ThemedText>
            </Pressable>
          ))}
        </View>
        {items.length > 0 && (
          <>
            <ThemedText type="smallBold">앨범 사진에서 고르기</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
              {items.map((item) => (
                <Pressable key={item.id} onPress={() => onChoose({ mode: 'photo', momentId: item.id })}>
                  {renderPhoto(item, styles.photo)}
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { marginTop: 'auto', padding: Spacing.four, paddingBottom: Spacing.five, gap: Spacing.three, borderTopLeftRadius: Spacing.four, borderTopRightRadius: Spacing.four },
  option: { flexDirection: 'row', padding: Spacing.three, borderRadius: Spacing.three },
  emojis: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  emoji: { width: 48, height: 48, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 24 },
  photos: { gap: Spacing.two },
  photo: { width: 68, height: 68, borderRadius: Spacing.two, overflow: 'hidden' },
});
