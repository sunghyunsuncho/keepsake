# Keepsake 개발 계획

> 기준 문서: [STARTING_POINT.md](../STARTING_POINT.md)
> 최종 수정: 2026-10-28

## 0. 확정된 결정

| 항목 | 결정 |
|---|---|
| 플랫폼 | iOS + Android, React Native / Expo |
| 언어 | 백엔드·데이터 규칙은 Python, 모바일 UI만 TypeScript |
| 아키텍처 | 로컬 우선. 기기가 원본 저장소, 클라우드는 백업·복원 |
| 클라우드 스토리지 | Cloudflare R2 |
| 요금제 | **Local**(무료, 기기 전용) + **Cloud**(유료 구독, 원본 백업) |
| 로그인 시점 | Cloud를 구독할 때만. Local 사용은 로그인 없음 |
| 백업 화질 | Cloud는 원본 보관 |
| 구독 만료 후 | 즉시 업로드 중단, 30일 동안 읽기·다운로드만 허용, 이후 클라우드 데이터 삭제 |
| 개발 순서 | Phase 1은 서버 없이 핵심 루프부터 검증 |
| 모바일 SDK | Expo SDK 54 (vernissage와 동일). SDK 56 이상은 현재 Xcode 26.1에서 빌드되지 않음 |

## 1. 언어 분담

React Native/Expo 앱은 TypeScript로만 작성할 수 있다. 따라서:

- **Python (FastAPI)**: 데이터 모델, 구독 상태·용량 규칙, 백업/동기화
- **TypeScript (Expo)**: 화면, 로컬 저장, API 호출. 규칙을 넣지 않고 얇게 유지
- **타입 공유**: Pydantic 모델 → FastAPI OpenAPI → `openapi-typescript`(또는 `orval`)로 TS 타입과 클라이언트를 자동 생성

업로드 허용 여부(구독 중인지, 용량이 남았는지)는 **항상 서버가 판단**하고, 앱은 서버가 준 결과를 보여주기만 한다.

## 2. 요금제 설계

### 2.1 등급

| | **Local** (무료, 로그인 없음) | **Cloud** (유료 구독) |
|---|---|---|
| 선택·기록·사진첩·다시 보기 | ✅ | ✅ |
| 기기 내 원본 보관 | ✅ | ✅ |
| ZIP 내보내기/가져오기 | ✅ | ✅ |
| 클라우드 백업 | ❌ | ✅ **원본** + 표시용 리사이즈본 |
| 새 기기 복원 | ZIP으로만 | ✅ 로그인만으로 원본 복원 |
| 여러 기기 동기화 | ❌ | ✅ |

- 핵심 경험(선택 → 기록 → 다시 보기)은 등급과 관계없이 모두 제공한다.
- 유료로 사는 가치는 "소중한 원본을 안전하게 맡긴다"는 것이다.
- **Local 사용자의 유일한 안전장치는 ZIP 내보내기**다. 부가 기능이 아니라 핵심 기능으로 다듬는다 (진행 상황 표시, 대용량 처리, 주기적 내보내기 권유 알림).
- 화질 기준 하위 유료 등급은 출시 후 가격 저항 데이터를 보고 결정한다. 서버의 `PlanLimit.allow_original`로 구분할 수 있게 구조만 열어둔다.

### 2.2 원가 추정 (R2 기준)

R2 단가: 저장 $0.015/GB·월, 쓰기 $4.50/백만 건, 읽기 $0.36/백만 건, **이그레스 무료**, 매월 10GB 무료.

하루 3장씩 1년 기록할 때 약 1,100장:

| | 1장 크기 | 1년 누적 | 월 저장 비용 |
|---|---|---|---|
| 원본 (HEIC/JPEG) | ~3~5MB | ~4.5GB | ~$0.07 |
| 표시용 리사이즈본 | ~0.5MB | ~0.55GB | ~$0.008 |

이그레스가 무료라 다시 보기·복원에 추가 비용이 없다. 가격은 원가보다 앱스토어 수수료(15~30%)와 운영비를 기준으로 정한다.

### 2.3 결제 구현

- 디지털 서비스 구독이므로 **Apple/Google 인앱 결제가 필수**다 (외부 결제 불가).
- **RevenueCat** (`react-native-purchases`, Expo dev build 지원) 사용:
  - 앱: 페이월, 구매, 구매 복원
  - 서버: RevenueCat **웹훅**을 FastAPI에서 받아 `entitlements` 테이블을 갱신
  - 앱이 보낸 "나 구독 중이야"는 믿지 않는다. 서버는 웹훅 + RevenueCat REST API 조회 결과만 신뢰한다.
- RevenueCat `app_user_id` = Keepsake 서버의 `user_id` (로그인 후 `Purchases.logIn(user_id)`).
- 앱스토어 결제 실패 유예(Apple Billing Grace Period, Google 계정 보류)를 켜두고, 그 기간에는 구독 중으로 취급한다.

### 2.4 상태 변경 정책

| 상황 | 동작 |
|---|---|
| Local → Cloud 구독 | 로그인 → 구매 → 기존 로컬 기록 전체를 계정에 연결 → 기기에 있는 원본과 리사이즈본 업로드 |
| 구독 만료 (스토어 결제 유예까지 끝난 시점) | 즉시 새 업로드·동기화 중단. **30일 동안 읽기와 전체 다운로드만 허용** |
| 유예 중 알림 | 만료 즉시, 삭제 7일 전, 삭제 1일 전 (푸시 + 이메일) |
| 유예 중 재구독 | 아무것도 다시 올리지 않고 즉시 복구 |
| 유예 30일 경과 | 클라우드 데이터(R2 객체 + 서버 기록) 삭제. **기기 데이터는 유지**되고 Local로 전환 |
| 용량 한도 초과 | 신규 업로드만 중단. 기존 백업은 삭제하지 않음 |
| 계정 삭제 | 서버 데이터와 R2 객체 즉시 삭제. 기기 데이터는 유지 (Local로 전환) |

리사이즈본도 함께 올리는 이유: 새 기기에서 복원할 때 사진첩을 빠르게 먼저 보여주고, 원본은 필요할 때 받는다. 원가 증가는 약 10%다.

## 3. 아키텍처

```
[ Expo 앱 ]                                     [ FastAPI (Python) ]
 expo-media-library ─▶ 날짜별 선택                ├─ Auth: Apple / Google → JWT
 expo-file-system   ─▶ 선택 사진 원본 복사         ├─ Sync: push(upsert) / pull(since=)
 expo-image-manipulator ─▶ 리사이즈본 생성         ├─ Upload: 구독·용량 검사 → presigned URL
 expo-sqlite        ─▶ moments, albums, ...       ├─ Upload complete: R2 HEAD로 크기 검증
 react-native-purchases ─▶ 구독                   ├─ Billing: RevenueCat 웹훅
        │                                          └─ Jobs: 유예 알림, 만료 데이터 삭제
        │  메타데이터 (HTTPS, JWT)                         │
        ├─────────────────────────────────────────▶ PostgreSQL
        │  사진 바이트 (presigned PUT/GET, 서버 미경유)      │
        └─────────────────────────────────────────▶ Cloudflare R2 (비공개 버킷)
```

### 3.1 R2 업로드 흐름

R2는 S3 호환 API라 Python에서는 `boto3`로 다룬다. R2는 presigned POST 정책(업로드 크기 제한 조건)을 지원하지 않으므로, **업로드 후 서버가 검증**한다.

1. 앱 → `POST /uploads` `{moment_id, variant: "display"|"original", size, content_type, sha256}`
2. 서버: 로그인·구독 상태 확인(`active`만 허용, `grace`는 거절), 용량 확인 → `cloud_objects` 행을 `pending`으로 생성 → presigned PUT URL(만료 10분) 반환
3. 앱 → R2로 직접 PUT
4. 앱 → `POST /uploads/{id}/complete`
5. 서버: R2 `HEAD`로 실제 크기 확인 → 신고한 크기와 다르거나 한도를 넘으면 객체 삭제 후 거절, 정상이면 `stored`로 바꾸고 사용량 반영
6. 일정 시간 지난 `pending` 행은 정리 작업이 R2 객체와 함께 삭제

다운로드는 `GET /moments/{id}/photo?variant=` → presigned GET URL(짧은 만료). `active`와 `grace` 상태 모두 허용.

객체 키: `u/{user_id}/m/{moment_id}/{variant}.{ext}`. 사용자별 prefix라 유예 만료·계정 삭제 시 prefix 단위로 지운다.

### 3.2 동기화 규칙 (처음부터 적용)

- ID는 클라이언트에서 UUID로 생성
- 모든 행에 `updated_at`, 삭제는 `deleted_at`(soft delete)
- 충돌은 `updated_at` 기준 최신 우선 (개인용 앱이라 이 정도로 충분)
- `POST /sync/push`: 변경분 일괄 upsert (`active`만) / `GET /sync/pull?since=`: 이후 변경분 (`active`, `grace`)

## 4. 데이터 모델

### 4.1 기기 (SQLite) — 모든 등급 공통

```
moments        id, source_asset_id, local_original_path, local_display_path,
               taken_at, lat, lng, place_name, memo,
               created_at, updated_at, deleted_at,
               sync_state ('local_only'|'pending'|'synced'),
               original_uploaded (bool)
albums         id, kind ('timeline'|'trip'|'theme'), title, start_date, end_date, ...
album_moments  album_id, moment_id, position
review_sessions id, date, reviewed_at, selected_count
upload_queue   moment_id, variant, attempts, last_error
settings       daily_recommended_count (기본 3), wifi_only_upload, ...
```

### 4.2 서버 (PostgreSQL)

서버에는 Cloud 구독을 시작한 사용자만 존재한다.

```python
class User:           id, email, created_at, deleted_at
class AuthIdentity:   user_id, provider ('apple'|'google'), subject
class Entitlement:    user_id, plan ('cloud'), status ('active'|'grace'|'expired'),
                      expires_at, grace_until, source ('revenuecat'), updated_at
class Moment:         id, user_id, taken_at, lat, lng, place_name, memo,
                      created_at, updated_at, deleted_at
class Album / AlbumMoment / ReviewSession: 기기 스키마와 동일 + user_id
class CloudObject:    id, user_id, moment_id, variant ('display'|'original'),
                      r2_key, size_bytes, sha256, status ('pending'|'stored'|'deleting'),
                      created_at
class Usage:          user_id, bytes_total, object_count  # 집계 캐시
class PlanLimit:      plan, max_bytes, allow_original, grace_days (=30)  # 설정값
class BillingEvent:   id, raw_payload, received_at, processed_at  # 웹훅 원본 기록
```

## 5. 기술 스택

**모바일 `/mobile`**
- Expo SDK 54 (vernissage와 동일, 현재 Xcode 26.1에서 빌드 가능한 버전), expo-router, TypeScript
- `expo-media-library`, `expo-image`, `expo-image-manipulator`, `expo-file-system`, `expo-sqlite`(+ Drizzle 선택), `expo-secure-store`, `expo-notifications`, `expo-apple-authentication`, Google 로그인, `react-native-purchases`
- TanStack Query, FlashList
- Expo Go 대신 **Development Build (EAS)** 로 개발

**백엔드 `/backend`**
- Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic, PostgreSQL
- `boto3` (R2 endpoint), `uv`, `pytest`, `ruff`
- 로컬: docker-compose (postgres + RustFS로 R2 대체. MinIO 공식 이미지는 배포 중단)
- 배포: Fly.io / Railway / Render 중 택1. 주기 작업은 플랫폼 cron 또는 APScheduler

## 6. 단계별 로드맵

### Phase 0 — 기반 (1주) ✅ iOS 시뮬레이터 기준 완료
- 모노레포 `/mobile`, `/backend`, `/docs`
- Expo 앱 생성, EAS 연결, iOS/Android dev build 성공
- FastAPI 뼈대, `/health`, Alembic 초기화, docker-compose
- OpenAPI → TS 클라이언트 생성 스크립트
- 앱 아이콘·스플래시 (원본 이미지에서 `make icons`로 생성)
- **완료 기준:** 양쪽 실기기에서 앱이 뜨고 로컬 서버 `/health` 호출 성공
- **현재 상태:** iOS 시뮬레이터에서 앱 실행과 `/health/ready` 호출까지 확인.
  EAS 연결, Android, 실기기 확인은 Phase 1 TestFlight / 내부 테스트 배포 전에 함께 진행한다.

### Phase 1 — 핵심 루프, Local 등급 (3~4주)
1. 사진 권한 (iOS 제한된 접근, Android 14+ 부분 허용 포함)
2. 날짜별 사진 보기
3. 선택 + 권장 수 안내 (초과해도 막지 않음)
4. 선택 시 원본 복사 + 리사이즈본 생성 (나중에 업로드할 수 있도록 미리 준비)
5. 메모, 날짜·장소 기록
6. 시간순 사진첩, 상세 보기
7. 설정 (권장 사진 수)
8. **ZIP 내보내기/가져오기** (Local 사용자의 유일한 백업 수단이므로 완성도 있게)
- TestFlight / Play 내부 테스트로 소수 사용자 검증
- **완료 기준:** 로그인·서버 없이 선택 → 기록 → 다시 보기 → 내보내기 → 다른 기기에서 가져오기가 완결됨

### Phase 2 — Cloud 구독 (4~5주)
- App Store Connect / Play Console 구독 상품, RevenueCat 설정, 스토어 결제 유예 설정
- Apple + Google 로그인 (Google을 넣으면 Apple 로그인 필수)
- 페이월 → 로그인 → 구매 → 로컬 데이터 계정 연결 흐름, 구매 복원
- RevenueCat 웹훅 → `Entitlement` 갱신
- 동기화 API, 업로드 흐름 (§3.1), 업로드 대기열·재시도, 와이파이 전용 옵션
- 새 기기 복원, 여러 기기 동기화
- 만료 처리: 업로드 중단 → 30일 읽기 전용 → 알림 3회 → 삭제 작업
- 계정 삭제 (App Store 필수 요건)
- **완료 기준:** 샌드박스 계정으로 구독 → 기기 A 백업 → 기기 B 복원 → 해지 → 읽기 전용 → 재구독 즉시 복구, 그리고 별도 계정으로 해지 → 30일 경과(시간 조작) → 삭제까지 확인

### Phase 3 — 다시 보기 강화 & 출시 (2주)
- "N년 전 오늘" 재발견 카드 (가끔 조용히)
- 리마인더 알림 (빈도는 사용자 설정), Local 사용자 대상 내보내기 권유
- 개인정보처리방침, 이용약관(구독 조건·만료 후 삭제 정책 명시), 스토어 메타데이터, Sentry, 최소 지표
- 스토어 심사 제출

### Phase 4 이후 — 검증 결과에 따라
여행 모드, AI 결정 보조, 검색, 제한적 공유, 화질 기준 하위 유료 등급

## 7. 지표

| 가설 | 지표 |
|---|---|
| 선택 과정에서 가치를 느낀다 | 하루 기록 완료율, 날짜당 선택 수 |
| 작은 사진첩이 다시 보기 쉽다 | 주간 사진첩 열람, 상세 보기 체류 |
| 노력이 작으면 반복한다 | 선택 1회 소요 시간, D7/D30 재방문 |
| 다시 보기가 기록을 부른다 | 다시 보기 직후 새 기록 비율 |
| 보관에 돈을 낼 만하다 | Local→Cloud 전환율, 페이월 이탈률, 해지율, 유예 중 재구독률 |

Local 사용자는 서버 계정이 없으므로 익명 이벤트만 수집한다. 사진과 메모 내용은 수집하지 않는다.

## 8. 리스크

- **사진 권한 거부·부분 허용:** 부분 허용 상태에서도 동작하고, "사진 추가 선택" 버튼 제공
- **대용량 갤러리 성능:** 날짜 범위 조회, 썸네일만 로드, FlashList
- **SDK 버전 뒤처짐:** SDK 54는 최신보다 뒤처져 있다. 출시 전(또는 스토어가 새 Xcode를 요구할 때) vernissage와 함께 Xcode와 SDK를 올린다
- **업로드 중단:** 대기열을 SQLite에 저장, 앱 재시작 시 재개, 와이파이 전용 옵션
- **기기에서 원본이 사라진 뒤 구독:** 앱 내부 복사본이 없는 기록은 리사이즈본만 업로드하고 "원본 없음"으로 표시
- **Local 사용자의 기기 분실:** ZIP 내보내기 권유 알림, 구독 안내는 강요하지 않는 선에서
- **결제 상태 불일치:** 웹훅 원본 저장 + 주기적 RevenueCat 재조회로 보정
- **실수로 인한 삭제:** 삭제 작업은 `grace_until`을 다시 확인하고, 실행 직전 RevenueCat 재조회로 재구독 여부 확인
- **개인 사진 보안:** 비공개 버킷, 짧은 만료 presigned URL, 사용자별 prefix, 서버 로그에 메모 내용 미기록

## 9. 미정 사항

- Cloud 구독 가격, 용량 한도 (출시 전 원가·경쟁 앱 가격 조사 후 결정)
- 연간 구독 할인 여부, 무료 체험 기간
- 앱 화면 표시용 썸네일 크기
