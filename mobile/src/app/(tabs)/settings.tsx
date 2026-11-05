import * as Application from 'expo-application';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ReminderSection } from '@/components/reminder-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { libraryStats } from '@/db/moments';
import { getSettings, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { formatFullDate, formatTime } from '@/lib/dates';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const { data: stats } = useDbQuery(() => libraryStats(db), [db]);

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="고르기">
          <ThemedText type="small" themeColor="textSecondary">
            {settings?.review_cursor
              ? `${formatFullDate(settings.review_cursor)} ${formatTime(settings.review_cursor)}에 찍은 사진까지 살펴봤어요. 고르기 화면은 그 뒤의 사진부터 보여줘요.`
              : '아직 어디서부터 고를지 정하지 않았어요.'}
          </ThemedText>
          <Button
            label="시작 시점 초기화"
            variant="secondary"
            disabled={!settings?.review_cursor}
            onPress={() =>
              Alert.alert(
                '시작 시점을 초기화할까요?',
                '이미 남긴 사진은 그대로예요. 다음에 고르기 탭을 열면 어디서부터 볼지 다시 선택할 수 있어요.',
                [
                  { text: '취소', style: 'cancel' },
                  { text: '초기화', style: 'destructive', onPress: () => setSetting(db, 'review_cursor', null) },
                ],
              )
            }
          />
        </Section>

        <Section title="알림">
          <ReminderSection settings={settings} />
        </Section>

        <Section title="기록 보관">
          <View style={[styles.statBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small">{stats ? `${stats.count}장 · ${stats.days}일의 기록` : ' '}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Keepsake는 사진을 따로 복사해 두지 않고 기기 사진첩의 원본을 그대로 보여줘요. 그래서 휴대폰 용량을
            거의 쓰지 않아요.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            기기 사진첩에서 사진을 지우면 기록의 사진도 보이지 않아요. 메모와 장소, 날짜는 남아요. 원본을 따로
            지켜 두고 싶다면 안전 보관을 이용해 주세요.
          </ThemedText>
        </Section>

        <View style={[styles.appInfo, { backgroundColor: theme.backgroundElement }]}>
          <View style={[styles.appIcon, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="albums-outline" size={22} color={theme.accent} />
          </View>
          <View style={styles.flex}>
            <ThemedText type="smallBold">Keepsake</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              앱 정보 · 버전 {Application.nativeApplicationVersion ?? '—'} ({Application.nativeBuildVersion ?? '—'})
            </ThemedText>
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.five, paddingBottom: Spacing.six },
  section: { gap: Spacing.three },
  statBox: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  appInfo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.three },
  appIcon: { width: 42, height: 42, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
});
