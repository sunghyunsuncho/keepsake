import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CONTACT_EMAIL } from '@/constants/app-info';
import { LEGAL_DOCS, type LegalDocKey } from '@/constants/legal';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// 이용약관·개인정보 처리방침을 앱 안에서 보여준다 (Vernissage 약관 화면과 같은 구성: 시행일 → 조항 → 문의).
export default function LegalScreen() {
  const theme = useTheme();
  const { doc } = useLocalSearchParams<{ doc: LegalDocKey }>();
  const legal = LEGAL_DOCS[doc] ?? LEGAL_DOCS.terms;

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: legal.title }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ThemedText themeColor="textSecondary" style={[styles.small, styles.effectiveDate]}>
          시행일: {legal.effectiveDate}
        </ThemedText>

        {legal.sections.map((section, i) => (
          <View key={i} style={styles.section}>
            {!!section.title && <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>}
            <ThemedText themeColor="textMid" style={styles.sectionBody}>
              {section.body}
            </ThemedText>
            {section.link && (
              <Pressable
                onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: section.link!.doc } })}
                style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}>
                <ThemedText style={[styles.small, styles.linkText]}>{section.link.label} →</ThemedText>
              </Pressable>
            )}
          </View>
        ))}

        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <ThemedText themeColor="textSecondary" style={styles.small}>
            문의: {CONTACT_EMAIL}
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

// Vernissage 약관 화면과 같은 크기: 조항 제목 16, 본문 14(줄 높이 22), 조항 사이 24.
const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, paddingBottom: Spacing.six },
  small: { fontSize: 14, lineHeight: 20 },
  effectiveDate: { marginBottom: Spacing.four },
  section: { marginBottom: Spacing.four },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600', marginBottom: Spacing.one },
  sectionBody: { fontSize: 14, lineHeight: 22 },
  linkRow: { marginTop: Spacing.one },
  linkText: { fontWeight: '600' },
  footer: { marginTop: Spacing.four, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
});
