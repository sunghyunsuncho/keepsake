import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Linking } from 'react-native';
import { ArrowCircleUpIcon, ArrowsClockwiseIcon, ChartPieSliceIcon, CloudArrowUpIcon, CreditCardIcon, DownloadSimpleIcon, HourglassIcon, SignOutIcon, TrashIcon, WifiHighIcon } from 'phosphor-react-native';

import { SettingsRow, SettingsSwitchRow, shortDateTime } from '@/components/settings-list';
import { useDbQuery } from '@/db/changes';
import { getSettings, setSetting } from '@/db/settings';
import { formatFullDate } from '@/lib/dates';
import { deleteAccount, signOut, syncCloud, useCloudState } from '@/lib/cloud/engine';
import { countMissingOriginals, PhotoSaveError, saveOriginalsToLibrary } from '@/lib/cloud/photos';
import { MANAGE_SUBSCRIPTION_URL, purchasesAvailable } from '@/lib/cloud/purchases';
import { useCloudSession } from '@/lib/cloud/session';
import { formatBytes } from '@/lib/storage';

// 설정 탭의 계정·보관 행들. 상태 판단은 서버가 준 subscription 값을 그대로 보여준다.
// 등급: 로그인하지 않으면 백업 없음 → 로그인하면 기록 백업(RecordBackupRows) → 구독하면 사진 보관(CloudLibraryRows).

/** 기기 사진첩 설정의 기록 백업 행. 로그인했을 때만 보인다 (로그인은 설정 탭 맨 위 계정 행에서 한다). */
export function RecordBackupRows() {
  const db = useSQLiteContext();
  const session = useCloudSession();
  const { account, running, problem, lastSyncedAt } = useCloudState();
  if (!session) return null;

  return (
    <>
      <SettingsRow
        label="기록 백업"
        icon={ArrowsClockwiseIcon}
        value={problem ?? (lastSyncedAt ? shortDateTime(lastSyncedAt) : account ? null : '확인하는 중')}
        loading={running}
        onPress={() => syncCloud(db)}
      />
      {account && (
        <SettingsRow
          label="기기 기록 올리기"
          icon={CloudArrowUpIcon}
          onPress={() => router.push({ pathname: '/cloud-import', params: { all: '1' } })}
        />
      )}
    </>
  );
}

/** 안전 사진첩 설정 행. 구독 중이거나 구독이 끝난 뒤 30일 유예 중인 사용자에게만 보인다. */
export function CloudLibraryRows() {
  const db = useSQLiteContext();
  const { account, pendingUploads } = useCloudState();
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const { data: missingOriginals } = useDbQuery(() => countMissingOriginals(db), [db]);
  const [downloading, setDownloading] = useState<{ done: number; total: number } | null>(null);
  const subscription = account?.subscription;
  if (!account || !subscription?.can_download) return null;

  const fetchOriginals = async () => {
    if (downloading) return;
    setDownloading({ done: 0, total: missingOriginals ?? 0 });
    try {
      const result = await saveOriginalsToLibrary(db, (done, total) => setDownloading({ done, total }));
      Alert.alert(
        '기기 사진첩에 저장했어요',
        result.failed > 0 ? `${result.failed}장은 저장하지 못했어요. 다시 시도해 주세요.` : undefined,
      );
    } catch (e) {
      Alert.alert('사진을 저장하지 못했어요', e instanceof PhotoSaveError ? e.message : '잠시 후 다시 시도해 주세요.');
    } finally {
      setDownloading(null);
    }
  };

  const grace = subscription.status === 'grace';
  const { usage } = account;

  return (
    <>
      {grace && (
        <SettingsRow
          label="사진 내려받기 기한"
          icon={HourglassIcon}
          value={subscription.grace_until ? formatFullDate(subscription.grace_until) : '30일'}
        />
      )}
      <SettingsRow label="사용한 공간" icon={ChartPieSliceIcon} value={`${formatBytes(usage.bytes_total)} / ${formatBytes(usage.max_bytes)}`} />
      {subscription.can_upload && pendingUploads > 0 && <SettingsRow label="올릴 사진" icon={ArrowCircleUpIcon} value={`${pendingUploads}장`} />}
      {subscription.can_upload && (
        <SettingsSwitchRow
          label="Wi-Fi에서만 사진 올리기"
          icon={WifiHighIcon}
          value={settings?.wifi_only_upload ?? true}
          onValueChange={(value) => {
            setSetting(db, 'wifi_only_upload', value).then(() => syncCloud(db));
          }}
        />
      )}
      {(missingOriginals ?? 0) > 0 && (
        <SettingsRow
          label="원본을 기기 사진첩에 저장"
          icon={DownloadSimpleIcon}
          value={downloading ? `${downloading.done}/${downloading.total}` : `${missingOriginals}장`}
          disabled={downloading !== null}
          onPress={fetchOriginals}
        />
      )}
      {purchasesAvailable && (
        <SettingsRow label="구독 관리" icon={CreditCardIcon} onPress={() => MANAGE_SUBSCRIPTION_URL && Linking.openURL(MANAGE_SUBSCRIPTION_URL)} />
      )}
    </>
  );
}

/** 로그아웃·계정 삭제 행. 로그인했을 때만 보인다. */
export function AccountRows() {
  const session = useCloudSession();
  const [busy, setBusy] = useState(false);
  if (!session) return null;

  const confirmSignOut = () =>
    Alert.alert('로그아웃할까요?', '이 기기에만 보관한 기록으로 돌아가요. 이 계정의 기록은 다시 로그인하면 볼 수 있어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        onPress: async () => {
          setBusy(true);
          await signOut().finally(() => setBusy(false));
        },
      },
    ]);

  const confirmDelete = () =>
    Alert.alert(
      '계정을 삭제할까요?',
      '안전 보관한 사진과 기록이 바로 삭제되고 되돌릴 수 없어요. 이 기기에만 보관한 기록과, 이 기기 사진과 연결된 기록은 기기에 남아요.' +
        (purchasesAvailable ? '\n\n구독은 자동으로 해지되지 않으니 스토어의 구독 관리에서 해지해 주세요.' : ''),
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteAccount();
              if (purchasesAvailable) {
                Alert.alert('계정을 삭제했어요', '구독 해지를 잊지 마세요.', [
                  { text: '나중에' },
                  { text: '구독 관리', onPress: () => MANAGE_SUBSCRIPTION_URL && Linking.openURL(MANAGE_SUBSCRIPTION_URL) },
                ]);
              } else {
                Alert.alert('계정을 삭제했어요');
              }
            } catch {
              Alert.alert('삭제하지 못했어요', '잠시 후 다시 시도해 주세요.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  return (
    <>
      <SettingsRow label="로그아웃" icon={SignOutIcon} disabled={busy} onPress={confirmSignOut} chevron={false} />
      <SettingsRow label="계정 삭제" icon={TrashIcon} destructive disabled={busy} onPress={confirmDelete} />
    </>
  );
}
