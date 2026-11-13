import * as MediaLibrary from 'expo-media-library';
import { useVideoPlayer, VideoView, type VideoContentFit } from 'expo-video';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { PhotoMoment } from '@/components/moment-photo';
import { Spacing } from '@/constants/theme';
import { cloudOriginalUrl } from '@/lib/cloud/photos';
import { useCloudSession } from '@/lib/cloud/session';
import { assetFileUri } from '@/lib/photos';
import { localizeText, useTranslation } from '@/lib/i18n';

type Props = {
  moment: PhotoMoment;
  style: StyleProp<ViewStyle>;
  contentFit?: VideoContentFit;
  /** 옆으로 넘겨 보는 화면에서 지금 보이는 페이지인지. 아니면 멈춘다. */
  active?: boolean;
  /** 영상을 찾는 동안과 재생할 영상이 없을 때 보여줄 대표 장면 (화면을 채운다) */
  poster: ReactNode;
};

/**
 * 기록의 동영상을 크게 재생한다. 기기 사진첩 원본을 먼저 쓰고(iOS는 ph:// 주소를 재생하지 못해 파일 주소를 받는다),
 * 없으면 Cloud 원본, 그다음 효율 보관 영상(720p)을 서명 URL로 바로 재생한다. 받는 동안과 재생할 영상이 없을 때는
 * 대표 장면을 보여준다.
 */
export function MomentVideo({ moment, style, contentFit = 'contain', active = true, poster }: Props) {
  const session = useCloudSession();
  const { language } = useTranslation();
  // undefined: 찾는 중, null: 재생할 영상이 없다
  const [uri, setUri] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setUri(undefined);
    resolveVideoUri(moment, !!session)
      .catch(() => null)
      .then((found) => !cancelled && setUri(found));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment.id, moment.source_asset_id, moment.source_missing, moment.original_uploaded, moment.compact_uploaded, !!session]);

  if (uri) return <Player uri={uri} style={style} contentFit={contentFit} active={active} />;
  return (
    <View style={style}>
      {poster}
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        {uri === undefined ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.message}>{localizeText(language, '재생할 수 있는 동영상을 찾지 못했어요.')}</Text>
        )}
      </View>
    </View>
  );
}

async function resolveVideoUri(moment: PhotoMoment, signedIn: boolean) {
  if (moment.source_asset_id) {
    // iCloud에만 있는 영상은 받아야 재생할 수 있다 (OS가 관리하는 사진첩 캐시라 앱 용량은 늘지 않는다).
    const info = await MediaLibrary.getAssetInfoAsync(moment.source_asset_id, {
      shouldDownloadFromNetwork: true,
    }).catch(() => null);
    const file = info && assetFileUri(info);
    if (file) return file;
  }
  if (!signedIn) return null;
  if (moment.original_uploaded) return cloudOriginalUrl(moment.id, 'original');
  if (moment.compact_uploaded) return cloudOriginalUrl(moment.id, 'compact');
  return null;
}

export function Player({
  uri,
  style,
  contentFit,
  active,
}: {
  uri: string;
  style: StyleProp<ViewStyle>;
  contentFit: VideoContentFit;
  active: boolean;
}) {
  const player = useVideoPlayer(uri);
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [player, active]);
  return <VideoView player={player} style={style} contentFit={contentFit} nativeControls allowsPictureInPicture={false} />;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  message: { color: '#fff', fontSize: 14, textAlign: 'center' },
});
