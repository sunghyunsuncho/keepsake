import * as Application from 'expo-application';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import * as MediaLibrary from 'expo-media-library';
import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { notifyChange } from '@/db/changes';
import { inTransaction } from '@/db/moments';
import { getSettings, setSetting } from '@/db/settings';
import { cloudApi, unwrap } from '@/lib/cloud/session';
import { MEDIA_PERMISSIONS, MEDIA_TYPES } from '@/lib/photos';

// 기록과 이 기기 사진의 연결을 계정·기기별로 서버에 둔다. 앱을 다시 설치해도 원본을 다시 가리키기 위해서다.
// 새 휴대폰처럼 저장해 둔 연결이 없는 기기에서는 사진첩에서 같은 사진(파일 이름·촬영 시각)을 찾아 잇는다.
// 이으면 무료 회원도 iCloud 사진·Google 포토로 옮겨진 사진을 기록과 함께 본다.
// 복구하지 못해도 잃는 것은 없다. 안전 앨범의 사진은 Cloud에서 받아 보여준다.

const LINK_BATCH = 200;
const DEVICE_KEY = 'keepsake.device.id';
const SAME_PHOTO_MS = 2000;

/** 기기 원본값을 그대로 보내지 않고 계정과 묶어 해시한다. 계정이 다르면 같은 기기여도 값이 다르다. */
async function deviceIdFor(userId: string) {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, `${userId}:${await rawDeviceId()}`);
}

async function rawDeviceId() {
  if (Platform.OS === 'android') return Application.getAndroidId();
  // iOS 앱 식별값은 앱을 지우면 바뀔 수 있어 Keychain에 둔다. 새 기기로 옮겨지지 않게 THIS_DEVICE_ONLY로 저장한다.
  const saved = await SecureStore.getItemAsync(DEVICE_KEY);
  if (saved) return saved;
  const created = randomUUID();
  await SecureStore.setItemAsync(DEVICE_KEY, created, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return created;
}

/** 서버에 있는 기록 중 아직 보내지 않은 연결을 보낸다. */
export async function pushDeviceLinks(db: SQLiteDatabase, userId: string) {
  const deviceId = await deviceIdFor(userId);
  for (;;) {
    const rows = await db.getAllAsync<{ id: string; source_asset_id: string }>(
      `SELECT id, source_asset_id FROM moments
       WHERE deleted_at IS NULL AND sync_state = 'synced' AND source_asset_id IS NOT NULL
         AND source_link_synced = 0
       LIMIT ${LINK_BATCH}`,
    );
    if (rows.length === 0) return;
    unwrap(
      await cloudApi.PUT('/sync/device-links', {
        body: {
          device_id: deviceId,
          links: rows.map((row) => ({ moment_id: row.id, asset_id: row.source_asset_id })),
        },
      }),
    );
    await inTransaction(db, async () => {
      for (const row of rows) {
        await db.runAsync(
          'UPDATE moments SET source_link_synced = 1 WHERE id = ? AND source_asset_id = ?',
          row.id,
          row.source_asset_id,
        );
      }
    });
  }
}

// 일부 허용 상태에서 마지막으로 연결을 확인한 때. 허용 범위가 바뀐 것을 직접 알 수 없다.
let limitedChecked: { userId: string; visible: number; at: number } | null = null;
const LIMITED_RECHECK_MS = 60 * 60 * 1000;

/**
 * 새로 만든 계정 공간에서 한 번, 이 기기에 저장해 둔 연결을 되살린다.
 * Android 사진 id는 초기화 뒤 다른 사진을 가리킬 수 있어 파일 이름과 촬영 시각이 맞을 때만 잇는다.
 */
export async function restoreDeviceLinks(db: SQLiteDatabase, userId: string) {
  if ((await getSettings(db)).cloud_links_restored) return;
  // 권한을 받기 전이면 확인할 수 없으니 다음 동기화에서 다시 한다.
  const { granted, accessPrivileges } = await MediaLibrary.getPermissionsAsync(false, MEDIA_PERMISSIONS);
  if (!granted) return;
  // 일부 사진만 허용했으면 볼 수 있는 사진 수가 달라졌을 때나 한 시간에 한 번만 다시 본다.
  // 동기화마다 전체를 받지 않는다. 수가 같게 바꾼 경우는 다음 확인 때 이어진다.
  const limited = accessPrivileges === 'limited';
  let visible = 0;
  if (limited) {
    visible = (await MediaLibrary.getAssetsAsync({ mediaType: MEDIA_TYPES, first: 1 })).totalCount;
    if (
      limitedChecked?.userId === userId &&
      limitedChecked.visible === visible &&
      Date.now() - limitedChecked.at < LIMITED_RECHECK_MS
    ) {
      return;
    }
  }

  const deviceId = await deviceIdFor(userId);
  let after = '';
  let restored = 0;
  for (;;) {
    const page = unwrap(
      await cloudApi.GET('/sync/device-links', {
        params: { query: { device_id: deviceId, after } },
      }),
    );
    for (const link of page.links) {
      const moment = await db.getFirstAsync<{ original_filename: string | null; taken_at: string }>(
        `SELECT original_filename, taken_at FROM moments
         WHERE id = ? AND deleted_at IS NULL AND source_asset_id IS NULL`,
        link.moment_id,
      );
      if (!moment?.original_filename) continue;
      const asset = await MediaLibrary.getAssetInfoAsync(link.asset_id, {
        shouldDownloadFromNetwork: false,
      }).catch(() => null);
      if (
        !asset ||
        asset.filename !== moment.original_filename ||
        Math.abs(asset.creationTime - new Date(moment.taken_at).getTime()) > SAME_PHOTO_MS
      ) {
        continue;
      }
      await db.runAsync(
        `UPDATE moments SET source_asset_id = ?, source_uri = ?, source_missing = 0, source_link_synced = 1
         WHERE id = ?`,
        asset.id,
        asset.uri,
        link.moment_id,
      );
      restored++;
    }
    if (!page.has_more || page.links.length === 0) break;
    after = page.links[page.links.length - 1].moment_id;
  }
  if (limited) limitedChecked = { userId, visible, at: Date.now() };
  else await setSetting(db, 'cloud_links_restored', true);
  if (restored > 0) notifyChange();
}

/**
 * 사진과 이어지지 않은 기록(다른 기기에서 남긴 기록, 새 휴대폰)을 이 기기 사진첩의 같은 사진과 잇는다.
 * 촬영 시각이 ±2초 안이고 파일 이름까지 같은 사진이 하나뿐일 때만 잇는다. 이미 다른 기록이 가리키는 사진,
 * 촬영 시각을 고친 기록은 잇지 않는다 (잘못 잇느니 잇지 않는다). 이은 연결은 pushDeviceLinks가 이 기기 몫으로 보낸다.
 * 사진첩 사진 수·아직 잇지 못한 기록 수·마지막 변경 시각이 지난번과 같으면 다시 찾지 않는다.
 */
export async function relinkFromLibrary(db: SQLiteDatabase) {
  const { granted } = await MediaLibrary.getPermissionsAsync(false, MEDIA_PERMISSIONS);
  if (!granted) return;
  const unlinked = await db.getAllAsync<{
    id: string;
    original_filename: string;
    taken_at: string;
    updated_at: string;
  }>(
    `SELECT id, original_filename, taken_at, updated_at FROM moments
     WHERE deleted_at IS NULL AND source_asset_id IS NULL AND original_filename IS NOT NULL`,
  );
  if (unlinked.length === 0) return;
  const library = (await MediaLibrary.getAssetsAsync({ mediaType: MEDIA_TYPES, first: 1 })).totalCount;
  const latestUpdatedAt = unlinked.reduce<string | null>(
    (latest, moment) => (!latest || moment.updated_at > latest ? moment.updated_at : latest),
    null,
  );
  const last = (await getSettings(db)).cloud_relink_state;
  if (
    last &&
    last.library === library &&
    last.unlinked === unlinked.length &&
    last.latest_updated_at === latestUpdatedAt
  ) {
    return;
  }

  const used = new Set(
    (
      await db.getAllAsync<{ source_asset_id: string }>(
        'SELECT source_asset_id FROM moments WHERE deleted_at IS NULL AND source_asset_id IS NOT NULL',
      )
    ).map((row) => row.source_asset_id),
  );
  let relinked = 0;
  for (const moment of unlinked) {
    const takenAt = new Date(moment.taken_at).getTime();
    if (Number.isNaN(takenAt)) continue;
    const { assets } = await MediaLibrary.getAssetsAsync({
      mediaType: MEDIA_TYPES,
      createdAfter: takenAt - SAME_PHOTO_MS,
      createdBefore: takenAt + SAME_PHOTO_MS,
      first: 50,
    });
    const matches = assets.filter((asset) => asset.filename === moment.original_filename && !used.has(asset.id));
    if (matches.length !== 1) continue;
    const [asset] = matches;
    await db.runAsync(
      `UPDATE moments SET source_asset_id = ?, source_uri = ?, source_missing = 0, source_link_synced = 0
       WHERE id = ? AND source_asset_id IS NULL`,
      asset.id,
      asset.uri,
      moment.id,
    );
    used.add(asset.id);
    relinked++;
  }
  await setSetting(db, 'cloud_relink_state', {
    library,
    unlinked: unlinked.length - relinked,
    latest_updated_at: latestUpdatedAt,
  });
  if (relinked > 0) notifyChange();
}
