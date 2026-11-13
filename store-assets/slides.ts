export type StoreLocale = 'ko' | 'en' | 'ja';
export const STORE_LOCALES: StoreLocale[] = ['ko', 'en', 'ja'];

export type Slide = { no: string; route: string; rawFile: string; title: string; accent: string; description: string; delayMs?: number };

const ko: Slide[] = [
  { no: '01', route: '/', rawFile: '01-choose.png', title: '오늘 찍은 사진 중, 몇 장만', accent: '십 년 뒤에도 보고 싶은 사진을 골라요', description: '지난번에 본 다음 사진부터 차례로 살펴봐요' },
  { no: '02', route: '/moment/1', rawFile: '02-memory.png', title: '사진에 그날의 기억을', accent: '메모와 장소를 함께 남겨요', description: '사진 한 장이 그날의 이야기가 돼요' },
  { no: '03', route: '/album', rawFile: '03-library.png', title: '다시 보고 싶어지는', accent: '나만의 작은 사진첩', description: '여행·가족·계절의 이야기로 묶어 보세요' },
  { no: '04', route: '/cloud-library', rawFile: '04-secure.png', title: '남긴 사진은 지키고', accent: '휴대폰은 가볍게', description: '새 휴대폰에서도 그대로, 선택 구독' },
  { no: '05', route: '/cleanup', rawFile: '05-cleanup.png', title: '남기지 않은 사진은', accent: '한 번 더 보고 가볍게', description: '정리 후보를 한눈에 살펴보고 결정해요' },
  { no: '06', route: '/settings', rawFile: '06-settings.png', title: '로그인 없이 시작해도', accent: '기억은 계속 쌓여요', description: '원하면 로그인해 기록을 무료로 이어 볼 수 있어요' },
];

const copy: Record<Exclude<StoreLocale, 'ko'>, Pick<Slide, 'title' | 'accent' | 'description'>[]> = {
  en: [
    { title: 'From all the photos you took today', accent: 'Keep just the ones you will want in ten years', description: 'Pick up right after the last photo you reviewed' },
    { title: 'Give each photo its story', accent: 'Keep notes and places together', description: 'One photo becomes a memory of the day' },
    { title: 'A library you will want to revisit', accent: 'Your small, personal photo book', description: 'Group stories by trips, family, and seasons' },
    { title: 'Keep the photos you chose safe', accent: 'Keep your phone light', description: 'They stay with you on a new phone, with an optional subscription' },
    { title: 'Before clearing the rest', accent: 'Look once more, then let go', description: 'Review cleanup candidates together and decide' },
    { title: 'Start without an account', accent: 'Keep building your memories', description: 'Sign in later to back up your memories for free' },
  ],
  ja: [
    { title: '今日撮った写真から、数枚だけ', accent: '十年後も見返したい写真を選ぼう', description: '前回見た写真の続きから順番に見られます' },
    { title: '写真にその日の記憶を', accent: 'メモと場所を一緒に残そう', description: '一枚の写真がその日の物語になります' },
    { title: 'また見返したくなる', accent: '自分だけの小さな写真集', description: '旅・家族・季節の物語ごとにまとめましょう' },
    { title: '残した写真は守って', accent: 'スマホは軽く', description: '新しいスマホでもそのまま。オプションのサブスクリプション' },
    { title: '残さなかった写真も', accent: 'もう一度見て、軽やかに', description: '整理候補をまとめて見て決められます' },
    { title: 'ログインなしで始めても', accent: '思い出は積み重なります', description: 'あとからログインして思い出を無料でバックアップできます' },
  ],
};

export function getSlides(locale: StoreLocale): Slide[] {
  if (locale === 'ko') return ko;
  return ko.map((slide, index) => ({ ...slide, ...copy[locale][index] }));
}
