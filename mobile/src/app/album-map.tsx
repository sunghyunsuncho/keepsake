import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import MapView, { Callout, Marker, type Region } from 'react-native-maps';

import { MomentPhoto } from '@/components/moment-photo';
import { SharedItemPhoto } from '@/components/shared-item-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { listAlbumMoments } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import type { Moment } from '@/db/moments';
import { listSharedItems, type SharedItem } from '@/lib/cloud/shared';
import { formatFullDate } from '@/lib/dates';

type Point = { id: string; lat: number; lng: number; takenAt: string; placeName?: string | null };
type MarkerPoint = Point & { count: number };

/** 앨범 안에서 위치가 남아 있는 사진만 Apple 사진 앱처럼 지도 위에서 본다. */
export default function AlbumMapScreen() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind: 'album' | 'shared' }>();
  return kind === 'shared' ? <SharedAlbumMap albumId={id} /> : <PersonalAlbumMap albumId={id} />;
}

function PersonalAlbumMap({ albumId }: { albumId: string }) {
  const db = useSQLiteContext();
  const { data: moments, error } = useDbQuery(() => listAlbumMoments(db, albumId), [db, albumId]);
  if (error) return <MapLoadError />;
  if (!moments) return <LoadingMap />;
  const points = momentsToPoints(moments);
  const momentsById = new Map(moments.map((moment) => [moment.id, moment]));
  return (
    <AlbumMap
      title="앨범 지도"
      points={points}
      renderPreview={(point) => {
        const moment = momentsById.get(point.id);
        return moment ? <MomentPhoto moment={moment} variant="thumb" style={styles.preview} badge={false} /> : null;
      }}
      onPressPoint={(point) => router.push({ pathname: '/viewer', params: { album: albumId, moment: point.id } })}
    />
  );
}

function SharedAlbumMap({ albumId }: { albumId: string }) {
  const { data: items, error } = useDbQuery(() => listSharedItems(albumId), [albumId]);
  if (error) return <MapLoadError shared />;
  if (!items) return <LoadingMap />;
  const points = sharedItemsToPoints(items);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  return (
    <AlbumMap
      title="공유 앨범 지도"
      points={points}
      renderPreview={(point) => {
        const item = itemsById.get(point.id);
        return item ? <SharedItemPhoto albumId={albumId} item={item} variant="thumb" style={styles.preview} /> : null;
      }}
    />
  );
}

function AlbumMap({
  title,
  points,
  renderPreview,
  onPressPoint,
}: {
  title: string;
  points: Point[];
  renderPreview: (point: MarkerPoint) => ReactNode;
  onPressPoint?: (point: MarkerPoint) => void;
}) {
  const region = useMemo(() => mapRegion(points), [points]);
  // 수천 장이 한 앨범에 있어도 Marker를 수천 개 만들지 않는다. 현재 화면 범위에 비례한 격자로
  // 가까운 사진을 묶어 Apple 사진 앱처럼 한 핀으로 보여 준다.
  const markers = useMemo(() => clusterPoints(points, region), [points, region]);
  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title }} />
      {region ? (
        <MapView style={styles.flex} initialRegion={region} showsUserLocation={false}>
          {markers.map((point) => (
            <Marker key={point.id} coordinate={{ latitude: point.lat, longitude: point.lng }}>
              <Callout tooltip onPress={() => onPressPoint?.(point)}>
                <View style={styles.callout}>
                  {renderPreview(point)}
                  <View style={styles.calloutText}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {point.count > 1 ? `${point.count}장의 사진` : formatFullDate(point.takenAt)}
                    </ThemedText>
                    {point.placeName && (
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {point.placeName}
                      </ThemedText>
                    )}
                  </View>
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>
      ) : (
        <View style={styles.empty}>
          <ThemedText type="smallBold">지도에 표시할 사진이 없어요</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            촬영 위치가 저장된 사진을 앨범에 담으면 여기에서 볼 수 있어요.
          </ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

function LoadingMap() {
  return (
    <ThemedView style={styles.empty}>
      <Stack.Screen options={{ title: '앨범 지도' }} />
      <ActivityIndicator />
    </ThemedView>
  );
}

function MapLoadError({ shared = false }: { shared?: boolean }) {
  return (
    <ThemedView style={styles.empty}>
      <Stack.Screen options={{ title: shared ? '공유 앨범 지도' : '앨범 지도' }} />
      <ThemedText type="smallBold">지도를 불러오지 못했어요</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {shared ? '인터넷 연결을 확인한 뒤 다시 열어 주세요.' : '잠시 후 다시 열어 주세요.'}
      </ThemedText>
    </ThemedView>
  );
}

function momentsToPoints(moments: Moment[]): Point[] {
  return moments
    .filter((moment) => validCoordinate(moment.lat, moment.lng))
    .map((moment) => ({ id: moment.id, lat: moment.lat!, lng: moment.lng!, takenAt: moment.taken_at, placeName: moment.place_name }));
}

function sharedItemsToPoints(items: SharedItem[]): Point[] {
  return items
    .filter((item) => item.taken_at && validCoordinate(item.lat, item.lng))
    .map((item) => ({ id: item.id, lat: item.lat!, lng: item.lng!, takenAt: item.taken_at!, placeName: null }));
}

function validCoordinate(lat: number | null, lng: number | null) {
  return lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function mapRegion(points: Point[]): Region | null {
  if (points.length === 0) return null;
  const latitudes = points.map((point) => point.lat);
  const longitudes = points.map((point) => point.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.35, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.35, 0.02),
  };
}

const MAX_MARKERS = 300;

function clusterPoints(points: Point[], region: Region | null): MarkerPoint[] {
  if (!region) return [];
  // 분산이 큰 앨범도 최대 300개 핀에 머물도록 격자 크기를 단계적으로 키운다.
  let rows = 36;
  for (;;) {
    const latStep = Math.max(region.latitudeDelta / rows, 0.0001);
    const lngStep = Math.max(region.longitudeDelta / rows, 0.0001);
    const groups = new Map<string, Point[]>();
    for (const point of points) {
      const key = `${Math.floor(point.lat / latStep)}:${Math.floor(point.lng / lngStep)}`;
      const group = groups.get(key);
      if (group) group.push(point);
      else groups.set(key, [point]);
    }
    if (groups.size <= MAX_MARKERS || rows <= 2) {
      return [...groups.values()].map((group) => ({ ...group[0], count: group.length }));
    }
    rows = Math.floor(rows / 2);
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  center: { textAlign: 'center' },
  callout: { width: 196, flexDirection: 'row', overflow: 'hidden', borderRadius: Spacing.two, backgroundColor: 'white' },
  preview: { width: 72, height: 72, backgroundColor: '#ddd' },
  calloutText: { flex: 1, justifyContent: 'center', gap: Spacing.one, padding: Spacing.two },
});
