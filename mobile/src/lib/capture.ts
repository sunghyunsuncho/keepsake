import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
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
import { deletePhotoDir, ensureDir, photoDir, photoDirPath } from '@/lib/storage';

// 표시용 리사이즈본: 긴 변 기준. 1장 약 0.5MB를 목표로 한다 (docs/PLAN.md §2.2).
const DISPLAY_LONG_EDGE = 1600;
const DISPLAY_QUALITY = 0.8;

export class CaptureError extends Error {}

/**
 * 사진을 고르면 원본을 앱 안에 복사하고 표시용 리사이즈본을 만든 뒤 기록을 만든다.
 * 사용자가 나중에 보관함에서 사진을 지워도 기록이 남고, Cloud 구독 시 바로 올릴 수 있다.
 */
export async function captureAsset(
  db: SQLiteDatabase,
  asset: MediaLibrary.Asset,
  reviewDate: string,
) {
  // 고르기와 날짜로 보기에서 같은 사진을 따로 남기는 경우 등, 이미 남긴 사진이면 그 기록을 쓴다.
  const existing = await findMomentByAsset(db, asset.id);
  if (existing) return existing;

  // iCloud에만 있는 사진은 원본을 내려받아야 localUri가 생긴다.
  const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: true });
  const sourceUri = info.localUri ?? asset.uri;
  if (!sourceUri.startsWith('file://')) {
    throw new CaptureError('원본 사진을 가져오지 못했어요. 네트워크 연결을 확인해 주세요.');
  }

  const id = randomUUID();
  const dir = photoDir(id);
  ensureDir(dir);

  try {
    const ext = extensionOf(asset.filename) ?? extensionOf(sourceUri) ?? 'jpg';
    const original = new File(dir, `original.${ext}`);
    new File(sourceUri).copy(original);

    // 촬영지 시간대. 원본 EXIF에 있으면 그걸 쓰고, 없으면 장소를 찾을 때 그 지역 시간대로 채운다.
    const tzOffset = readCaptureOffset(original.uri);

    const display = await makeDisplayImage(sourceUri, asset.width, asset.height);
    display.move(new File(dir, 'display.jpg'));

    const moment: NewMoment = {
      id,
      source_asset_id: asset.id,
      local_original_path: `${photoDirPath(id)}/original.${ext}`,
      local_display_path: `${photoDirPath(id)}/display.jpg`,
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
    return id;
  } catch (e) {
    deletePhotoDir(id);
    throw e;
  }
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

/** 기록에서 뺀다. 행은 소프트 삭제로 남기고 앱 안의 사진 파일은 지운다. */
export async function removeMoment(db: SQLiteDatabase, id: string, reviewDate?: string) {
  await softDeleteMoment(db, id, reviewDate);
  deletePhotoDir(id);
}

async function makeDisplayImage(uri: string, width: number, height: number) {
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > DISPLAY_LONG_EDGE) {
    context.resize(
      width >= height ? { width: DISPLAY_LONG_EDGE, height: null } : { width: null, height: DISPLAY_LONG_EDGE },
    );
  }
  // 원본 해상도 이미지를 메모리에 올리므로 다 쓰면 바로 놓아준다.
  const image = await context.renderAsync();
  try {
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: DISPLAY_QUALITY });
    return new File(result.uri);
  } finally {
    image.release();
    context.release();
  }
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

function extensionOf(name: string | undefined) {
  const match = name?.match(/\.([A-Za-z0-9]{1,5})$/);
  return match ? match[1].toLowerCase() : null;
}
