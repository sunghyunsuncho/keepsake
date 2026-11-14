export type StoreLocale = 'ko' | 'en' | 'ja';
export const STORE_LOCALES: StoreLocale[] = ['ko', 'en', 'ja'];

// Google Play는 기기 종류별로 스크린샷을 8장까지 받는다 (App Store는 10장). 두 스토어에 같은 세트를 쓰므로 8장 이하로 둔다.
// route의 {album:제목}은 캡처할 때 시뮬레이터 DB에서 그 이름의 기기 앨범 ID로 바꾼다 (simctl.ts resolveRoute).
export type Slide = { no: string; route: string; rawFile: string; title: string; accent: string; description: string; delayMs?: number };

const ko: Slide[] = [
  { no: '01', route: '/', rawFile: '01-choose.png', title: '오늘 찍은 사진 중, 몇 장만', accent: '십 년 뒤에도 보고 싶은 사진을 골라요', description: '지난번에 본 다음 사진부터 차례로 살펴봐요' },
  { no: '02', route: '/moment/1', rawFile: '02-memory.png', title: '사진에 그날의 기억을', accent: '메모와 장소를 함께 남겨요', description: '사진 한 장이 그날의 이야기가 돼요' },
  { no: '03', route: '/album', rawFile: '03-library.png', title: '다시 보고 싶어지는', accent: '나만의 작은 사진첩', description: '여행·가족·계절의 이야기로 묶어 보세요' },
  { no: '04', route: '/albums/{album:Europe Trip}', rawFile: '04-story.png', title: '앨범을 펼치면', accent: '한 권의 이야기가 돼요', description: '메모와 장소가 사진과 함께 날짜순으로 이어져요' },
  { no: '05', route: '/album-map?id={album:Europe Trip}&kind=album', rawFile: '05-map.png', title: '어디서 찍었는지', accent: '지도로 다시 떠나요', description: '앨범 사진을 찍은 곳을 지도에 모아 보여줘요', delayMs: 4000 },
  { no: '06', route: '/shared-albums/{shared:Our Family}', rawFile: '06-shared.png', title: '가족과 함께 채우는', accent: '우리 가족 공유 앨범', description: '각자 찍은 사진에 이야기와 댓글을 나눠요' },
  { no: '07', route: '/cloud-library', rawFile: '07-secure.png', title: '남긴 사진은 지키고', accent: '휴대폰은 가볍게', description: '휴대폰을 바꾸거나 잃어버려도 원본이 그대로 남아요' },
  { no: '08', route: '/cleanup', rawFile: '08-cleanup.png', title: '남기지 않은 사진은', accent: '한 번 더 보고 가볍게', description: '정리할 사진을 한눈에 보고 천천히 골라요' },
];

const copy: Record<Exclude<StoreLocale, 'ko'>, Pick<Slide, 'title' | 'accent' | 'description'>[]> = {
  en: [
    { title: 'From all the photos you took today', accent: 'Keep just the ones you will want in ten years', description: 'Pick up right after the last photo you reviewed' },
    { title: 'Give each photo its story', accent: 'Keep notes and places together', description: 'One photo becomes a memory of the day' },
    { title: 'A library you will want to revisit', accent: 'Your small, personal photo book', description: 'Group stories by trips, family, and seasons' },
    { title: 'Open an album', accent: 'And it reads like a story', description: 'Notes and places follow your photos, day by day' },
    { title: 'Remember where it happened', accent: 'Travel back on the map', description: 'See the photos in an album where they were taken' },
    { title: 'Filled in together', accent: 'A shared album for your family', description: 'Everyone adds photos, stories, and comments' },
    { title: 'Keep the photos you chose safe', accent: 'Keep your phone light', description: 'Originals stay safe even if you change or lose your phone' },
    { title: 'Before clearing the rest', accent: 'Look once more, then let go', description: 'See them all at once and decide at your own pace' },
  ],
  ja: [
    { title: '今日撮った写真から、数枚だけ', accent: '十年後も見返したい写真を選ぼう', description: '前回見た写真の続きから順番に見られます' },
    { title: '写真にその日の記憶を', accent: 'メモと場所を一緒に残そう', description: '一枚の写真がその日の物語になります' },
    { title: 'また見返したくなる', accent: '自分だけの小さな写真集', description: '旅・家族・季節の物語ごとにまとめましょう' },
    { title: 'アルバムを開けば', accent: '一冊の物語に', description: 'メモと場所が写真と一緒に日付順につながります' },
    { title: 'どこで撮ったのか', accent: '地図でもう一度旅しよう', description: 'アルバムの写真を撮った場所ごとに地図で見られます' },
    { title: '家族みんなで作る', accent: '家族の共有アルバム', description: 'それぞれの写真に思い出やコメントを寄せ合えます' },
    { title: '残した写真は守って', accent: 'スマホは軽く', description: '機種変更や紛失のときもオリジナルはそのまま残ります' },
    { title: '残さなかった写真も', accent: 'もう一度見て、軽やかに', description: 'まとめて見て、ゆっくり決められます' },
  ],
};

export function getSlides(locale: StoreLocale): Slide[] {
  if (locale === 'ko') return ko;
  return ko.map((slide, index) => ({ ...slide, ...copy[locale][index] }));
}
