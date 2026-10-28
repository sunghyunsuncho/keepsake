import Ionicons from '@expo/vector-icons/Ionicons';
import * as Application from 'expo-application';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDbQuery } from '@/db/changes';
import { libraryStats } from '@/db/moments';
import { getSettings, RECOMMENDED_COUNT_RANGE, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import {
  ArchiveError,
  cleanupExport,
  exportArchive,
  importArchive,
  type ImportResult,
  type Progress,
} from '@/lib/archive';
import { daysSince, formatFullDate, formatTime } from '@/lib/dates';
import { formatBytes, libraryDir } from '@/lib/storage';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: settings } = useDbQuery(() => getSettings(db), [db]);
  const { data: stats } = useDbQuery(
    async () => ({ ...(await libraryStats(db)), bytes: libraryDir.exists ? (libraryDir.size ?? 0) : 0 }),
    [db],
  );
  const [progress, setProgress] = useState<Progress | null>(null);

  // 지난 실행에서 남은 내보내기 파일을 지운다 (Android는 공유 직후에 지우지 않으므로).
  useEffect(() => cleanupExport(), []);

  const count = settings?.daily_recommended_count ?? 3;
  const changeCount = (delta: number) => {
    const next = Math.min(
      RECOMMENDED_COUNT_RANGE.max,
      Math.max(RECOMMENDED_COUNT_RANGE.min, count + delta),
    );
    if (next !== count) setSetting(db, 'daily_recommended_count', next);
  };

  // iOS는 닫히는 중인 모달 위에 공유 시트를 띄우려다 실패하고, 이때 shareAsync는 끝나지 않는다.
  // 그래서 모달이 완전히 닫힌 뒤(onDismiss)에 다음 화면을 띄운다. onDismiss는 iOS에만 있다.
  const onProgressDismissed = useRef<(() => void) | null>(null);
  const closeProgress = () =>
    new Promise<void>((resolve) => {
      // 모달이 이미 닫혀 있으면 onDismiss가 오지 않으므로 시간 제한을 둔다.
      const timeout = setTimeout(done, Platform.OS === 'ios' ? MODAL_DISMISS_TIMEOUT_MS : 0);
      function done() {
        clearTimeout(timeout);
        onProgressDismissed.current = null;
        resolve();
      }
      onProgressDismissed.current = done;
      setProgress(null);
    });

  // 진행 모달이 뜨기 전에 한 번 더 누르면 두 작업이 같은 임시 폴더를 지우며 겹친다.
  const busy = useRef(false);

  const runExport = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await exportArchive(db, setProgress);
      await closeProgress();
      if (!(await Sharing.isAvailableAsync())) {
        throw new ArchiveError('이 기기에서는 파일을 공유할 수 없어요.');
      }
      // 공유 시트에서 '파일에 저장', 클라우드 드라이브, AirDrop 등으로 보관한다.
      await Sharing.shareAsync(result.file.uri, {
        mimeType: 'application/zip',
        UTI: 'public.zip-archive',
        dialogTitle: `Keepsake 내보내기 (${result.momentCount}장, ${formatBytes(result.bytes)})`,
      });
    } catch (e) {
      await closeProgress();
      Alert.alert('내보내지 못했어요', errorMessage(e));
    } finally {
      // iOS는 공유 시트가 닫힐 때 저장이 끝나 있다. Android는 받는 앱이 파일을 나중에 읽을 수 있어
      // 바로 지우지 않고, 다음 내보내기나 다음 실행 때 지운다.
      if (Platform.OS === 'ios') cleanupExport();
      busy.current = false;
    }
  };

  const runImport = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await importFromPicker();
    } finally {
      busy.current = false;
    }
  };

  const importFromPicker = async () => {
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed'],
        copyToCacheDirectory: true,
      });
    } catch {
      Alert.alert('파일을 열 수 없어요', '잠시 후 다시 시도해 주세요.');
      return;
    }
    if (picked.canceled) return;
    const asset = picked.assets[0];
    try {
      const result = await importArchive(db, asset.uri, setProgress);
      await closeProgress();
      Alert.alert('가져왔어요', importSummary(result));
    } catch (e) {
      await closeProgress();
      Alert.alert('가져오지 못했어요', errorMessage(e));
    } finally {
      const copy = new File(asset.uri);
      if (copy.exists) copy.delete();
    }
  };

  const confirmImport = () => {
    Alert.alert(
      'ZIP에서 가져오기',
      'Keepsake에서 내보낸 ZIP 파일을 고르세요. 지금 기기에 있는 기록은 지워지지 않고, 같은 기록은 더 최근에 고친 쪽으로 합쳐져요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '파일 고르기', onPress: runImport },
      ],
    );
  };

  const lastExported = settings?.last_exported_at;

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="하루 권장 사진 수">
          <ThemedText type="small" themeColor="textSecondary">
            필름 한 롤처럼, 하루에 남길 사진 수의 기준이에요. 넘겨도 괜찮아요.
          </ThemedText>
          <View style={styles.stepper}>
            <StepButton icon="remove" label="줄이기" disabled={count <= RECOMMENDED_COUNT_RANGE.min} onPress={() => changeCount(-1)} />
            <ThemedText style={styles.count} accessibilityLabel={`${count}장`}>
              {count}장
            </ThemedText>
            <StepButton icon="add" label="늘리기" disabled={count >= RECOMMENDED_COUNT_RANGE.max} onPress={() => changeCount(1)} />
          </View>
        </Section>

        <Section title="고르기">
          <ThemedText type="small" themeColor="textSecondary">
            {settings?.review_cursor
              ? `${formatFullDate(settings.review_cursor)} ${formatTime(settings.review_cursor)}에 찍은 사진까지 살펴봤어요. 고르기 화면은 그 뒤의 사진부터 보여줘요.`
              : '아직 어디서부터 고를지 정하지 않았어요.'}
          </ThemedText>
          <Button
            label="시작 지점 다시 정하기"
            variant="secondary"
            disabled={!settings?.review_cursor}
            onPress={() =>
              Alert.alert(
                '어디서부터 고를지 다시 정할까요?',
                '이미 남긴 사진은 그대로 있어요. 고르기 화면에서 시작할 날짜를 다시 고르게 돼요.',
                [
                  { text: '취소', style: 'cancel' },
                  { text: '다시 정하기', onPress: () => setSetting(db, 'review_cursor', null) },
                ],
              )
            }
          />
        </Section>

        <Section title="백업">
          <ThemedText type="small" themeColor="textSecondary">
            기록은 이 기기에만 저장돼요. 기기를 잃어버리거나 바꿀 때를 대비해 ZIP 파일로 내보내 두세요.
            사진 원본과 메모가 모두 들어 있어요.
          </ThemedText>
          <View style={[styles.statBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small">
              {stats ? `${stats.count}장 · ${stats.days}일의 기록 · ${formatBytes(stats.bytes)}` : ' '}
            </ThemedText>
            <ThemedText
              type="small"
              style={{ color: lastExported && daysSince(lastExported) < 30 ? theme.textSecondary : theme.danger }}>
              {lastExported
                ? `마지막 내보내기: ${formatFullDate(lastExported)}${daysSince(lastExported) > 0 ? ` (${daysSince(lastExported)}일 전)` : ''}`
                : '아직 내보낸 적이 없어요'}
            </ThemedText>
          </View>
          <Button label="ZIP으로 내보내기" disabled={!stats?.count} onPress={runExport} />
          <Button label="ZIP에서 가져오기" variant="secondary" onPress={confirmImport} />
        </Section>

        <ThemedText type="small" themeColor="textSecondary" style={styles.version}>
          Keepsake {Application.nativeApplicationVersion} ({Application.nativeBuildVersion})
        </ThemedText>
      </ScrollView>

      <ProgressModal progress={progress} onDismiss={() => onProgressDismissed.current?.()} />
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {children}
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={[styles.stepButton, { backgroundColor: theme.backgroundElement, opacity: disabled ? 0.3 : 1 }]}>
      <Ionicons name={icon} size={22} color={theme.text} />
    </Pressable>
  );
}

const MODAL_DISMISS_TIMEOUT_MS = 1500;

const PHASE_LABEL: Record<Progress['phase'], string> = {
  preparing: '준비하는 중',
  compressing: '사진을 묶는 중',
  extracting: '파일을 푸는 중',
  merging: '기록을 합치는 중',
};

function ProgressModal({
  progress,
  onDismiss,
}: {
  progress: Progress | null;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={progress !== null} transparent animationType="fade" onDismiss={onDismiss}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: theme.background }]}>
          <ThemedText type="smallBold">{progress ? PHASE_LABEL[progress.phase] : ''}</ThemedText>
          <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
            <View
              style={[
                styles.bar,
                { backgroundColor: theme.accent, width: `${Math.round((progress?.ratio ?? 0) * 100)}%` },
              ]}
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            사진이 많으면 몇 분 걸릴 수 있어요. 앱을 닫지 말아 주세요.
          </ThemedText>
        </View>
      </View>
    </Modal>
  );
}

function importSummary(result: ImportResult) {
  const parts = [
    result.added && `새 기록 ${result.added}장`,
    result.updated && `갱신 ${result.updated}장`,
    result.removed && `삭제 반영 ${result.removed}장`,
    result.unchanged && `이미 있음 ${result.unchanged}장`,
  ].filter(Boolean);
  const summary = parts.length > 0 ? parts.join(', ') : '가져올 기록이 없었어요';
  return result.missingPhotos > 0
    ? `${summary}\n사진 파일이 없는 ${result.missingPhotos}장은 건너뛰었어요.`
    : summary;
}

function errorMessage(e: unknown) {
  return e instanceof ArchiveError ? e.message : '잠시 후 다시 시도해 주세요.';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.five, paddingBottom: Spacing.six },
  section: { gap: Spacing.three },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { fontSize: 22, lineHeight: 30, fontWeight: 700, minWidth: 48, textAlign: 'center' },
  statBox: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  version: { textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modalCard: { width: '100%', borderRadius: Spacing.four, padding: Spacing.four, gap: Spacing.three },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: '100%' },
});
