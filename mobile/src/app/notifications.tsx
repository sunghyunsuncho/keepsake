import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { listNotifications, markNotificationsRead, type NotificationEntry } from '@/db/notifications';
import { useTheme } from '@/hooks/use-theme';
import { formatFullDate, formatTime } from '@/lib/dates';

// 알림이 열 수 있는 화면. 모르는 주소는 열지 않는다.
const OPENABLE: Record<string, { href: Href; icon: keyof typeof Ionicons.glyphMap }> = {
  '/': { href: '/', icon: 'images-outline' },
  '/settings': { href: '/settings', icon: 'cloud-outline' },
};

/** 받은 알림 내역. 화면을 떠날 때 모두 읽은 것으로 표시한다 (읽지 않은 알림은 보는 동안 강조된다). */
export default function NotificationsScreen() {
  const theme = useTheme();
  const { data: entries } = useDbQuery(() => listNotifications(), []);
  useFocusEffect(
    useCallback(
      () => () => {
        markNotificationsRead().catch(() => {});
      },
      [],
    ),
  );

  if (!entries) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }
  if (entries.length === 0) {
    return (
      <ThemedView style={styles.centered}>
        <Ionicons name="notifications-off-outline" size={40} color={theme.textSecondary} />
        <ThemedText type="smallBold">아직 받은 알림이 없어요</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          고르기 알림과 안전 보관 소식이 여기에 모여요. 고르기 알림은 설정 탭에서 켤 수 있어요.
        </ThemedText>
      </ThemedView>
    );
  }
  return (
    <ThemedView style={styles.flex}>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <NotificationRow entry={item} />}
      />
    </ThemedView>
  );
}

function NotificationRow({ entry }: { entry: NotificationEntry }) {
  const theme = useTheme();
  const target = entry.url ? OPENABLE[entry.url] : undefined;
  const unread = entry.read_at === null;
  return (
    <Pressable
      onPress={target ? () => router.navigate(target.href) : undefined}
      disabled={!target}
      accessibilityRole={target ? 'button' : undefined}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: unread ? theme.backgroundElement : theme.background, opacity: pressed ? 0.8 : 1 },
      ]}>
      <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
        <Ionicons name={target?.icon ?? 'notifications-outline'} size={18} color={theme.accent} />
      </View>
      <View style={styles.body}>
        {!!entry.title && <ThemedText type="smallBold">{entry.title}</ThemedText>}
        {!!entry.body && (
          <ThemedText type="small" themeColor={entry.title ? 'textSecondary' : 'text'}>
            {entry.body}
          </ThemedText>
        )}
        <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
          {`${formatFullDate(entry.received_at)} ${formatTime(entry.received_at)}`}
        </ThemedText>
      </View>
      {unread && <View style={[styles.unreadDot, { backgroundColor: theme.accent }]} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  list: { padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: Spacing.half },
  time: { fontSize: 12, lineHeight: 16, marginTop: Spacing.half },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: Spacing.two },
});
