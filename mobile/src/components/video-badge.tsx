import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';

/** "0:07", "12:30", "1:02:03" */
export function formatDuration(seconds: number) {
  const total = Math.max(Math.round(seconds), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 썸네일 왼쪽 아래의 동영상 표시. 사진 위에 겹치므로 부모가 position을 잡는다. */
export function VideoBadge({ duration }: { duration: number | null | undefined }) {
  return (
    <View style={styles.badge} pointerEvents="none">
      <Ionicons name="play" size={10} color="#fff" />
      {!!duration && <Text style={styles.text}>{formatDuration(duration)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    left: Spacing.one,
    bottom: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  text: { color: '#fff', fontSize: 11, lineHeight: 14, fontWeight: 600, fontVariant: ['tabular-nums'] },
});
