import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { PRINT, PRINT_SHADOW } from '@/components/gallery';
import { SharedItemPhoto } from '@/components/shared-item-photo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { SharedItem } from '@/lib/cloud/shared';
import { formatTime, localDateKey } from '@/lib/dates';
import { addedBy, localizeText, useTranslation } from '@/lib/i18n';

/**
 * 공유 앨범의 이야기 단계: 내 앨범의 StoryCard처럼 폴라로이드로 한 장씩.
 * 메모는 개인 기록이라 다른 구성원에게 보내지 않으므로, 아래 여백에는 누가 언제 담았는지 적는다.
 */
export function SharedStoryCard({
  albumId,
  item,
  takenAt,
  onOpen,
  selecting = false,
  selected = false,
  onSelect,
}: {
  albumId: string;
  item: SharedItem;
  /** 촬영 시각 (없으면 담은 시각) */
  takenAt: string;
  onOpen: () => void;
  selecting?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const theme = useTheme();
  const { language } = useTranslation();
  const day = localDateKey(takenAt, item.taken_tz_offset);
  const tilt = item.id.charCodeAt(item.id.length - 1) % 2 ? '0.5deg' : '-0.5deg';
  return (
    <Pressable
      onPress={selecting ? onSelect : onOpen}
      accessibilityLabel={localizeText(language, selecting ? '앨범에서 뺄 사진 선택' : '사진 크게 보기')}
      accessibilityState={selecting ? { checked: selected } : undefined}
      style={[styles.print, { transform: [{ rotate: tilt }] }, selecting && selected && { borderWidth: 3, borderColor: theme.accent }]}>
      <SharedItemPhoto albumId={albumId} item={item} style={[styles.image, { backgroundColor: theme.backgroundElement }]} />
      <View style={styles.body}>
        <ThemedText style={{ color: PRINT.ink }} numberOfLines={1}>
          {item.is_mine ? '내가 담았어요' : addedBy(language, item.author_name)}
        </ThemedText>
        <View style={styles.foot}>
          <ThemedText type="small" style={[styles.flex, { color: PRINT.inkSecondary }]} numberOfLines={1}>
            {item.taken_at ? formatTime(item.taken_at, item.taken_tz_offset) : ''}
          </ThemedText>
          <ThemedText type="small" style={{ color: PRINT.inkSecondary }}>
            {day.slice(5).replace('-', '.')}
          </ThemedText>
        </View>
      </View>
      {selecting && (
        <View style={[styles.check, { backgroundColor: selected ? theme.accent : 'rgba(0,0,0,0.2)' }]}>
          {selected && <Ionicons name="checkmark" size={16} color={theme.onAccent} />}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  print: {
    position: 'relative',
    marginHorizontal: 22,
    marginTop: Spacing.one,
    marginBottom: 26,
    padding: 12,
    paddingBottom: 0,
    backgroundColor: PRINT.paper,
    ...PRINT_SHADOW,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  image: { width: '100%', aspectRatio: 1 },
  body: { paddingHorizontal: Spacing.one, paddingTop: 14, paddingBottom: Spacing.three, gap: 10, minHeight: 64 },
  foot: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  check: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
