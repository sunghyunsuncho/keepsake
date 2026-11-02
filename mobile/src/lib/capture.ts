import { randomUUID } from 'expo-crypto';
import * as MediaLibrary from 'expo-media-library';
import type { SQLiteDatabase } from 'expo-sqlite';

import { readCaptureOffset } from '@modules/photo-meta';

import {
  fillPlaceIfEmpty,
  findMomentByAsset,
  insertMoment,
  softDeleteMoment,
  type NewMoment,
} from '@/db/moments';
import { lookupPlace } from '@/lib/place';

export class CaptureError extends Error {}

/**
 * 고른 사진을 기록으로 남긴다. 사진은 앱에 복사하지 않고 기기 사진첩의 원본을 가리키기만 한다
 * (docs/PLAN.md §0 '사진 보관'). 기기 사진첩에서 지우면 기록의 사진도 보이지 않는다.
 */
export async function captureAsset(
  db: SQLiteDatabase,
  asset: MediaLibrary.Asset,
  reviewDate: string,
) {
  // 고르기와 날짜로 보기에서 같은 사진을 따로 남기는 경우 등, 이미 남긴 사진이면 그 기록을 쓴다.
  const existing = await findMomentByAsset(db, asset.id);
  if (existing) return existing;

  // 위치는 사진첩 정보에 있어서 원본을 받지 않아도 된다. iCloud에만 있는 사진을 남기려고 원본을 내려받지 않는다.
  let info: MediaLibrary.AssetInfo;
  try {
    info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false });
  } catch {
    throw new CaptureError('사진 정보를 읽지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  // 촬영지 시간대는 원본 EXIF에서 읽는다. 원본이 기기에 없으면 장소를 찾을 때 그 지역 시간대로 채운다.
  const tzOffset = info.localUri?.startsWith('file://') ? readCaptureOffset(info.localUri) : null;

  const moment: NewMoment = {
    id: randomUUID(),
    source_asset_id: asset.id,
    source_uri: asset.uri,
    original_filename: asset.filename,
    width: asset.width || null,
    height: asset.height || null,
    // creationTime은 ms. 촬영 시각이 없으면 지금으로 둔다.
    taken_at: new Date(asset.creationTime || Date.now()).toISOString(),
    taken_tz_offset: tzOffset,
    ...toLocation(info.location),
  };
  await insertMoment(db, moment, reviewDate);
  // 장소 찾기는 네트워크를 쓰므로 기다리지 않는다. 실패하면 상세 화면에서 다시 시도할 수 있다.
  fillPlaceFromPhoto(db, moment).catch(() => {});
  return moment.id;
}

/** 사진 좌표로 장소 이름(과 시간대)을 채운다. 찾았으면 true. */
export async function fillPlaceFromPhoto(
  db: SQLiteDatabase,
  moment: Pick<NewMoment, 'id' | 'lat' | 'lng' | 'taken_at'>,
) {
  if (moment.lat === null || moment.lng === null) return false;
  const place = await lookupPlace(moment.lat, moment.lng, moment.taken_at);
  if (!place) return false;
  await fillPlaceIfEmpty(db, moment.id, place.name, place.timeZoneOffsetMinutes);
  return true;
}

/** 기록에서 뺀다. 행은 동기화를 위해 소프트 삭제로 남긴다. 기기 사진첩의 원본은 건드리지 않는다. */
export function removeMoment(db: SQLiteDatabase, id: string, reviewDate?: string) {
  return softDeleteMoment(db, id, reviewDate);
}

function toLocation(location: MediaLibrary.Location | undefined) {
  const lat = toCoordinate(location?.latitude);
  const lng = toCoordinate(location?.longitude);
  // 일부 Android 카메라는 위치가 없을 때 0,0을 기록한다 (대서양 한가운데).
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return { lat: null, lng: null };
  return { lat, lng };
}

// iOS expo-media-library는 타입과 달리 좌표를 문자열로 줄 때가 있다.
function toCoordinate(value: unknown) {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}
