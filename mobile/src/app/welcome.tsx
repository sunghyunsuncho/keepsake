import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import {
  ArrowRightIcon,
  BellRingingIcon,
  BroomIcon,
  CheckCircleIcon,
  CloudIcon,
  MapPinIcon,
  NotePencilIcon,
  ShieldCheckIcon,
} from 'phosphor-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { LanguageMenu } from '@/components/language-menu';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { APP_NAME } from '@/constants/app-info';
import { Spacing } from '@/constants/theme';
import { setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';

type PageKind = 'pick' | 'device' | 'cloud' | 'light';
type Page = {
  kind: PageKind;
  title: 'welcomePickTitle' | 'welcomeDeviceTitle' | 'welcomeCloudTitle' | 'welcomeLightTitle';
  text: 'welcomePickText' | 'welcomeDeviceText' | 'welcomeCloudText' | 'welcomeLightText';
};

// 탭 순서대로 한 장씩: 고르기 → 기기 사진첩 → 안전 사진첩 → 정리·알림.
const PAGES: Page[] = [
  { kind: 'pick', title: 'welcomePickTitle', text: 'welcomePickText' },
  { kind: 'device', title: 'welcomeDeviceTitle', text: 'welcomeDeviceText' },
  { kind: 'cloud', title: 'welcomeCloudTitle', text: 'welcomeCloudText' },
  { kind: 'light', title: 'welcomeLightTitle', text: 'welcomeLightText' },
];

/** 처음 실행할 때(WelcomeGate) 한 번 보여주는 앱 소개. 설정의 [앱 사용법]으로 다시 연다. */
export default function WelcomeScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  const scroll = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;

  // 열자마자 본 것으로 둔다: 중간에 앱을 꺼도 다음 실행 때 다시 막아서지 않는다.
  useEffect(() => {
    setSetting(db, 'welcome_seen', true).catch(() => {});
  }, [db]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const goTo = (index: number) => {
    scroll.current?.scrollTo({ x: index * width, animated: true });
    setPage(index);
  };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));

  return (
    <ThemedView style={[styles.flex, { paddingTop: insets.top + Spacing.two, paddingBottom: insets.bottom + Spacing.three }]}>
      <View style={styles.header}>
        <ThemedText style={styles.wordmark} localize={false}>
          {APP_NAME}
        </ThemedText>
        <LanguageMenu />
      </View>

      {/* 스토리처럼 지금 몇 번째 장인지 보여주고, 눌러서 그 장으로 옮긴다. */}
      <View style={styles.progress}>
        {PAGES.map(({ kind }, index) => (
          <Pressable key={kind} style={styles.segmentHit} onPress={() => goTo(index)} hitSlop={{ top: 10, bottom: 10 }}>
            <View style={[styles.segment, { backgroundColor: index <= page ? theme.accent : theme.backgroundSelected }]} />
          </Pressable>
        ))}
      </View>

      <ScrollView
        ref={scroll}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={styles.flex}>
        {PAGES.map(({ kind, title, text }, index) => (
          <View key={kind} style={[styles.page, { width }]}>
            <View
              style={[styles.stage, { backgroundColor: theme.backgroundElement }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <Illustration kind={kind} />
            </View>
            <View style={styles.copy}>
              <ThemedText type="smallBold" localize={false} style={[styles.step, { color: theme.accent }]}>
                {String(index + 1).padStart(2, '0')} / {String(PAGES.length).padStart(2, '0')}
              </ThemedText>
              <ThemedText style={styles.title}>{t(title)}</ThemedText>
              <ThemedText themeColor="textSecondary">{t(text)}</ThemedText>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {last ? (
          <View style={styles.flex}>
            <Button label={t('getStarted')} onPress={close} />
          </View>
        ) : (
          <>
            <Pressable onPress={close} hitSlop={10} accessibilityRole="button">
              <ThemedText type="small" themeColor="textSecondary">
                {t('skip')}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => goTo(page + 1)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.next, { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText style={[styles.nextLabel, { color: theme.onAccent }]}>{t('next')}</ThemedText>
              <ArrowRightIcon size={18} weight="bold" color={theme.onAccent} />
            </Pressable>
          </>
        )}
      </View>
    </ThemedView>
  );
}

/** 실제 화면을 단순하게 줄여 그린 그림. 사진 대신 색 면을 써서 언어·테마와 상관없이 같은 모양이다. */
function Illustration({ kind }: { kind: PageKind }) {
  const theme = useTheme();
  const tints = [theme.backgroundSelected, `${theme.accent}33`, `${theme.navy}33`];
  const tile = (index: number) => tints[index % tints.length];

  switch (kind) {
    case 'pick':
      // 사진 아홉 장 중 두 장만 골라 남긴다.
      return (
        <View style={styles.grid}>
          {Array.from({ length: 9 }, (_, i) => {
            const picked = i === 1 || i === 6;
            return (
              <View
                key={i}
                style={[
                  styles.tile,
                  { backgroundColor: tile(i), opacity: picked ? 1 : 0.55 },
                  picked && { borderWidth: 2.5, borderColor: theme.accent },
                ]}>
                {picked && (
                  <View style={[styles.check, { backgroundColor: theme.background }]}>
                    <CheckCircleIcon size={22} weight="fill" color={theme.accent} />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      );
    case 'device':
      // 남긴 사진 한 장이 장소·메모와 함께 카드로 쌓인다.
      return (
        <View>
          <View style={[styles.card, styles.cardBehindLeft, { backgroundColor: theme.backgroundSelected }]} />
          <View style={[styles.card, styles.cardBehindRight, { backgroundColor: `${theme.navy}33` }]} />
          <View style={[styles.card, { backgroundColor: theme.background, shadowColor: theme.text }]}>
            <View style={[styles.cardPhoto, { backgroundColor: `${theme.accent}33` }]} />
            <View style={styles.cardLine}>
              <MapPinIcon size={14} weight="fill" color={theme.accent} />
              <View style={[styles.bar, { width: 90, backgroundColor: theme.backgroundSelected }]} />
            </View>
            <View style={styles.cardLine}>
              <NotePencilIcon size={14} color={theme.textSecondary} />
              <View style={[styles.bar, { width: 120, backgroundColor: theme.backgroundSelected }]} />
            </View>
          </View>
        </View>
      );
    case 'cloud':
      // 원본은 안전 보관에, 공유 앨범은 여러 사람이 함께.
      return (
        <View style={styles.cloudWrap}>
          <View>
            <CloudIcon size={150} weight="fill" color={`${theme.accent}40`} />
            <View style={styles.cloudShield}>
              <ShieldCheckIcon size={52} weight="fill" color={theme.accent} />
            </View>
          </View>
          <View style={styles.people}>
            {[theme.navy, theme.accent, theme.textSecondary].map((color, i) => (
              <View
                key={i}
                style={[styles.person, { backgroundColor: color, borderColor: theme.backgroundElement, marginLeft: i === 0 ? 0 : -10 }]}
              />
            ))}
          </View>
        </View>
      );
    case 'light':
      // 남기지 않은 사진은 정리 후보가 되고, 알림이 다음 고르기를 챙긴다.
      return (
        <View>
          <View style={styles.grid}>
            {Array.from({ length: 9 }, (_, i) => {
              const kept = i === 0 || i === 4 || i === 8;
              return (
                <View
                  key={i}
                  style={[
                    styles.tile,
                    kept
                      ? { backgroundColor: tile(i) }
                      : { borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.chevron },
                  ]}
                />
              );
            })}
          </View>
          <View style={[styles.badge, styles.badgeBottom, { backgroundColor: theme.accent }]}>
            <BroomIcon size={24} weight="fill" color={theme.onAccent} />
          </View>
          <View style={[styles.badge, styles.badgeTop, { backgroundColor: theme.background, shadowColor: theme.text }]}>
            <BellRingingIcon size={22} weight="fill" color={theme.accent} />
          </View>
        </View>
      );
  }
}

const TILE = 58;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    minHeight: 40,
  },
  wordmark: { fontSize: 20, lineHeight: 26, fontWeight: 700, letterSpacing: -0.3 },
  progress: { flexDirection: 'row', gap: 6, paddingHorizontal: Spacing.four, paddingTop: Spacing.three },
  segmentHit: { flex: 1 },
  segment: { height: 3, borderRadius: 2 },
  page: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four, gap: Spacing.four },
  stage: { flex: 1, maxHeight: 340, borderRadius: 28, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  copy: { gap: Spacing.two, paddingBottom: Spacing.three },
  step: { letterSpacing: 1 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: 700, letterSpacing: -0.5 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    minHeight: 52,
  },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 52,
    paddingHorizontal: Spacing.four,
    borderRadius: 26,
  },
  nextLabel: { fontWeight: 700 },

  grid: { width: TILE * 3 + 8 * 2, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: TILE, height: TILE, borderRadius: 12 },
  check: { position: 'absolute', top: -8, right: -8, borderRadius: 12 },

  card: {
    width: 180,
    padding: 12,
    gap: 10,
    borderRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 4,
  },
  cardBehindLeft: { position: 'absolute', top: 0, bottom: 0, transform: [{ rotate: '-8deg' }, { translateX: -14 }] },
  cardBehindRight: { position: 'absolute', top: 0, bottom: 0, transform: [{ rotate: '7deg' }, { translateX: 14 }] },
  cardPhoto: { height: 110, borderRadius: 10 },
  cardLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bar: { height: 8, borderRadius: 4 },

  cloudWrap: { alignItems: 'center', gap: Spacing.two },
  cloudShield: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingTop: 14 },
  people: { flexDirection: 'row' },
  person: { width: 32, height: 32, borderRadius: 16, borderWidth: 3 },

  badge: { position: 'absolute', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  badgeBottom: { right: -18, bottom: -18 },
  badgeTop: {
    left: -18,
    top: -18,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
});
