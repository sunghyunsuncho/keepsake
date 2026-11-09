import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';

import { showActionSheet } from '@/components/action-sheet';
import { AllocationPicker } from '@/components/allocation-picker';
import { Button } from '@/components/button';
import { PhotoQualityPicker } from '@/components/photo-quality';
import { RelationPicker } from '@/components/relation-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ALBUM_TITLE_MAX, type PhotoQuality } from '@/db/albums';
import { useDbQuery } from '@/db/changes';
import { useTheme } from '@/hooks/use-theme';
import { useCloudState } from '@/lib/cloud/engine';
import { CloudError } from '@/lib/cloud/session';
import {
  createInvite,
  deleteSharedAlbum,
  DISPLAY_NAME_MAX,
  getSharedAlbum,
  inviteMessage,
  leavePreview,
  removeMember,
  revokeInvite,
  sharedAlbumOverview,
  transferOwner,
  updateMember,
  updateSharedAlbum,
  type LeavePreview,
  type Relation,
  type SharedAlbumDetail,
  type SharedMember,
} from '@/lib/cloud/shared';
import { formatFullDate } from '@/lib/dates';
import { formatBytes, formatSize } from '@/lib/storage';

// 공유 앨범 관리: 초대 코드(관리자), 구성원과 역할·소유자, 내 이름·나눠 준 용량, 앨범 이름·화질(관리자), 나가기·지우기.
// 권한은 서버가 다시 확인한다. 화면은 할 수 없는 동작을 감추기만 한다.
export default function SharedAlbumMembersScreen() {
  const { id, invite } = useLocalSearchParams<{ id: string; invite?: string }>();
  const { data: album, error } = useDbQuery(() => getSharedAlbum(id), [id]);
  const autoInvited = useRef(false);

  // 앨범 화면의 [초대하기]로 왔으면 코드부터 만든다.
  useEffect(() => {
    if (invite && album?.role === 'admin' && !album.invite && !autoInvited.current) {
      autoInvited.current = true;
      createInvite(id).catch(() => {});
    }
  }, [invite, album, id]);

  if (error && !album) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText themeColor="textSecondary">공유 앨범을 불러오지 못했어요.</ThemedText>
      </ThemedView>
    );
  }
  if (!album) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }
  const admin = album.role === 'admin';
  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {admin && <InviteSection album={album} />}
        <MembersSection album={album} />
        <MyNameSection album={album} />
        <MyAllocationSection album={album} />
        {admin && <AlbumSettingsSection album={album} />}
        <LeaveSection album={album} />
      </ScrollView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function failed(title: string, e: unknown) {
  const message =
    e instanceof CloudError && e.status === 409
      ? '앨범에는 관리자가 한 명 이상 있어야 해요. 다른 구성원을 먼저 관리자로 지정해 주세요.'
      : e instanceof CloudError && e.status === 403
        ? '이 작업은 관리자만 할 수 있어요.'
        : '잠시 후 다시 시도해 주세요.';
  Alert.alert(title, message);
}

function InviteSection({ album }: { album: SharedAlbumDetail }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      failed('초대 코드를 바꾸지 못했어요', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="초대">
      {album.invite ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.code} selectable>
            {album.invite.code}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            {formatFullDate(album.invite.expires_at)}까지 이 코드로 여러 사람이 참여할 수 있어요.
          </ThemedText>
          <Button
            label="초대 보내기"
            onPress={() => Share.share({ message: inviteMessage(album.title, album.invite!.code) })}
          />
          <View style={styles.inlineButtons}>
            <View style={styles.flex}>
              <Button label="새 코드" variant="secondary" loading={busy} onPress={() => run(() => createInvite(album.id))} />
            </View>
            <View style={styles.flex}>
              <Button label="초대 멈추기" variant="secondary" disabled={busy} onPress={() => run(() => revokeInvite(album.id))} />
            </View>
          </View>
        </View>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            초대 코드를 만들어 가족·친구에게 보내면, 받은 사람이 안전 사진첩의 [초대 코드로 참여]에서 들어와요. 코드는 7일 동안
            쓸 수 있어요.
          </ThemedText>
          <Button label="초대 코드 만들기" loading={busy} onPress={() => run(() => createInvite(album.id))} />
        </>
      )}
    </Section>
  );
}

/**
 * 구성원이 빠질 때(나가기·내보내기): 줄어드는 용량을 보여 주고, 그 사람이 담은 사진을 남길지 고른다.
 * 남기면 앨범 용량이 넘칠 수 있다. 넘친 앨범은 새 사진을 받지 않고, 관리자가 사진을 정리하거나
 * 구성원이 용량을 더 나눠 주면 다시 담는다.
 */
async function confirmRemoval(album: SharedAlbumDetail, member: SharedMember, onDone: () => void) {
  let preview: LeavePreview;
  try {
    preview = await leavePreview(album.id, member.user_id);
  } catch (e) {
    failed(member.is_me ? '나가지 못했어요' : '내보내지 못했어요', e);
    return;
  }
  const who = member.is_me ? '내가' : `${member.display_name}님이`;
  const shrink =
    preview.capacity_after < preview.capacity_before
      ? `앨범 용량이 ${formatSize(preview.capacity_before)}에서 ${formatSize(preview.capacity_after)}로 줄어요.`
      : '';
  const last = album.members.length === 1 ? ' 혼자 남은 앨범이라 앨범이 지워져요.' : '';
  const run = (photos: 'keep' | 'remove') =>
    removeMember(album.id, member.user_id, photos).then(onDone, (e) => failed(member.is_me ? '나가지 못했어요' : '내보내지 못했어요', e));
  const title = member.is_me ? '공유 앨범에서 나갈까요?' : `${member.display_name}님을 내보낼까요?`;
  if (preview.member_items === 0 || album.members.length === 1) {
    Alert.alert(title, `${shrink}${last}`.trim() || undefined, [
      { text: '취소', style: 'cancel' },
      { text: member.is_me ? '나가기' : '내보내기', style: 'destructive', onPress: () => run('remove') },
    ]);
    return;
  }
  const overflow = preview.over_if_kept
    ? `\n\n사진을 남기면 앨범이 ${formatBytes(preview.bytes_total - preview.capacity_after)} 넘쳐 새 사진을 담을 수 없게 돼요. 관리자가 사진을 정리하거나 다른 구성원이 용량을 더 나눠 주면 다시 담을 수 있어요.`
    : '';
  const removedOverflow = preview.over_if_removed ? ' 사진을 빼도 용량이 넘쳐요.' : '';
  Alert.alert(
    title,
    `${shrink} ${who} 담은 사진 ${preview.member_items}장(${formatBytes(preview.member_bytes)})을 어떻게 할까요?${overflow}${removedOverflow}`.trim(),
    [
      { text: '사진은 앨범에 남기기', onPress: () => run('keep') },
      { text: '사진도 앨범에서 빼기', style: 'destructive', onPress: () => run('remove') },
      { text: '취소', style: 'cancel' },
    ],
  );
}

function MembersSection({ album }: { album: SharedAlbumDetail }) {
  const theme = useTheme();
  const admin = album.role === 'admin';

  const manage = (member: SharedMember) => {
    const makeAdmin = member.role !== 'admin';
    // 선택지가 4개까지라 시트로 연다 (안드로이드 Alert는 버튼을 3개까지만 보여 준다).
    showActionSheet(member.display_name, undefined, [
      // 관리자는 여럿 둘 수 있다. 소유자는 관리자에서 해제할 수 없다.
      ...(!member.is_owner
        ? [
            {
              text: makeAdmin ? '관리자로 지정' : '관리자에서 해제',
              onPress: () =>
                updateMember(album.id, member.user_id, { role: makeAdmin ? 'admin' : 'member' }).catch((e) =>
                  failed('역할을 바꾸지 못했어요', e),
                ),
            },
          ]
        : []),
      ...(album.is_owner
        ? [
            {
              text: '소유자 넘기기',
              onPress: () =>
                Alert.alert(
                  `${member.display_name}님에게 소유자를 넘길까요?`,
                  '공유 앨범 개수는 소유자의 요금제에서 세요. 넘겨받는 사람은 안전 보관을 구독 중이고, 공유 앨범을 더 가질 수 있어야 해요. 나는 관리자로 남아요.',
                  [
                    { text: '취소', style: 'cancel' },
                    {
                      text: '넘기기',
                      onPress: () =>
                        transferOwner(album.id, member.user_id).catch((e) =>
                          Alert.alert(
                            '소유자를 넘기지 못했어요',
                            e instanceof CloudError && e.status === 409
                              ? `${member.display_name}님은 지금 공유 앨범을 더 가질 수 없어요 (구독하지 않았거나 요금제의 공유 앨범 수를 다 썼어요).`
                              : '잠시 후 다시 시도해 주세요.',
                          ),
                        ),
                    },
                  ],
                ),
            },
          ]
        : []),
      ...(!member.is_owner
        ? [{ text: '앨범에서 내보내기', style: 'destructive' as const, onPress: () => confirmRemoval(album, member, () => {}) }]
        : []),
      { text: '취소', style: 'cancel' },
    ]);
  };

  return (
    <Section title={`구성원 ${album.members.length}명`}>
      <View style={[styles.list, { borderColor: theme.border }]}>
        {album.members.map((member, index) => {
          const canManage = admin && !member.is_me;
          return (
            <Pressable
              key={member.user_id}
              disabled={!canManage}
              onPress={() => manage(member)}
              accessibilityRole={canManage ? 'button' : undefined}
              style={({ pressed }) => [
                styles.memberRow,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
                { opacity: pressed ? 0.7 : 1 },
              ]}>
              <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold">{member.display_name.slice(0, 1)}</ThemedText>
              </View>
              <View style={styles.flex}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {member.display_name}
                  {member.is_me ? ' (나)' : ''}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {member.allocated_bytes > 0
                    ? `${formatSize(member.allocated_bytes)} 나눔${member.allocation_counted ? '' : ' (구독이 끝나 세지 않아요)'}`
                    : '나눈 용량 없음'}{' '}
                  · {formatFullDate(member.joined_at)} 참여
                </ThemedText>
              </View>
              {(member.is_owner || member.role === 'admin') && (
                <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="small" style={{ color: theme.accent, fontWeight: 700 }}>
                    {member.is_owner ? '소유자' : '관리자'}
                  </ThemedText>
                </View>
              )}
              {canManage && <Ionicons name="ellipsis-horizontal" size={18} color={theme.textSecondary} />}
            </Pressable>
          );
        })}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        관리자는 여러 명 둘 수 있어요. 관리자는 모든 사진을 빼고 구성원과 앨범을 관리하고, 구성원은 자기가 담은 사진만 뺄 수
        있어요. 소유자는 관리자 중 한 명으로, 이 앨범을 자기 요금제의 공유 앨범 수로 세요.
      </ThemedText>
    </Section>
  );
}

/** 내가 이 앨범에 나눠 준 용량. 앨범이 이미 쓰는 만큼보다 작게 줄일 수는 없다. */
function MyAllocationSection({ album }: { album: SharedAlbumDetail }) {
  const me = album.members.find((member) => member.is_me);
  const subscribed = useCloudState().account?.subscription.can_upload ?? false;
  const { data: overview } = useDbQuery(() => sharedAlbumOverview(), []);
  const [value, setValue] = useState(me?.allocated_bytes ?? 0);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(me?.allocated_bytes ?? 0), [me?.allocated_bytes]);
  if (!me) return null;
  const available = (subscribed ? (overview?.free_bytes ?? 0) : 0) + me.allocated_bytes;

  const save = async () => {
    setSaving(true);
    try {
      await updateMember(album.id, me.user_id, { allocated_bytes: value });
    } catch (e) {
      Alert.alert(
        '나눠 준 용량을 바꾸지 못했어요',
        e instanceof CloudError && e.status === 409
          ? `앨범이 이미 ${formatBytes(album.storage.bytes_total)}를 쓰고 있어서 그만큼 줄일 수 없어요.`
          : e instanceof CloudError && e.status === 413
            ? '내 안전 보관에 남은 용량보다 크게 나눠 줄 수 없어요.'
            : '잠시 후 다시 시도해 주세요.',
      );
      setValue(me.allocated_bytes);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="이 앨범에 나눠 준 내 용량">
      <AllocationPicker value={value} onChange={setValue} available={available} allowZero={!album.is_owner} />
      <ThemedText type="small" themeColor="textSecondary">
        앨범 용량 {formatSize(album.storage.capacity_bytes)} 중 {formatBytes(album.storage.bytes_total)}를 쓰고 있어요.
        나눠 준 용량은 쓰지 않아도 내 안전 보관에서 미리 빠져요.
      </ThemedText>
      {value !== me.allocated_bytes && <Button label="저장" loading={saving} onPress={save} />}
    </Section>
  );
}

function MyNameSection({ album }: { album: SharedAlbumDetail }) {
  const theme = useTheme();
  const me = album.members.find((member) => member.is_me);
  const [name, setName] = useState(me?.display_name ?? '');
  const [saving, setSaving] = useState(false);
  const changed = name.trim() !== '' && name.trim() !== me?.display_name;
  if (!me) return null;

  const save = async () => {
    setSaving(true);
    try {
      await updateMember(album.id, me.user_id, { display_name: name.trim() });
    } catch (e) {
      failed('이름을 바꾸지 못했어요', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="이 앨범에서 보일 내 이름">
      <View style={styles.inlineButtons}>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={DISPLAY_NAME_MAX}
          style={[styles.input, styles.flex, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        {changed && <Button label="저장" loading={saving} onPress={save} />}
      </View>
    </Section>
  );
}

function AlbumSettingsSection({ album }: { album: SharedAlbumDetail }) {
  const theme = useTheme();
  const [title, setTitle] = useState(album.title);
  const [saving, setSaving] = useState(false);
  const changed = title.trim() !== '' && title.trim() !== album.title;

  const update = async (body: { title?: string; relation?: Relation; photo_quality?: PhotoQuality }) => {
    setSaving(true);
    try {
      await updateSharedAlbum(album.id, body);
    } catch (e) {
      failed('앨범을 바꾸지 못했어요', e);
    } finally {
      setSaving(false);
    }
  };

  const changeQuality = (quality: PhotoQuality) => {
    if (quality === album.photo_quality) return;
    Alert.alert(
      quality === 'display' ? '효율 보관으로 바꿀까요?' : '원본 그대로 보관할까요?',
      quality === 'display'
        ? '원본은 앨범 용량에서 빠지고, 다른 앨범에 필요 없는 원본은 담은 사람의 기기가 지워요. 지운 원본은 되돌릴 수 없어요. 사진마다 따로 화질을 고른 사진은 그대로예요.'
        : '구성원의 기기에 원본이 남아 있으면 원본도 올라가요. 앨범 용량을 더 써요. 사진마다 따로 화질을 고른 사진은 그대로예요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '바꾸기', onPress: () => update({ photo_quality: quality }) },
      ],
    );
  };

  return (
    <Section title="앨범 설정">
      <View style={styles.inlineButtons}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          maxLength={ALBUM_TITLE_MAX}
          style={[styles.input, styles.flex, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        {changed && <Button label="저장" loading={saving} onPress={() => update({ title: title.trim() })} />}
      </View>
      <RelationPicker value={album.relation} onChange={(relation) => update({ relation })} />
      <PhotoQualityPicker value={album.photo_quality} onChange={changeQuality} />
    </Section>
  );
}

function LeaveSection({ album }: { album: SharedAlbumDetail }) {
  const me = album.members.find((member) => member.is_me);

  const remove = () =>
    Alert.alert('공유 앨범을 지울까요?', '구성원 모두에게서 앨범이 사라져요. 각자의 기록과 다른 앨범의 사진은 그대로예요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '지우기',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSharedAlbum(album.id);
            router.dismissTo('/cloud-library');
          } catch (e) {
            failed('앨범을 지우지 못했어요', e);
          }
        },
      },
    ]);

  return (
    <View style={styles.section}>
      {me && (
        <Button
          label="앨범에서 나가기"
          variant="danger"
          onPress={() => confirmRemoval(album, me, () => router.dismissTo('/cloud-library'))}
        />
      )}
      {album.is_owner && album.members.length > 1 && (
        <ThemedText type="small" themeColor="textSecondary">
          소유자가 나가면 공유 앨범을 더 가질 수 있는 관리자나 구성원에게 소유자가 넘어가요.
        </ThemedText>
      )}
      {album.role === 'admin' && <Button label="앨범 지우기" variant="danger" onPress={remove} />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  content: { padding: Spacing.three, gap: Spacing.five, paddingBottom: Spacing.six },
  section: { gap: Spacing.two },
  card: { gap: Spacing.three, padding: Spacing.three, borderRadius: Spacing.three },
  code: { fontSize: 30, lineHeight: 38, letterSpacing: 6, fontWeight: 800, textAlign: 'center' },
  inlineButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { fontSize: 16, padding: Spacing.three, borderRadius: Spacing.three },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Spacing.three, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 10 },
});
