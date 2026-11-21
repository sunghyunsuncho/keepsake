import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheetHost, showActionSheet } from '@/components/action-sheet';
import { useAndroidKeyboardHeight } from '@/hooks/use-keyboard-inset';
import { chooseReportReason, confirmBlock, type ReportTarget } from '@/components/report-block';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { registerPushToken } from '@/lib/cloud/push';
import { useTheme } from '@/hooks/use-theme';
import {
  addComment,
  COMMENT_MAX,
  deleteComment,
  listComments,
  type SharedComment,
  type SharedItem,
} from '@/lib/cloud/shared';
import { localizeText, memberName, showAlert, timeAgo, useTranslation } from '@/lib/i18n';

let pushAsked = false;

/**
 * 공유 앨범 사진의 댓글. 사진을 크게 보는 Modal 안에서 연다 (그래서 메뉴용 ActionSheetHost를 따로 둔다).
 * 구성원이면 누구나 남기고, 내 댓글은 내가, 모든 댓글은 관리자가 지운다. 다른 사람의 댓글은 신고하거나 쓴 사람을 차단한다.
 * 열려 있을 때만 그린다: 닫히면 메뉴 호스트도 빠져야 아래 화면의 호스트가 다시 메뉴를 연다.
 */
export function SharedCommentsSheet({
  albumId,
  item,
  onClose,
  onBlocked,
}: {
  albumId: string;
  item: SharedItem;
  onClose: () => void;
  /** 쓴 사람을 차단했을 때. 그 사람의 사진이 목록에서 빠질 수 있어 크게 보기도 닫는다. */
  onBlocked: () => void;
}) {
  const theme = useTheme();
  const { language } = useTranslation();
  const insets = useSafeAreaInsets();
  const keyboard = useAndroidKeyboardHeight(true);
  const { data: comments, error } = useDbQuery(() => listComments(albumId, item.id), [albumId, item.id]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList<SharedComment>>(null);
  const trimmed = text.trim();

  const send = async () => {
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await addComment(albumId, item.id, trimmed);
      setText('');
      // 답글이 달리면 알 수 있게, 내 사진에 댓글이 달리면 알린다는 권한을 이때 묻는다 (이미 정했으면 묻지 않는다).
      // 댓글마다 토큰을 다시 보내지 않게 앱을 실행한 동안 한 번만 한다.
      if (!pushAsked) {
        pushAsked = true;
        registerPushToken({ ask: true });
      }
      // 새 댓글이 목록에 들어온 뒤 맨 아래로 내린다.
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 300);
    } catch {
      showAlert('댓글을 남기지 못했어요', '잠시 후 다시 시도해 주세요.');
    } finally {
      setSending(false);
    }
  };

  const showMenu = (comment: SharedComment) => {
    // 나간 구성원은 서버가 '나간 구성원'으로 보낸다. 문구에 넣기 전에 번역한다.
    const name = memberName(language, comment.author_name);
    const person: ReportTarget = { albumId, userId: comment.author_id, name, commentId: comment.id };
    const remove = () =>
      showAlert('댓글을 지울까요?', '구성원 모두에게서 사라져요.', [
        { text: '취소', style: 'cancel' },
        {
          text: '지우기',
          style: 'destructive',
          onPress: () =>
            deleteComment(albumId, item.id, comment.id).catch(() =>
              showAlert('댓글을 지우지 못했어요', '잠시 후 다시 시도해 주세요.'),
            ),
        },
      ]);
    showActionSheet(undefined, undefined, [
      ...(comment.can_delete
        ? [{ text: '댓글 지우기', icon: 'trash-outline' as const, style: 'destructive' as const, onPress: remove }]
        : []),
      ...(!comment.is_mine
        ? [
            { text: '이 댓글 신고하기', icon: 'flag-outline' as const, onPress: () => chooseReportReason(person, onBlocked) },
            {
              text: { ko: `${name}님 차단하기`, en: `Block ${name}`, ja: `${name}さんをブロック` }[language],
              icon: 'remove-circle-outline' as const,
              style: 'destructive' as const,
              onPress: () => confirmBlock(person, onBlocked),
            },
          ]
        : []),
      { text: '취소', style: 'cancel' },
    ]);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.flex, { paddingBottom: keyboard }]}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={localizeText(language, '닫기')} />
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={[styles.heading, { borderColor: theme.border }]}>
            <ThemedText type="smallBold" style={styles.flex}>
              댓글
            </ThemedText>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={localizeText(language, '닫기')}>
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          {!comments ? (
            <View style={styles.state}>
              {error ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                  {'댓글을 불러오지 못했어요.\n인터넷 연결을 확인해 주세요.'}
                </ThemedText>
              ) : (
                <ActivityIndicator />
              )}
            </View>
          ) : (
            <FlatList
              ref={list}
              data={comments}
              keyExtractor={(comment) => comment.id}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <ThemedText type="small" themeColor="textSecondary" style={[styles.center, styles.empty]}>
                  {'아직 댓글이 없어요.\n이 사진에 얽힌 이야기를 남겨 보세요.'}
                </ThemedText>
              }
              renderItem={({ item: comment }) => (
                <Pressable
                  onLongPress={() => showMenu(comment)}
                  style={styles.comment}
                  accessibilityHint={localizeText(language, '댓글 메뉴')}>
                  <View style={styles.flex}>
                    <View style={styles.byline}>
                      <ThemedText type="smallBold" localize={false} numberOfLines={1} style={styles.name}>
                        {comment.is_mine ? localizeText(language, '나') : memberName(language, comment.author_name)}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" localize={false}>
                        {timeAgo(language, comment.created_at)}
                      </ThemedText>
                    </View>
                    {/* 사용자가 쓴 글이라 번역하지 않는다. */}
                    <ThemedText type="small" localize={false} selectable>
                      {comment.body}
                    </ThemedText>
                  </View>
                  {(comment.can_delete || !comment.is_mine) && (
                    <Pressable
                      onPress={() => showMenu(comment)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={localizeText(language, '댓글 메뉴')}>
                      <Ionicons name="ellipsis-horizontal" size={18} color={theme.textSecondary} />
                    </Pressable>
                  )}
                </Pressable>
              )}
            />
          )}
          <View
            style={[
              styles.composer,
              { borderColor: theme.border, paddingBottom: keyboard > 0 ? Spacing.two : insets.bottom + Spacing.two },
            ]}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={localizeText(language, '댓글 남기기')}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              maxLength={COMMENT_MAX}
              multiline
            />
            <Pressable
              onPress={send}
              disabled={!trimmed || sending}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={localizeText(language, '보내기')}
              style={{ opacity: !trimmed ? 0.4 : 1 }}>
              {sending ? (
                <ActivityIndicator />
              ) : (
                <Ionicons name="arrow-up-circle" size={34} color={theme.accent} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      {/* 댓글 메뉴를 이 Modal 위에 띄운다. */}
      <ActionSheetHost />
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    marginTop: 'auto',
    maxHeight: '75%',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  state: { minHeight: 160, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  list: { flexGrow: 0 },
  listContent: { paddingVertical: Spacing.two },
  empty: { paddingVertical: Spacing.five, paddingHorizontal: Spacing.four },
  comment: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  byline: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  name: { flexShrink: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 16, maxHeight: 120, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.three },
});
