# Keepsake

모든 순간을 저장하기보다, 소중한 순간을 선택한다.

- 제품 비전: [STARTING_POINT.md](STARTING_POINT.md)
- 개발 계획: [docs/PLAN.md](docs/PLAN.md)
- 출시 전 QA: [docs/QA.md](docs/QA.md)

## 구조

```
backend/   FastAPI (Python 3.13, uv) — 계정, 구독 상태, 백업·동기화
mobile/    Expo (SDK 54, TypeScript, expo-router) — vernissage와 같은 버전 — iOS / Android 앱
  modules/ 앱 안의 로컬 네이티브 모듈 (photo-meta: 사진 좌표 → 주소, 원본 EXIF의 촬영 시간대)
docs/      계획, QA 체크리스트, 약관·개인정보처리방침(legal/), 스토어 등록 정보(store/)
```

## 처음 설정

필요한 도구: Docker, Node.js, [uv](https://docs.astral.sh/uv/), EAS CLI

```bash
cp backend/.env.example backend/.env
cp mobile/.env.example mobile/.env

(cd backend && uv sync)
(cd mobile && npm install)

./start.sh     # Postgres(15434) + S3 호환 스토리지(9010, 콘솔 9011) + 버킷 생성 + 마이그레이션 + API(18020)
```

로컬 호스트 포트는 [compose.dev.env](compose.dev.env)에 모여 있다 (vernissage·atelierlabs와 겹치지 않게 배정).

## 자주 쓰는 명령

| 명령 | 설명 |
|---|---|
| `./start.sh` | 인프라 + 마이그레이션 + API 서버(백그라운드, hot reload) 시작. 문서는 http://localhost:18020/docs |
| `./stop.sh` | API 서버 + 컨테이너 중지 (`--api` API만, `--clean` 컨테이너 제거, `--reset` 볼륨까지 삭제) |
| `./restart.sh` | API 서버 재시작 (`backend/.env` 변경 반영, `--all`은 컨테이너까지) |
| `./logs.sh` | API 로그 (`db`, `s3`, `all`) |
| `./set-ip.sh` | 실기기용으로 API·S3 주소를 Mac LAN IP로 변경 (`--local`로 되돌림) |
| `make api` | API 서버를 포그라운드로 실행 (`./start.sh` 대신 직접 띄울 때) |
| `make mobile` | Expo 개발 서버 실행 (포트 18082) |
| `make ios` | iOS 시뮬레이터용 개발 빌드 설치 (네이티브 패키지·`app.json`·`mobile/modules`가 바뀌었을 때) |
| `make icons` | `mobile/assets/source/keepsake_icon.png`로 아이콘·스플래시 재생성 |
| `make test` | 백엔드 테스트 |
| `make lint` | 백엔드·scripts ruff + 모바일 타입 체크·린트 |
| `make api-types` | Pydantic 모델 → `mobile/src/api/schema.d.ts` 타입 재생성 |
| `make migration m="설명"` | 모델 변경으로 Alembic 마이그레이션 생성 |
| `make up` / `make down` | 인프라만 시작 / 종료 |

백엔드 API를 바꾸면 `make api-types`를 실행해서 모바일 타입을 갱신한다. 잊으면 `make test`의 `test_openapi`가 실패한다.

## 실기기에서 실행하기

이 앱은 Expo Go가 아니라 **Development Build**로 실행한다 (사진 라이브러리 등 네이티브 모듈 때문).

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest init                                   # 최초 1회, EAS 프로젝트 연결
npx eas-cli@latest build --profile development --platform ios      # 또는 android
```

빌드된 앱을 기기에 설치한 뒤 `make mobile`로 개발 서버에 연결한다.
API 주소(`mobile/.env`의 `EXPO_PUBLIC_API_URL`):

- iOS 시뮬레이터: `http://localhost:18020` 그대로 (`./set-ip.sh --local`)
- Android 에뮬레이터: `http://10.0.2.2:18020` (에뮬레이터 안의 localhost는 에뮬레이터 자신)
- 실기기: `./set-ip.sh` — Mac의 LAN IP로 API 주소와 `backend/.env`의 `R2_ENDPOINT_URL`을 함께 바꾼다 (Cloud 사진의 presigned URL을 휴대폰이 열 수 있어야 하므로)

`.env`는 git에 올라가지 않으므로 EAS 클라우드 빌드에는 포함되지 않는다. preview·production 빌드의 API 주소는 서버를 배포할 때(Phase 2) `eas.json`의 `env`나 EAS 환경 변수로 지정한다.

## Cloud 백업 (Phase 2)

로그인한 사용자는 무료로 기록(메모·장소·앨범)을 서버에 백업한다. 유료 구독은 안전 앨범에 담은 사진을 보관하는 기능에만 필요하다.
앱은 로그인 상태에서 앱을 열 때·앞으로 돌아올 때·기록이 바뀐 뒤 동기화한다
(기록 push → 다른 기기 변경 pull → 더는 필요 없는 사진 정리 → 사진 업로드. 사진은 기기 사진첩에 없을 때 볼 때마다 한 장씩 받는다). 구독 여부는 서버가 RevenueCat webhook과 REST 조회로만 판단한다.

결제 연결은 출시 직전으로 미뤘다 (docs/PLAN.md Phase 3). 그때까지 서버는 `CLOUD_BILLING_ENABLED=false`로 두고, 로그인한 계정을 구독 중으로 취급한다. 아래 외부 설정 중 1·2번은 그때 한다.

| 위치 | 내용 |
|---|---|
| `backend/app/cloud.py` | 구독 규칙 (사진 쓰기·읽기 허용, 만료 → 30일 유예, 사진 삭제) |
| `backend/app/api/` | `auth`(Apple/Google 로그인), `account`(상태·기기 등록·계정 삭제), `sync`, `uploads`, `billing`(webhook) |
| `backend/app/jobs.py` | 주기 작업: 유예 알림 3회, 30일 뒤 삭제, 계정 삭제 마무리, 미완료 업로드 정리 |
| `mobile/src/db/spaces.ts` | Local과 계정별 공간(DB 파일) 관리 |
| `mobile/src/lib/cloud/` | 세션, 계정 공간, 기기 기록 올리기, 사진 연결, 동기화, 사진 업로드·다운로드, RevenueCat, 로그인, 푸시 토큰 |
| `mobile/src/app/cloud.tsx` | 소개·가격(로그인 없이) → 로그인(기록 백업) → 구매 / 구매 복원(사진 보관) |

로컬에서 Cloud 흐름 시험:

```bash
make up && make migrate && make test     # tests/test_cloud.py가 로컬 Postgres·S3로 전체 흐름을 확인
cd backend && uv run python -m app.jobs  # 주기 작업 한 번 실행
```

### 외부 설정 (실제 로그인·결제)

1. **App Store Connect / Play Console**: Cloud 구독 상품(같은 구독 그룹), 결제 유예(Billing Grace Period / 유예 기간) 켜기. Play는 앱을 만들고 AAB를 내부 테스트 트랙에 한 번 올려야 RevenueCat이 패키지를 찾는다.
2. **RevenueCat**: 두 스토어 앱·상품, entitlement `cloud`, current offering. webhook URL `https://<API>/billing/revenuecat`, Authorization 헤더 `Bearer <REVENUECAT_WEBHOOK_SECRET>`.
3. **로그인**: Apple 개발자 계정에서 App ID에 Sign in with Apple 켜기. Google Cloud Console에서 OAuth 클라이언트 3개(웹, iOS 번들 ID, Android 패키지+SHA-1 — 로컬·EAS·Play 앱 서명 키 각각).
4. **환경 변수**: `backend/.env.example`, `mobile/.env.example`의 Cloud 항목. 모바일 값은 EAS 환경 변수로도 넣는다.
5. **푸시 알림**: `eas init`으로 projectId 연결, `eas credentials`로 APNs 키, Android는 FCM V1 서비스 계정 키 업로드.
6. **배포 (Railway)**: Root Directory `backend`로 `backend/Dockerfile`을 빌드한다. API 서비스는 Pre-deploy `alembic upgrade head`, 헬스 체크 `/health/ready`. Jobs 서비스는 Start `python -m app.jobs`, Cron `0 * * * *`. `DATABASE_URL`은 `postgresql://`도 받으며 psycopg 드라이버로 바꿔 쓴다.
7. **Sentry**: 서버 `SENTRY_DSN`, 앱 `EXPO_PUBLIC_SENTRY_DSN`, EAS `preview`·`production` 환경의 시크릿 `SENTRY_AUTH_TOKEN`(소스맵 업로드. 없으면 Release 빌드가 실패한다).
