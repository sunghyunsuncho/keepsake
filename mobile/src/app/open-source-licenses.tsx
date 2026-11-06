import { FlatList, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Library = { name: string; version: string; license: string; copyright: string };

const EXPO = 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)';

// 앱에 들어가는 패키지 (package.json dependencies, 빌드 도구 제외). 버전·라이선스·저작권은 node_modules에서 옮겨 적었다.
// 패키지를 추가하거나 올리면 함께 고친다.
const LIBRARIES: Library[] = [
  { name: 'React', version: '19.1.0', license: 'MIT', copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.' },
  { name: 'React Native', version: '0.81.5', license: 'MIT', copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.' },
  { name: 'Expo', version: '54.0.38', license: 'MIT', copyright: EXPO },
  { name: 'expo-router', version: '6.0.24', license: 'MIT', copyright: EXPO },
  { name: 'expo-apple-authentication', version: '8.0.8', license: 'MIT', copyright: EXPO },
  { name: 'expo-application', version: '7.0.8', license: 'MIT', copyright: EXPO },
  { name: 'expo-constants', version: '18.0.14', license: 'MIT', copyright: EXPO },
  { name: 'expo-crypto', version: '15.0.9', license: 'MIT', copyright: EXPO },
  { name: 'expo-file-system', version: '19.0.24', license: 'MIT', copyright: EXPO },
  { name: 'expo-font', version: '14.0.12', license: 'MIT', copyright: EXPO },
  { name: 'expo-image', version: '3.0.11', license: 'MIT', copyright: EXPO },
  { name: 'expo-image-manipulator', version: '14.0.8', license: 'MIT', copyright: EXPO },
  { name: 'expo-linking', version: '8.0.12', license: 'MIT', copyright: EXPO },
  { name: 'expo-media-library', version: '18.2.1', license: 'MIT', copyright: EXPO },
  { name: 'expo-network', version: '8.0.8', license: 'MIT', copyright: EXPO },
  { name: 'expo-notifications', version: '0.32.17', license: 'MIT', copyright: EXPO },
  { name: 'expo-secure-store', version: '15.0.8', license: 'MIT', copyright: EXPO },
  { name: 'expo-splash-screen', version: '31.0.13', license: 'MIT', copyright: EXPO },
  { name: 'expo-sqlite', version: '16.0.10', license: 'MIT', copyright: EXPO },
  { name: 'expo-status-bar', version: '3.0.9', license: 'MIT', copyright: EXPO },
  { name: 'expo-system-ui', version: '6.0.9', license: 'MIT', copyright: EXPO },
  { name: '@expo/vector-icons', version: '15.1.1', license: 'MIT', copyright: 'Copyright (c) 2015 Joel Arvidsson' },
  { name: '@react-native-community/datetimepicker', version: '8.4.4', license: 'MIT', copyright: 'Copyright (c) 2019 React Native Community' },
  { name: '@react-native-google-signin/google-signin', version: '16.1.5', license: 'MIT', copyright: 'Copyright (c) 2015 Apptailor' },
  { name: '@react-navigation/native', version: '7.5.1', license: 'MIT', copyright: 'Copyright (c) 2017 React Navigation Contributors' },
  { name: '@sentry/react-native', version: '7.2.0', license: 'MIT', copyright: 'Copyright (c) 2017-2024 Sentry' },
  { name: '@shopify/flash-list', version: '2.0.2', license: 'MIT', copyright: 'Copyright 2022-present, Shopify Inc.' },
  { name: 'openapi-fetch', version: '0.17.0', license: 'MIT', copyright: 'Copyright (c) 2023 Drew Powers' },
  { name: 'react-native-gesture-handler', version: '2.28.0', license: 'MIT', copyright: 'Copyright (c) 2016 Software Mansion <swmansion.com>' },
  { name: 'react-native-purchases', version: '10.16.0', license: 'MIT', copyright: 'Copyright (c) 2023 RevenueCat' },
  { name: 'react-native-reanimated', version: '4.1.7', license: 'MIT', copyright: 'Copyright (c) 2016 Software Mansion <swmansion.com>' },
  { name: 'react-native-safe-area-context', version: '5.6.2', license: 'MIT', copyright: 'Copyright (c) 2019 Th3rd Wave' },
  { name: 'react-native-screens', version: '4.16.0', license: 'MIT', copyright: 'Copyright (c) 2018 Software Mansion <swmansion.com>' },
  { name: 'react-native-worklets', version: '0.5.1', license: 'MIT', copyright: 'Copyright (c) 2024 Software Mansion <swmansion.com>' },
];

export default function OpenSourceLicensesScreen() {
  const theme = useTheme();
  return (
    <ThemedView style={styles.flex}>
      <FlatList
        data={LIBRARIES}
        keyExtractor={(library) => library.name}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
            Keepsake는 아래 오픈소스 소프트웨어를 사용해요. 각 소프트웨어는 표시된 라이선스를 따릅니다.
          </ThemedText>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.cardHeader}>
              <ThemedText type="smallBold" style={styles.flex}>
                {item.name}
              </ThemedText>
              <View style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="small" style={styles.badgeText}>
                  {item.license}
                </ThemedText>
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
              v{item.version}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
              {item.copyright}
            </ThemedText>
          </View>
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  intro: { marginBottom: Spacing.one },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.half },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.one },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  meta: { fontSize: 12, lineHeight: 17 },
});
