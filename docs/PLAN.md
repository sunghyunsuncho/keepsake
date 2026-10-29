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
| 고르기 방식 | 날짜를 넘겨 가며 고르지 않는다. 필름 한 롤을 넘겨 보듯, 지난번에 살펴본 다음 사진부터 이어서 보여준다 (날짜로 보기는 보조) |
| 고르기 확정 | 사진을 누르면 '고른 상태'만 되고, [남기기]를 눌러야 원본을 앱에 복사한다 |

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
| Local → Cloud 구독 | 소개·가격 확인(로그인 없이) → [구독하기] → 로그인 → 구매 (이미 구독 중인 계정이면 구매 없이 복원) → 기존 로컬 기록 전체를 계정에 연결 → 기기에 있는 원본과 리사이즈본 업로드 |
| 구독 만료 (스토어 결제 유예까지 끝난 시점) | 즉시 새 업로드·동기화 중단. **30일 동안 읽기와 전체 다운로드만 허용** |
| 유예 중 알림 | 만료 즉시, 삭제 7일 전, 삭제 1일 전 (푸시 + 이메일) |
| 유예 중 재구독 | 아무것도 다시 올리지 않고 즉시 복구 |
| 유예 30일 경과 | 클라우드 데이터(R2 객체 + 서버 기록) 삭제. **기기 데이터는 유지**되고 Local로 전환. 나중에 다시 구독하면 기기의 기록을 처음부터 다시 올린다 |
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

1. 앱 → `POST /uploads` `{moment_id, variant: "display"|"original", size, content_type, md5}` (MD5는 파일을 JS 메모리에 올리지 않고 네이티브로 계산한다)
2. 서버: 로그인·구독 상태 확인(`active`만 허용, `grace`는 거절), 용량 확인 → `cloud_objects` 행을 `pending`으로 생성 → `Content-MD5`까지 서명한 presigned PUT URL(만료 10분)과 붙일 헤더 반환
3. 앱 → R2로 직접 PUT (내용이 MD5와 다르면 R2가 거절)
4. 앱 → `POST /uploads/{id}/complete`
5. 서버: R2 `HEAD`로 실제 크기와 ETag(MD5) 확인 → 신고한 값과 다르면 객체 삭제 후 거절, 정상이면 `stored`로 바꾸고 사용량 반영
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
                      r2_key, size_bytes, md5, status ('pending'|'stored'|'deleting'),
                      created_at
class Usage:          user_id, bytes_total, object_count  # 집계 캐시
class PlanLimit:      plan, max_bytes, allow_original, grace_days (=30)  # 설정값
class BillingEvent:   id, raw_payload, received_at, processed_at  # 웹훅 원본 기록
```

## 5. 기술 스택

**모바일 `/mobile`**
- Expo SDK 54 (vernissage와 동일, 현재 Xcode 26.1에서 빌드 가능한 버전), expo-router, TypeScript
- `expo-media-library`, `expo-image`, `expo-image-manipulator`, `expo-file-system`, `expo-sqlite`(+ Drizzle 선택), `expo-secure-store`, `expo-notifications`, `expo-apple-authentication`, Google 로그인, `react-native-purchases`
- ZIP 백업: `react-native-zip-archive`, `expo-sharing`, `expo-document-picker`
- 로컬 네이티브 모듈 `mobile/modules/photo-meta`: 사진 좌표 → 주소(iOS Apple, Android OS Geocoder), 원본 EXIF의 촬영 시간대. 위치 권한 없이 동작
- FlashList, TanStack Query(Phase 2 서버 API용. 로컬 DB 읽기는 자체 `useDbQuery`)
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
2. 아직 살펴보지 않은 사진을 이어서 보기 (고르기), 날짜로 보기
3. 선택 + 권장 수 안내 (초과해도 막지 않음)
4. 선택 시 원본 복사 + 리사이즈본 생성 (나중에 업로드할 수 있도록 미리 준비)
5. 메모, 날짜·장소 기록
6. 시간순 사진첩, 상세 보기
7. 설정 (권장 사진 수)
8. **ZIP 내보내기/가져오기** (Local 사용자의 유일한 백업 수단이므로 완성도 있게)
- TestFlight / Play 내부 테스트로 소수 사용자 검증
- **완료 기준:** 로그인·서버 없이 선택 → 기록 → 다시 보기 → 내보내기 → 다른 기기에서 가져오기가 완결됨
- **현재 상태:** 1~8 구현, iOS 시뮬레이터에서 완료 기준 흐름 확인. 남은 것: Android 개발 빌드(로컬 모듈의 Kotlin 코드 포함)·실기기 확인, TestFlight / Play 내부 테스트 배포
- **구현 메모:**
  - 사진 파일은 `<document>/library/photos/{moment_id}/original.{ext}`, `display.jpg`(긴 변 1600px, JPEG 0.8). DB에는 library 기준 상대 경로만 저장한다 (iOS 컨테이너 경로가 바뀔 수 있음).
  - ZIP 형식은 library 폴더 + `manifest.json`(format `keepsake-export`, version 1). 삭제 기록(tombstone)도 포함하고, 가져올 때 `updated_at` 최신 우선으로 병합한다 (§3.2와 같은 규칙). 정의는 `mobile/src/lib/archive.ts`.
  - 장소 자동 채우기: 완료 후 사진 좌표를 주소로 바꿔 비어 있는 장소 칸을 채운다 (iOS는 Apple, Android는 OS Geocoder). 사진에 이미 있는 좌표만 쓰므로 위치 권한은 받지 않는다. 좌표가 Apple/Google 지오코딩 서버로 전송되므로 개인정보처리방침에 적는다 (Phase 3).
  - 촬영지 시간대: 원본 EXIF `OffsetTimeOriginal`을 `taken_tz_offset`(분)으로 저장하고, 없으면 지오코딩 결과의 시간대로 채운다. 날짜·시각은 촬영지 기준으로 보여준다. 둘 다 로컬 네이티브 모듈 `mobile/modules/photo-meta`.
  - 고르기 = '새로 찍은 사진': `settings.review_cursor`(여기까지 찍은 사진은 이미 봤다) 이후의 사진을 오래된 것부터 날짜별로 이어서 보여준다. 스크롤해서 화면에 절반 이상 보인 사진까지를 '봤다'로 치고, [남기기] 또는 [여기까지 봤어요]를 누를 때 지점을 옮긴다. 미래 시각이 찍힌 사진 때문에 지점이 앞서 나가지 않도록 현재 시각을 넘지 않게 한다. 처음 실행 때 시작 지점(오늘/1주/한 달/날짜)을 고르고, 설정에서 다시 정할 수 있다. 날짜별로 다시 보는 화면은 `/day`.
  - 알려진 한계: 지점보다 이전 시각으로 나중에 추가된 사진(다른 기기에서 받은 사진, 가져온 사진)은 고르기에 나타나지 않는다. 날짜로 보기에서는 보인다. → Phase 3 '놓친 사진'
  - `albums`/`album_moments` 테이블은 만들어 두었고, 시간순 사진첩은 moments를 날짜순으로 바로 보여준다. 여행·주제 사진첩은 Phase 4.

### Phase 2 — Cloud 백업·동기화 (4~5주)
결제 연결(스토어 상품·RevenueCat 자격 증명)은 기다리는 시간이 길어서 출시 직전(Phase 3의 '결제 연결')으로 미뤘다. 그동안 서버는 `CLOUD_BILLING_ENABLED=false`로 두고, 로그인한 계정을 구독 중으로 취급한다.
- Apple + Google 로그인 (Google을 넣으면 Apple 로그인 필수)
- 로그인 → 로컬 데이터 계정 연결 흐름
- 동기화 API, 업로드 흐름 (§3.1), 업로드 대기열·재시도, 와이파이 전용 옵션
- 새 기기 복원, 여러 기기 동기화
- 만료 처리: 업로드 중단 → 30일 읽기 전용 → 알림 3회 → 삭제 작업 (서버 로직과 테스트까지. 실제 해지 흐름은 결제 연결 후 확인)
- 계정 삭제 (App Store 필수 요건)
- **완료 기준:** 실기기에서 로그인 → 기기 A 백업 → 기기 B 복원 → 두 기기에서 고친 내용이 서로 반영됨 → 계정 삭제
- **현재 상태:** 서버·앱 코드 구현 (구독·만료 코드도 포함). 서버 쪽 흐름은 `backend/tests/test_cloud.py`가 로컬 Postgres·S3로 확인한다 (시간 조작은 `jobs.run(now=...)`). iOS 시뮬레이터 두 대와 로컬 서버로 완료 기준 흐름 확인 (2026-10-29): Apple·Google 로그인 → 백업 → 새 기기 복원(기록·표시용 사진) → 메모 수정이 다른 기기에 반영, 같은 기기에서 계정을 바꿔도 계정별로 따로 백업, 다시 로그인하면 사진을 다시 올리지 않음, 계정 삭제 후 서버·R2 데이터 삭제와 기기 데이터 유지. 남은 것: Android 빌드·확인, 실기기 확인, 푸시 자격 증명(APNs·FCM), 서버 배포와 cron
- **구현 메모:**
  - Cloud 화면은 가격까지 로그인 없이 보여준다 (RevenueCat 익명 사용자로 상품만 불러온다). 구매·복원은 로그인한 뒤에만 해서 결제가 항상 서버 `user_id`에 묶인다. RevenueCat 키가 없으면(결제 연결 전) 로그인 버튼만 보여준다.
  - `CLOUD_BILLING_ENABLED=false`면 저장된 구독 상태가 `none`인 계정을 `active`로 보여주고 허용한다 (`app/cloud.py`의 `subscription_status`). 저장 값은 바꾸지 않으므로 true로 바꾸면 바로 결제 규칙으로 돌아간다. `ENV=production`에서 false면 서버가 시작하지 않는다. 앱은 RevenueCat 키가 없으면 구독 관리 버튼과 해지 안내를 숨긴다.
  - 구독 상태 `none → active → grace(30일 읽기 전용) → expired(삭제됨)`. `BILLING_ISSUE`·`CANCELLATION`은 상태를 바꾸지 않는다 (스토어 결제 유예 중이거나 만료 전이므로). `REVENUECAT_API_KEY`가 있으면 webhook마다·구매 직후(`POST /account/refresh-subscription`)·삭제 직전에 RevenueCat REST로 다시 확인한다.
  - 사용량·사진·변경 번호를 바꾸는 요청(push, 업로드 시작·완료)은 모두 사용자 행을 먼저 잠근다. 같은 사용자의 요청이 차례로 처리되어 사용량이 어긋나거나 교착이 생기지 않는다.
  - 기기는 기록을 고칠 때 updated_at을 이전 값보다 항상 뒤로 잡는다. 기기 시계가 조금 늦어도 방금 받은 값을 고친 수정이 서버에서 '옛 값'으로 버려지지 않는다. 서버 시각(마이크로초)은 받을 때 기기 형식(밀리초, `toISOString`)으로 바꿔서 문자열 비교가 맞게 한다.
  - pull 커서는 기기 시각이 아니라 서버가 매기는 사용자별 변경 번호(`users.sync_seq`)다. 사진 업로드가 끝나도 번호를 올려서 다른 기기가 표시용 사진을 받으러 온다.
  - 서버는 기기 전용 값(사진 경로, `sync_state`, 업로드 여부)을 저장하지 않는다. 복원한 기기는 표시용 사진을 자동으로 받고, 원본은 설정의 [Cloud에만 있는 원본 받기]로 받는다.
  - moments 외 테이블(review_sessions, albums, album_moments)은 서버 `sync_records`에 같은 규칙으로 저장한다.
  - 기록을 지우면 사진은 `deleting` 상태가 되어 사용량에서 바로 빠지고, 주기 작업이 R2에서 지운다.
  - 계정 삭제는 요청 즉시 R2 prefix와 서버 행을 지운다. 스토어 구독은 서버가 해지할 수 없으므로 앱이 구독 관리로 안내한다.
  - 기기의 동기화 표시(`sync_state`, 업로드 여부, pull 커서)는 "계정 + 서버 데이터 세대" 하나에 묶인다. 로그아웃·계정 삭제·다른 계정 로그인·유예 만료로 서버 데이터가 지워진 경우(`users.data_generation`이 바뀜)에는 `local_only`로 돌아가서 처음부터 다시 올린다. 이미 Cloud에 있는 사진은 pull이 먼저 '올라감'으로 표시하므로 다시 올리지 않는다.
  - Google 로그인은 `@react-native-google-signin/google-signin`(네이티브). 토큰의 aud는 웹 클라이언트 ID다.

### Phase 3 — 다시 보기 강화 & 출시 (2주)
- "N년 전 오늘" 재발견 카드 (가끔 조용히)
- **고르기 리마인더 알림** (`expo-notifications`, 로컬 알림. 서버 불필요)
  - 설정: 켜기/끄기, 시각(기본 21:00), 빈도(매일 / 이틀마다 / 매주, 기본 이틀마다)
  - 권한: 처음 [남기기]를 마친 뒤 한 번 "알림으로 알려드릴까요?" 묻고, 이후는 설정에서만 바꾼다
  - 예약: 앱이 백그라운드로 갈 때·설정을 바꿀 때·[남기기] 후에 기존 예약을 모두 지우고 다음 7회분을 다시 예약한다 (iOS 예약 한도 64개)
  - 내용: 예약 시점에 `review_cursor` 이후 사진 수(`getPhotosSince(...).totalCount`)를 넣는다. 예) "지난 3일 동안 찍은 사진 24장 중 십 년 뒤에도 보고 싶은 사진이 있나요?" 0장이면 첫 회는 건너뛰고 이후 회차는 일반 문구("최근 찍은 사진 중 남기고 싶은 순간이 있나요?")
  - 오늘 이미 [남기기]/[여기까지 봤어요]를 했으면 오늘 알림은 건너뛴다
  - 알림을 누르면 고르기 탭으로 연다. Android는 알림 채널을 만든다
  - 완료 기준: 실기기에서 예약 → 알림 수신 → 눌러서 고르기 화면 열림, 빈도·시각 변경이 반영됨
- **놓친 사진**: 고르기 지점보다 이전 시각으로 새로 추가된 사진이 있으면 고르기 위쪽에 "놓친 사진 N장" 묶음으로 보여준다 (MediaLibrary 변경 이벤트 + 마지막 확인 시각과 `modificationTime` 비교. Android는 변경 내역을 주지 않으므로 앱을 열 때 비교)
- **필름 사진첩 느낌 다듬기**: 사진첩 카드를 인화 사진처럼(흰 여백, 손글씨 느낌의 메모 영역), 월별 묶음을 '롤'로 표현하는 것 검토. 고르기 → 남기기 → 사진첩으로 이어지는 문구를 '남기다'로 통일했으니 화면 디자인도 맞춘다
- Local 사용자 대상 내보내기 권유 (마지막 내보내기가 30일 넘으면 설정·알림으로 안내)
- 개인정보처리방침, 이용약관(구독 조건·만료 후 삭제 정책 명시), 스토어 메타데이터, Sentry, 최소 지표
- **결제 연결** (Phase 2에서 미룬 것. 코드는 이미 있고 설정과 확인만 남았다)
  - App Store Connect / Play Console 구독 상품, 스토어 결제 유예 설정 (Play는 AAB를 한 번 올려야 RevenueCat이 검증할 수 있다)
  - AAB를 올린 뒤 Play 앱 서명 키 SHA-1로 Google OAuth Android 클라이언트를 하나 더 만든다 (스토어에서 받은 앱은 Google이 다시 서명하므로 등록하지 않으면 Google 로그인이 실패한다). 로컬 디버그 키와 EAS 키는 등록해 두었다.
  - RevenueCat: 앱·상품, entitlement `cloud`, current offering, 웹훅(`/billing/revenuecat`), 서비스 계정 권한
  - 서버 `CLOUD_BILLING_ENABLED=true`, `REVENUECAT_*`, 앱 `EXPO_PUBLIC_REVENUECAT_*_KEY`
  - 결제 없이 쓰던 테스트 계정은 상태가 `none`이라 결제를 켜면 페이월로 간다 (데이터는 남아 있다)
  - 유예 알림 이메일 (메일 서비스 선택 후)
  - 완료 기준: 샌드박스 계정으로 구독 → 백업 → 해지 → 읽기 전용 → 재구독 즉시 복구, 그리고 별도 계정으로 해지 → 30일 경과(시간 조작) → 삭제까지 확인
- 스토어 심사 제출

### Phase 4 이후 — 검증 결과에 따라
여행 모드(좌표·시간으로 기록을 묶어 여행 사진첩 제안), 지도로 보기, AI 결정 보조, 검색, 제한적 공유, 화질 기준 하위 유료 등급

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
