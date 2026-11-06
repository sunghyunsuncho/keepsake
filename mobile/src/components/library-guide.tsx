import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { PHOTO_QUALITY } from '@/components/photo-quality';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type GuideLine = { icon: keyof typeof Ionicons.glyphMap; title: string; text: string };

const CLOUD_LINES: GuideLine[] = [
  {
    icon: 'cloud-outline',
    title: '안전 보관에만 있는 앨범',
    text: '새 안전 앨범을 만들고 나의 순간들에서 사진을 골라 담아요. 담은 사진만 안전 보관에 올라가요.',
  },
  {
    icon: 'link-outline',
    title: '기기 앨범 연결',
    text: '기기 앨범을 연결하면 그 앨범의 사진을 함께 올리고, 앞으로 넣는 사진도 따라 올려요.',
  },
  {
    icon: PHOTO_QUALITY.original.icon,
    title: '앨범마다 보관 화질',
    text: `${PHOTO_QUALITY.original.label}는 원본과 보기용 사진을, ${PHOTO_QUALITY.display.label}은 긴 변 1600px 보기용만 보관해 용량을 아껴요.`,
  },
  {
    icon: 'trash-outline',
    title: '빼면 용량이 돌아와요',
    text: '안전 앨범에서 빼거나 앨범을 지우면, 다른 안전 앨범에 없는 사진은 안전 보관에서 삭제돼요. 기록과 기기 사진첩의 원본은 그대로예요.',
  },
];

const DEVICE_LINES: GuideLine[] = [
  {
    icon: 'phone-portrait-outline',
    title: '이 기기에 남긴 사진첩',
    text: '고르기에서 남긴 사진과 메모를 이 기기에서 모아 봐요. 사진을 복사하지 않고 기기 사진첩의 원본을 그대로 보여줘서 용량을 거의 쓰지 않아요.',
  },
  {
    icon: 'images-outline',
    title: '나의 순간들',
    text: '남긴 사진이 모두 모이는 곳이에요. 앨범에 담지 않은 사진도 여기서 볼 수 있어요.',
  },
  {
    icon: 'albums-outline',
    title: '앨범으로 묶기',
    text: '여행, 가족, 계절처럼 이야기별로 앨범을 만들어요. 한 사진을 여러 앨범에 넣어도 사진은 하나예요.',
  },
  {
    icon: 'alert-circle-outline',
    title: '원본을 지우면',
    text: '기기 사진첩에서 원본을 지우면 사진은 보이지 않고 메모·장소·날짜만 남아요. 원본까지 지키려면 안전 사진첩에 담아 주세요.',
  },
];

/** 기기 사진첩·안전 사진첩 제목 옆 (i) 버튼으로 여는 안내 */
function GuideSheet({
  title,
  lines,
  visible,
  onClose,
}: {
  title: string;
  lines: GuideLine[];
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="닫기" />
      <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + Spacing.three }]}>
        <ThemedText type="subtitle">{title}</ThemedText>
        {lines.map((line) => (
          <View key={line.title} style={styles.line}>
            <View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name={line.icon} size={18} color={theme.accent} />
            </View>
            <View style={styles.body}>
              <ThemedText type="smallBold">{line.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {line.text}
              </ThemedText>
            </View>
          </View>
        ))}
        <Button label="확인" onPress={onClose} />
      </View>
    </Modal>
  );
}

export function CloudAlbumGuide({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return <GuideSheet title="안전 사진첩은 이렇게 써요" lines={CLOUD_LINES} visible={visible} onClose={onClose} />;
}

export function DeviceAlbumGuide({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return <GuideSheet title="기기 사진첩은 이렇게 써요" lines={DEVICE_LINES} visible={visible} onClose={onClose} />;
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    marginTop: 'auto',
    padding: Spacing.four,
    gap: Spacing.three,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
  },
  line: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: Spacing.half },
});
