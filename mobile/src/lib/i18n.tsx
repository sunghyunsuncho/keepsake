import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { type AppLanguage, getSettings, setSetting } from '@/db/settings';
import { setDateLanguage } from '@/lib/dates';
import { rescheduleReminders } from '@/lib/reminders';

type TranslationKey = keyof typeof copy.ko;

const copy = {
  ko: {
    language: '언어',
    chooseLanguage: '언어 선택',
    cancel: '취소',
    deviceLibrary: '기기 사진첩',
    secureLibrary: '안전 사진첩',
    choosePhotos: '사진 고르기',
    settings: '설정',
    account: '계정',
    helpAndInfo: '도움말 및 정보',
    terms: '이용약관',
    privacy: '개인정보 처리방침',
    startPoint: '고르기 초기화',
    notSet: '정하지 않음',
    savedRecords: '남긴 기록',
    resetStartTitle: '고르기 시작 시점을 초기화할까요?',
    resetStartMessage: '남긴 사진은 그대로예요. 다음에 고르기 탭을 열면 다시 정해요.',
    reset: '초기화',
    signedInAccount: '로그인한 계정',
    notSignedIn: '로그인하지 않았어요',
    localOnly: '기록이 이 기기에만 있어요',
    signInAndBackup: '로그인하고 기록 백업하기',
    subscribeAgain: '다시 구독하기',
    startSecureStorage: '사진 안전 보관 시작하기',
    loadingAccount: '계정 정보를 불러오는 중이에요',
    secureStorageActive: '안전 보관 · 사진까지 보관하고 있어요',
    subscriptionEnded: '구독 종료 · 30일 동안 사진 내려받기',
    freeBackup: '무료 · 기록을 백업하고 있어요',
    version: '버전',
    contact: '문의',
    openSource: '오픈소스 라이선스',
    close: '닫기',
    reminder: '고르기 알림', reminderFrequency: '알림 빈도', reminderTime: '알림 시각', allowNotifications: '알림 허용하기',
  },
  en: {
    language: 'Language', chooseLanguage: 'Choose language', cancel: 'Cancel', deviceLibrary: 'Device Library', secureLibrary: 'Secure Library', choosePhotos: 'Choose Photos', settings: 'Settings', account: 'Account', helpAndInfo: 'Help & Information', terms: 'Terms of Service', privacy: 'Privacy Policy', startPoint: 'Reset review point', notSet: 'Not set', savedRecords: 'Saved memories', resetStartTitle: 'Reset your review starting point?', resetStartMessage: 'Your saved photos will stay. You can choose a new starting point the next time you open Choose Photos.', reset: 'Reset', signedInAccount: 'Signed-in account', notSignedIn: 'Not signed in', localOnly: 'Your memories are only on this device', signInAndBackup: 'Sign in to back up your memories', subscribeAgain: 'Subscribe again', startSecureStorage: 'Start secure photo storage', loadingAccount: 'Loading account information', secureStorageActive: 'Secure storage · Your photos are protected', subscriptionEnded: 'Subscription ended · Download photos for 30 days', freeBackup: 'Free · Your memories are backed up', version: 'Version', contact: 'Contact', openSource: 'Open-source licenses', close: 'Close', reminder: 'Photo review reminders', reminderFrequency: 'Reminder frequency', reminderTime: 'Reminder time', allowNotifications: 'Allow notifications',
  },
  ja: {
    language: '言語', chooseLanguage: '言語を選択', cancel: 'キャンセル', deviceLibrary: 'デバイスのライブラリ', secureLibrary: 'セキュアライブラリ', choosePhotos: '写真を選ぶ', settings: '設定', account: 'アカウント', helpAndInfo: 'ヘルプと情報', terms: '利用規約', privacy: 'プライバシーポリシー', startPoint: '見直し位置をリセット', notSet: '未設定', savedRecords: '残した思い出', resetStartTitle: '開始位置をリセットしますか？', resetStartMessage: '残した写真はそのままです。次に「写真を選ぶ」を開いたときに、あらためて決められます。', reset: 'リセット', signedInAccount: 'ログイン中のアカウント', notSignedIn: 'ログインしていません', localOnly: '思い出はこのデバイスにのみ保存されています', signInAndBackup: 'ログインして思い出をバックアップ', subscribeAgain: '再登録する', startSecureStorage: '写真の安全保管を始める', loadingAccount: 'アカウント情報を読み込んでいます', secureStorageActive: '安全保管 · 写真も保管されています', subscriptionEnded: 'サブスクリプション終了 · 30日間写真をダウンロードできます', freeBackup: '無料 · 思い出をバックアップしています', version: 'バージョン', contact: 'お問い合わせ', openSource: 'オープンソースライセンス', close: '閉じる', reminder: '写真を選ぶリマインダー', reminderFrequency: 'リマインダーの頻度', reminderTime: '通知時刻', allowNotifications: '通知を許可する',
  },
} as const;

export const LANGUAGE_LABELS: Record<AppLanguage, string> = { ko: '한국어', en: 'English', ja: '日本語' };

/**
 * 기존 화면은 문구를 JSX에 직접 둔 곳이 많다. ThemedText가 이 표를 통과시키므로,
 * 화면별 코드를 모두 건드리지 않아도 본문·빈 화면·버튼 문구가 같은 언어로 표시된다.
 * 새 문구는 위의 key 기반 copy에 추가하는 것을 원칙으로 한다.
 */
const legacyText: Record<string, { en: string; ja: string }> = {
  '취소': { en: 'Cancel', ja: 'キャンセル' }, '완료': { en: 'Done', ja: '完了' }, '확인': { en: 'OK', ja: '確認' }, '닫기': { en: 'Close', ja: '閉じる' },
  '지난 사진': { en: 'Past Photos', ja: '過去の写真' }, '최근 사진부터 시간 순서대로': { en: 'Starting with the most recent photos', ja: '新しい写真から時系列順に表示します' }, '아래로 내려가며 계속 볼 수 있어요.': { en: 'Scroll down to keep exploring.', ja: '下にスクロールして続けて見られます。' }, '사진 보관함에 사진이 없어요.': { en: 'There are no photos in your library.', ja: '写真ライブラリに写真がありません。' },
  '안전 보관 사진첩': { en: 'Secure Photo Library', ja: 'セキュア写真ライブラリ' }, '아직 안전 보관 사진첩이 없어요': { en: 'You do not have a secure photo library yet.', ja: 'セキュア写真ライブラリはまだありません。' }, '인터넷에 연결되면 안전 사진첩을 볼 수 있어요': { en: 'Connect to the internet to view your secure library.', ja: 'インターネットに接続するとセキュアライブラリを見られます。' },
  '남긴 사진은 지키고, 휴대폰은 가볍게': { en: 'Keep your favorite photos, free up your phone.', ja: '大切な写真を守り、スマホを軽く。' }, '안전 보관을 사용하고 있어요.': { en: 'You are using secure storage.', ja: '安全保管を利用しています。' }, '로그인': { en: 'Sign in', ja: 'ログイン' },
  '정리할 사진이 없어요': { en: 'There are no photos to clean up.', ja: '整理する写真はありません。' }, '지도에 표시할 사진이 없어요': { en: 'There are no photos to show on the map.', ja: '地図に表示する写真がありません。' }, '지도를 불러오지 못했어요': { en: 'Unable to load the map.', ja: '地図を読み込めませんでした。' },
  '올릴 기록이 없어요': { en: 'There are no memories to upload.', ja: 'アップロードする思い出はありません。' }, '이 기기의 기록을 이 계정에 백업할까요?': { en: 'Back up this device’s memories to this account?', ja: 'このデバイスの思い出をこのアカウントにバックアップしますか？' },
  '아직 받은 알림이 없어요': { en: 'No notifications yet.', ja: '通知はまだありません。' }, '이 기록을 찾을 수 없어요.': { en: 'This memory could not be found.', ja: 'この思い出は見つかりません。' }, '이 앨범을 찾을 수 없어요.': { en: 'This album could not be found.', ja: 'このアルバムは見つかりません。' }, '공유 앨범을 불러오지 못했어요.': { en: 'Unable to load the shared album.', ja: '共有アルバムを読み込めませんでした。' },
  '놓친 사진': { en: 'Missed photos', ja: '見逃した写真' }, '새로 찍은 사진을 모두 살펴봤어요': { en: 'You have reviewed all your new photos.', ja: '新しく撮った写真をすべて見ました。' }, '지난 사진 다시 보기': { en: 'Revisit past photos', ja: '過去の写真をもう一度見る' }, '정리 후보': { en: 'Cleanup candidates', ja: '整理候補' },
  '함께 담을 사람을 초대해 보세요': { en: 'Invite people to add memories together.', ja: '一緒に思い出を追加する人を招待しましょう。' }, '초대 코드': { en: 'Invite code', ja: '招待コード' }, '이 앨범에서 보일 내 이름': { en: 'Your name in this album', ja: 'このアルバムで表示する名前' }, '이 앨범에 나눠 줄 내 용량': { en: 'Storage to share with this album', ja: 'このアルバムに割り当てる容量' },
  '누가 보는 앨범인가요?': { en: 'Who is this album for?', ja: '誰のためのアルバムですか？' }, '누구와 함께 쓰나요?': { en: 'Who will you share it with?', ja: '誰と一緒に使いますか？' }, '앨범 이름': { en: 'Album name', ja: 'アルバム名' }, '연결할 기기 앨범': { en: 'Device album to link', ja: '連携するデバイスのアルバム' }, '보관 화질': { en: 'Storage quality', ja: '保存画質' }, '어떻게 만들까요?': { en: 'How would you like to create it?', ja: 'どのように作成しますか？' },
  '앨범 표지': { en: 'Album cover', ja: 'アルバムの表紙' }, '최신 사진으로 자동 설정': { en: 'Use the latest photo automatically', ja: '最新の写真を自動で使う' }, '앨범에 가장 최근에 담긴 사진을 표지로 써요.': { en: 'Use the most recently added photo as the cover.', ja: 'アルバムに最後に追加した写真を表紙にします。' }, '기본 디자인': { en: 'Default designs', ja: '基本デザイン' }, '앨범 사진에서 고르기': { en: 'Choose from album photos', ja: 'アルバムの写真から選ぶ' },
  '앨범에 넣기': { en: 'Add to album', ja: 'アルバムに追加' }, '새 앨범 만들기': { en: 'Create new album', ja: '新しいアルバムを作成' }, '눌러서 그때의 기억을 적어 보세요': { en: 'Tap to write down this memory.', ja: 'タップしてそのときの思い出を書いてみましょう。' },
  '돌아가기': { en: 'Go back', ja: '戻る' }, '구매 복원': { en: 'Restore purchases', ja: '購入を復元' }, '로그인만 하기 · 이미 구독 중이에요': { en: 'Sign in only · I already subscribe', ja: 'ログインのみ · すでに購読しています' }, '새 사진에서 고르기': { en: 'Choose from new photos', ja: '新しい写真から選ぶ' }, '기록에서 빼기': { en: 'Remove from memories', ja: '思い出から削除' }, '사진 고르러 가기': { en: 'Choose photos', ja: '写真を選ぶ' }, '앨범에서 빼기': { en: 'Remove from album', ja: 'アルバムから削除' }, '새 코드': { en: 'New code', ja: '新しいコード' }, '초대 멈추기': { en: 'Stop invitations', ja: '招待を停止' }, '초대 코드 만들기': { en: 'Create invite code', ja: '招待コードを作成' }, '저장': { en: 'Save', ja: '保存' }, '앨범 지우기': { en: 'Delete album', ja: 'アルバムを削除' }, '사진 담기': { en: 'Add photos', ja: '写真を追加' }, '내 용량을 더 나눠 주기': { en: 'Share more storage', ja: '容量をさらに共有' }, '구성원 초대하기': { en: 'Invite members', ja: 'メンバーを招待' }, '로그인하러 가기': { en: 'Go to sign in', ja: 'ログインへ' }, '참여하기': { en: 'Join', ja: '参加する' }, '기기 사진첩으로 가기': { en: 'Go to device library', ja: 'デバイスのライブラリへ' }, '사진을 찾는 중…': { en: 'Finding photos…', ja: '写真を探しています…' }, '처음부터 조금씩 고르기': { en: 'Choose a little at a time from the beginning', ja: '最初から少しずつ選ぶ' }, '오늘 찍은 사진부터': { en: 'Start with today’s photos', ja: '今日撮った写真から' }, '최근 1주': { en: 'Past week', ja: '過去1週間' }, '최근 한 달': { en: 'Past month', ja: '過去1か月' }, '날짜 고르기': { en: 'Choose a date', ja: '日付を選ぶ' },
  '어디서부터 고를까요?': { en: 'Where would you like to start?', ja: 'どこから選びますか？' }, '처음부터 시작해도 괜찮아요. 중간에 멈추면 다음번에 그 뒤부터 이어서 보여드려요.': { en: 'It is fine to start from the beginning. If you stop, we will pick up where you left off next time.', ja: '最初から始めても大丈夫です。途中で止めても、次回は続きから見られます。' }, '필름 한 롤을 다 찍고 나서 남길 사진을 고르듯,': { en: 'Like choosing the keepers after finishing a roll of film,', ja: 'フィルムを撮り終えてから残す写真を選ぶように、' }, 'Keepsake는 지난번에 살펴본 다음 사진부터 차례로 보여드려요.': { en: 'Keepsake shows photos in order, starting after the last one you reviewed.', ja: 'Keepsakeは前回見た写真の次から順番に表示します。' },
  '예전에 찍었지만 나중에 보관함에 들어온 사진이에요': { en: 'These were taken earlier but added to your library later.', ja: '以前撮影し、あとからライブラリに追加された写真です。' }, '예전 사진도 다시 골라 남겨요': { en: 'Choose and keep past photos too.', ja: '過去の写真も選んで残せます。' }, '남기지 않은 사진을 정리해요': { en: 'Clean up photos you did not keep.', ja: '残さなかった写真を整理します。' }, '그대로 두기': { en: 'Keep them', ja: 'そのままにする' }, '정리하기': { en: 'Clean up', ja: '整理する' },
  '새 앨범': { en: 'New Album', ja: '新しいアルバム' }, '새 안전 앨범': { en: 'New Album', ja: '新しいアルバム' }, '새 공유 앨범': { en: 'Create', ja: '作成' }, '기기 사진첩': { en: 'Device Library', ja: 'デバイスのライブラリ' }, '나의 순간들': { en: 'My Moments', ja: 'マイメモリーズ' }, '만든 앨범': { en: 'My Albums', ja: '作成したアルバム' }, '나만 보는 안전 앨범': { en: 'My Secure Albums', ja: '自分だけのセキュアアルバム' }, '공유 앨범': { en: 'Shared Albums', ja: '共有アルバム' },
  '함께 쓰는 공유 앨범': { en: 'Shared Spaces', ja: 'みんなの共有スペース' }, '코드로 참여': { en: 'Join with code', ja: 'コードで参加' }, '파트너': { en: 'Partner', ja: 'パートナー' }, '가족': { en: 'Family', ja: '家族' }, '친구': { en: 'Friends', ja: '友人' }, '소유자': { en: 'Owner', ja: 'オーナー' }, '관리자': { en: 'Admin', ja: '管理者' },
  '원본 그대로': { en: 'Original quality', ja: 'オリジナル品質' }, '원본 보관': { en: 'Originals', ja: 'オリジナルを保存' }, '효율 보관': { en: 'Space saver', ja: '省スペース保存' }, '원본': { en: 'Original', ja: 'オリジナル' }, '효율': { en: 'Optimized', ja: '省容量' }, '앨범 기본': { en: 'Album default', ja: 'アルバムの設定' }, '기기 앨범 연결': { en: 'Linked device album', ja: 'デバイスのアルバムを連携' },
  '기록 백업': { en: 'Backup', ja: 'バックアップ' }, '기기 기록 올리기': { en: 'Upload memories', ja: '思い出をアップロード' }, '확인하는 중': { en: 'Checking…', ja: '確認中…' }, '사진 내려받기 기한': { en: 'Download deadline', ja: 'ダウンロード期限' }, '사용한 공간': { en: 'Storage used', ja: '使用中のストレージ' }, '올릴 사진': { en: 'Photos to upload', ja: 'アップロードする写真' }, 'Wi-Fi에서만 사진 올리기': { en: 'Wi‑Fi uploads only', ja: 'Wi‑Fiのみでアップロード' }, '원본을 기기 사진첩에 저장': { en: 'Save originals to device', ja: 'オリジナルを端末に保存' }, '구독 관리': { en: 'Manage subscription', ja: 'サブスクリプションを管理' }, '로그아웃': { en: 'Sign out', ja: 'ログアウト' }, '계정 삭제': { en: 'Delete account', ja: 'アカウントを削除' },
  '안전 보관한 모든 사진': { en: 'All securely stored photos', ja: '安全保管したすべての写真' }, '동기화하는 중…': { en: 'Syncing…', ja: '同期中…' }, '앨범 용량이 넘쳤어요': { en: 'This album is over its storage limit', ja: 'このアルバムは容量上限を超えています' }, '아직 남긴 사진이 없어요.': { en: 'You have not saved any photos yet.', ja: 'まだ残した写真はありません。' }, '남긴 사진을 이야기별 앨범으로 묶어 보세요.': { en: 'Group your saved photos into albums by story.', ja: '残した写真をテーマごとにアルバムにまとめましょう。' },
  '안전 보관에만 있는 앨범': { en: 'Secure-only albums', ja: '安全保管専用のアルバム' }, '앨범마다 보관 화질': { en: 'Storage quality per album', ja: 'アルバムごとの保存画質' }, '빼면 용량이 돌아와요': { en: 'Removing photos frees storage', ja: '写真を外すと容量が戻ります' }, '이 기기에 남긴 사진첩': { en: 'Memories saved on this device', ja: 'このデバイスに残した写真' }, '앨범으로 묶기': { en: 'Organize into albums', ja: 'アルバムにまとめる' }, '원본을 지우면': { en: 'If you delete the original', ja: 'オリジナルを削除すると' }, '안전 사진첩은 이렇게 써요': { en: 'How Secure Library works', ja: 'セキュアライブラリの使い方' }, '기기 사진첩은 이렇게 써요': { en: 'How Device Library works', ja: 'デバイスのライブラリの使い方' },
  '연도': { en: 'Year', ja: '年' }, '월': { en: 'Month', ja: '月' }, '일': { en: 'Day', ja: '日' }, '이야기': { en: 'Story', ja: 'ストーリー' }, '최신순': { en: 'Newest first', ja: '新しい順' }, '오래된순': { en: 'Oldest first', ja: '古い順' },
};

export function localizeText(language: AppLanguage, value: string) {
  if (language === 'ko') return value;
  return legacyText[value]?.[language] ?? value;
}

/** 수량과 변수 자리는 언어마다 어순이 달라 공통 문자열 치환 대신 여기서 조립한다. */
export function photoCount(language: AppLanguage, count: number) {
  if (language === 'en') return `${count} photos`;
  if (language === 'ja') return `${count}枚`;
  return `${count}장`;
}

export function inboxTitle(language: AppLanguage, albumTitle: string | null) {
  if (!albumTitle) return language === 'en' ? 'New Photos' : language === 'ja' ? '新しい写真' : '새로 찍은 사진';
  return language === 'en' ? `Photos for ${albumTitle}` : language === 'ja' ? `${albumTitle}に追加する写真` : `${albumTitle}에 담을 사진`;
}

export function reviewedUntil(language: AppLanguage, date: string) {
  if (language === 'en') return `You’ve reviewed photos through ${date}.\nNew photos will appear here next.`;
  if (language === 'ja') return `${date}までの写真を確認しました。\n新しい写真はここに表示されます。`;
  return `${date} 사진까지 봤어요.\n새 사진을 찍으면 여기에서 이어서 고를 수 있어요.`;
}

export function selectionSummary(language: AppLanguage, count: number) {
  if (language === 'en') return `${photoCount(language, count)} selected`;
  if (language === 'ja') return `${photoCount(language, count)}を選択中`;
  return `${photoCount(language, count)} 골랐어요`;
}
export const ROUTE_TITLES: Record<AppLanguage, Record<'day' | 'map' | 'cleanup' | 'cloud' | 'notifications' | 'licenses' | 'newAlbum' | 'import' | 'join' | 'manageAlbum', string>> = {
  ko: { day: '지난 사진', map: '앨범 지도', cleanup: '사진 정리', cloud: '안전 보관', notifications: '알림', licenses: '오픈소스 라이선스', newAlbum: '새 안전 앨범', import: '기기 기록 올리기', join: '공유 앨범 참여', manageAlbum: '앨범 관리' },
  en: { day: 'Past Photos', map: 'Album Map', cleanup: 'Clean Up Photos', cloud: 'Secure Storage', notifications: 'Notifications', licenses: 'Open-source Licenses', newAlbum: 'New Secure Album', import: 'Upload Device Memories', join: 'Join Shared Album', manageAlbum: 'Manage Album' },
  ja: { day: '過去の写真', map: 'アルバムマップ', cleanup: '写真を整理', cloud: '安全保管', notifications: '通知', licenses: 'オープンソースライセンス', newAlbum: '新しいセキュアアルバム', import: 'デバイスの思い出をアップロード', join: '共有アルバムに参加', manageAlbum: 'アルバムを管理' },
};
type I18n = { language: AppLanguage; t: (key: TranslationKey) => string; setLanguage: (language: AppLanguage) => Promise<void> };
const I18nContext = createContext<I18n | null>(null);

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [language, setCurrentLanguage] = useState<AppLanguage>(() => {
    // 계정 공간을 전환해 Provider가 새로 생길 때도, 첫 렌더의 언어와 날짜 형식을 맞춘다.
    setDateLanguage('ko');
    return 'ko';
  });
  const loadId = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      const id = ++loadId.current;
      return getSettings(db).then((settings) => {
        // 공간 전환·설정 저장 중 먼저 끝난 이전 읽기 결과는 무시한다.
        if (!alive || id !== loadId.current) return;
        setDateLanguage(settings.language);
        setCurrentLanguage(settings.language);
      });
    };
    // 언어는 아래 setLanguage만 바꾼다. 모든 DB 변경을 구독하면 메모 입력·동기화마다
    // 불필요하게 settings 전체를 읽게 되므로, 공간을 열 때 한 번만 복원한다.
    void load().catch(() => {});
    return () => {
      alive = false;
    };
  }, [db]);
  const setLanguage = useCallback(async (next: AppLanguage) => {
    if (next === language) return;
    const previous = language;
    // 진행 중인 이전 DB 읽기가 방금 선택한 언어를 덮어쓰지 못하게 한다.
    loadId.current++;
    // 날짜 포맷은 렌더 과정에서 읽히므로 state보다 먼저 바꿔 같은 프레임에 맞춘다.
    setDateLanguage(next);
    setCurrentLanguage(next);
    // 저장이 실패하면 화면과 날짜 포맷 모두 이전 값으로 되돌린다.
    try {
      await setSetting(db, 'language', next);
      // 이미 잡힌 로컬 알림도 새 언어로 다시 만든다.
      await rescheduleReminders(db);
    } catch (error) {
      setDateLanguage(previous);
      setCurrentLanguage(previous);
      throw error;
    }
  }, [db, language]);
  const value = useMemo<I18n>(() => ({ language, setLanguage, t: (key) => copy[language][key] }), [language, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useTranslation must be used inside LocalizationProvider');
  return value;
}
