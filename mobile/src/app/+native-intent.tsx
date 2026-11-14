// 공유 앨범 초대 링크(https://keepsake.atelierlabs.co.kr/join?code=…)를 앱의 참여 화면으로 보낸다.
// 웹은 영어·일본어 페이지를 /en/join, /ja/join에 두지만 앱 라우트에는 언어 접두사가 없다. 표시 언어는 앱 설정을 따른다.
// path는 전체 URL이나 경로 모두로 올 수 있다. 여기서 예외가 나면 앱이 멈출 수 있어 문자열 치환만 한다.
const INVITE_LINK = /^(?:https?:\/\/[^/?#]+)?\/?(?:(?:en|ja)\/)?join\/?(?=[?#]|$)/;

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return path.replace(INVITE_LINK, '/shared-albums/join');
}
