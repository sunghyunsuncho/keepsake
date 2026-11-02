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

// 기록과 이 기기 사진의 연결을 계정·기기별로 서버에 둔다. 앱을 다시 설치해도 원본을 다시 가리키기 위해서다.
// 복구하지 못해도 잃는 것은 없다. 사진은 Cloud에서 받아 보여준다.

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

/**
 * 새로 만든 계정 공간에서 한 번, 이 기기에 저장해 둔 연결을 되살린다.
 * Android 사진 id는 초기화 뒤 다른 사진을 가리킬 수 있어 파일 이름과 촬영 시각이 맞을 때만 잇는다.
 */
export async function restoreDeviceLinks(db: SQLiteDatabase, userId: string) {
  if ((await getSettings(db)).cloud_links_restored) return;
  // 권한을 받기 전이면 확인할 수 없으니 다음 동기화에서 다시 한다.
  const { granted, accessPrivileges } = await MediaLibrary.getPermissionsAsync(false, ['photo']);
  if (!granted) return;

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
  // 일부 사진만 허용했으면 나중에 허용한 사진을 이을 수 있도록 다음 동기화에서 다시 본다.
  if (accessPrivileges !== 'limited') await setSetting(db, 'cloud_links_restored', true);
  if (restored > 0) notifyChange();
}
