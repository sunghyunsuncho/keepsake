import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageContentFit } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { setMomentSource, type Moment } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { cloudDisplayUri, cloudOriginalUrl } from '@/lib/cloud/photos';
import { useCloudSession } from '@/lib/cloud/session';

type PhotoMoment = Pick<
  Moment,
  'id' | 'source_asset_id' | 'source_uri' | 'source_missing' | 'display_uploaded' | 'original_uploaded'
>;

type Props = {
  moment: PhotoMoment;
  /** original: 크게 볼 때. 사진첩 원본이 없으면 Cloud 원본을 받는다. */
  variant?: 'display' | 'original';
  style: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  transition?: number;
  /** 지워진 사진일 때 설명 문구까지 보여줄지 (작은 카드는 아이콘만) */
  explainMissing?: boolean;
};

/**
 * 기록의 사진. 앱은 사진을 보관하지 않으므로 기기 사진첩 원본을 그대로 그리고,
 * 원본이 없으면(지워진 사진, 다른 기기에서 남긴 기록) Cloud에 있는 사진을 받아 그린다.
 * 둘 다 없으면 지워진 사진으로 보여준다.
 */
export function MomentPhoto({ moment, variant = 'display', style, contentFit = 'cover', transition, explainMissing }: Props) {
  const db = useSQLiteContext();
  const session = useCloudSession();
  // 이번에 사진첩 원본을 그리지 못했으면 true. 지워진 사진으로 표시돼 있어도 한 번은 사진첩을 먼저 시도한다
  // (사진첩에서 다시 보이게 된 경우 표시를 되돌리기 위해).
  const [libraryFailed, setLibraryFailed] = useState(false);
  const [cloudUri, setCloudUri] = useState<string | null>(null);
  const [cloudFailed, setCloudFailed] = useState(false);

  // 다른 기록을 그리게 되거나(목록 재사용) 주소가 바뀌면 처음부터 다시 시도한다.
  // 그리기 전에 바꿔서, 재사용된 칸에 이전 기록의 사진이 잠깐 보이지 않게 한다.
  const sourceKey = `${moment.id}|${moment.source_uri ?? ''}`;
  const [triedKey, setTriedKey] = useState(sourceKey);
  if (triedKey !== sourceKey) {
    setTriedKey(sourceKey);
    setLibraryFailed(false);
    setCloudUri(null);
    setCloudFailed(false);
  }

  // 그릴 주소를 아직 모르면(이전 버전에서 남긴 기록) 사진첩에서 찾아 저장한다.
  useEffect(() => {
    if (!moment.source_uri) refreshSource(db, moment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, moment.id, moment.source_asset_id, moment.source_uri]);

  const libraryUri = !libraryFailed ? moment.source_uri : null;
  // 원본이 아직 Cloud에 없으면(표시용만 올라간 경우) 크게 볼 때도 표시용 사진을 보여준다.
  const cloudVariant =
    variant === 'original' && moment.original_uploaded ? 'original' : moment.display_uploaded ? 'display' : null;
  const tryCloud = !libraryUri && !!session && !!cloudVariant && !cloudFailed;

  useEffect(() => {
    if (!tryCloud || cloudUri) return;
    let cancelled = false;
    (cloudVariant === 'original' ? cloudOriginalUrl(moment.id) : cloudDisplayUri(moment.id))
      .then((uri) => !cancelled && setCloudUri(uri))
      .catch(() => !cancelled && setCloudFailed(true));
    return () => {
      cancelled = true;
    };
  }, [tryCloud, cloudUri, cloudVariant, moment.id]);

  const uri = libraryUri ?? (tryCloud ? cloudUri : null);
  const waiting = !libraryUri && tryCloud && !cloudUri;
  if (!uri) {
    // 사진 자리의 크기만 쓰므로 View에도 같은 스타일을 준다.
    const box = style as StyleProp<ViewStyle>;
    return waiting ? <View style={box} /> : <MissingPhoto style={box} explain={explainMissing} />;
  }
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit={contentFit}
      recyclingKey={moment.id}
      transition={transition}
      onLoad={() => {
        if (uri === libraryUri && moment.source_missing) {
          setMomentSource(db, moment.id, { missing: false });
        }
      }}
      onError={() => {
        if (uri === libraryUri) {
          setLibraryFailed(true);
          refreshSource(db, moment);
        } else {
          setCloudFailed(true);
        }
      }}
    />
  );
}

/**
 * 사진첩에서 사진을 다시 찾아 연결 상태를 고친다. 그리기 실패만으로 지워졌다고 보지 않는다:
 * iCloud에만 있는 사진은 오프라인이면 그리지 못하고, Android는 사진을 옮기면 주소가 바뀐다.
 * 사진이 없으면 null이고, 예외(권한 없음)일 때는 알 수 없으므로 표시를 바꾸지 않는다.
 */
function refreshSource(db: SQLiteDatabase, moment: PhotoMoment) {
  if (!moment.source_asset_id) return;
  MediaLibrary.getAssetInfoAsync(moment.source_asset_id, { shouldDownloadFromNetwork: false })
    .then((asset) => {
      if (!asset) {
        if (!moment.source_missing) return setMomentSource(db, moment.id, { missing: true });
      } else if (asset.uri !== moment.source_uri || moment.source_missing) {
        return setMomentSource(db, moment.id, { uri: asset.uri, missing: false });
      }
    })
    .catch(() => {});
}

function MissingPhoto({ style, explain }: { style: StyleProp<ViewStyle>; explain?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[style, styles.missing, { backgroundColor: theme.backgroundElement }]}>
      <Ionicons name="image-outline" size={explain ? 32 : 24} color={theme.textSecondary} />
      {explain && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          기기 사진첩에서 지워진 사진이에요.{'\n'}메모와 장소, 날짜는 그대로 남아 있어요.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  missing: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.three },
  center: { textAlign: 'center' },
});
