import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { getSettings, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { formatFullDate, formatTime } from '@/lib/dates';
import { deleteAccount, signOut, syncCloud, useCloudState } from '@/lib/cloud/engine';
import { countMissingOriginals, PhotoSaveError, saveOriginalsToLibrary } from '@/lib/cloud/photos';
import { MANAGE_SUBSCRIPTION_URL, purchasesAvailable } from '@/lib/cloud/purchases';
import { useCloudSession } from '@/lib/cloud/session';
import { formatBytes } from '@/lib/storage';

/** 설정 화면의 Cloud 구역. 상태 판단은 서버가 준 subscription 값을 그대로 보여준다. */
export function CloudSection() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const session = useCloudSession();
  const { account, running, problem, pendingUploads, lastSyncedAt } = useCloudState();
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const { data: missingOriginals } = useDbQuery(() => countMissingOriginals(db), [db]);
  const [downloading, setDownloading] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <View style={styles.section}>
        <ThemedText type="small" themeColor="textSecondary">
          Cloud를 구독하면 직접 남긴 사진의 원본만 따로 보관해요. 백업이 끝난 사진은 기기 사진첩에서 지워도
          남으니 휴대폰을 비워도 되고, 새 기기에서는 로그인만으로 되돌릴 수 있어요.
        </ThemedText>
        <Button label="Cloud 알아보기" variant="secondary" onPress={() => router.push('/cloud')} />
      </View>
    );
  }

  const subscription = account?.subscription;
  const usage = account?.usage;

  const fetchOriginals = async () => {
    if (downloading) return;
    setDownloading({ done: 0, total: missingOriginals ?? 0 });
    try {
      const result = await saveOriginalsToLibrary(db, (done, total) => setDownloading({ done, total }));
      Alert.alert(
        '기기 사진첩에 저장했어요',
        result.failed > 0
          ? `${result.failed}장은 저장하지 못했어요. 다시 시도해 주세요.`
          : 'Cloud에만 있던 원본을 모두 기기 사진첩에 저장했어요.',
      );
    } catch (e) {
      Alert.alert(
        '사진을 저장하지 못했어요',
        e instanceof PhotoSaveError ? e.message : '잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setDownloading(null);
    }
  };

  const confirmSignOut = () =>
    Alert.alert('로그아웃할까요?', 'Local 기록으로 돌아가요. 이 계정의 기록은 다시 로그인하면 볼 수 있어요.', [
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
      'Cloud에 백업한 사진과 기록이 바로 삭제되고 되돌릴 수 없어요. Local 기록과, 이 기기 사진첩에 원본이 있는 기록은 기기에 남아요.' +
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
    <View style={styles.section}>
      <View style={[styles.statBox, { backgroundColor: theme.backgroundElement }]}>
        {!subscription ? (
          <ThemedText type="small">{problem ?? '상태를 확인하는 중이에요'}</ThemedText>
        ) : (
          <>
            <ThemedText type="small" style={subscription.status === 'grace' ? { color: theme.danger } : undefined}>
              {statusText(subscription.status, subscription.grace_until)}
            </ThemedText>
            {usage && subscription.status !== 'none' && (
              <ThemedText type="small" themeColor="textSecondary">
                {`${usage.object_count}개 파일 · ${formatBytes(usage.bytes_total)} / ${formatBytes(usage.max_bytes)}`}
              </ThemedText>
            )}
            {subscription.can_upload && (
              <ThemedText type="small" themeColor="textSecondary">
                {running
                  ? '동기화하는 중…'
                  : pendingUploads > 0
                    ? `올릴 사진 ${pendingUploads}장`
                    : lastSyncedAt
                      ? `${formatFullDate(lastSyncedAt)} ${formatTime(lastSyncedAt)}에 동기화했어요`
                      : ' '}
              </ThemedText>
            )}
            {problem && (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {problem}
              </ThemedText>
            )}
          </>
        )}
      </View>

      {subscription && !subscription.can_upload && (
        <Button
          label={subscription.status === 'grace' ? '다시 구독하기' : '구독하기'}
          onPress={() => router.push('/cloud')}
        />
      )}

      {subscription?.can_download && (missingOriginals ?? 0) > 0 && (
        <Button
          label={
            downloading
              ? `기기 사진첩에 저장하는 중 ${downloading.done}/${downloading.total}`
              : `Cloud에만 있는 원본을 기기 사진첩에 저장 (${missingOriginals}장)`
          }
          variant={subscription.status === 'grace' ? 'primary' : 'secondary'}
          disabled={downloading !== null}
          onPress={fetchOriginals}
        />
      )}

      {subscription?.can_upload && (
        <>
          <View style={styles.row}>
            <ThemedText type="small" style={styles.flex}>
              Wi-Fi에서만 사진 올리기
            </ThemedText>
            <Switch
              value={settings?.wifi_only_upload ?? true}
              onValueChange={(value) => {
                setSetting(db, 'wifi_only_upload', value).then(() => syncCloud(db));
              }}
            />
          </View>
          <Button
            label="기기 기록 올리기"
            variant="secondary"
            onPress={() => router.push({ pathname: '/cloud-import', params: { all: '1' } })}
          />
          <Button label="지금 동기화" variant="secondary" loading={running} onPress={() => syncCloud(db)} />
          {purchasesAvailable && (
            <Button
              label="구독 관리"
              variant="secondary"
              onPress={() => MANAGE_SUBSCRIPTION_URL && Linking.openURL(MANAGE_SUBSCRIPTION_URL)}
            />
          )}
        </>
      )}

      <Button label="로그아웃" variant="secondary" disabled={busy} onPress={confirmSignOut} />
      <Button label="계정 삭제" variant="danger" disabled={busy} onPress={confirmDelete} />
    </View>
  );
}

function statusText(status: string, graceUntil: string | null) {
  switch (status) {
    case 'active':
      return 'Cloud 백업을 사용하고 있어요.';
    case 'grace':
      return graceUntil
        ? `구독이 끝났어요. ${formatFullDate(graceUntil)}까지 백업한 사진을 내려받을 수 있고, 그 뒤 삭제돼요. 새 기록은 이 기기에만 저장돼요.`
        : '구독이 끝났어요. 30일 동안 백업한 사진을 내려받을 수 있어요. 새 기록은 이 기기에만 저장돼요.';
    case 'expired':
      return '구독이 끝나 Cloud 데이터가 삭제됐어요. 이 기기 사진첩에 원본이 있는 기록은 Local에 남겼어요.';
    default:
      return '로그인했어요. 구독하면 백업을 시작해요.';
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: Spacing.three },
  statBox: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
