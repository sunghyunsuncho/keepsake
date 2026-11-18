import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AllocationPicker } from '@/components/allocation-picker';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CloudError, useCloudSession } from '@/lib/cloud/session';
import { useDbQuery } from '@/db/changes';
import { useCloudState } from '@/lib/cloud/engine';
import { registerPushToken } from '@/lib/cloud/push';
import { localizeText, showAlert, useTranslation } from '@/lib/i18n';
import {
  DISPLAY_NAME_MAX,
  joinSharedAlbum,
  normalizeCode,
  previewInvite,
  RELATIONS,
  sharedAlbumOverview,
} from '@/lib/cloud/shared';

type Preview = Awaited<ReturnType<typeof previewInvite>>;

// 초대 코드로 공유 앨범에 참여한다. 초대 링크(https://keepsake.atelierlabs.co.kr/join?code=…, app/+native-intent.tsx)로 열면 코드가 채워져 있다.
// 보는 것은 로그인만 하면 되고, 사진을 담으려면 구독이 필요하다.
export default function JoinSharedAlbumScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string }>();
  const theme = useTheme();
  const { language } = useTranslation();
  const session = useCloudSession();
  const [code, setCode] = useState(params.code ? normalizeCode(params.code) : '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [allocation, setAllocation] = useState<number | null>(null);
  const subscribed = useCloudState().account?.subscription.can_upload ?? false;
  const { data: overview } = useDbQuery(async () => (session ? sharedAlbumOverview() : null), [!!session]);
  const available = subscribed ? (overview?.free_bytes ?? 0) : 0;
  useEffect(() => {
    if (overview && allocation === null) {
      setAllocation(subscribed ? Math.min(overview.suggested_allocation, available) : 0);
    }
  }, [overview, allocation, subscribed, available]);

  const check = async (value = code) => {
    if (normalizeCode(value).length < 4) return;
    setChecking(true);
    try {
      const found = await previewInvite(value);
      if (found.already_member) {
        router.replace({ pathname: '/shared-albums/[id]', params: { id: found.album_id } });
        return;
      }
      setPreview(found);
    } catch (e) {
      showAlert(
        '초대를 찾지 못했어요',
        e instanceof CloudError && e.status === 404
          ? '코드가 틀렸거나 기한(7일)이 지났어요. 초대한 사람에게 새 코드를 받아 주세요.'
          : '인터넷 연결을 확인해 주세요.',
      );
    } finally {
      setChecking(false);
    }
  };

  // 링크로 들어왔으면 바로 확인한다.
  useEffect(() => {
    if (params.code && session) check(params.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code, !!session]);

  const join = async () => {
    if (!preview || !name.trim()) return;
    setJoining(true);
    try {
      const album = await joinSharedAlbum(code, name.trim(), allocation ?? 0);
      // 내 사진에 구성원이 댓글을 남기면 알린다.
      registerPushToken({ ask: true });
      router.replace({ pathname: '/shared-albums/[id]', params: { id: album.id } });
    } catch (e) {
      showAlert(
        '참여하지 못했어요',
        e instanceof CloudError && e.status === 409
          ? '이 앨범은 구성원이 가득 찼어요.'
          : e instanceof CloudError && e.status === 413
            ? '내 안전 보관에 남은 용량보다 크게 나눠 줄 수 없어요.'
            : '잠시 후 다시 시도해 주세요.',
      );
      setJoining(false);
    }
  };

  if (!session) {
    return (
      <ThemedView style={styles.centered}>
        <Ionicons name="person-circle-outline" size={44} color={theme.textSecondary} />
        <ThemedText themeColor="textSecondary" style={styles.center}>
          공유 앨범에 참여하려면 먼저 로그인해 주세요.{'\n'}로그인은 무료예요.
        </ThemedText>
        <Button label="로그인하러 가기" onPress={() => router.replace('/cloud')} />
      </ThemedView>
    );
  }

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];
  return (
    <ThemedView style={styles.flex}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Spacing.six + insets.bottom }]} keyboardShouldPersistTaps="handled">
          {!preview ? (
            <View style={styles.section}>
              <ThemedText type="smallBold">초대 코드</ThemedText>
              <TextInput
                value={code}
                onChangeText={(text) => setCode(normalizeCode(text))}
                placeholder={localizeText(language, '8자리 코드')}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[inputStyle, styles.code]}
                maxLength={16}
                onSubmitEditing={() => check()}
                returnKeyType="next"
              />
              <ThemedText type="small" themeColor="textSecondary">
                공유 앨범 관리자에게 받은 코드를 입력해 주세요.
              </ThemedText>
              <Button label="확인" disabled={code.length < 4} loading={checking} onPress={() => check()} />
            </View>
          ) : (
            <>
              <View style={[styles.previewCard, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name={RELATIONS[preview.relation].icon} size={28} color={theme.accent} />
                <ThemedText type="subtitle" style={styles.center} localize={false}>
                  {preview.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.center} localize={false}>
                  {
                    {
                      ko: `${preview.invited_by ? `${preview.invited_by}님이 초대했어요 · ` : ''}${preview.member_count}명이 함께하고 있어요`,
                      en: `${preview.invited_by ? `Invited by ${preview.invited_by} · ` : ''}${preview.member_count} ${preview.member_count === 1 ? 'member' : 'members'}`,
                      ja: `${preview.invited_by ? `${preview.invited_by}さんからの招待 · ` : ''}${preview.member_count}人が参加中`,
                    }[language]
                  }
                </ThemedText>
              </View>
              <View style={styles.section}>
                <ThemedText type="smallBold">이 앨범에서 보일 내 이름</ThemedText>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder={localizeText(language, '예) 아빠, 서준')}
                  placeholderTextColor={theme.textSecondary}
                  style={inputStyle}
                  maxLength={DISPLAY_NAME_MAX}
                  autoFocus
                />
                <ThemedText type="small" themeColor="textSecondary">
                  내가 담은 사진에 이 이름이 표시돼요. 이름은 앨범마다 따로 정해요.
                </ThemedText>
              </View>
              <View style={styles.section}>
                <ThemedText type="smallBold">이 앨범에 나눠 줄 내 용량</ThemedText>
                {allocation !== null && (
                  <AllocationPicker value={allocation} onChange={setAllocation} available={available} allowZero />
                )}
                <ThemedText type="small" themeColor="textSecondary">
                  {subscribed
                    ? '앨범 용량은 구성원이 나눠 준 용량을 합한 만큼이에요. 나눠 주면 앨범에 더 많이 담을 수 있고, 그만큼 내 안전 보관에서 미리 빠져요. 나중에 바꿀 수 있어요.'
                    : '안전 보관을 구독하지 않아도 다른 구성원이 나눠 준 용량으로 함께 보고 담을 수 있어요. 구독하면 내 용량도 나눠 줄 수 있어요.'}
                </ThemedText>
              </View>
              <Button label="참여하기" disabled={!name.trim()} loading={joining} onPress={join} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  center: { textAlign: 'center' },
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.six },
  section: { gap: Spacing.two },
  input: { fontSize: 16, padding: Spacing.three, borderRadius: Spacing.three },
  code: { fontSize: 22, letterSpacing: 4, textAlign: 'center', fontWeight: 700 },
  previewCard: { alignItems: 'center', gap: Spacing.two, padding: Spacing.four, borderRadius: Spacing.three },
});
