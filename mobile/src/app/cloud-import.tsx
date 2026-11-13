import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { BottomBar, Centered, GRID_GAP, useTileWidth } from '@/components/pick';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VideoBadge } from '@/components/video-badge';
import { Spacing } from '@/constants/theme';
import type { Moment } from '@/db/moments';
import { useTheme } from '@/hooks/use-theme';
import { syncCloud, useCloudState } from '@/lib/cloud/engine';
import { importMoments, listImportable } from '@/lib/cloud/imports';
import { showAlert, useTranslation } from '@/lib/i18n';

const COLUMNS = 3;
const PREVIEW_COUNT = 4;

// 이 기기의 Local 기록을 계정 Cloud에 백업(복사)한다. Local 기록은 그대로 남는다.
// 기록(메모·장소·날짜·사진 연결 정보)만 백업하고 사진 파일은 올리지 않는다. 사진은 구독하고 안전 앨범에 담아야 보관된다.
// - 로그인 직후(LocalImportPrompt): 아직 묻지 않은 기록 전체를 백업할지 한 번에 묻고, 백업한 뒤 구독 여부에 맞는 다음 단계를 권한다.
// - 설정 > 기기 기록 백업하기(all=1): 전에 [나중에]를 고른 기록까지 하나씩 골라 백업한다.
export default function CloudImportScreen() {
  const params = useLocalSearchParams<{ all?: string }>();
  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        {params.all === '1' ? <ChooseRecords /> : <BackupPrompt />}
      </SafeAreaView>
    </ThemedView>
  );
}

function close() {
  if (router.canGoBack()) router.back();
}

function BackupPrompt() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { language } = useTranslation();
  const { account } = useCloudState();
  const subscription = account?.subscription;
  const subscribed = subscription?.can_upload ?? false;
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    listImportable(db, { skipped: false })
      .then(setMoments)
      .catch(() => setMoments([]));
  }, [db]);

  const finish = async (backup: boolean) => {
    if (saving || !moments) return;
    setSaving(true);
    try {
      await importMoments(db, backup ? moments : [], backup ? [] : moments);
      if (!backup) return close();
      syncCloud(db);
      setDone(true);
    } catch {
      showAlert('백업하지 못했어요', '잠시 후 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  if (moments === null) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  if (moments.length === 0) {
    return (
      <Centered>
        <ThemedText style={styles.center}>백업할 기록이 없어요</ThemedText>
        <Button label="닫기" onPress={close} />
      </Centered>
    );
  }

  const count = recordCount(language, moments.length);
  if (done) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.doneHeading}>
          <Ionicons name="checkmark-circle" size={40} color={theme.accent} />
          <ThemedText style={[styles.title, styles.center]}>
            기록을 백업했어요
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            {subscribed ? '사진은 안전 앨범에 담으면 보관돼요.' : '사진은 아직 이 기기 사진첩에만 있어요.'}
          </ThemedText>
        </View>
        {subscribed ? (
          <View style={styles.actions}>
            <Button label="안전 앨범 만들기" onPress={() => router.replace('/cloud-albums/new')} />
            <Button label="닫기" variant="secondary" onPress={close} />
          </View>
        ) : (
          <>
            <SecureStoragePitch grace={subscription?.status === 'grace'} />
            <Button label="나중에 할게요" variant="secondary" onPress={close} />
          </>
        )}
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <ThemedText style={styles.title}>기기의 &apos;나의 순간들&apos;을 이 계정에 백업할까요?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {language === 'en'
              ? `You kept ${count} on this device before signing in.`
              : language === 'ja'
                ? `ログイン前にこのデバイスで${count}を残しました。`
                : `로그인하기 전에 이 기기에서 ${count}를 남겼어요.`}
          </ThemedText>
        </View>
        <Preview moments={moments} />
        <View style={styles.list}>
          <Included included text="메모·장소·날짜" detail="새 휴대폰에서도 같은 사진과 다시 이어져요." />
          {subscribed ? (
            <Included included text="사진 파일" detail="안전 앨범에 담은 사진을 보관해요." />
          ) : (
            <Included included={false} text="사진 파일" detail="사진은 이 기기 사진첩에만 남아요.">
              <PhotoBackupNote />
            </Included>
          )}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          [나중에]를 골라도 설정에서 다시 백업할 수 있어요.
        </ThemedText>
        <Pressable
          onPress={() => router.replace({ pathname: '/cloud-import', params: { all: '1' } })}
          accessibilityRole="button"
          hitSlop={8}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.link}>
            골라서 백업하기
          </ThemedText>
        </Pressable>
      </ScrollView>
      <BottomBar
        title={language === 'en' ? `Back up ${count}` : language === 'ja' ? `${count}をバックアップ` : `${count}를 백업해요`}
        secondary={{ label: '나중에', onPress: () => finish(false) }}
        action={{ label: '백업하기', onPress: () => finish(true), loading: saving }}
      />
    </>
  );
}

/** 백업할 기록의 사진 몇 장. 무엇을 백업하는지 알아보게 한다. */
function Preview({ moments }: { moments: Moment[] }) {
  const theme = useTheme();
  const rest = moments.length - PREVIEW_COUNT;
  return (
    <View style={styles.preview}>
      {moments.slice(0, PREVIEW_COUNT).map((moment) => (
        <Image
          key={moment.id}
          source={{ uri: moment.source_uri ?? undefined }}
          style={[styles.previewTile, { backgroundColor: theme.backgroundElement }]}
          contentFit="cover"
        />
      ))}
      {rest > 0 && (
        <View style={[styles.previewTile, styles.previewMore, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            +{rest}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

function Included({
  included,
  text,
  detail,
  children,
}: {
  included: boolean;
  text: string;
  detail: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.item}>
      <Ionicons
        name={included ? 'checkmark-circle' : 'close-circle-outline'}
        size={20}
        color={included ? theme.accent : theme.textSecondary}
      />
      <View style={styles.flex}>
        <ThemedText type="smallBold" themeColor={included ? undefined : 'textSecondary'}>
          {text}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
        {children}
      </View>
    </View>
  );
}

/** 무료 계정이 백업하기 전에: 사진까지 백업하려면 안전 보관을 구독하면 된다고 알리고 구독 안내로 보낸다. */
function PhotoBackupNote() {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.push('/cloud')}
      accessibilityRole="link"
      hitSlop={8}
      style={({ pressed }) => [styles.note, pressed && styles.pressed]}>
      <ThemedText type="smallBold" style={{ color: theme.accent }}>
        사진까지 백업하려면 안전 보관 구독 ›
      </ThemedText>
    </Pressable>
  );
}

/** 무료 계정에 기록을 백업한 뒤: 사진까지 지키려면 안전 보관을 쓰라고 권한다. */
function SecureStoragePitch({ grace }: { grace: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.pitch, { backgroundColor: theme.accent + '12' }]}>
      <View style={styles.pitchHeading}>
        <Ionicons name="shield-checkmark-outline" size={22} color={theme.accent} />
        <ThemedText type="smallBold">사진까지 지켜 두세요</ThemedText>
      </View>
      <Benefit text="사진첩에서 지워도 Keepsake에 남아요" />
      <Benefit text="휴대폰을 잃어버려도 사진이 돌아와요" />
      {grace && (
        <ThemedText type="small" themeColor="textSecondary">
          지금 다시 구독하면 보관하던 사진을 다시 올리지 않고 이어서 써요.
        </ThemedText>
      )}
      <Button label={grace ? '다시 구독하기' : '안전 보관 알아보기'} onPress={() => router.replace('/cloud')} />
      <Button label={t('comparePlans')} variant="secondary" onPress={() => router.push('/plans')} />
    </View>
  );
}

function Benefit({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.benefit}>
      <Ionicons name="checkmark" size={16} color={theme.accent} />
      <ThemedText type="small" style={styles.flex}>
        {text}
      </ThemedText>
    </View>
  );
}

function recordCount(language: string, count: number) {
  if (language === 'en') return count === 1 ? '1 memory' : `${count} memories`;
  if (language === 'ja') return `${count}件の思い出`;
  return `기록 ${count}개`;
}

/** 설정에서 연다: 전에 [나중에]를 고른 기록까지 하나씩 골라 백업한다. */
function ChooseRecords() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { language } = useTranslation();
  const { account } = useCloudState();
  // 사진 사용량은 무료 기록 백업 계정에서 항상 0일 수 있다. 서버가 알려 준 기록 존재 여부로만
  // 빈 계정을 판단해, 이미 내용이 있는 다른 계정에 Local 기록을 자동으로 섞지 않는다.
  const selectAll = account?.has_records === false;
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const tileWidth = useTileWidth(COLUMNS);

  useEffect(() => {
    listImportable(db, { skipped: true })
      .then((rows) => {
        setMoments(rows);
        if (selectAll) setSelectedIds(new Set(rows.map((row) => row.id)));
      })
      .catch(() => setMoments([]));
    // 고른 상태의 기본값은 화면을 열 때 한 번만 정한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  const selected = useMemo(
    () => (moments ?? []).filter((moment) => selectedIds.has(moment.id)),
    [moments, selectedIds],
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const finish = async (chosen: Moment[]) => {
    if (saving || !moments) return;
    setSaving(true);
    try {
      const chosenIds = new Set(chosen.map((moment) => moment.id));
      await importMoments(db, chosen, moments.filter((moment) => !chosenIds.has(moment.id)));
      if (chosen.length > 0) syncCloud(db);
      close();
    } catch {
      showAlert('백업하지 못했어요', '잠시 후 다시 시도해 주세요.');
      setSaving(false);
    }
  };

  if (moments === null) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  if (moments.length === 0) {
    return (
      <Centered>
        <ThemedText style={styles.center}>백업할 기록이 없어요</ThemedText>
        <Button label="닫기" onPress={close} />
      </Centered>
    );
  }
  return (
    <>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary">
          고른 기록의 메모·장소·날짜를 이 계정에 백업해요. 기기의 기록은 그대로 남아요.
        </ThemedText>
        {!account?.subscription.can_upload && <PhotoBackupNote />}
      </View>
      <FlashList
        data={moments}
        numColumns={COLUMNS}
        keyExtractor={(moment) => moment.id}
        extraData={selectedIds}
        contentContainerStyle={{ padding: GRID_GAP / 2, paddingBottom: Spacing.four }}
        renderItem={({ item }) => {
          const checked = selectedIds.has(item.id);
          return (
            <Pressable
              onPress={() => toggle(item.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              style={{ width: tileWidth, height: tileWidth, margin: GRID_GAP / 2 }}>
              <Image
                source={{ uri: item.source_uri ?? undefined }}
                style={styles.fill}
                contentFit="cover"
                recyclingKey={item.id}
              />
              {item.media_type === 'video' && <VideoBadge duration={item.duration} />}
              {checked && (
                <View style={[styles.fill, styles.checked]}>
                  <Ionicons name="checkmark-circle" size={24} color={theme.accent} />
                </View>
              )}
            </Pressable>
          );
        }}
      />
      <BottomBar
        title={{
          ko: `${moments.length}개 중 ${selected.length}개를 백업해요`,
          en: `Back up ${selected.length} of ${recordCount(language, moments.length)}`,
          ja: `${moments.length}件中${selected.length}件をバックアップします`,
        }[language]}
        secondary={{ label: '나중에', onPress: () => finish([]) }}
        action={{
          label: selected.length > 0 ? '백업하기' : '닫기',
          onPress: () => finish(selected),
          loading: saving,
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  fill: { ...StyleSheet.absoluteFillObject },
  header: { gap: Spacing.one, padding: Spacing.three },
  checked: { backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'flex-end', padding: Spacing.one },
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.five },
  heading: { gap: Spacing.two },
  doneHeading: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.three },
  preview: { flexDirection: 'row', gap: Spacing.two },
  previewTile: { width: 64, height: 64, borderRadius: Spacing.two },
  previewMore: { alignItems: 'center', justifyContent: 'center' },
  list: { gap: Spacing.three },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  link: { textDecorationLine: 'underline' },
  actions: { gap: Spacing.two },
  pitch: { gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  pitchHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  note: { alignSelf: 'flex-start', marginTop: Spacing.one },
  title: { fontSize: 22, lineHeight: 30, fontWeight: 700 },
  pressed: { opacity: 0.7 },
});
