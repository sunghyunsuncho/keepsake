import { useEffect, useState } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { bannerUnitId, useAds } from '@/lib/ads';
import { useTranslation } from '@/lib/i18n';

/** 탭 바 위에 고정하는 광고(고르기·기기 사진첩·안전 사진첩 탭)의 최대 높이. 목록이 가려지지 않게 낮게 둔다. */
export const TAB_AD_MAX_HEIGHT = 90;

// 광고를 받지 못하면(오프라인, 채울 광고 없음) 이만큼 뒤에 다시 요청한다. 탭 화면은 계속 떠 있어서
// 다시 묻지 않으면 그 실행 내내 광고 자리가 비고, 너무 자주 물으면 요청만 늘어난다.
const RETRY_AFTER_MS = 60_000;

/**
 * 광고 한 칸. 놓인 자리의 폭에 맞춘 인라인 적응형 배너이고, maxHeight로 높이를 제한한다.
 * 광고가 오기 전이나 받지 못하면 자리를 차지하지 않는다. 버튼과 붙지 않게 위에 여백을 둔다.
 * '광고' 딱지는 배너 왼쪽 위 모서리에 붙인다. 광고 위에 겹치면 AdMob 정책(광고를 가리는 구현)에 걸리므로 겹치지 않는다.
 */
export function AdBanner({ maxHeight, style }: { maxHeight: number; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { ready } = useAds();
  const [width, setWidth] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // 다시 요청할 때 BannerAd를 새로 만든다.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((n) => n + 1);
    }, RETRY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  if (!ready || failed || !bannerUnitId) return null;
  return (
    <View
      // 받기 전에는 놓인 자리의 위아래 여백(style)도 없앤다. 좌우 여백은 폭을 재야 하므로 둔다.
      style={[styles.slot, style, !loaded && styles.waiting]}
      onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
      {width > 0 && (
        // 배너 크기에 맞춰 줄어드는 틀. 딱지가 배너 왼쪽 끝에 맞춰진다.
        <View style={styles.frame}>
          {loaded && (
            <View style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.tagText}>
                {t('ad')}
              </ThemedText>
            </View>
          )}
          <BannerAd
            key={attempt}
            unitId={bannerUnitId}
            size={BannerAdSize.INLINE_ADAPTIVE_BANNER}
            width={width}
            maxHeight={maxHeight}
            onAdLoaded={() => setLoaded(true)}
            onAdFailedToLoad={() => {
              setLoaded(false);
              setFailed(true);
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { alignSelf: 'stretch', alignItems: 'center', marginTop: Spacing.three },
  // 광고가 오기 전에는 높이를 0으로 두되, 폭은 재야 하므로 그리기는 한다.
  waiting: { height: 0, overflow: 'hidden', marginTop: 0, marginBottom: 0 },
  frame: { alignItems: 'flex-start' },
  // 배너 위 모서리에 붙은 탭 모양 딱지
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  tagText: { fontSize: 10, lineHeight: 13, fontWeight: 600 },
});
