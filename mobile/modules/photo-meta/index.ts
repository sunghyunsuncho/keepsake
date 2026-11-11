import { requireNativeModule } from 'expo-modules-core';

// 사진의 좌표를 주소로 바꾸고, 원본 EXIF에서 촬영 시간대를 읽는 로컬 네이티브 모듈.
// 위치 권한 없이 동작한다 (기기 위치가 아니라 사진에 이미 들어 있는 좌표를 쓴다).
// Cloud에 올릴 파일의 MD5와 효율 보관용 동영상(720p)도 여기서 만든다.

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

/** 효율 보관 JPEG에 다시 기록할, 사진 앱이 읽는 핵심 EXIF 값. */
export type ImageMetadata = {
  takenAt: string;
  takenTzOffset: number | null;
  lat: number | null;
  lng: number | null;
};

type PhotoMetaNative = {
  reverseGeocode(
    latitude: number,
    longitude: number,
    localeId: string,
    atMs: number,
  ): Promise<GeocodedPlace | null>;
  readCaptureOffset(uri: string): number | null;
  trashPhotos(photoIds: string[], videoIds: string[]): Promise<boolean>;
  md5File(uri: string): Promise<string>;
  transcodeVideo(inputUri: string, outputUri: string): Promise<void>;
  writeImageMetadata(uri: string, metadata: ImageMetadata): Promise<void>;
};

const PhotoMeta = requireNativeModule<PhotoMetaNative>('PhotoMeta');

export function reverseGeocode(latitude: number, longitude: number, localeId: string, atMs: number) {
  return PhotoMeta.reverseGeocode(latitude, longitude, localeId, atMs);
}

/** 원본 파일 EXIF의 촬영 시간대 (UTC 기준 분). 없으면 null. */
export function readCaptureOffset(fileUri: string) {
  return PhotoMeta.readCaptureOffset(fileUri);
}

/** 사진·동영상을 기기 휴지통으로 옮긴다 (Android 11+ 전용). 확인 창에서 취소하면 false. */
export function trashPhotos(photoIds: string[], videoIds: string[]) {
  return PhotoMeta.trashPhotos(photoIds, videoIds);
}

/** 파일의 MD5(hex). 파일을 메모리에 올리지 않고 조금씩 읽는다 (몇 GB짜리 동영상). */
export function md5File(fileUri: string) {
  return PhotoMeta.md5File(fileUri);
}

/** 동영상을 짧은 변 720px 이하의 H.264 mp4로 줄여 outputUri에 쓴다. 원래 작으면 키우지 않는다. */
export function transcodeVideo(inputUri: string, outputUri: string) {
  return PhotoMeta.transcodeVideo(inputUri, outputUri);
}

/** 리사이즈한 JPEG에 촬영 일시·시간대·GPS를 EXIF로 다시 쓴다. */
export function writeImageMetadata(fileUri: string, metadata: ImageMetadata) {
  return PhotoMeta.writeImageMetadata(fileUri, metadata);
}
