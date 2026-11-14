import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, type AlertButton, type AlertOptions } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import * as Linking from 'expo-linking';

import { type AppLanguage, deviceLanguage, getSettings, setSetting } from '@/db/settings';
import { setDateLanguage } from '@/lib/dates';
import { rescheduleReminders } from '@/lib/reminders';

export type { AppLanguage } from '@/db/settings';

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
    blockedUsers: '차단한 사람',
    close: '닫기',
    reminder: '고르기 알림', reminderFrequency: '알림 빈도', reminderTime: '알림 시각', allowNotifications: '알림 허용하기',
    howToUse: '앱 사용법', plansGuide: '이용 등급 안내', comparePlans: '등급별로 비교하기', skip: '건너뛰기', next: '다음', getStarted: '시작하기',
    welcomePickTitle: '남길 사진만 골라요',
    welcomePickText: '사진 고르기 탭은 지난번에 본 다음 사진부터 차례로 보여줘요. 십 년 뒤에도 보고 싶은 몇 장만 골라 남기고, 그때의 이야기를 메모로 적어 두세요.',
    welcomeDeviceTitle: '기기 사진첩에 모여요',
    welcomeDeviceText: '남긴 사진은 날짜·장소·메모와 함께 모여요. 여행, 가족처럼 이야기별 앨범으로 묶을 수 있고, 사진을 복사하지 않아 용량을 거의 쓰지 않아요.',
    welcomeCloudTitle: '원본까지 안전하게',
    welcomeCloudText: '로그인하면 기록을 무료로 백업해요. 안전 보관을 구독하면 고른 사진의 원본까지 안전 사진첩에 지키고, 가족·친구와 공유 앨범도 함께 쓸 수 있어요.',
    welcomeLightTitle: '휴대폰은 가볍게',
    welcomeLightText: '남기지 않은 사진은 정리 후보로 모여 한 번에 지울 수 있어요. 고르기 알림을 켜 두면 사진이 쌓이기 전에 알려드려요.',
  },
  en: {
    language: 'Language', chooseLanguage: 'Choose language', cancel: 'Cancel', deviceLibrary: 'Device Library', secureLibrary: 'Secure Library', choosePhotos: 'Choose Photos', settings: 'Settings', account: 'Account', helpAndInfo: 'Help & Information', terms: 'Terms of Service', privacy: 'Privacy Policy', startPoint: 'Reset review point', notSet: 'Not set', savedRecords: 'Saved memories', resetStartTitle: 'Reset your review starting point?', resetStartMessage: 'Your saved photos will stay. You can choose a new starting point the next time you open Choose Photos.', reset: 'Reset', signedInAccount: 'Signed-in account', notSignedIn: 'Not signed in', localOnly: 'Your memories are only on this device', signInAndBackup: 'Sign in to back up your memories', subscribeAgain: 'Subscribe again', startSecureStorage: 'Start secure photo storage', loadingAccount: 'Loading account information', secureStorageActive: 'Secure storage · Your photos are protected', subscriptionEnded: 'Subscription ended · Download photos for 30 days', freeBackup: 'Free · Your memories are backed up', version: 'Version', contact: 'Contact', openSource: 'Open-source licenses', blockedUsers: 'Blocked people', close: 'Close', reminder: 'Photo review reminders', reminderFrequency: 'Reminder frequency', reminderTime: 'Reminder time', allowNotifications: 'Allow notifications',
    howToUse: 'How to use', plansGuide: 'Plans', comparePlans: 'Compare plans', skip: 'Skip', next: 'Next', getStarted: 'Get started',
    welcomePickTitle: 'Keep only the photos that matter',
    welcomePickText: 'Choose Photos shows your photos in order, starting after the last one you reviewed. Keep the few you will still want to see in ten years, and jot down the story behind them.',
    welcomeDeviceTitle: 'Gathered in your Device Library',
    welcomeDeviceText: 'Saved photos come together with their date, place, and notes. Group them into albums by story, like trips or family. Photos are never copied, so they take up almost no space.',
    welcomeCloudTitle: 'Keep the originals safe',
    welcomeCloudText: 'Sign in to back up your memories for free. With a secure storage subscription, the originals of the photos you keep are protected in your Secure Library, and you can share albums with family and friends.',
    welcomeLightTitle: 'A lighter phone',
    welcomeLightText: 'Photos you did not keep become cleanup candidates you can delete all at once. Turn on reminders and we will nudge you before photos pile up.',
  },
  ja: {
    language: '言語', chooseLanguage: '言語を選択', cancel: 'キャンセル', deviceLibrary: 'デバイスのライブラリ', secureLibrary: 'セキュアライブラリ', choosePhotos: '写真を選ぶ', settings: '設定', account: 'アカウント', helpAndInfo: 'ヘルプと情報', terms: '利用規約', privacy: 'プライバシーポリシー', startPoint: '見直し位置をリセット', notSet: '未設定', savedRecords: '残した思い出', resetStartTitle: '開始位置をリセットしますか？', resetStartMessage: '残した写真はそのままです。次に「写真を選ぶ」を開いたときに、あらためて決められます。', reset: 'リセット', signedInAccount: 'ログイン中のアカウント', notSignedIn: 'ログインしていません', localOnly: '思い出はこのデバイスにのみ保存されています', signInAndBackup: 'ログインして思い出をバックアップ', subscribeAgain: '再登録する', startSecureStorage: '写真の安全保管を始める', loadingAccount: 'アカウント情報を読み込んでいます', secureStorageActive: '安全保管 · 写真も保管されています', subscriptionEnded: 'サブスクリプション終了 · 30日間写真をダウンロードできます', freeBackup: '無料 · 思い出をバックアップしています', version: 'バージョン', contact: 'お問い合わせ', openSource: 'オープンソースライセンス', blockedUsers: 'ブロックした人', close: '閉じる', reminder: '写真を選ぶリマインダー', reminderFrequency: 'リマインダーの頻度', reminderTime: '通知時刻', allowNotifications: '通知を許可する',
    howToUse: '使い方', plansGuide: 'プランのご案内', comparePlans: 'プランを比較', skip: 'スキップ', next: '次へ', getStarted: 'はじめる',
    welcomePickTitle: '残したい写真だけを選ぶ',
    welcomePickText: '「写真を選ぶ」では、前回見た写真の次から順番に表示します。十年後も見返したい数枚だけを選んで残し、そのときの思い出をメモしておきましょう。',
    welcomeDeviceTitle: 'デバイスのライブラリに集まります',
    welcomeDeviceText: '残した写真は日付・場所・メモと一緒にまとまります。旅行や家族などテーマごとのアルバムにでき、写真をコピーしないので容量はほとんど使いません。',
    welcomeCloudTitle: 'オリジナルまで安全に',
    welcomeCloudText: 'ログインすると思い出を無料でバックアップします。安全保管を購読すると、選んだ写真のオリジナルまでセキュアライブラリで守り、家族や友人と共有アルバムも使えます。',
    welcomeLightTitle: 'スマホは軽く',
    welcomeLightText: '残さなかった写真は整理候補にまとまり、一度に削除できます。リマインダーをオンにすると、写真がたまる前にお知らせします。',
  },
} as const;

export const LANGUAGE_LABELS: Record<AppLanguage, string> = { ko: '한국어', en: 'English', ja: '日本語' };

/**
 * 기존 화면은 문구를 JSX에 직접 둔 곳이 많다. ThemedText가 이 표를 통과시키므로,
 * 화면별 코드를 모두 건드리지 않아도 본문·빈 화면·버튼 문구가 같은 언어로 표시된다.
 * 새 문구는 위의 key 기반 copy에 추가하는 것을 원칙으로 한다.
 */
const legacyText: Record<string, { en: string; ja: string }> = {
  '메모·장소·날짜·앨범을 무료로 백업해요. 휴대폰을 바꿔도 사진첩에 같은 사진이 있으면 기록과 다시 이어져요.': { en: 'Back up notes, places, dates, and albums for free. On a new phone, they reconnect to the same photos in your library.', ja: 'メモ・場所・日付・アルバムを無料でバックアップします。スマホを替えても、ライブラリに同じ写真があれば思い出とまたつながります。' }, '휴대폰을 잃어버려도, 사진첩 백업이 없어도 사진이 돌아와요': { en: 'Your photos come back even if you lose your phone or have no library backup', ja: 'スマホをなくしても、ライブラリのバックアップがなくても写真が戻ります' },  '남긴 사진을 안전하게 보관해요': { en: 'Keep the photos you saved safe', ja: '残した写真を安全に保管' }, '지금은 메모·장소·날짜만 백업하고 있어요. 구독하면 사진 파일까지 지켜 드려요.': { en: 'Right now only notes, places, and dates are backed up. Subscribe to protect the photo files too.', ja: '今はメモ・場所・日付だけをバックアップしています。サブスクリプションで写真ファイルまで守れます。' }, '로그인하면 기록을, 구독하면 사진까지 이 계정에 보관해요.': { en: 'Sign in to back up your memories, and subscribe to keep the photos too.', ja: 'ログインで思い出を、サブスクリプションで写真までアカウントに保管します。' }, '안전 앨범에 담은 사진을 원본 그대로, 또는 용량을 아껴 보관해요': { en: 'Photos in secure albums are kept in Original quality, or with Space saver to save storage', ja: 'セキュアアルバムの写真を、オリジナル品質か省スペース保存で保管' }, '기기 사진첩에서 지워도 남아서 휴대폰이 가벼워져요': { en: 'They stay even if you delete them from your library, so your phone stays light', ja: 'ライブラリから削除しても残るので、スマホが軽くなります' }, '안전 보관 시작하기': { en: 'Start Secure Storage', ja: '安全保管を始める' },
  'Google 로그인': { en: 'Continue with Google', ja: 'Googleでログイン' }, 'Apple로 로그인': { en: 'Continue with Apple', ja: 'Appleでサインイン' },
  '기록을 계정에 백업해요': { en: 'Back up your memories to your account', ja: '思い出をアカウントにバックアップ' },
  '남긴 사진까지 안전하게': { en: 'Keep your saved photos safe, too', ja: '残した写真まで安全に' }, '로그인하면 기록을 무료로 백업해요. 구독하면 안전 앨범에 담은 사진 파일까지 보관해서, 사진첩에서 지우거나 휴대폰을 잃어버려도 사진이 남아요.': { en: 'Sign in to back up your memories for free. Subscribe to also keep the photo files in your secure albums, so your photos stay even if you delete them from your library or lose your phone.', ja: 'ログインすると思い出を無料でバックアップします。購読すると、セキュアアルバムの写真ファイルまで保管するので、ライブラリから削除したりスマホをなくしたりしても写真が残ります。' }, '로그인하지 않아도 사진 고르기·사진첩·정리는 모두 무료로 쓸 수 있어요.': { en: 'Choosing photos, your library, and cleanup are all free, even without signing in.', ja: 'ログインしなくても、写真選び・ライブラリ・整理はすべて無料で使えます。' },
  '안전 보관 구독은 준비하고 있어요': { en: 'Secure Storage subscriptions are coming soon', ja: '安全保管のサブスクリプションは準備中です' }, '지금은 이 계정에 기록을 무료로 백업하고 있어요.': { en: 'For now, your memories are backed up to this account for free.', ja: '今はこのアカウントに思い出を無料でバックアップしています。' }, '지금은 로그인해서 기록을 무료로 백업할 수 있어요.': { en: 'For now, you can sign in to back up your memories for free.', ja: '今はログインして思い出を無料でバックアップできます。' }, '로그인하면 기록을 무료로 백업해요. 다른 기기에서 같은 계정으로 로그인하면 기록을 받아와요.': { en: 'Sign in to back up your memories for free. Sign in with the same account on another device to get them there.', ja: 'ログインすると思い出を無料でバックアップします。別のデバイスで同じアカウントにログインすると思い出を受け取れます。' },
  '사진까지 백업하려면 안전 보관 구독 ›': { en: 'Back up photos too with Secure Storage ›', ja: '写真もバックアップするなら安全保管 ›' }, '새 휴대폰에서도 같은 사진과 다시 이어져요.': { en: 'On a new phone, they reconnect to the same photos.', ja: '新しいスマホでも同じ写真とまたつながります。' }, '사진은 이 기기 사진첩에만 남아요.': { en: 'Photos stay only in this device’s library.', ja: '写真はこのデバイスのライブラリにだけ残ります。' }, '[나중에]를 골라도 설정에서 다시 백업할 수 있어요.': { en: 'If you choose Later, you can back up again from Settings.', ja: '［あとで］を選んでも、設定からまたバックアップできます。' }, '사진은 안전 앨범에 담으면 보관돼요.': { en: 'Add photos to a secure album to keep them.', ja: '写真はセキュアアルバムに追加すると保管されます。' }, '사진은 아직 이 기기 사진첩에만 있어요.': { en: 'The photos are still only in this device’s library.', ja: '写真はまだこのデバイスのライブラリにしかありません。' }, '사진첩에서 지워도 Keepsake에 남아요': { en: 'Photos stay in Keepsake even if you delete them from your library', ja: 'ライブラリから削除してもKeepsakeに残ります' }, '휴대폰을 잃어버려도 사진이 돌아와요': { en: 'Your photos come back even if you lose your phone', ja: 'スマホをなくしても写真が戻ります' }, '고른 기록의 메모·장소·날짜를 이 계정에 백업해요. 기기의 기록은 그대로 남아요.': { en: 'Notes, places, and dates of the memories you choose are backed up to this account. Memories on this device stay as they are.', ja: '選んだ思い出のメモ・場所・日付をこのアカウントにバックアップします。デバイスの思い出はそのまま残ります。' },
  '백업할 기록이 없어요': { en: 'There are no memories to back up.', ja: 'バックアップする思い出はありません。' }, '백업하지 못했어요': { en: 'Could not back up', ja: 'バックアップできませんでした' }, '기록을 백업했어요': { en: 'Your memories are backed up', ja: '思い出をバックアップしました' }, '안전 앨범 만들기': { en: 'Create a secure album', ja: 'セキュアアルバムを作成' }, '나중에 할게요': { en: 'Maybe later', ja: 'あとで' }, '기기의 \'나의 순간들\'을 이 계정에 백업할까요?': { en: 'Back up “My Moments” from this device to this account?', ja: 'このデバイスの「マイメモリーズ」をこのアカウントにバックアップしますか？' }, '메모·장소·날짜': { en: 'Notes, places, and dates', ja: 'メモ・場所・日付' }, '사진 파일': { en: 'Photo files', ja: '写真ファイル' }, '골라서 백업하기': { en: 'Choose which to back up', ja: '選んでバックアップ' }, '백업하기': { en: 'Back up', ja: 'バックアップ' }, '사진까지 지켜 두세요': { en: 'Keep your photos safe too', ja: '写真も守りましょう' }, '지금 다시 구독하면 보관하던 사진을 다시 올리지 않고 이어서 써요.': { en: 'Subscribe again now to keep using your stored photos without uploading them again.', ja: '今再登録すれば、保管していた写真を再アップロードせずにそのまま使えます。' }, '안전 보관 알아보기': { en: 'Learn about secure storage', ja: '安全保管について見る' }, '안전 앨범에 담은 사진을 보관해요.': { en: 'Photos in secure albums are now stored.', ja: 'セキュアアルバムの写真を保管します。' },
  '취소': { en: 'Cancel', ja: 'キャンセル' }, '완료': { en: 'Done', ja: '完了' }, '확인': { en: 'OK', ja: '確認' }, '닫기': { en: 'Close', ja: '閉じる' },
  '지난 사진': { en: 'Past Photos', ja: '過去の写真' }, '최근 사진부터 시간 순서대로': { en: 'Starting with the most recent photos', ja: '新しい写真から時系列順に表示します' }, '아래로 내려가며 계속 볼 수 있어요.': { en: 'Scroll down to keep exploring.', ja: '下にスクロールして続けて見られます。' }, '사진 보관함에 사진이 없어요.': { en: 'There are no photos in your library.', ja: '写真ライブラリに写真がありません。' },
  '안전 보관 사진첩': { en: 'Secure Photo Library', ja: 'セキュア写真ライブラリ' }, '아직 안전 보관 사진첩이 없어요': { en: 'You do not have a secure photo library yet.', ja: 'セキュア写真ライブラリはまだありません。' }, '인터넷에 연결되면 안전 사진첩을 볼 수 있어요': { en: 'Connect to the internet to view your secure library.', ja: 'インターネットに接続するとセキュアライブラリを見られます。' },
'안전 보관을 사용하고 있어요.': { en: 'You are using secure storage.', ja: '安全保管を利用しています。' }, '로그인': { en: 'Sign in', ja: 'ログイン' },
  '정리할 사진이 없어요': { en: 'There are no photos to clean up.', ja: '整理する写真はありません。' }, '지도에 표시할 사진이 없어요': { en: 'There are no photos to show on the map.', ja: '地図に表示する写真がありません。' }, '지도를 불러오지 못했어요': { en: 'Unable to load the map.', ja: '地図を読み込めませんでした。' },
  '이 기기의 기록을 이 계정에 백업할까요?': { en: 'Back up this device’s memories to this account?', ja: 'このデバイスの思い出をこのアカウントにバックアップしますか？' },
  '아직 받은 알림이 없어요': { en: 'No notifications yet.', ja: '通知はまだありません。' }, '이 기록을 찾을 수 없어요.': { en: 'This memory could not be found.', ja: 'この思い出は見つかりません。' }, '이 앨범을 찾을 수 없어요.': { en: 'This album could not be found.', ja: 'このアルバムは見つかりません。' }, '공유 앨범을 불러오지 못했어요.': { en: 'Unable to load the shared album.', ja: '共有アルバムを読み込めませんでした。' },
  '놓친 사진': { en: 'Missed photos', ja: '見逃した写真' }, '새로 찍은 사진을 모두 살펴봤어요': { en: 'You have reviewed all your new photos.', ja: '新しく撮った写真をすべて見ました。' }, '지난 사진 다시 보기': { en: 'Revisit past photos', ja: '過去の写真をもう一度見る' }, '정리 후보': { en: 'Cleanup candidates', ja: '整理候補' },
  '함께 담을 사람을 초대해 보세요': { en: 'Invite people to add memories together.', ja: '一緒に思い出を追加する人を招待しましょう。' }, '초대 코드': { en: 'Invite code', ja: '招待コード' }, '이 앨범에서 보일 내 이름': { en: 'Your name in this album', ja: 'このアルバムで表示する名前' }, '이 앨범에 나눠 줄 내 용량': { en: 'Storage to share with this album', ja: 'このアルバムに割り当てる容量' },
  '누가 보는 앨범인가요?': { en: 'Who is this album for?', ja: '誰のためのアルバムですか？' }, '누구와 함께 쓰나요?': { en: 'Who will you share it with?', ja: '誰と一緒に使いますか？' }, '앨범 이름': { en: 'Album name', ja: 'アルバム名' }, '연결할 기기 앨범': { en: 'Device album to link', ja: '連携するデバイスのアルバム' }, '보관 화질': { en: 'Storage quality', ja: '保存画質' }, '어떻게 만들까요?': { en: 'How would you like to create it?', ja: 'どのように作成しますか？' },
  '앨범 표지': { en: 'Album cover', ja: 'アルバムの表紙' }, '최신 사진으로 자동 설정': { en: 'Use the latest photo automatically', ja: '最新の写真を自動で使う' }, '앨범에 가장 최근에 담긴 사진을 표지로 써요.': { en: 'Use the most recently added photo as the cover.', ja: 'アルバムに最後に追加した写真を表紙にします。' }, '기본 디자인': { en: 'Default designs', ja: '基本デザイン' }, '앨범 사진에서 고르기': { en: 'Choose from album photos', ja: 'アルバムの写真から選ぶ' },
  '앨범에 넣기': { en: 'Add to album', ja: 'アルバムに追加' }, '새 앨범 만들기': { en: 'Create new album', ja: '新しいアルバムを作成' }, '눌러서 그때의 기억을 적어 보세요': { en: 'Tap to write down this memory.', ja: 'タップしてそのときの思い出を書いてみましょう。' },
  '돌아가기': { en: 'Go back', ja: '戻る' }, '구매 복원': { en: 'Restore purchases', ja: '購入を復元' }, '로그인만 하기 · 이미 구독 중이에요': { en: 'Sign in only · I already subscribe', ja: 'ログインのみ · すでに購読しています' }, '새 사진에서 고르기': { en: 'Choose from new photos', ja: '新しい写真から選ぶ' }, '기록에서 빼기': { en: 'Remove from memories', ja: '思い出から削除' }, '사진 고르러 가기': { en: 'Choose photos', ja: '写真を選ぶ' }, '앨범에서 빼기': { en: 'Remove from album', ja: 'アルバムから削除' }, '새 코드': { en: 'New code', ja: '新しいコード' }, '초대 멈추기': { en: 'Stop invitations', ja: '招待を停止' }, '초대 코드 만들기': { en: 'Create invite code', ja: '招待コードを作成' }, '저장': { en: 'Save', ja: '保存' }, '앨범 지우기': { en: 'Delete album', ja: 'アルバムを削除' }, '사진 담기': { en: 'Add photos', ja: '写真を追加' }, '내 용량을 더 나눠 주기': { en: 'Share more storage', ja: '容量をさらに共有' }, '구성원 초대하기': { en: 'Invite members', ja: 'メンバーを招待' }, '로그인하러 가기': { en: 'Go to sign in', ja: 'ログインへ' }, '참여하기': { en: 'Join', ja: '参加する' }, '기기 사진첩으로 가기': { en: 'Go to device library', ja: 'デバイスのライブラリへ' }, '사진을 찾는 중…': { en: 'Finding photos…', ja: '写真を探しています…' }, '처음부터 조금씩 고르기': { en: 'From the very beginning', ja: '最初から少しずつ選ぶ' }, '오늘 찍은 사진부터': { en: 'From today', ja: '今日撮った写真から' }, '최근 1주': { en: 'Past week', ja: '過去1週間' }, '최근 한 달': { en: 'Past month', ja: '過去1か月' }, '날짜 고르기': { en: 'Choose a date', ja: '日付を選ぶ' },
  '어디서부터 고를까요?': { en: 'Where to start?', ja: 'どこから選びますか？' }, '필름 한 롤을 다 찍고 고르듯, 살펴본 사진 다음부터 차례로 보여 드려요.': { en: 'Like sorting a finished roll of film, you go through your photos in order.', ja: 'フィルムを撮り終えてから選ぶように、見た写真の次から順番に表示します。' }, '중간에 멈춰도 다음에 이어서 볼 수 있어요.': { en: 'Stop anytime and pick up where you left off.', ja: '途中で止めても、次回は続きから見られます。' }, '지금부터 찍는 사진을 가볍게 골라요': { en: 'An easy start with new photos', ja: 'これから撮る写真を気軽に選びます' }, '원하는 날부터 시작해요': { en: 'Start from any day', ja: '好きな日から始めます' }, '가장 오래된 사진부터 차례로 봐요': { en: 'Start with your oldest photos', ja: 'いちばん古い写真から順番に見ます' }, '추천': { en: 'Suggested', ja: 'おすすめ' }, '나중에': { en: 'Later', ja: 'あとで' },
  '예전에 찍었지만 나중에 보관함에 들어온 사진이에요': { en: 'These were taken earlier but added to your library later.', ja: '以前撮影し、あとからライブラリに追加された写真です。' }, '예전 사진도 다시 골라 남겨요': { en: 'Choose and keep past photos too.', ja: '過去の写真も選んで残せます。' }, '남기지 않은 사진을 정리해요': { en: 'Clean up photos you did not keep.', ja: '残さなかった写真を整理します。' }, '그대로 두기': { en: 'Keep them', ja: 'そのままにする' }, '정리하기': { en: 'Clean up', ja: '整理する' },
  '새 앨범': { en: 'New Album', ja: '新しいアルバム' }, '새 안전 앨범': { en: 'New Album', ja: '新しいアルバム' }, '새 공유 앨범': { en: 'Create', ja: '作成' }, '기기 사진첩': { en: 'Device Library', ja: 'デバイスのライブラリ' }, '나의 순간들': { en: 'My Moments', ja: 'マイメモリーズ' }, '만든 앨범': { en: 'My Albums', ja: '作成したアルバム' }, '나만 보는 안전 앨범': { en: 'My Secure Albums', ja: '自分だけのセキュアアルバム' }, '공유 앨범': { en: 'Shared Albums', ja: '共有アルバム' },
  '함께 쓰는 공유 앨범': { en: 'Shared Spaces', ja: 'みんなの共有スペース' }, '코드로 참여': { en: 'Join with code', ja: 'コードで参加' }, '파트너': { en: 'Partner', ja: 'パートナー' }, '가족': { en: 'Family', ja: '家族' }, '친구': { en: 'Friends', ja: '友人' }, '소유자': { en: 'Owner', ja: 'オーナー' }, '관리자': { en: 'Admin', ja: '管理者' },
  '원본 그대로': { en: 'Original quality', ja: 'オリジナル品質' }, '원본 보관': { en: 'Originals', ja: 'オリジナルを保存' }, '효율 보관': { en: 'Space saver', ja: '省スペース保存' }, '원본': { en: 'Original', ja: 'オリジナル' }, '효율': { en: 'Optimized', ja: '省容量' }, '앨범 기본': { en: 'Album default', ja: 'アルバムの設定' }, '기기 앨범 연결': { en: 'Linked device album', ja: 'デバイスのアルバムを連携' },
  '기록 백업': { en: 'Backup', ja: 'バックアップ' }, '기기 기록 백업하기': { en: 'Back Up Device Memories', ja: 'デバイスの思い出をバックアップ' }, '확인하는 중': { en: 'Checking…', ja: '確認中…' }, '사진 내려받기 기한': { en: 'Download deadline', ja: 'ダウンロード期限' }, '사용한 공간': { en: 'Storage used', ja: '使用中のストレージ' }, '올릴 사진': { en: 'Photos to upload', ja: 'アップロードする写真' }, 'Wi-Fi에서만 사진 올리기': { en: 'Wi‑Fi uploads only', ja: 'Wi‑Fiのみでアップロード' }, '원본을 기기 사진첩에 저장': { en: 'Save originals to device', ja: 'オリジナルを端末に保存' }, '구독 관리': { en: 'Manage subscription', ja: 'サブスクリプションを管理' }, '로그아웃': { en: 'Sign out', ja: 'ログアウト' }, '계정 삭제': { en: 'Delete account', ja: 'アカウントを削除' },
  '안전 보관한 모든 사진': { en: 'All securely stored photos', ja: '安全保管したすべての写真' }, '동기화하는 중…': { en: 'Syncing…', ja: '同期中…' }, '앨범 용량이 넘쳤어요': { en: 'This album is over its storage limit', ja: 'このアルバムは容量上限を超えています' }, '아직 남긴 사진이 없어요.': { en: 'You have not saved any photos yet.', ja: 'まだ残した写真はありません。' }, '남긴 사진을 이야기별 앨범으로 묶어 보세요.': { en: 'Group your saved photos into albums by story.', ja: '残した写真をテーマごとにアルバムにまとめましょう。' },
  '안전 보관에만 있는 앨범': { en: 'Secure-only albums', ja: '安全保管専用のアルバム' }, '앨범마다 보관 화질': { en: 'Storage quality per album', ja: 'アルバムごとの保存画質' }, '빼면 용량이 돌아와요': { en: 'Removing photos frees storage', ja: '写真を外すと容量が戻ります' }, '이 기기에 남긴 사진첩': { en: 'Memories saved on this device', ja: 'このデバイスに残した写真' }, '앨범으로 묶기': { en: 'Organize into albums', ja: 'アルバムにまとめる' }, '원본을 지우면': { en: 'If you delete the original', ja: 'オリジナルを削除すると' }, '안전 사진첩은 이렇게 써요': { en: 'How Secure Library works', ja: 'セキュアライブラリの使い方' }, '기기 사진첩은 이렇게 써요': { en: 'How Device Library works', ja: 'デバイスのライブラリの使い方' },
  '연도': { en: 'Year', ja: '年' }, '월': { en: 'Month', ja: '月' }, '일': { en: 'Day', ja: '日' }, '이야기': { en: 'Story', ja: 'ストーリー' }, '최신순': { en: 'Newest first', ja: '新しい順' }, '오래된순': { en: 'Oldest first', ja: '古い順' },
  // 설정 > 계정
  '기기 사진첩에 저장했어요': { en: 'Saved to your device library', ja: 'デバイスのライブラリに保存しました' },
  '사진을 저장하지 못했어요': { en: 'Could not save the photos', ja: '写真を保存できませんでした' },
  '잠시 후 다시 시도해 주세요.': { en: 'Please try again in a moment.', ja: 'しばらくしてからもう一度お試しください。' },
  '30일': { en: '30 days', ja: '30日間' },
  '로그아웃할까요?': { en: 'Sign out?', ja: 'ログアウトしますか？' },
  '이 기기에만 보관한 기록으로 돌아가요. 이 계정의 기록은 다시 로그인하면 볼 수 있어요.': { en: 'You’ll switch back to the memories kept only on this device. Sign in again anytime to see this account’s memories.', ja: 'このデバイスだけに保存している思い出に切り替わります。このアカウントの思い出は、もう一度ログインすると表示されます。' },
  '계정을 삭제할까요?': { en: 'Delete your account?', ja: 'アカウントを削除しますか？' },
  '삭제': { en: 'Delete', ja: '削除' },
  '계정을 삭제했어요': { en: 'Your account has been deleted', ja: 'アカウントを削除しました' },
  '구독 해지를 잊지 마세요.': { en: 'Don’t forget to cancel your subscription.', ja: 'サブスクリプションの解約もお忘れなく。' },
  '삭제하지 못했어요': { en: 'Could not delete your account', ja: 'アカウントを削除できませんでした' },
  // 기기 사진첩 탭
  '기기 사진첩 설정': { en: 'Device Library settings', ja: 'デバイスのライブラリの設定' },
  '고르기에서 남긴 사진은 나의 순간들에 차곡차곡 쌓여요.': { en: 'Photos you keep in Choose Photos will collect in My Moments.', ja: '「写真を選ぶ」で残した写真は、マイメモリーズに少しずつたまっていきます。' },
  '만들기': { en: 'Create', ja: '作成' },
  '그날의 기억': { en: 'On this day', ja: 'あの日の思い出' },
  '오늘은 그만 보기': { en: 'Hide for today', ja: '今日は表示しない' },
  // 안전 사진첩 탭
  '안전 사진첩 설정': { en: 'Secure Library settings', ja: 'セキュアライブラリの設定' },
  '안전 사진첩은 계정에 보관한 사진을 불러와서 인터넷이 필요해요.': { en: 'Your Secure Library loads photos stored in your account, so it needs an internet connection.', ja: 'セキュアライブラリはアカウントに保管した写真を読み込むため、インターネット接続が必要です。' },
  '사진 고르기와 기기 사진첩은 지금도 그대로 쓸 수 있어요.': { en: 'You can still use Choose Photos and your Device Library.', ja: '「写真を選ぶ」とデバイスのライブラリは、今もそのまま使えます。' },
  '아직 안전 앨범이 없어요. 안전 보관할 사진을 앨범으로 묶어 보세요.': { en: 'No secure albums yet. Group the photos you want to keep safe into an album.', ja: 'セキュアアルバムはまだありません。安全に保管したい写真をアルバムにまとめましょう。' },
  '뒤로 가기': { en: 'Back', ja: '戻る' },
  '예) 우리 가족, 2025 제주 여행': { en: 'e.g. Our family, Summer 2025 trip', ja: '例）わが家、2025年夏の旅行' },
  // 사진 고르기 탭
  '휴대폰에 쌓여 가는 수많은 사진 중': { en: 'Out of all the photos piling up on your phone,', ja: 'スマホにたまっていくたくさんの写真から、' },
  '십 년 뒤에도 다시 보고 싶은 몇 장만 골라 남겨요.': { en: 'keep just the few you’ll still want to see ten years from now.', ja: '十年後も見返したい数枚だけを選んで残します。' },
  '필름 사진을 골라 인화하던 때처럼요.': { en: 'Just like choosing which film photos to print.', ja: 'フィルム写真を選んでプリントしていた頃のように。' },
  '사진에 접근할 수 없어요. 고를 사진을 보여드리려면 사진 접근을 허용해 주세요.': { en: 'Keepsake can’t access your photos. Allow photo access so we can show you photos to choose from.', ja: '写真にアクセスできません。選ぶ写真を表示するには、写真へのアクセスを許可してください。' },
  '일부 사진만 허용해도 괜찮아요.': { en: 'Allowing only some photos is fine too.', ja: '一部の写真だけの許可でも大丈夫です。' },
  '설정에서 허용하기': { en: 'Allow in Settings', ja: '設定で許可する' },
  '사진 보관함 열기': { en: 'Allow photo access', ja: '写真へのアクセスを許可' },
  '먼저 고른 사진을 남겨 주세요': { en: 'Keep your selected photos first', ja: '先に選んだ写真を残してください' },
  '선택을 해제하거나 [남기기]를 누른 뒤 진행할 수 있어요.': { en: 'Clear your selection or tap Keep, then try again.', ja: '選択を解除するか、［残す］をタップしてから進めてください。' },
  '이 날짜까지 확인할까요?': { en: 'Mark photos through this date as reviewed?', ja: 'この日付まで確認済みにしますか？' },
  '이 날짜까지의 사진은 다음 고르기에서 건너뛰어요.': { en: 'Photos up to this date will be skipped next time.', ja: 'この日付までの写真は、次回から表示されません。' },
  '앨범에 담기 마치기': { en: 'Finish adding to album', ja: 'アルバムへの追加を終える' },
  '십 년 뒤에도 다시 보고 싶은 사진만 골라 남겨 보세요.': { en: 'Keep only the photos you’ll still want to see in ten years.', ja: '十年後も見返したい写真だけを選んで残しましょう。' },
  '남기는 중…': { en: 'Saving…', ja: '保存中…' },
  '선택 해제': { en: 'Clear', ja: '選択を解除' },
  '남기기': { en: 'Keep', ja: '残す' },
  '다음엔 그 뒤부터 보여드려요': { en: 'Next time you’ll start after these', ja: '次回はその続きから表示します' },
  '다음엔 보여드리지 않아요': { en: 'They won’t be shown again', ja: '次回からは表示しません' },
  '여기까지 봤어요': { en: 'Done for now', ja: 'ここまで見た' },
  '오늘': { en: 'Today', ja: '今日' },
  '이 날짜까지 확인하고 다음부터 건너뛰기': { en: 'Mark through this date as reviewed and skip next time', ja: 'この日付まで確認済みにして次回から表示しない' },
  // 고르기 공통 조각
  '남김': { en: 'Saved', ja: '保存済み' },
  '기억 적기': { en: 'Write a memory', ja: '思い出を書く' },
  '일부 사진만 볼 수 있어요. 보이지 않는 사진이 있다면': { en: 'Only some photos are available. If a photo is missing,', ja: '一部の写真だけが表示されています。表示されない写真がある場合は' },
  '사진 추가 선택': { en: 'select more photos', ja: '写真を追加で選択' },
  // 앨범 지도
  '앨범 지도': { en: 'Album Map', ja: 'アルバムマップ' },
  '공유 앨범 지도': { en: 'Shared Album Map', ja: '共有アルバムのマップ' },
  '촬영 위치가 저장된 사진을 앨범에 담으면 여기에서 볼 수 있어요.': { en: 'Add photos with location info to the album to see them here.', ja: '撮影場所が記録された写真をアルバムに追加すると、ここに表示されます。' },
  '인터넷 연결을 확인한 뒤 다시 열어 주세요.': { en: 'Check your internet connection and open it again.', ja: 'インターネット接続を確認してから、もう一度開いてください。' },
  '잠시 후 다시 열어 주세요.': { en: 'Please open it again in a moment.', ja: 'しばらくしてからもう一度開いてください。' },
  // 보관 화질
  '찍은 그대로의 원본과 보기용 사진을 함께 보관해요. 동영상도 원본 그대로예요. 인화하거나 원본을 다시 내려받을 때 좋아요.': { en: 'Keeps the untouched original along with a viewing copy. Videos stay in original quality too. Best for printing or downloading originals later.', ja: '撮影したままのオリジナルと表示用の写真を一緒に保管します。動画もオリジナルのままです。プリントやオリジナルの再ダウンロードに向いています。' },
  '1장에 약 3~5MB': { en: 'About 3–5 MB per photo', ja: '1枚あたり約3〜5MB' },
  '휴대폰에서 볼 때 뭉개지지 않는 크기(사진은 긴 변 2048px, 동영상은 720p)로만 보관해요. 같은 용량에 훨씬 많이 담을 수 있어요.': { en: 'Keeps only a size that still looks sharp on a phone (photos at 2048px on the long edge, videos at 720p). You can fit far more in the same space.', ja: 'スマホで見てもきれいなサイズ（写真は長辺2048px、動画は720p）だけを保管します。同じ容量でずっと多く保管できます。' },
  '1장에 약 0.8MB': { en: 'About 0.8 MB per photo', ja: '1枚あたり約0.8MB' },
  // 앨범에 사진 넣기
  '앨범을 저장하지 못했어요': { en: 'Could not save the album', ja: 'アルバムを保存できませんでした' },
  '고르기 탭에서 사진을 먼저 남겨 주세요.': { en: 'Keep some photos in Choose Photos first.', ja: '先に「写真を選ぶ」で写真を残してください。' },
  '이 앨범에 넣을 사진을 골라 주세요. 사진은 복사되지 않고, 앨범에서 빼도 기록은 그대로 남아요.': { en: 'Choose photos for this album. Photos aren’t copied, and removing them from the album keeps the memory.', ja: 'このアルバムに入れる写真を選んでください。写真はコピーされず、アルバムから外しても思い出はそのまま残ります。' },
  // 앨범 화면
  '안전 사진첩으로 돌아가기': { en: 'Back to Secure Library', ja: 'セキュアライブラリに戻る' },
  '사진첩으로 돌아가기': { en: 'Back to Device Library', ja: 'ライブラリに戻る' },
  '앨범에서 뺄까요?': { en: 'Remove from album?', ja: 'アルバムから外しますか？' },
  '다른 안전 앨범에 없는 사진은 안전 보관에서 삭제돼 용량이 돌아와요. 기록(메모·장소)과 기기 사진첩의 원본은 그대로예요.': { en: 'Photos that aren’t in another secure album will be deleted from secure storage, freeing up space. Your memories (notes and places) and the originals in your device library stay as they are.', ja: 'ほかのセキュアアルバムにない写真は安全保管から削除され、容量が空きます。思い出（メモ・場所）とデバイスのライブラリのオリジナルはそのままです。' },
  '사진이나 기록은 삭제되지 않아요. 이 앨범에 연결된 사진만 빠져요.': { en: 'No photos or memories will be deleted. They’ll only be removed from this album.', ja: '写真や思い出は削除されません。このアルバムから外れるだけです。' },
  '기록 열기': { en: 'Open memory', ja: '思い出を開く' },
  '효율 보관으로 바꾸면 다른 원본 보관 앨범에 없는 사진의 원본은 안전 보관에서 삭제돼요. 사진에서 따로 ‘원본 그대로’를 고른 사진은 남아요. 동영상 원본은 720p 영상을 올린 뒤에 지워요.': { en: 'If you switch to Space saver, originals of photos that aren’t in another Original-quality album will be deleted from secure storage. Photos you set to Original quality individually are kept. Video originals are deleted after the 720p version is uploaded.', ja: '省スペース保存に切り替えると、ほかのオリジナル保存アルバムにない写真のオリジナルは安全保管から削除されます。写真ごとに「オリジナル品質」を選んだ写真は残ります。動画のオリジナルは、720pの動画をアップロードしてから削除します。' },
  '(지금)': { en: '(current)', ja: '（現在）' },
  '연결된 안전 앨범 보기': { en: 'View linked secure album', ja: '連携中のセキュアアルバムを見る' },
  '안전 보관에 연결': { en: 'Link to secure storage', ja: '安全保管と連携' },
  '다운로드할 사진이 없어요': { en: 'No photos to download', ja: 'ダウンロードする写真はありません' },
  '이 앨범의 보관 파일은 이미 모두 기기 사진첩에 연결되어 있어요.': { en: 'All stored files in this album are already linked to your device library.', ja: 'このアルバムの保管ファイルは、すべてデバイスのライブラリとひも付いています。' },
  '원본 보관 사진은 같은 원본인지 확인해 연결하고, 효율 보관 파일은 같은 파일명으로 이미 받은 사진을 찾아 다시 저장하지 않아요. 다운로드 뒤에는 이 기기의 사진첩 연결도 동기화해요.': { en: 'Original-quality photos are matched to the same original and linked. For Space saver files, photos already downloaded with the same file name won’t be saved again. After downloading, this device’s library links are synced too.', ja: 'オリジナル保存の写真は同じオリジナルか確認してひも付けます。省スペース保存のファイルは、同じファイル名ですでにダウンロード済みの写真があれば保存し直しません。ダウンロード後は、このデバイスのライブラリとのひも付けも同期します。' },
  '다운로드': { en: 'Download', ja: 'ダウンロード' },
  '일부 사진을 다운로드하지 못했어요': { en: 'Some photos could not be downloaded', ja: '一部の写真をダウンロードできませんでした' },
  '기기 사진첩으로 다운로드했어요': { en: 'Downloaded to your device library', ja: 'デバイスのライブラリにダウンロードしました' },
  '사진을 다운로드하지 못했어요': { en: 'Could not download the photos', ja: '写真をダウンロードできませんでした' },
  '보관 화질 바꾸기': { en: 'Change storage quality', ja: '保存画質を変更' },
  '기기 사진첩으로 다운로드 중…': { en: 'Downloading to device library…', ja: 'デバイスのライブラリにダウンロード中…' },
  '기기 사진첩으로 다운로드': { en: 'Download to device library', ja: 'デバイスのライブラリにダウンロード' },
  '공유 앨범으로 바꾸기': { en: 'Turn into shared album', ja: '共有アルバムにする' },
  '표지 바꾸기': { en: 'Change cover', ja: '表紙を変更' },
  '이름 바꾸기': { en: 'Rename', ja: '名前を変更' },
  '앨범을 지울까요?': { en: 'Delete this album?', ja: 'アルバムを削除しますか？' },
  '다른 안전 앨범에 없는 사진은 안전 보관에서 삭제돼요. 기록과 기기 사진첩의 원본은 그대로예요.': { en: 'Photos that aren’t in another secure album will be deleted from secure storage. Your memories and the originals in your device library stay as they are.', ja: 'ほかのセキュアアルバムにない写真は安全保管から削除されます。思い出とデバイスのライブラリのオリジナルはそのままです。' },
  '앨범만 지워지고, 들어 있던 기록은 그대로 남아요.': { en: 'Only the album is deleted. The memories in it stay.', ja: 'アルバムだけが削除され、入っていた思い出はそのまま残ります。' },
  '지우기': { en: 'Delete', ja: '削除' },
  '앨범 메뉴': { en: 'Album menu', ja: 'アルバムのメニュー' },
  '아직 안전 보관한 사진이 없어요.\n나의 순간들에서 안전 보관할 사진을 골라 보세요.': { en: 'No securely stored photos yet.\nChoose photos to keep safe from My Moments.', ja: 'まだ安全保管した写真はありません。\nマイメモリーズから安全保管する写真を選びましょう。' },
  '아직 담은 사진이 없어요.\n나의 순간들에서 고르거나 새 사진을 담아 보세요.': { en: 'No photos yet.\nChoose from My Moments or add new photos.', ja: 'まだ写真がありません。\nマイメモリーズから選ぶか、新しい写真を追加しましょう。' },
  '나의 순간들에서 사진 올리기': { en: 'Upload from My Moments', ja: 'マイメモリーズからアップロード' },
  '나의 순간들에서 사진 추가': { en: 'Add from My Moments', ja: 'マイメモリーズから追加' },
  '아직 안전 보관한 사진이 없어요.': { en: 'No securely stored photos yet.', ja: 'まだ安全保管した写真はありません。' },
  '안전 앨범을 만들고 사진을 담으면 여기에 모여요.': { en: 'Create a secure album and add photos to see them here.', ja: 'セキュアアルバムを作って写真を追加すると、ここに集まります。' },
  '십 년 뒤에도 다시 보고 싶은 몇 장을 골라 보세요.': { en: 'Choose the few you’ll still want to see in ten years.', ja: '十年後も見返したい数枚を選びましょう。' },
  '추가': { en: 'Add', ja: '追加' },
  '빼기 취소': { en: 'Cancel', ja: 'キャンセル' },
  '빼기': { en: 'Remove', ja: '外す' },
  '다른 안전 앨범에 없는 사진은 안전 보관에서 삭제돼요.': { en: 'Photos that aren’t in another secure album will be deleted from secure storage.', ja: 'ほかのセキュアアルバムにない写真は安全保管から削除されます。' },
  '사진과 기록은 남고, 이 앨범에서만 빠져요.': { en: 'Photos and memories stay. They’re only removed from this album.', ja: '写真と思い出は残り、このアルバムから外れるだけです。' },
  '앨범 이름 바꾸기': { en: 'Rename album', ja: 'アルバム名を変更' },
  '바꾸기': { en: 'Change', ja: '変更' },
  '담은 사진을 모두 안전 보관했어요': { en: 'All photos in this album are stored safely', ja: '追加した写真はすべて安全保管しました' },
  // 사진 정리
  '남긴 사진의 원본은 기기 사진첩에 그대로 있어요.': { en: 'The originals of the photos you kept are still in your device library.', ja: '残した写真のオリジナルは、デバイスのライブラリにそのまま残っています。' },
  'Cloud를 쓰면 남긴 사진은 기기에서 지워도 지켜져요.': { en: 'With secure storage, kept photos stay safe even after you delete them from your device.', ja: '安全保管を使えば、残した写真はデバイスから削除しても守られます。' },
  '지울 사진이 없어요': { en: 'No photos to delete', ja: '削除する写真はありません' },
  '지우지 않았어요. 다시 시도할 수 있어요.': { en: 'Nothing was deleted. You can try again.', ja: '削除されていません。もう一度お試しいただけます。' },
  '한 번 더 확인한 뒤에 지워요': { en: 'You’ll confirm once more before deleting', ja: 'もう一度確認してから削除します' },
  '지울 사진': { en: 'Photo to delete', ja: '削除する写真' },
  '지우지 않을 사진': { en: 'Photo to keep', ja: '削除しない写真' },
  '지운 사진은 사진 앱의 \'최근 삭제된 항목\'에 30일 동안 있어요. iCloud 사진을 쓰고 있다면 다른 기기에서도 함께 지워져요.': { en: 'Deleted photos stay in Recently Deleted in the Photos app for 30 days. If you use iCloud Photos, they’re deleted from your other devices too.', ja: '削除した写真は、写真アプリの「最近削除した項目」に30日間残ります。iCloud写真を使っている場合は、ほかのデバイスからも削除されます。' },
  '지운 사진은 기기 휴지통으로 옮겨지고, 일정 기간이 지나면 완전히 지워져요.': { en: 'Deleted photos move to your device’s trash and are permanently deleted after a while.', ja: '削除した写真は端末のゴミ箱に移動し、一定期間が過ぎると完全に削除されます。' },
  '지운 사진은 되돌릴 수 없어요.': { en: 'Deleted photos can’t be recovered.', ja: '削除した写真は元に戻せません。' },
  '지우지 않을 사진을 눌러 주세요. 남긴 사진과 즐겨찾기는 여기에 나오지 않아요.': { en: 'Tap the photos you want to keep. Kept photos and favorites don’t appear here.', ja: '削除しない写真をタップしてください。残した写真とお気に入りはここに表示されません。' },
  '지우지 않을 사진을 눌러 주세요. 남긴 사진은 여기에 나오지 않아요.': { en: 'Tap the photos you want to keep. Kept photos don’t appear here.', ja: '削除しない写真をタップしてください。残した写真はここに表示されません。' },
  // 안전 앨범·공유 앨범 만들기
  '할당한 용량이 이 앨범의 사진보다 작아요. 더 크게 골라 주세요.': { en: 'The storage you set aside is smaller than the photos in this album. Please choose a larger amount.', ja: '割り当てた容量がこのアルバムの写真より小さいです。もっと大きな容量を選んでください。' },
  '내 안전 보관에 남은 용량보다 크게 할당할 수 없어요.': { en: 'You can’t set aside more than the space left in your secure storage.', ja: '安全保管の残り容量より大きくは割り当てられません。' },
  '지금 요금제로 가질 수 있는 공유 앨범을 모두 만들었어요.': { en: 'You’ve already created as many shared albums as your plan allows.', ja: '現在のプランで作成できる共有アルバムの上限に達しています。' },
  '공유 앨범으로 바꾸지 못했어요': { en: 'Could not turn it into a shared album', ja: '共有アルバムにできませんでした' },
  '앨범을 만들지 못했어요': { en: 'Could not create the album', ja: 'アルバムを作成できませんでした' },
  '원래 앨범은 그대로예요. 구독 상태와 인터넷 연결을 확인해 주세요.': { en: 'Your original album is unchanged. Please check your subscription and internet connection.', ja: '元のアルバムはそのままです。サブスクリプションの状態とインターネット接続を確認してください。' },
  ' 기기 앨범 연결은 공유 앨범에서 이어지지 않아요. 이후 사진은 공유 앨범에서 직접 담아 주세요.': { en: ' The link to your device album won’t carry over to the shared album, so add new photos directly in the shared album.', ja: 'デバイスのアルバムとの連携は共有アルバムには引き継がれません。今後の写真は共有アルバムで直接追加してください。' },
  '나만 보기': { en: 'Just me', ja: '自分だけ' },
  '내 계정에서만 보는 앨범': { en: 'An album only you can see', ja: '自分のアカウントだけで見るアルバム' },
  '함께 쓰기': { en: 'Shared', ja: 'みんなで使う' },
  '가족·친구·파트너와 함께 담는 공유 앨범': { en: 'A shared album to fill with family, friends, or a partner', ja: '家族・友人・パートナーと一緒に写真を追加する共有アルバム' },
  '예) 우리 둘의 여행': { en: 'e.g. Our trips together', ja: '例）ふたりの旅' },
  '예) 대학 동기 모임': { en: 'e.g. College friends', ja: '例）大学の同期' },
  '예) 엄마, 큰딸': { en: 'e.g. Mom, Emma', ja: '例）ママ、長女' },
  '예) 자기, 지민': { en: 'e.g. Honey, Alex', ja: '例）ダーリン、ゆうき' },
  '예) 지민': { en: 'e.g. Alex', ja: '例）ゆうき' },
  '이름은 앨범마다 따로 정해요. 가족 앨범에선 ‘엄마’, 친구 앨범에선 ‘지민’처럼요. 내가 담은 사진에 표시되고, 계정 이메일은 다른 구성원에게 보이지 않아요. 나중에 앨범 화면에서 바꿀 수 있어요.': { en: 'You set a name for each album, like “Mom” in a family album or “Alex” in a friends album. It appears on the photos you add, and your account email is never shown to other members. You can change it later from the album screen.', ja: '名前はアルバムごとに決めます。家族のアルバムでは「ママ」、友人のアルバムでは「ゆうき」のように。自分が追加した写真に表示され、アカウントのメールアドレスはほかのメンバーには表示されません。あとからアルバム画面で変更できます。' },
  '앨범 용량은 구성원이 각자 나눠 준 용량을 합한 만큼이에요. 나눠 준 용량은 내 안전 보관에서 미리 빠지고, 앨범에 담긴 사진은 내 개인 용량이 아니라 앨범 용량에서 세요.': { en: 'An album’s storage is the total that each member shares with it. Storage you share is set aside from your secure storage up front, and photos in the album count against the album’s storage, not your own.', ja: 'アルバムの容量は、メンバーがそれぞれ割り当てた容量の合計です。割り当てた容量は安全保管からあらかじめ差し引かれ、アルバム内の写真は個人の容量ではなくアルバムの容量で数えます。' },
  ' 이 앨범의 사진이 쓰던 용량도 앨범으로 옮겨 가므로, 그보다 크게 골라 주세요.': { en: ' The space this album’s photos use moves to the album too, so choose more than that.', ja: 'このアルバムの写真が使っていた容量もアルバムに移るため、それより大きな容量を選んでください。' },
  '새로 만들기': { en: 'Create new', ja: '新しく作成' },
  '기기 앨범을 안전 보관에 동기화': { en: 'Sync a device album to secure storage', ja: 'デバイスのアルバムを安全保管と同期' },
  '예) 아이의 첫 해, 부모님 사진': { en: 'e.g. Baby’s first year, Photos of Mom and Dad', ja: '例）赤ちゃんの1年目、両親の写真' },
  '만든 뒤 나의 순간들에서 안전 보관할 사진을 골라요. 기기 사진첩의 앨범에는 보이지 않아요.': { en: 'After creating it, you’ll choose photos to keep safe from My Moments. It won’t appear among the albums in your Device Library.', ja: '作成後、マイメモリーズから安全保管する写真を選びます。デバイスのライブラリのアルバムには表示されません。' },
  '아직 기기 사진첩에 만든 앨범이 없어요. 기기 사진첩에서 앨범을 만들거나, 새로 만들기를 골라 주세요.': { en: 'You haven’t created any albums in your Device Library yet. Create one there, or choose Create new.', ja: 'デバイスのライブラリにはまだアルバムがありません。デバイスのライブラリでアルバムを作るか、「新しく作成」を選んでください。' },
  '지금 담긴 사진을 모두 올리고, 앞으로 기기 앨범에 넣는 사진도 따라 올려요. 기기 앨범에서 빼도 안전 앨범의 사진은 그대로 남아요.': { en: 'All photos currently in the album are uploaded, and photos you add to the device album later are uploaded too. Removing a photo from the device album keeps it in the secure album.', ja: '今入っている写真をすべてアップロードし、今後デバイスのアルバムに追加した写真も自動でアップロードします。デバイスのアルバムから外しても、セキュアアルバムの写真はそのまま残ります。' },
  '구성원이 담는 사진은 이 화질로 보관하고, 구성원이 나눠 준 앨범 용량에서 세요. 관리자는 나중에 바꿀 수 있어요.': { en: 'Photos members add are stored at this quality and count against the storage members share with the album. Admins can change this later.', ja: 'メンバーが追加する写真はこの画質で保管し、メンバーが割り当てたアルバムの容量で数えます。管理者はあとから変更できます。' },
  '앨범마다 다르게 고를 수 있고, 나중에 앨범 메뉴에서 바꿀 수 있어요. 원본을 보관해도 빠르게 보여 줄 보기용 사진을 함께 만들어 둬요.': { en: 'You can choose differently for each album and change it later from the album menu. Even when originals are stored, a viewing copy is made so photos load quickly.', ja: 'アルバムごとに選べて、あとからアルバムのメニューで変更できます。オリジナルを保管する場合も、すばやく表示できるよう表示用の写真を一緒に作っておきます。' },
  '• 만든 사람이 소유자이자 관리자예요. 관리자는 여러 명 둘 수 있고, 구성원을 초대·내보내고 모든 사진을 뺄 수 있어요.': { en: '• The creator is the owner and an admin. An album can have several admins, who can invite and remove members and remove any photo.', ja: '• 作成した人がオーナー兼管理者です。管理者は複数置くことができ、メンバーの招待・削除やすべての写真の削除ができます。' },
  '• 다른 구성원은 자기가 담은 사진만 뺄 수 있어요.': { en: '• Other members can only remove photos they added.', ja: '• ほかのメンバーは、自分が追加した写真だけを削除できます。' },
  '• 앨범 용량에 여유가 있으면 구독하지 않은 구성원도 보고 담을 수 있어요.': { en: '• As long as the album has space, members without a subscription can view and add photos too.', ja: '• アルバムの容量に余裕があれば、サブスクリプションに登録していないメンバーも閲覧・追加できます。' },
  '• 메모와 장소는 함께 보내지 않아요.': { en: '• Notes and places are not shared.', ja: '• メモと場所は共有されません。' },
  '만들고 초대하기': { en: 'Create and invite', ja: '作成して招待' },
  '만들고 사진 고르기': { en: 'Create and choose photos', ja: '作成して写真を選ぶ' },
  '연결하기': { en: 'Link', ja: '連携する' },
  '이미 연결했어요': { en: 'Already linked', ja: '連携済み' },
  '함께': { en: 'Other', ja: 'その他' },
  // 안전 보관(구독)
  '문제가 생겼어요': { en: 'Something went wrong', ja: '問題が発生しました' },
  '다시 구독해 주셔서 고마워요': { en: 'Thanks for subscribing again', ja: '再登録ありがとうございます' },
  '안전 보관을 시작했어요': { en: 'Secure storage is on', ja: '安全保管を開始しました' },
  '백업한 기록이 그대로 이어져요.': { en: 'Your backed-up memories carry right on.', ja: 'バックアップした思い出はそのまま引き継がれます。' },
  '구매를 확인하는 중이에요': { en: 'Confirming your purchase', ja: '購入を確認しています' },
  '잠시 후 설정 화면에서 상태가 바뀌어요.': { en: 'Your status in Settings will update shortly.', ja: 'まもなく設定画面の状態が切り替わります。' },
  '안전 보관에 연결했어요': { en: 'Connected to secure storage', ja: '安全保管に接続しました' },
  '이 계정의 기록을 받아올게요. 이 기기의 기록은 백업하기로 고른 것만 들어가요.': { en: 'We’ll bring in this account’s memories. Only the memories on this device that you choose to back up will be added.', ja: 'このアカウントの思い出を読み込みます。このデバイスの思い出は、バックアップを選んだものだけが追加されます。' },
  '로그인했어요': { en: 'You’re signed in', ja: 'ログインしました' },
  '이제 메모·장소·앨범을 이 계정에 백업해요. 사진까지 안전 보관하려면 구독해 주세요.': { en: 'Your notes, places, and albums will now be backed up to this account. Subscribe to keep your photos safe too.', ja: 'これからはメモ・場所・アルバムをこのアカウントにバックアップします。写真まで安全保管するには、サブスクリプションに登録してください。' },
  '백업한 사진을 다른 기기에서도 찾을 수 있도록, 구독 전에 로그인해 주세요.': { en: 'Sign in before subscribing so you can find your backed-up photos on other devices too.', ja: 'バックアップした写真をほかのデバイスでも見られるよう、購読の前にログインしてください。' },
  '이미 구독 중이라면 같은 계정으로 로그인하면 백업한 기록을 받아와요.': { en: 'Already subscribed? Sign in with the same account to bring back your backed-up memories.', ja: 'すでに購読中なら、同じアカウントでログインするとバックアップした思い出を受け取れます。' },
  '지금 다시 구독하면 아무것도 다시 올리지 않고 바로 이어서 쓸 수 있어요.': { en: 'Subscribe again now to pick up right where you left off, without uploading anything again.', ja: '今再登録すれば、何も再アップロードせずにそのまま続けて使えます。' },
  '구독 상품을 불러오지 못했어요. 잠시 후 다시 열어 주세요.': { en: 'Could not load subscription options. Please open this again in a moment.', ja: 'サブスクリプションを読み込めませんでした。しばらくしてからもう一度開いてください。' },
  '구독은 기간이 끝나기 24시간 전까지 해지하지 않으면 자동으로 갱신돼요. 해지는 스토어의 구독 관리에서 할 수 있어요. 구독이 끝나면 30일 동안 보관한 사진을 내려받을 수 있고, 그 뒤 사진은 삭제돼요. 기록 백업은 로그인한 동안 계속돼요.': { en: 'Your subscription renews automatically unless canceled at least 24 hours before the end of the current period. You can cancel in your store’s subscription settings. When a subscription ends, you can download your stored photos for 30 days, after which they are deleted. Memory backup continues while you’re signed in.', ja: 'サブスクリプションは、期間終了の24時間前までに解約しない限り自動的に更新されます。解約はストアのサブスクリプション管理から行えます。サブスクリプション終了後30日間は保管した写真をダウンロードでき、その後写真は削除されます。思い出のバックアップはログイン中は続きます。' },
  '이용약관': { en: 'Terms of Service', ja: '利用規約' },
  '개인정보처리방침': { en: 'Privacy Policy', ja: 'プライバシーポリシー' },
  // 지난 사진
  '고르기로 돌아가기': { en: 'Back to Choose Photos', ja: '「写真を選ぶ」に戻る' },
  '남기면 사진첩에서 다시 볼 수 있어요': { en: 'Kept photos can be revisited in your library', ja: '残した写真はライブラリでいつでも見返せます' },
  // 기록 화면
  '장소를 찾지 못했어요': { en: 'Could not find the place', ja: '場所が見つかりませんでした' },
  '인터넷 연결을 확인하거나 직접 입력해 주세요.': { en: 'Check your internet connection, or type it in yourself.', ja: 'インターネット接続を確認するか、直接入力してください。' },
  '기록에서 빼지 못했어요': { en: 'Could not remove from memories', ja: '思い出から削除できませんでした' },
  '모든 앨범에서 사라지고, 남긴 메모와 장소도 지워져요. 기기 사진첩의 사진은 그대로예요.': { en: 'It will disappear from every album, and its notes and place will be deleted too. The photo in your device library stays.', ja: 'すべてのアルバムから消え、残したメモと場所も削除されます。デバイスのライブラリの写真はそのままです。' },
  '기록에서 뺄까요?': { en: 'Remove from memories?', ja: '思い出から削除しますか？' },
  '공유 앨범에는 남기기': { en: 'Keep in shared albums', ja: '共有アルバムには残す' },
  '공유 앨범에서도 빼기': { en: 'Remove from shared albums too', ja: '共有アルバムからも外す' },
  '공유 앨범에서 빼지 못했어요': { en: 'Could not remove from shared albums', ja: '共有アルバムから外せませんでした' },
  '인터넷 연결을 확인해 주세요. 기록은 그대로예요.': { en: 'Please check your internet connection. Your memory is unchanged.', ja: 'インターネット接続を確認してください。思い出はそのままです。' },
  '사진 크게 보기': { en: 'View photo', ja: '写真を拡大表示' },
  '사진을 찍은 곳': { en: 'Where this was taken', ja: '撮影した場所' },
  '사진 위치로 채우기': { en: 'Use photo location', ja: '写真の位置情報で入力' },
  '이 순간을 남기고 싶은 이유, 그때의 생각이나 기억을 적어 보세요.': { en: 'Why do you want to keep this moment? Write down what you were thinking or what you remember.', ja: 'この瞬間を残したい理由や、そのときの気持ち、思い出を書いてみましょう。' },
  '원본이 안전 보관함에 있어요. 기기 사진첩에서 지워도 남아요.': { en: 'The original is in secure storage. It stays even if you delete it from your device library.', ja: 'オリジナルは安全保管にあります。デバイスのライブラリから削除しても残ります。' },
  '사진은 기기 사진첩의 원본을 그대로 보여줘요. 기기 사진첩에서 지우면 여기서도 보이지 않아요.': { en: 'This shows the original from your device library. If you delete it there, it won’t appear here either.', ja: '写真はデバイスのライブラリのオリジナルをそのまま表示しています。デバイスのライブラリから削除すると、ここでも表示されなくなります。' },
  '원본을 보관할 수 없어요': { en: 'Can’t store the original', ja: 'オリジナルを保管できません' },
  '기기 사진첩에 원본이 없어요. 원본은 기기 사진첩에 있을 때만 올릴 수 있어요.': { en: 'The original isn’t in your device library. Originals can only be uploaded while they’re in your device library.', ja: 'デバイスのライブラリにオリジナルがありません。オリジナルは、デバイスのライブラリにある場合のみアップロードできます。' },
  '안전 보관한 원본을 지울까요?': { en: 'Delete the stored original?', ja: '安全保管したオリジナルを削除しますか？' },
  '720p로 줄인 영상과 대표 장면만 남아요. 720p 영상을 올린 뒤에 원본을 지워요.': { en: 'Only a 720p version and a cover frame will remain. The original is deleted after the 720p video is uploaded.', ja: '720pに縮小した動画と代表シーンだけが残ります。720pの動画をアップロードしてからオリジナルを削除します。' },
  '긴 변 2048px 보기용 사진만 남아요.': { en: 'Only a viewing copy at 2048px on the long edge will remain.', ja: '長辺2048pxの表示用写真だけが残ります。' },
  '기기 사진첩에 원본이 있는 동안에는 다시 원본으로 바꿀 수 있어요.': { en: 'As long as the original is in your device library, you can switch back to Original quality.', ja: 'デバイスのライブラリにオリジナルがある間は、オリジナルに戻せます。' },
  '기기 사진첩에 원본이 없어 720p 영상을 만들 수 없으니, 원본은 그대로 남겨 둬요.': { en: 'The original isn’t in your device library, so a 720p version can’t be made. The original will be kept.', ja: 'デバイスのライブラリにオリジナルがないため720pの動画を作れません。オリジナルはそのまま残します。' },
  '기기 사진첩에도 원본이 없어서 지우면 되돌릴 수 없어요.': { en: 'The original isn’t in your device library either, so this can’t be undone.', ja: 'デバイスのライブラリにもオリジナルがないため、削除すると元に戻せません。' },
  '효율 보관으로': { en: 'Switch to Space saver', ja: '省スペース保存にする' },
  '이 사진의 보관 화질': { en: 'Storage quality for this photo', ja: 'この写真の保存画質' },
  '원본 보관 공유 앨범에 담겨 있어서 원본은 늘 함께 남아요.': { en: 'This photo is in a shared album that stores originals, so the original is always kept.', ja: 'オリジナル保存の共有アルバムに入っているため、オリジナルは常に残ります。' },
  // 앨범 고르기·용량 고르기
  '기기 앨범': { en: 'Device albums', ja: 'デバイスのアルバム' },
  '안전 앨범': { en: 'Secure albums', ja: 'セキュアアルバム' },
  '만들고 넣기': { en: 'Create and add', ja: '作成して追加' },
  '할당 안 함': { en: 'None', ja: '割り当てない' },
  '내 안전 보관에서 쓸 수 있는 용량: ': { en: 'Available in your secure storage: ', ja: '安全保管で使える容量：' },
  // 공통 컴포넌트
  '앨범에서 뺄 사진 선택': { en: 'Select photo to remove from album', ja: 'アルバムから外す写真を選択' },
  '재생할 수 있는 동영상을 찾지 못했어요.': { en: 'Couldn’t find a playable video.', ja: '再生できる動画が見つかりませんでした。' },
  '알림': { en: 'Notifications', ja: '通知' },
  '사진을 불러오지 못했어요.': { en: 'Could not load the photo.', ja: '写真を読み込めませんでした。' },
  '재생할 수 있는 동영상이 아직 없어요.': { en: 'No playable video yet.', ja: '再生できる動画はまだありません。' },
  '내가 담았어요': { en: 'Added by you', ja: '自分が追加' },
  '보여줄 사진이 없어요.': { en: 'No photos to show.', ja: '表示する写真がありません。' },
  '기록 보기': { en: 'View memory', ja: '思い出を見る' },
  '기기 사진첩에서 찾을 수 없는 사진이에요.': { en: 'This photo can’t be found in your device library.', ja: 'デバイスのライブラリに見つからない写真です。' },
  '메모와 장소, 날짜는 그대로 남아 있어요.': { en: 'Its notes, place, and date are still here.', ja: 'メモ・場所・日付はそのまま残っています。' },
  '공유 앨범을 불러오지 못했어요. 잠시 후 다시 열어 주세요.': { en: 'Could not load shared albums. Please open this again in a moment.', ja: '共有アルバムを読み込めませんでした。しばらくしてからもう一度開いてください。' },
  '가족·친구·파트너와 함께 사진을 담는 앨범이에요.': { en: 'Albums you fill together with family, friends, or a partner.', ja: '家族・友人・パートナーと一緒に写真を追加するアルバムです。' },
  '누가 담았는지 사진마다 보이고, 각자 담은 사진은 각자 관리해요.': { en: 'Each photo shows who added it, and everyone manages the photos they added.', ja: '誰が追加したかが写真ごとに表示され、自分が追加した写真はそれぞれが管理します。' },
  '이 빌드에서는 로그인을 사용할 수 없어요.': { en: 'Sign-in isn’t available in this build.', ja: 'このビルドではログインを利用できません。' },
  '고르기 알림과 안전 보관 소식이 여기에 모여요. 고르기 알림은 설정 탭에서 켤 수 있어요.': { en: 'Photo review reminders and secure storage updates appear here. You can turn on reminders in the Settings tab.', ja: '写真を選ぶリマインダーと安全保管のお知らせがここに表示されます。リマインダーは設定タブでオンにできます。' },
  'Keepsake는 아래 오픈소스 소프트웨어를 사용해요. 각 소프트웨어는 표시된 라이선스를 따릅니다.': { en: 'Keepsake uses the open-source software below. Each is provided under the license shown.', ja: 'Keepsakeは以下のオープンソースソフトウェアを使用しています。各ソフトウェアには記載のライセンスが適用されます。' },
  // 공유 앨범 참여
  '초대를 찾지 못했어요': { en: 'Invitation not found', ja: '招待が見つかりませんでした' },
  '코드가 틀렸거나 기한(7일)이 지났어요. 초대한 사람에게 새 코드를 받아 주세요.': { en: 'The code is wrong or has expired (codes last 7 days). Ask the person who invited you for a new one.', ja: 'コードが間違っているか、有効期限（7日間）が過ぎています。招待した人に新しいコードをもらってください。' },
  '인터넷 연결을 확인해 주세요.': { en: 'Please check your internet connection.', ja: 'インターネット接続を確認してください。' },
  '참여하지 못했어요': { en: 'Could not join', ja: '参加できませんでした' },
  '이 앨범은 구성원이 가득 찼어요.': { en: 'This album is full.', ja: 'このアルバムはメンバーの上限に達しています。' },
  '내 안전 보관에 남은 용량보다 크게 나눠 줄 수 없어요.': { en: 'You can’t share more than the space left in your secure storage.', ja: '安全保管の残り容量より多くは割り当てられません。' },
  '공유 앨범에 참여하려면 먼저 로그인해 주세요.': { en: 'Sign in first to join a shared album.', ja: '共有アルバムに参加するには、先にログインしてください。' },
  '로그인은 무료예요.': { en: 'Signing in is free.', ja: 'ログインは無料です。' },
  '8자리 코드': { en: '8-character code', ja: '8桁のコード' },
  '공유 앨범 관리자에게 받은 코드를 입력해 주세요.': { en: 'Enter the code you got from the shared album’s admin.', ja: '共有アルバムの管理者から受け取ったコードを入力してください。' },
  '예) 아빠, 서준': { en: 'e.g. Dad, Sam', ja: '例）パパ、そうた' },
  '내가 담은 사진에 이 이름이 표시돼요. 이름은 앨범마다 따로 정해요.': { en: 'This name appears on the photos you add. You set a separate name for each album.', ja: '自分が追加した写真にこの名前が表示されます。名前はアルバムごとに決めます。' },
  '앨범 용량은 구성원이 나눠 준 용량을 합한 만큼이에요. 나눠 주면 앨범에 더 많이 담을 수 있고, 그만큼 내 안전 보관에서 미리 빠져요. 나중에 바꿀 수 있어요.': { en: 'An album’s storage is the total its members share. Sharing more lets the album hold more, and that amount is set aside from your secure storage. You can change this later.', ja: 'アルバムの容量は、メンバーが割り当てた容量の合計です。割り当てるとアルバムにより多く追加でき、その分は安全保管からあらかじめ差し引かれます。あとから変更できます。' },
  '안전 보관을 구독하지 않아도 다른 구성원이 나눠 준 용량으로 함께 보고 담을 수 있어요. 구독하면 내 용량도 나눠 줄 수 있어요.': { en: 'Even without a secure storage subscription, you can view and add photos using the storage other members share. Subscribe to share your own storage too.', ja: '安全保管を購読していなくても、ほかのメンバーが割り当てた容量で一緒に閲覧・追加できます。購読すると自分の容量も割り当てられます。' },
  // 공유 앨범에 사진 담기
  '사진을 담지 못했어요': { en: 'Could not add the photos', ja: '写真を追加できませんでした' },
  '앨범 용량이 모자라요. 앨범 관리에서 용량을 더 나눠 주거나, 사진을 조금만 골라 주세요.': { en: 'There isn’t enough album storage. Share more storage in Manage Album, or choose fewer photos.', ja: 'アルバムの容量が足りません。アルバムの管理で容量をさらに割り当てるか、写真を少なめに選んでください。' },
  '담기': { en: 'Add', ja: '追加' },
  '구성원과 함께 볼 사진을 골라 주세요.': { en: 'Choose photos to share with members.', ja: 'メンバーと一緒に見る写真を選んでください。' },
  '메모와 장소는 함께 보내지 않아요.': { en: 'Notes and places aren’t shared.', ja: 'メモと場所は共有されません。' },
  // 공유 앨범 화면
  '더 이상 이 공유 앨범의 구성원이 아니에요.': { en: 'You’re no longer a member of this shared album.', ja: 'この共有アルバムのメンバーではなくなりました。' },
  '공유 앨범을 불러오지 못했어요.\n인터넷 연결을 확인해 주세요.': { en: 'Could not load the shared album.\nPlease check your internet connection.', ja: '共有アルバムを読み込めませんでした。\nインターネット接続を確認してください。' },
  '앨범에 나눠 준 용량이 없어요': { en: 'No storage has been shared with this album', ja: 'アルバムに割り当てられた容量がありません' },
  '앨범 용량이 가득 찼어요': { en: 'The album’s storage is full', ja: 'アルバムの容量がいっぱいです' },
  '앨범 관리에서 내 용량을 더 나눠 주거나, 담긴 사진을 정리하면 다시 담을 수 있어요.': { en: 'Share more of your storage in Manage Album, or clear out some photos, to add more.', ja: 'アルバムの管理で容量をさらに割り当てるか、写真を整理すると、また追加できます。' },
  '구성원이 용량을 더 나눠 주거나 사진을 정리하면 다시 담을 수 있어요. 안전 보관을 구독하면 내 용량도 나눠 줄 수 있어요.': { en: 'You can add more once a member shares more storage or some photos are cleared out. Subscribe to secure storage to share your own storage too.', ja: 'メンバーが容量をさらに割り当てるか写真を整理すると、また追加できます。安全保管を購読すると、自分の容量も割り当てられます。' },
  '앨범 관리': { en: 'Manage Album', ja: 'アルバムを管理' },
  '뺄 수 없는 사진이에요': { en: 'You can’t remove this photo', ja: 'この写真は外せません' },
  '구성원 모두에게서 사라져요. 올린 사람의 기록과 기기 사진첩의 사진은 그대로예요.': { en: 'They’ll disappear for every member. The uploaders’ memories and the photos in their device libraries stay as they are.', ja: 'すべてのメンバーから見えなくなります。追加した人の思い出とデバイスのライブラリの写真はそのままです。' },
  '사진을 빼지 못했어요': { en: 'Could not remove the photos', ja: '写真を外せませんでした' },
  '표지를 바꾸지 못했어요': { en: 'Could not change the cover', ja: '表紙を変更できませんでした' },
  '이름을 바꾸지 못했어요': { en: 'Could not change the name', ja: '名前を変更できませんでした' },
  '다른 구성원의 사진은 이미 모두 기기 사진첩에 저장했어요.': { en: 'You’ve already saved all photos from other members to your device library.', ja: 'ほかのメンバーの写真は、すべてデバイスのライブラリに保存済みです。' },
  '원본이 있으면 원본을, 효율 보관 사진은 저장된 효율 파일을 내려받아요.': { en: 'Originals are downloaded when available; Space saver photos download their stored copy.', ja: 'オリジナルがあればオリジナルを、省スペース保存の写真は保存されているファイルをダウンロードします。' },
  '구성원과 앨범 관리': { en: 'Members & album settings', ja: 'メンバーとアルバムの管理' },
  '나': { en: 'Me', ja: '自分' },
  '구성원 모두에게서 빠져요. 올린 사람의 기록은 남아요.': { en: 'They’ll be removed for every member. The uploaders’ memories stay.', ja: 'すべてのメンバーから外れます。追加した人の思い出は残ります。' },
  '내가 담은 사진만 뺄 수 있어요.': { en: 'You can only remove photos you added.', ja: '自分が追加した写真だけを外せます。' },
  '이 구성원이 담은 사진이 없어요.': { en: 'This member hasn’t added any photos.', ja: 'このメンバーが追加した写真はありません。' },
  '아직 담은 사진이 없어요.\n위의 [추가]로 함께 볼 사진을 담아 보세요.': { en: 'No photos yet.\nTap Add above to share some photos.', ja: 'まだ写真がありません。\n上の［追加］から一緒に見る写真を追加しましょう。' },
  '구성원 모두에게 바뀐 이름으로 보여요.': { en: 'Every member will see the new name.', ja: 'すべてのメンバーに新しい名前で表示されます。' },
  '이 앨범에서 보일 내 이름 바꾸기': { en: 'Change your name in this album', ja: 'このアルバムでの表示名を変更' },
  '예) 엄마, 지민': { en: 'e.g. Mom, Alex', ja: '例）ママ、ゆうき' },
  '이 앨범에만 적용돼요. 내가 담은 사진의 이름표가 모두 바뀌어요.': { en: 'Applies to this album only. The name on every photo you added will change.', ja: 'このアルバムにだけ適用されます。自分が追加した写真の名前がすべて変わります。' },
  '초대 코드를 받은 사람이 참여하면 서로 담은 사진을 함께 볼 수 있어요. 담은 사진은 앨범 용량에서 세고, 참여한 사람이 용량을 나눠 주면 앨범 용량도 늘어나요.': { en: 'When someone joins with your invite code, you can see each other’s photos. Photos count against the album’s storage, which grows as members share their storage.', ja: '招待コードを受け取った人が参加すると、お互いが追加した写真を一緒に見られます。写真はアルバムの容量で数え、参加した人が容量を割り当てるとアルバムの容量も増えます。' },
  '초대하기': { en: 'Invite', ja: '招待する' },
  '모두': { en: 'All', ja: 'すべて' },
  '나간 구성원': { en: 'Former member', ja: '退出したメンバー' },
  '저장하지 못했어요': { en: 'Could not save', ja: '保存できませんでした' },
  '이 앨범에 나눠 준 용량이 없어요': { en: 'No storage has been shared with this album', ja: 'このアルバムに割り当てられた容量がありません' },
  '용량을 나눠 준 구성원이 모두 나갔거나 구독이 끝나 새 사진도 담을 수 없어요. 그 전에 누군가 용량을 나눠 주면 그대로 이어져요. 간직할 사진은 기기 사진첩에 저장해 두세요.': { en: 'Everyone who shared storage has left or their subscription has ended, so no new photos can be added. If someone shares storage before then, the album carries on. Save any photos you want to keep to your device library.', ja: '容量を割り当てていたメンバーが全員退出したかサブスクリプションが終了したため、新しい写真も追加できません。それまでに誰かが容量を割り当てれば、そのまま続けられます。残したい写真はデバイスのライブラリに保存しておいてください。' },
  '앨범 관리에서 용량 나눠 주기': { en: 'Share storage in Manage Album', ja: 'アルバムの管理で容量を割り当てる' },
  '저장하는 중…': { en: 'Saving…', ja: '保存中…' },
  '앨범 용량': { en: 'Album storage', ja: 'アルバムの容量' },
  '구성원이 나가거나 구독이 끝나 앨범 용량이 줄었어요. 사진은 그대로 볼 수 있지만, 정리하기 전까지 새 사진은 담을 수 없어요. 아래 중에서 골라 주세요.': { en: 'The album’s storage shrank because a member left or a subscription ended. You can still view every photo, but you can’t add new ones until you free up space. Choose one of the options below.', ja: 'メンバーの退出やサブスクリプションの終了でアルバムの容量が減りました。写真はそのまま見られますが、整理するまで新しい写真は追加できません。以下から選んでください。' },
  '사진을 한 장씩 빼려면 사진을 눌러 크게 본 뒤 휴지통을 눌러요. 공유 앨범 용량만 따로 늘리는 추가 결제는 준비하고 있어요.': { en: 'To remove photos one at a time, open a photo and tap the trash icon. A separate add-on for more shared album storage is coming soon.', ja: '写真を1枚ずつ外すには、写真をタップして拡大表示し、ゴミ箱をタップします。共有アルバムの容量だけを増やす追加購入は準備中です。' },
  '공유 앨범에서 뺄까요?': { en: 'Remove from shared album?', ja: '共有アルバムから外しますか？' },
  '구성원 모두에게서 사라져요. 내 기록과 기기 사진첩의 사진은 그대로예요.': { en: 'It’ll disappear for every member. Your memory and the photo in your device library stay as they are.', ja: 'すべてのメンバーから見えなくなります。自分の思い出とデバイスのライブラリの写真はそのままです。' },
  '효율 보관으로 바꿀까요?': { en: 'Switch to Space saver?', ja: '省スペース保存に切り替えますか？' },
  '원본은 앨범 용량에서 빠지고, 다른 앨범에 필요 없는 원본은 담은 사람의 기기가 지워요. 지운 원본은 되돌릴 수 없어요.': { en: 'Originals no longer count against the album’s storage, and originals no other album needs are deleted by the uploader’s device. Deleted originals can’t be recovered.', ja: 'オリジナルはアルバムの容量から外れ、ほかのアルバムで不要なオリジナルは追加した人のデバイスが削除します。削除したオリジナルは元に戻せません。' },
  '화질을 바꾸지 못했어요': { en: 'Could not change the quality', ja: '画質を変更できませんでした' },
  ' · 바꾸기': { en: ' · Change', ja: ' · 変更' },
  '공유 앨범에서 빼기': { en: 'Remove from shared album', ja: '共有アルバムから外す' },
  // 공유 앨범 구성원·설정
  '앨범에는 관리자가 한 명 이상 있어야 해요. 다른 구성원을 먼저 관리자로 지정해 주세요.': { en: 'An album needs at least one admin. Make another member an admin first.', ja: 'アルバムには管理者が1人以上必要です。先にほかのメンバーを管理者にしてください。' },
  '이 작업은 관리자만 할 수 있어요.': { en: 'Only admins can do this.', ja: 'この操作は管理者だけが行えます。' },
  '초대 코드를 바꾸지 못했어요': { en: 'Could not update the invite code', ja: '招待コードを変更できませんでした' },
  '초대': { en: 'Invite', ja: '招待' },
  '초대 보내기': { en: 'Send invite', ja: '招待を送る' },
  '초대 코드를 만들어 가족·친구에게 보내면, 받은 사람이 안전 사진첩의 [초대 코드로 참여]에서 들어와요. 코드는 7일 동안 쓸 수 있어요.': { en: 'Create an invite code and send it to family or friends. They can join from Join with code in their Secure Library. Codes work for 7 days.', ja: '招待コードを作って家族や友人に送ると、受け取った人はセキュアライブラリの［コードで参加］から参加できます。コードは7日間使えます。' },
  '나가지 못했어요': { en: 'Could not leave the album', ja: 'アルバムから退出できませんでした' },
  '내보내지 못했어요': { en: 'Could not remove the member', ja: 'メンバーを外せませんでした' },
  '혼자 남은 앨범이라 앨범이 지워져요.': { en: 'You’re the only member, so the album will be deleted.', ja: 'メンバーが自分だけなので、アルバムは削除されます。' },
  '공유 앨범에서 나갈까요?': { en: 'Leave this shared album?', ja: '共有アルバムから退出しますか？' },
  '나가기': { en: 'Leave', ja: '退出' },
  '내보내기': { en: 'Remove', ja: '外す' },
  '사진을 빼도 용량이 넘쳐요.': { en: 'The album will still be over its storage even if the photos are removed.', ja: '写真を外しても容量を超えたままです。' },
  '사진은 앨범에 남기기': { en: 'Keep photos in album', ja: '写真はアルバムに残す' },
  '사진도 앨범에서 빼기': { en: 'Remove photos too', ja: '写真もアルバムから外す' },
  '관리자로 지정': { en: 'Make admin', ja: '管理者にする' },
  '관리자에서 해제': { en: 'Remove as admin', ja: '管理者から外す' },
  '역할을 바꾸지 못했어요': { en: 'Could not change the role', ja: '役割を変更できませんでした' },
  '소유자 넘기기': { en: 'Transfer ownership', ja: 'オーナーを引き継ぐ' },
  '공유 앨범 개수는 소유자의 요금제에서 세요. 넘겨받는 사람은 안전 보관을 구독 중이고, 공유 앨범을 더 가질 수 있어야 해요. 나는 관리자로 남아요.': { en: 'Shared albums count toward the owner’s plan. The new owner needs a secure storage subscription with room for another shared album. You’ll stay on as an admin.', ja: '共有アルバムの数はオーナーのプランで数えます。引き継ぐ人は安全保管を購読中で、共有アルバムをさらに持てる必要があります。自分は管理者として残ります。' },
  '넘기기': { en: 'Transfer', ja: '引き継ぐ' },
  '소유자를 넘기지 못했어요': { en: 'Could not transfer ownership', ja: 'オーナーを引き継げませんでした' },
  '앨범에서 내보내기': { en: 'Remove from album', ja: 'アルバムから外す' },
  '(구독이 끝나 세지 않아요)': { en: '(not counted — subscription ended)', ja: '（サブスクリプション終了のため数えません）' },
  '나눈 용량 없음': { en: 'No storage shared', ja: '割り当てなし' },
  '관리자는 여러 명 둘 수 있어요. 관리자는 모든 사진을 빼고 구성원과 앨범을 관리하고, 구성원은 자기가 담은 사진만 뺄 수 있어요. 소유자는 관리자 중 한 명으로, 이 앨범을 자기 요금제의 공유 앨범 수로 세요.': { en: 'An album can have several admins. Admins can remove any photo and manage members and the album; members can only remove photos they added. The owner is one of the admins, and this album counts toward the owner’s plan.', ja: '管理者は複数置くことができます。管理者はすべての写真を外し、メンバーとアルバムを管理できます。メンバーは自分が追加した写真だけを外せます。オーナーは管理者の1人で、このアルバムはオーナーのプランの共有アルバム数に含まれます。' },
  '나눠 준 용량을 바꾸지 못했어요': { en: 'Could not change your shared storage', ja: '割り当てた容量を変更できませんでした' },
  '이 앨범에 나눠 준 내 용량': { en: 'Storage you share with this album', ja: 'このアルバムに割り当てた容量' },
  '앨범을 바꾸지 못했어요': { en: 'Could not update the album', ja: 'アルバムを変更できませんでした' },
  '원본 그대로 보관할까요?': { en: 'Store in original quality?', ja: 'オリジナル品質で保管しますか？' },
  '원본은 앨범 용량에서 빠지고, 다른 앨범에 필요 없는 원본은 담은 사람의 기기가 지워요. 지운 원본은 되돌릴 수 없어요. 사진마다 따로 화질을 고른 사진은 그대로예요.': { en: 'Originals no longer count against the album’s storage, and originals no other album needs are deleted by the uploader’s device. Deleted originals can’t be recovered. Photos with their own quality setting stay as they are.', ja: 'オリジナルはアルバムの容量から外れ、ほかのアルバムで不要なオリジナルは追加した人のデバイスが削除します。削除したオリジナルは元に戻せません。写真ごとに画質を選んだ写真はそのままです。' },
  '구성원의 기기에 원본이 남아 있으면 원본도 올라가요. 앨범 용량을 더 써요. 사진마다 따로 화질을 고른 사진은 그대로예요.': { en: 'Originals still on members’ devices will be uploaded too, using more of the album’s storage. Photos with their own quality setting stay as they are.', ja: 'メンバーのデバイスにオリジナルが残っていれば、オリジナルもアップロードされます。アルバムの容量を多く使います。写真ごとに画質を選んだ写真はそのままです。' },
  '앨범 설정': { en: 'Album settings', ja: 'アルバムの設定' },
  '공유 앨범을 지울까요?': { en: 'Delete this shared album?', ja: '共有アルバムを削除しますか？' },
  '구성원 모두에게서 앨범이 사라져요. 각자의 기록과 다른 앨범의 사진은 그대로예요.': { en: 'The album will disappear for every member. Everyone’s memories and photos in other albums stay as they are.', ja: 'すべてのメンバーからアルバムが見えなくなります。それぞれの思い出とほかのアルバムの写真はそのままです。' },
  '앨범을 지우지 못했어요': { en: 'Could not delete the album', ja: 'アルバムを削除できませんでした' },
  '앨범에서 나가기': { en: 'Leave album', ja: 'アルバムから退出' },
  '소유자가 나가면 공유 앨범을 더 가질 수 있는 관리자나 구성원에게 소유자가 넘어가요.': { en: 'If the owner leaves, ownership passes to an admin or member who has room for another shared album.', ja: 'オーナーが退出すると、共有アルバムをさらに持てる管理者かメンバーにオーナーが引き継がれます。' },
  // 동기화·오류 메시지
  '인터넷에 연결되면 이어서 백업할게요.': { en: 'Backup will continue once you’re online.', ja: 'インターネットに接続したらバックアップを再開します。' },
  'Wi-Fi에 연결되면 사진을 올릴게요.': { en: 'Photos will upload once you’re on Wi‑Fi.', ja: 'Wi‑Fiに接続したら写真をアップロードします。' },
  '안전 보관함 용량이 가득 찼어요. 새 사진은 올리지 않고, 이미 올린 사진은 그대로 있어요.': { en: 'Your secure storage is full. New photos won’t be uploaded, and photos already uploaded stay as they are.', ja: '安全保管の容量がいっぱいです。新しい写真はアップロードせず、アップロード済みの写真はそのまま残ります。' },
  '로그인이 만료됐어요. 다시 로그인해 주세요.': { en: 'Your sign-in has expired. Please sign in again.', ja: 'ログインの有効期限が切れました。もう一度ログインしてください。' },
  '구독 상태가 바뀌었어요. 잠시 후 다시 확인할게요.': { en: 'Your subscription status changed. We’ll check again shortly.', ja: 'サブスクリプションの状態が変わりました。しばらくしてから再確認します。' },
  '서버와 연결하지 못했어요. 잠시 후 다시 시도할게요.': { en: 'Couldn’t reach the server. We’ll try again shortly.', ja: 'サーバーに接続できませんでした。しばらくしてから再試行します。' },
  '동기화하지 못했어요. 잠시 후 다시 시도할게요.': { en: 'Couldn’t sync. We’ll try again shortly.', ja: '同期できませんでした。しばらくしてから再試行します。' },
  '사진 정보를 읽지 못했어요. 잠시 후 다시 시도해 주세요.': { en: 'Couldn’t read the photo’s details. Please try again in a moment.', ja: '写真の情報を読み込めませんでした。しばらくしてからもう一度お試しください。' },
  '사진을 저장하려면 사진 접근을 허용해 주세요.': { en: 'Allow photo access to save photos.', ja: '写真を保存するには、写真へのアクセスを許可してください。' },
  '이전에 보관한 사진': { en: 'Previously stored photos', ja: '以前に保管した写真' },
  '안전 보관': { en: 'Secure Storage', ja: '安全保管' },
  '로그인 정보를 확인하지 못했어요. 다시 시도해 주세요.': { en: 'Couldn’t verify your sign-in. Please try again.', ja: 'ログイン情報を確認できませんでした。もう一度お試しください。' },
  '서버가 로그인을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.': { en: 'The server couldn’t complete sign-in. Please try again in a moment.', ja: 'サーバーでログインを処理できませんでした。しばらくしてからもう一度お試しください。' },
  '이미 로그인하는 중이에요.': { en: 'Sign-in is already in progress.', ja: 'すでにログイン処理中です。' },
  'Google Play 서비스를 사용할 수 없어요.': { en: 'Google Play services aren’t available.', ja: 'Google Play開発者サービスを利用できません。' },
  '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.': { en: 'Couldn’t reach the server. Please check your internet connection.', ja: 'サーバーに接続できませんでした。インターネット接続を確認してください。' },
  // 사진첩 안내
  '새 안전 앨범을 만들고 나의 순간들에서 사진을 골라 담아요. 담은 사진만 안전 보관에 올라가요.': { en: 'Create a new secure album and add photos from My Moments. Only the photos you add are uploaded to secure storage.', ja: '新しいセキュアアルバムを作り、マイメモリーズから写真を選んで追加します。追加した写真だけが安全保管にアップロードされます。' },
  '기기 앨범을 연결하면 그 앨범의 사진을 함께 올리고, 앞으로 넣는 사진도 따라 올려요.': { en: 'Link a device album to upload its photos, along with any photos you add to it later.', ja: 'デバイスのアルバムを連携すると、そのアルバムの写真をアップロードし、今後追加する写真も自動でアップロードします。' },
  '원본 그대로는 원본과 보기용 사진을, 효율 보관은 보기용(사진은 긴 변 2048px, 동영상은 720p)만 보관해 용량을 아껴요.': { en: 'Original quality keeps the original and a viewing copy. Space saver keeps only the viewing copy (photos at 2048px on the long edge, videos at 720p) to save space.', ja: 'オリジナル品質はオリジナルと表示用の写真を、省スペース保存は表示用（写真は長辺2048px、動画は720p）だけを保管して容量を節約します。' },
  '안전 앨범에서 빼거나 앨범을 지우면, 다른 안전 앨범에 없는 사진은 안전 보관에서 삭제돼요. 기록과 기기 사진첩의 원본은 그대로예요.': { en: 'When you remove photos from a secure album or delete the album, photos that aren’t in another secure album are deleted from secure storage. Your memories and the originals in your device library stay as they are.', ja: 'セキュアアルバムから外したりアルバムを削除したりすると、ほかのセキュアアルバムにない写真は安全保管から削除されます。思い出とデバイスのライブラリのオリジナルはそのままです。' },
  '고르기에서 남긴 사진과 메모를 이 기기에서 모아 봐요. 사진을 복사하지 않고 기기 사진첩의 원본을 그대로 보여줘서 용량을 거의 쓰지 않아요.': { en: 'See the photos and notes you kept in Choose Photos, all on this device. Photos aren’t copied — the originals in your device library are shown as they are, so they take up almost no space.', ja: '「写真を選ぶ」で残した写真とメモを、このデバイスでまとめて見られます。写真はコピーせず、デバイスのライブラリのオリジナルをそのまま表示するので、容量はほとんど使いません。' },
  '남긴 사진이 모두 모이는 곳이에요. 앨범에 담지 않은 사진도 여기서 볼 수 있어요.': { en: 'Every photo you keep collects here, including ones that aren’t in an album.', ja: '残した写真がすべて集まる場所です。アルバムに入れていない写真もここで見られます。' },
  '여행, 가족, 계절처럼 이야기별로 앨범을 만들어요. 한 사진을 여러 앨범에 넣어도 사진은 하나예요.': { en: 'Make albums by story, like trips, family, or seasons. A photo in several albums is still just one photo.', ja: '旅行・家族・季節など、テーマごとにアルバムを作れます。1枚の写真を複数のアルバムに入れても、写真は1枚のままです。' },
  '기기 사진첩에서 원본을 지우면 사진은 보이지 않고 메모·장소·날짜만 남아요. 원본까지 지키려면 안전 사진첩에 담아 주세요.': { en: 'If you delete the original from your device library, the photo disappears and only its notes, place, and date remain. To protect originals too, add them to your Secure Library.', ja: 'デバイスのライブラリからオリジナルを削除すると、写真は表示されず、メモ・場所・日付だけが残ります。オリジナルまで守るには、セキュアライブラリに追加してください。' },
  // 요금제
  '요금제를 바꿨어요': { en: 'Your plan has changed', ja: 'プランを変更しました' },
  '잠시 후 설정 화면에서 용량이 바뀌어요.': { en: 'Your storage in Settings will update shortly.', ja: 'まもなく設定画面の容量が切り替わります。' },
  '고른 사진을 원본으로 몇 년 동안 남기기에 충분해요.': { en: 'Plenty for keeping years of chosen photos in original quality.', ja: '選んだ写真を何年分もオリジナルで残すのに十分です。' },
  '동영상과 가족 공유 앨범까지 넉넉하게 담아요.': { en: 'Room to spare for videos and family shared albums.', ja: '動画や家族の共有アルバムまで余裕をもって保管できます。' },
  '더 넉넉하게 쓰고 싶다면': { en: 'Need more room?', ja: 'もっと余裕がほしいなら' },
  '30일 무료': { en: '30 days free', ja: '30日間無料' },
  '처음 구독하면 30일 동안 무료예요. 체험이 끝나기 24시간 전까지 해지하지 않으면 고른 요금으로 결제돼요.': { en: 'Your first 30 days are free. Unless you cancel at least 24 hours before the trial ends, you’ll be charged for the plan you chose.', ja: '初めての購読は30日間無料です。無料期間終了の24時間前までに解約しないと、選んだプランの料金が請求されます。' },
  '바꾸면 남은 기간을 새 요금제에 맞춰 계산해요. 해지나 작은 요금제로 바꾸기는 스토어의 구독 관리에서 할 수 있어요.': { en: 'When you switch, the rest of your current period is prorated to the new plan. To cancel or move to a smaller plan, use your store’s subscription settings.', ja: '切り替えると、残りの期間は新しいプランに合わせて計算されます。解約や小さいプランへの変更は、ストアのサブスクリプション管理から行えます。' },
  // 구독 안내
  '다시 구독하기': { en: 'Subscribe again', ja: '再登録する' },
  // 신고·차단
  '신고하기': { en: 'Report', ja: '報告する' },
  '어떤 문제가 있나요?': { en: 'What’s the problem?', ja: 'どのような問題がありますか？' },
  '신고한 내용은 운영팀만 보고, 상대방에게는 알리지 않아요.': { en: 'Only our team sees your report. The other person isn’t told.', ja: '報告内容は運営チームだけが確認し、相手には知らせません。' },
  '성적인 콘텐츠': { en: 'Sexual content', ja: '性的なコンテンツ' },
  '폭력적이거나 위험한 콘텐츠': { en: 'Violent or dangerous content', ja: '暴力的または危険なコンテンツ' },
  '괴롭힘이나 혐오': { en: 'Harassment or hate', ja: '嫌がらせやヘイト' },
  '스팸': { en: 'Spam', ja: 'スパム' },
  '기타': { en: 'Something else', ja: 'その他' },
  '신고했어요': { en: 'Report sent', ja: '報告しました' },
  '신고하지 못했어요': { en: 'Couldn’t send the report', ja: '報告できませんでした' },
  '차단하지 못했어요': { en: 'Couldn’t block', ja: 'ブロックできませんでした' },
  '차단을 풀지 못했어요': { en: 'Couldn’t unblock', ja: 'ブロックを解除できませんでした' },
  '차단하기': { en: 'Block', ja: 'ブロックする' },
  '차단 풀기': { en: 'Unblock', ja: 'ブロックを解除' },
  '차단함': { en: 'Blocked', ja: 'ブロック中' },
  '이 사진 신고하기': { en: 'Report this photo', ja: 'この写真を報告' },
  '신고 또는 차단': { en: 'Report or block', ja: '報告またはブロック' },
  '차단한 사람이 없어요.': { en: 'You haven’t blocked anyone.', ja: 'ブロックした人はいません。' },
  '차단한 사람이 공유 앨범에 담은 사진은 모든 공유 앨범에서 나에게 보이지 않아요. 상대방에게는 알리지 않고, 다른 구성원에게는 그대로 보여요.': { en: 'Photos that people you’ve blocked add to shared albums are hidden from you in every shared album. They aren’t told, and other members still see them.', ja: 'ブロックした人が共有アルバムに追加した写真は、すべての共有アルバムであなたにだけ表示されなくなります。相手には知らせず、ほかのメンバーには通常どおり表示されます。' },
  '구성원을 눌러 신고하거나 차단할 수 있어요. 차단한 사람의 사진은 나에게만 보이지 않아요.': { en: 'Tap a member to report or block them. Photos from people you block are hidden only for you.', ja: 'メンバーをタップすると、報告やブロックができます。ブロックした人の写真は、あなたにだけ表示されなくなります。' },
  '차단한 사람 목록을 불러오지 못했어요.': { en: 'Couldn’t load the people you’ve blocked.', ja: 'ブロックした人の一覧を読み込めませんでした。' },
};

export function localizeText(language: AppLanguage, value: string) {
  if (language === 'ko') return value;
  return legacyText[value]?.[language] ?? value;
}

// Alert·오류 문구처럼 화면 밖(이벤트 처리, lib)에서 만드는 문구가 쓰는 지금 언어. Provider가 날짜 언어와 함께 맞춘다.
let currentLanguage: AppLanguage = 'ko';

function applyLanguage(language: AppLanguage) {
  currentLanguage = language;
  setDateLanguage(language);
}

export function getCurrentLanguage() {
  return currentLanguage;
}

/** Alert.alert와 같은 모양. 제목·설명·버튼 문구를 위의 표로 지금 언어에 맞춰 띄운다. */
export function showAlert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
  const localize = (value: string) => localizeText(currentLanguage, value);
  Alert.alert(
    localize(title),
    message === undefined ? undefined : localize(message),
    buttons?.map((button) => (button.text ? { ...button, text: localize(button.text) } : button)),
    options,
  );
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

export function memberCount(language: AppLanguage, count: number) {
  if (language === 'en') return count === 1 ? '1 member' : `${count} members`;
  if (language === 'ja') return `${count}人`;
  return `${count}명`;
}

/** 공유 앨범 사진 아래 '누가 담았는지'. 이름은 사용자가 정한 값이라 번역하지 않는다. */
export function addedBy(language: AppLanguage, name: string) {
  if (language === 'en') return `Added by ${name}`;
  if (language === 'ja') return `${name}さんが追加`;
  return `${name}님이 담았어요`;
}

export function selectionSummary(language: AppLanguage, count: number) {
  if (language === 'en') return `${photoCount(language, count)} selected`;
  if (language === 'ja') return `${photoCount(language, count)}を選択中`;
  return `${photoCount(language, count)} 골랐어요`;
}
export const ROUTE_TITLES: Record<AppLanguage, Record<'day' | 'map' | 'cleanup' | 'cloud' | 'notifications' | 'licenses' | 'newAlbum' | 'import' | 'join' | 'manageAlbum' | 'plans' | 'signIn' | 'blocked', string>> = {
  ko: { day: '지난 사진', map: '앨범 지도', cleanup: '사진 정리', cloud: '안전 보관', notifications: '알림', licenses: '오픈소스 라이선스', newAlbum: '새 안전 앨범', import: '기기 기록 백업하기', join: '공유 앨범 참여', manageAlbum: '앨범 관리', plans: '이용 등급 안내', signIn: '로그인', blocked: '차단한 사람' },
  en: { day: 'Past Photos', map: 'Album Map', cleanup: 'Clean Up Photos', cloud: 'Secure Storage', notifications: 'Notifications', licenses: 'Open-source Licenses', newAlbum: 'New Secure Album', import: 'Back Up Device Memories', join: 'Join Shared Album', manageAlbum: 'Manage Album', plans: 'Plans', signIn: 'Sign In', blocked: 'Blocked People' },
  ja: { day: '過去の写真', map: 'アルバムマップ', cleanup: '写真を整理', cloud: '安全保管', notifications: '通知', licenses: 'オープンソースライセンス', newAlbum: '新しいセキュアアルバム', import: 'デバイスの思い出をバックアップ', join: '共有アルバムに参加', manageAlbum: 'アルバムを管理', plans: 'プランのご案内', signIn: 'ログイン', blocked: 'ブロックした人' },
};
type I18n = { language: AppLanguage; t: (key: TranslationKey) => string; setLanguage: (language: AppLanguage) => Promise<void> };
const I18nContext = createContext<I18n | null>(null);

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const linkingUrl = Linking.useLinkingURL();
  const previewLanguage = useMemo<AppLanguage | null>(() => {
    if (!linkingUrl) return null;
    const value = Linking.parse(linkingUrl).queryParams?.previewLanguage;
    return typeof value === 'string' && ['ko', 'en', 'ja'].includes(value) ? value as AppLanguage : null;
  }, [linkingUrl]);
  const [language, setCurrentLanguage] = useState<AppLanguage>(() => {
    // 계정 공간을 전환해 Provider가 새로 생길 때도, 첫 렌더의 언어와 날짜 형식을 맞춘다.
    const initial = deviceLanguage();
    applyLanguage(initial);
    return initial;
  });
  const loadId = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      const id = ++loadId.current;
      return getSettings(db).then((settings) => {
        // 공간 전환·설정 저장 중 먼저 끝난 이전 읽기 결과는 무시한다.
        if (!alive || id !== loadId.current) return;
        applyLanguage(settings.language);
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
    // 지금 보이는 언어(기기 언어)를 그대로 골라도 저장한다 — 직접 고른 뒤에는 기기 언어가 바뀌어도 따라가지 않는다.
    if (next === language) {
      // 진행 중인 이전 DB 읽기가 방금 저장한 언어와 다른 값으로 화면을 바꾸지 못하게 한다.
      loadId.current++;
      await setSetting(db, 'language', next);
      return;
    }
    const previous = language;
    // 진행 중인 이전 DB 읽기가 방금 선택한 언어를 덮어쓰지 못하게 한다.
    loadId.current++;
    // 날짜 포맷은 렌더 과정에서 읽히므로 state보다 먼저 바꿔 같은 프레임에 맞춘다.
    applyLanguage(next);
    setCurrentLanguage(next);
    // 저장이 실패하면 화면과 날짜 포맷 모두 이전 값으로 되돌린다.
    try {
      await setSetting(db, 'language', next);
      // 이미 잡힌 로컬 알림도 새 언어로 다시 만든다.
      await rescheduleReminders(db);
    } catch (error) {
      applyLanguage(previous);
      setCurrentLanguage(previous);
      throw error;
    }
  }, [db, language]);
  // 스토어 자산 캡처 전용 딥링크는 DB 설정을 바꾸지 않고 현재 렌더에만 언어를 덮어쓴다.
  // useLinkingURL은 최초 URL과 이후 URL 모두 전달하므로 슬라이드마다 언어가 안정적으로 유지된다.
  const activeLanguage = previewLanguage ?? language;
  // 날짜 포맷 함수는 기존 화면에서 전역 언어를 읽는다. 미리보기 언어가 바뀐 뒤에도
  // 날짜가 직전 언어로 남지 않도록, 화면이 보이기 전에 바꾸고 한 번 다시 그린다.
  const [, rerenderDates] = useState(0);
  useLayoutEffect(() => {
    applyLanguage(activeLanguage);
    rerenderDates((version) => version + 1);
  }, [activeLanguage]);
  const value = useMemo<I18n>(() => ({ language: activeLanguage, setLanguage, t: (key) => copy[activeLanguage][key] }), [activeLanguage, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useTranslation must be used inside LocalizationProvider');
  return value;
}
