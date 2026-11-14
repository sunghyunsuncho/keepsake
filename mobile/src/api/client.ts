import createClient from 'openapi-fetch';

import type { paths } from '@/api/schema';

// 개발 번들(Metro)은 언제나 로컬 서버를 쓴다. EXPO_PUBLIC_API_URL은 EAS 환경 변수로 빌드에 들어가는 주소이고,
// `eas env:pull`로 받은 .env.local이 .env보다 우선해서 개발 중에도 운영 서버를 가리킬 수 있으므로 개발에서는 보지 않는다.
// 실기기에서는 localhost가 휴대폰 자신을 가리키므로, .env의 EXPO_PUBLIC_LOCAL_API_URL에 Mac의 LAN IP를 넣는다 (../set-ip.sh).
// `||`로 빈 문자열("EXPO_PUBLIC_LOCAL_API_URL=")도 기본값으로 처리한다.
export const API_URL = __DEV__
  ? process.env.EXPO_PUBLIC_LOCAL_API_URL || 'http://localhost:18020'
  : process.env.EXPO_PUBLIC_API_URL || 'http://localhost:18020';

// 타입은 backend의 Pydantic 모델에서 생성된다 (`make api-types`).
export const api = createClient<paths>({ baseUrl: API_URL });
