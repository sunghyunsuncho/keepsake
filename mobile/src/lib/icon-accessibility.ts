import Ionicons from '@expo/vector-icons/Ionicons';

// Ionicons는 아이콘 글꼴의 글자(사용자 영역 문자 \uf…)를 Text로 그린다. 버튼에 접근성 이름을 따로 주지 않으면
// Android는 안의 글자를 모아 이름을 만들어서, TalkBack이 ', 오늘 찍은 사진부터…'처럼 읽는다.
// 아이콘은 꾸밈이라 기본으로 접근성에서 숨긴다. 아이콘만 있는 버튼은 버튼 쪽에 accessibilityLabel을 준다.
// (앱 시작 때 한 번 import한다. createIconSet은 class 컴포넌트라 defaultProps가 그대로 적용된다.)
const IconClass = Ionicons as unknown as { defaultProps?: Record<string, unknown> };
IconClass.defaultProps = {
  ...IconClass.defaultProps,
  accessible: false,
  importantForAccessibility: 'no',
  accessibilityElementsHidden: true,
};
