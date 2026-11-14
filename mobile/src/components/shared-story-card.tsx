import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { PRINT, PRINT_SHADOW } from '@/components/gallery';
import { SharedItemPhoto } from '@/components/shared-item-photo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { SharedItem } from '@/lib/cloud/shared';
import { formatTime, localDateKey } from '@/lib/dates';
import { addedBy, commentCount, localizeText, memberName, useTranslation } from '@/lib/i18n';

/**
 * 공유 앨범의 이야기 단계: 내 앨범의 StoryCard처럼 폴라로이드로 한 장씩.
 * 누가 담았는지는 사진 위 이름표로 두고, 아래 여백에는 담은 사람이 구성원에게 쓴 글(개인 메모와 따로)과 최근 댓글 한 줄을 적는다.
 * 사진을 누르면 크게 보고, 아래를 누르면 댓글을 연다. 내 사진에 글이 없으면 쓰라고 권한다.
 */
export function SharedStoryCard({
  albumId,
  item,
  takenAt,
  onOpen,
  onOpenComments,
  onWriteCaption,
  selecting = false,
  selected = false,
  onSelect,
}: {
  albumId: string;
  item: SharedItem;
  /** 촬영 시각 (없으면 담은 시각) */
  takenAt: string;
  onOpen: () => void;
  onOpenComments: () => void;
  onWriteCaption: () => void;
  selecting?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const theme = useTheme();
  const { language } = useTranslation();
  const day = localDateKey(takenAt, item.taken_tz_offset);
  const tilt = item.id.charCodeAt(item.id.length - 1) % 2 ? '0.5deg' : '-0.5deg';
  const author = item.is_mine ? localizeText(language, '나') : memberName(language, item.author_name);
  const latest = item.latest_comment;
  return (
    <View style={[styles.print, { transform: [{ rotate: tilt }] }, selecting && selected && { borderWidth: 3, borderColor: theme.accent }]}>
      <Pressable
        onPress={selecting ? onSelect : onOpen}
        accessibilityLabel={localizeText(language, selecting ? '앨범에서 뺄 사진 선택' : '사진 크게 보기')}
        accessibilityState={selecting ? { checked: selected } : undefined}>
        <SharedItemPhoto albumId={albumId} item={item} style={[styles.image, { backgroundColor: theme.backgroundElement }]} />
        <View
          style={styles.authorTag}
          pointerEvents="none"
          accessible
          accessibilityLabel={item.is_mine ? localizeText(language, '내가 담았어요') : addedBy(language, author)}>
          <Ionicons name="person" size={11} color="#fff" />
          <ThemedText style={styles.authorText} numberOfLines={1} localize={false}>
            {author}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable
        onPress={selecting ? onSelect : onOpenComments}
        accessibilityLabel={localizeText(language, '댓글')}
        style={({ pressed }) => [styles.body, { opacity: pressed ? 0.7 : 1 }]}>
        {item.caption ? (
          // 담은 사람이 쓴 글이라 번역하지 않는다.
          <ThemedText numberOfLines={3} style={{ color: PRINT.ink }} localize={false}>
            {item.caption}
          </ThemedText>
        ) : (
          item.is_mine &&
          !selecting && (
            <Pressable onPress={onWriteCaption} accessibilityRole="button" hitSlop={6}>
              <ThemedText style={{ color: PRINT.inkSecondary }}>눌러서 구성원에게 이야기를 들려주세요</ThemedText>
            </Pressable>
          )
        )}
        {latest && (
          <View style={styles.latest}>
            <Ionicons name="chatbubble-outline" size={13} color={PRINT.inkSecondary} style={styles.latestIcon} />
            <ThemedText type="small" numberOfLines={1} style={[styles.flex, { color: PRINT.inkSecondary }]} localize={false}>
              <ThemedText type="smallBold" style={{ color: PRINT.ink }} localize={false}>
                {latest.is_mine ? localizeText(language, '나') : memberName(language, latest.author_name)}
              </ThemedText>
              {`  ${latest.body}`}
            </ThemedText>
          </View>
        )}
        <View style={styles.foot}>
          <ThemedText type="small" style={[styles.flex, { color: PRINT.inkSecondary }]} numberOfLines={1}>
            {item.taken_at ? formatTime(item.taken_at, item.taken_tz_offset) : ''}
          </ThemedText>
          {item.comment_count > 0 && (
            <View style={styles.comments} accessible accessibilityLabel={commentCount(language, item.comment_count)}>
              <Ionicons name="chatbubble-outline" size={13} color={PRINT.inkSecondary} />
              <ThemedText type="small" style={{ color: PRINT.inkSecondary }} localize={false}>
                {item.comment_count}
              </ThemedText>
            </View>
          )}
          <ThemedText type="small" style={{ color: PRINT.inkSecondary }}>
            {day.slice(5).replace('-', '.')}
          </ThemedText>
        </View>
      </Pressable>
      {selecting && (
        <View style={[styles.check, { backgroundColor: selected ? theme.accent : 'rgba(0,0,0,0.2)' }]} pointerEvents="none">
          {selected && <Ionicons name="checkmark" size={16} color={theme.onAccent} />}
        </View>
      )}
    </View>
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
  comments: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'center' },
  latest: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  latestIcon: { marginTop: 4 },
  // 썸네일 이름표와 같은 모양. 동영상 표시는 왼쪽 아래, 고르기 표시는 오른쪽 위에 있어 왼쪽 위에 둔다.
  authorTag: {
    position: 'absolute',
    left: Spacing.two,
    top: Spacing.two,
    maxWidth: '70%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  authorText: { color: '#fff', fontSize: 13, lineHeight: 17, fontWeight: 600 },
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
