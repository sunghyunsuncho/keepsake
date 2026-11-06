import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useDbQuery } from '@/db/changes';
import { countUnreadNotifications } from '@/db/notifications';
import { useTheme } from '@/hooks/use-theme';

/** 모든 탭 오른쪽 위의 알림 버튼. 읽지 않은 알림이 있으면 점을 띄운다. */
export function NotificationBell() {
  const theme = useTheme();
  const { data: unread } = useDbQuery(() => countUnreadNotifications(), []);
  const hasUnread = (unread ?? 0) > 0;
  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={hasUnread ? `알림, 읽지 않은 알림 ${unread}개` : '알림'}
      style={styles.button}>
      <Ionicons name="notifications-outline" size={23} color={theme.text} />
      {hasUnread && <View style={[styles.dot, { backgroundColor: theme.danger, borderColor: theme.background }]} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 3, right: 4, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
