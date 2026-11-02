import { requireNativeModule } from 'expo-modules-core';

// 사진의 좌표를 주소로 바꾸고, 원본 EXIF에서 촬영 시간대를 읽는 로컬 네이티브 모듈.
// 위치 권한 없이 동작한다 (기기 위치가 아니라 사진에 이미 들어 있는 좌표를 쓴다).

export type GeocodedPlace = {
  /** 랜드마크·공원 등 (iOS만) */
  areaOfInterest?: string;
  subLocality?: string;
  /** 도로명 */
  thoroughfare?: string;
  locality?: string;
  subAdministrativeArea?: string;
  administrativeArea?: string;
  country?: string;
  isoCountryCode?: string;
  /** 그 지역의 UTC 오프셋(분). iOS만 제공한다. */
  timeZoneOffsetMinutes?: number;
};

type PhotoMetaNative = {
  reverseGeocode(
    latitude: number,
    longitude: number,
    localeId: string,
    atMs: number,
  ): Promise<GeocodedPlace | null>;
  readCaptureOffset(uri: string): number | null;
  trashPhotos(assetIds: string[]): Promise<boolean>;
};

const PhotoMeta = requireNativeModule<PhotoMetaNative>('PhotoMeta');

export function reverseGeocode(latitude: number, longitude: number, localeId: string, atMs: number) {
  return PhotoMeta.reverseGeocode(latitude, longitude, localeId, atMs);
}

/** 원본 파일 EXIF의 촬영 시간대 (UTC 기준 분). 없으면 null. */
export function readCaptureOffset(fileUri: string) {
  return PhotoMeta.readCaptureOffset(fileUri);
}

/** 사진을 기기 휴지통으로 옮긴다 (Android 11+ 전용). 확인 창에서 취소하면 false. */
export function trashPhotos(assetIds: string[]) {
  return PhotoMeta.trashPhotos(assetIds);
}
