import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MomentPhoto } from '@/components/moment-photo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { AlbumSummary } from '@/db/albums';
import type { Moment } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';

const EMOJIS = ['🌿', '☕️', '✈️', '🎞️', '🎂', '🐚', '🏡', '✨'];

export type AlbumCoverChoice = { mode: AlbumSummary['coverMode']; momentId?: string | null; emoji?: string | null };

/** 최신 사진, 앨범 안의 사진, 이모지 디자인 중 표지 방식을 고르는 시트. */
export function AlbumCoverSheet({
  visible,
  moments,
  onChoose,
  onCancel,
}: {
  visible: boolean;
  moments: Moment[];
  onChoose: (choice: AlbumCoverChoice) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="닫기" />
      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
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
        {moments.length > 0 && (
          <>
            <ThemedText type="smallBold">앨범 사진에서 고르기</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
              {moments.map((moment) => (
                <Pressable key={moment.id} onPress={() => onChoose({ mode: 'photo', momentId: moment.id })}>
                  <MomentPhoto moment={moment} style={styles.photo} transition={100} />
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
