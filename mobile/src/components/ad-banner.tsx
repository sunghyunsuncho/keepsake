import { useState } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { bannerUnitId, useAds } from '@/lib/ads';
import { useTranslation } from '@/lib/i18n';

/**
 * 광고 한 칸. 놓인 자리의 폭에 맞춘 인라인 적응형 배너이고, maxHeight로 높이를 제한한다.
 * 광고가 오기 전이나 받지 못하면 자리를 차지하지 않는다. 버튼과 붙지 않게 위에 여백과 '광고' 표시를 둔다.
 */
export function AdBanner({ maxHeight, style }: { maxHeight: number; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { ready } = useAds();
  const [width, setWidth] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!ready || failed || !bannerUnitId) return null;
  return (
    <View
      style={[styles.slot, !loaded && styles.waiting, style]}
      onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
      {loaded && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
          {t('ad')}
        </ThemedText>
      )}
      {width > 0 && (
        <BannerAd
          unitId={bannerUnitId}
          size={BannerAdSize.INLINE_ADAPTIVE_BANNER}
          width={width}
          maxHeight={maxHeight}
          onAdLoaded={() => setLoaded(true)}
          onAdFailedToLoad={() => setFailed(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { alignSelf: 'stretch', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.three },
  // 광고가 오기 전에는 높이를 0으로 두되, 폭은 재야 하므로 그리기는 한다.
  waiting: { height: 0, overflow: 'hidden', marginTop: 0 },
  label: { alignSelf: 'flex-start', fontSize: 11, lineHeight: 14 },
});
