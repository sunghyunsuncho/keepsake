import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageContentFit } from 'expo-image';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { MomentPhoto } from '@/components/moment-photo';
import { Player } from '@/components/moment-video';
import { ThemedText } from '@/components/themed-text';
import { VideoBadge } from '@/components/video-badge';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { getMoment } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { sharedImageUri, sharedItemUrl, type SharedItem } from '@/lib/cloud/shared';

type Props = {
  albumId: string;
  item: SharedItem;
  style: StyleProp<ImageStyle>;
  /** full: 크게 볼 때. 동영상은 재생한다. thumb: 목록·표지처럼 작게 그릴 때 (썸네일이 없으면 표시용). */
  variant?: 'display' | 'thumb' | 'full';
  contentFit?: ImageContentFit;
  active?: boolean;
};

/**
 * 공유 앨범의 사진. 내가 담은 사진은 내 기록으로 그린다 (기기 사진첩 원본이 있으면 그대로).
 * 다른 구성원의 사진은 올린 사람의 Cloud 표시용 사진을 받아 그리고, 동영상은 Cloud 영상을 바로 재생한다.
 */
export function SharedItemPhoto(props: Props) {
  const db = useSQLiteContext();
  const momentId = props.item.is_mine ? props.item.moment_id : null;
  const { data: moment } = useDbQuery(async () => (momentId ? getMoment(db, momentId) : null), [db, momentId]);
  if (momentId && moment === undefined) return <View style={props.style as StyleProp<ViewStyle>} />;
  if (moment) {
    return (
      <MomentPhoto
        moment={moment}
        variant={props.variant === 'full' ? 'original' : props.variant === 'thumb' ? 'thumb' : 'display'}
        style={props.style}
        contentFit={props.contentFit}
        active={props.active}
        explainMissing={props.variant === 'full'}
      />
    );
  }
  if (props.variant === 'full' && props.item.media_type === 'video') return <SharedVideo {...props} />;
  if (props.item.media_type === 'video') {
    return (
      <View style={[props.style as StyleProp<ViewStyle>, styles.clip]}>
        <SharedImage {...props} style={StyleSheet.absoluteFill} />
        <VideoBadge duration={props.item.duration} />
      </View>
    );
  }
  return <SharedImage {...props} />;
}

function SharedImage({ albumId, item, style, contentFit = 'cover', variant }: Props) {
  const theme = useTheme();
  const stored = item.stored_variants.includes('display');
  const image = variant === 'thumb' && item.stored_variants.includes('thumb') ? 'thumb' : 'display';
  // undefined: 받는 중, null: 받을 수 없다
  const [uri, setUri] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!stored) return;
    let cancelled = false;
    setUri(undefined);
    sharedImageUri(albumId, item.id, image)
      // 썸네일을 받지 못하면 표시용으로 그린다 (목록을 받은 뒤 올린 사람이 바꾼 경우 등).
      .catch((e) => (image === 'thumb' ? sharedImageUri(albumId, item.id, 'display') : Promise.reject(e)))
      .then((found) => !cancelled && setUri(found))
      .catch(() => !cancelled && setUri(null));
    return () => {
      cancelled = true;
    };
  }, [albumId, item.id, stored, image]);

  if (stored && uri) {
    return <Image source={{ uri }} style={style} contentFit={contentFit} recyclingKey={item.id} transition={100} />;
  }
  const box = [style as StyleProp<ViewStyle>, styles.center, { backgroundColor: theme.backgroundElement }];
  if (stored && uri === undefined) return <View style={box} />;
  // 올린 사람의 기기가 아직 올리지 않았거나, 올린 사람의 보관 기간이 끝나 파일이 지워졌다.
  return (
    <View style={box}>
      <Ionicons name={stored ? 'image-outline' : 'cloud-upload-outline'} size={variant === 'full' ? 32 : 18} color={theme.textSecondary} />
      {variant === 'full' && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
          {stored ? '사진을 불러오지 못했어요.' : `${item.author_name}님의 기기에서 아직 올리는 중이에요.`}
        </ThemedText>
      )}
    </View>
  );
}

function SharedVideo(props: Props) {
  const { albumId, item, style, active = true } = props;
  const variant = item.stored_variants.includes('original')
    ? 'original'
    : item.stored_variants.includes('compact')
      ? 'compact'
      : null;
  const [uri, setUri] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!variant) return setUri(null);
    let cancelled = false;
    sharedItemUrl(albumId, item.id, variant)
      .then((found) => !cancelled && setUri(found))
      .catch(() => !cancelled && setUri(null));
    return () => {
      cancelled = true;
    };
  }, [albumId, item.id, variant]);

  if (uri) return <Player uri={uri} style={style as StyleProp<ViewStyle>} contentFit="contain" active={active} />;
  return (
    <View style={style as StyleProp<ViewStyle>}>
      <SharedImage {...props} variant="display" contentFit="contain" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        {uri === undefined ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.videoMessage}>재생할 수 있는 동영상이 아직 없어요.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.two },
  message: { textAlign: 'center' },
  videoMessage: { color: '#fff', fontSize: 14, textAlign: 'center' },
});
