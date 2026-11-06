import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * 기기 사진첩·안전 사진첩 맨 위의 소개 문구. 두 탭에서 아래 카드가 같은 위치에 오도록
 * 제목과 설명을 각각 한 줄로 고정한다.
 */
export function LibraryIntro({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.intro}>
      <ThemedText type="smallBold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {description}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { marginHorizontal: Spacing.three, paddingHorizontal: Spacing.one, gap: Spacing.one },
});
