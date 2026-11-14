import { showActionSheet } from '@/components/action-sheet';
import { blockUser, reportShared, unblockUser, type ReportReason } from '@/lib/cloud/shared';
import { getCurrentLanguage, showAlert } from '@/lib/i18n';

// 공유 앨범의 신고·차단. 신고는 운영자가 관리자 화면에서 보고 처리하고, 차단은 그 사람이 담은 사진을 나에게만 숨긴다.
// 둘 다 상대방에게 알리지 않는다. 사진 크게 보기와 앨범 관리의 구성원 목록에서 연다.

const REASONS: { reason: ReportReason; label: string }[] = [
  { reason: 'sexual', label: '성적인 콘텐츠' },
  { reason: 'violence', label: '폭력적이거나 위험한 콘텐츠' },
  { reason: 'harassment', label: '괴롭힘이나 혐오' },
  { reason: 'spam', label: '스팸' },
  { reason: 'other', label: '기타' },
];

export type ReportTarget = {
  albumId: string;
  userId: string;
  name: string;
  /** 사진을 신고할 때만 */
  itemId?: string;
};

/** 신고 사유를 고르고 보낸다. 보낸 뒤 차단도 할지 묻는다. */
export function chooseReportReason(target: ReportTarget, onBlocked?: () => void) {
  showActionSheet(
    '어떤 문제가 있나요?',
    '신고한 내용은 운영팀만 보고, 상대방에게는 알리지 않아요.',
    [
      ...REASONS.map(({ reason, label }) => ({ text: label, onPress: () => send(target, reason, onBlocked) })),
      { text: '취소', style: 'cancel' as const },
    ],
  );
}

async function send(target: ReportTarget, reason: ReportReason, onBlocked?: () => void) {
  try {
    await reportShared(target.albumId, target.itemId ? { itemId: target.itemId } : { userId: target.userId }, reason);
  } catch {
    showAlert('신고하지 못했어요', '잠시 후 다시 시도해 주세요.');
    return;
  }
  const { name } = target;
  showAlert(
    '신고했어요',
    {
      ko: `운영팀이 확인한 뒤 사진을 빼거나 구성원을 내보낼게요. 그동안 ${name}님의 사진을 보고 싶지 않다면 차단할 수 있어요.`,
      en: `Our team will review it and remove the photo or the member if needed. If you’d rather not see ${name}’s photos in the meantime, you can block them.`,
      ja: `運営チームが確認し、必要に応じて写真を外したりメンバーを退出させたりします。それまで${name}さんの写真を見たくない場合は、ブロックできます。`,
    }[getCurrentLanguage()],
    [
      { text: '닫기', style: 'cancel' },
      { text: '차단하기', style: 'destructive', onPress: () => block(target, onBlocked) },
    ],
  );
}

/** 차단하기 전에 무엇이 바뀌는지 알린다. */
export function confirmBlock(target: ReportTarget, onBlocked?: () => void) {
  const { name } = target;
  const language = getCurrentLanguage();
  showAlert(
    { ko: `${name}님을 차단할까요?`, en: `Block ${name}?`, ja: `${name}さんをブロックしますか？` }[language],
    {
      ko: `${name}님이 담은 사진이 모든 공유 앨범에서 나에게 보이지 않아요. 상대방에게는 알리지 않고, 다른 구성원에게는 그대로 보여요. 설정의 [차단한 사람]에서 언제든 풀 수 있어요.`,
      en: `Photos ${name} adds will be hidden from you in every shared album. They aren’t told, and other members still see them. You can unblock them anytime in Settings → Blocked people.`,
      ja: `${name}さんが追加した写真が、すべての共有アルバムであなたに表示されなくなります。相手には知らせず、ほかのメンバーには通常どおり表示されます。設定の［ブロックした人］からいつでも解除できます。`,
    }[language],
    [
      { text: '취소', style: 'cancel' },
      { text: '차단하기', style: 'destructive', onPress: () => block(target, onBlocked) },
    ],
  );
}

async function block(target: ReportTarget, onBlocked?: () => void) {
  try {
    await blockUser(target.albumId, target.userId);
    onBlocked?.();
  } catch {
    showAlert('차단하지 못했어요', '잠시 후 다시 시도해 주세요.');
  }
}

export function unblock(userId: string) {
  unblockUser(userId).catch(() => showAlert('차단을 풀지 못했어요', '잠시 후 다시 시도해 주세요.'));
}
