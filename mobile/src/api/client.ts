import createClient from 'openapi-fetch';

import type { paths } from '@/api/schema';

// 실기기에서는 localhost가 휴대폰 자신을 가리키므로, .env에 Mac의 LAN IP를 넣는다.
// `||`로 빈 문자열("EXPO_PUBLIC_API_URL=")도 기본값으로 처리한다.
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:18020';

// 타입은 backend의 Pydantic 모델에서 생성된다 (`make api-types`).
export const api = createClient<paths>({ baseUrl: API_URL });
