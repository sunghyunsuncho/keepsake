import { Linking } from 'react-native';

import { PUBLIC_WEB_URL } from '@/constants/app-info';

// 이용약관·개인정보 처리방침은 atelierlabs 홈페이지(sites/keepsake/legal)가 원본이다 — 앱도 같은 페이지를 연다.
// 앱 화면이 한국어뿐이라 한국어판을 연다. 영어판은 웹 페이지 위쪽의 언어 링크로 옮길 수 있다.
const LEGAL_PATHS = { terms: 'terms-of-service', privacy: 'privacy-policy' } as const;

export type LegalDocKey = keyof typeof LEGAL_PATHS;

export function openLegalDocument(doc: LegalDocKey) {
  Linking.openURL(`${PUBLIC_WEB_URL}/legal/${LEGAL_PATHS[doc]}`);
}
