import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { unblock } from '@/components/report-block';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { listBlockedUsers } from '@/lib/cloud/shared';
import { formatFullDate } from '@/lib/dates';
import { getCurrentLanguage, localizeText, showAlert, useTranslation } from '@/lib/i18n';

// 공유 앨범에서 차단한 사람. 앨범을 나간 사람도 여기서 풀 수 있다 (앨범 관리의 구성원 목록에는 없으므로).
export default function BlockedUsersScreen() {
  const { language } = useTranslation();
  const { data: users, error } = useDbQuery(() => listBlockedUsers(), []);

  const confirmUnblock = (userId: string, name: string) => {
    const lang = getCurrentLanguage();
    showAlert(
      { ko: `${name}님의 차단을 풀까요?`, en: `Unblock ${name}?`, ja: `${name}さんのブロックを解除しますか？` }[lang],
      {
        ko: `${name}님이 공유 앨범에 담은 사진이 다시 보여요.`,
        en: `Photos ${name} adds to shared albums will appear again.`,
        ja: `${name}さんが共有アルバムに追加した写真が、また表示されます。`,
      }[lang],
      [
        { text: '취소', style: 'cancel' },
        { text: '차단 풀기', onPress: () => unblock(userId) },
      ],
    );
  };

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          차단한 사람이 공유 앨범에 담은 사진은 모든 공유 앨범에서 나에게 보이지 않아요. 상대방에게는 알리지 않고, 다른 구성원에게는 그대로 보여요.
        </ThemedText>
        {!users ? (
          error ? (
            <ThemedText themeColor="textSecondary">차단한 사람 목록을 불러오지 못했어요.</ThemedText>
          ) : (
            <ActivityIndicator />
          )
        ) : users.length === 0 ? (
          <ThemedText themeColor="textSecondary">차단한 사람이 없어요.</ThemedText>
        ) : (
          <SettingsSection>
            {users.map((user) => {
              const name = user.display_name ?? localizeText(language, '나간 구성원');
              return (
                <SettingsRow
                  key={user.user_id}
                  label={`${name} · ${formatFullDate(user.blocked_at)}`}
                  value="차단 풀기"
                  onPress={() => confirmUnblock(user.user_id, name)}
                  chevron={false}
                />
              );
            })}
          </SettingsSection>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
});
