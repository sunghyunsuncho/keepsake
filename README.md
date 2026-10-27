# Keepsake

모든 순간을 저장하기보다, 소중한 순간을 선택한다.

- 제품 비전: [STARTING_POINT.md](STARTING_POINT.md)
- 개발 계획: [docs/PLAN.md](docs/PLAN.md)

## 구조

```
backend/   FastAPI (Python 3.13, uv) — 계정, 구독 상태, 백업·동기화
mobile/    Expo (SDK 54, TypeScript, expo-router) — vernissage와 같은 버전 — iOS / Android 앱
docs/      계획 문서
```

## 처음 설정

필요한 도구: Docker, Node.js, [uv](https://docs.astral.sh/uv/), EAS CLI

```bash
cp backend/.env.example backend/.env
cp mobile/.env.example mobile/.env

(cd backend && uv sync)
(cd mobile && npm install)

make up        # Postgres(5433) + S3 호환 스토리지(9010, 콘솔 9011) 실행, 버킷 생성
make migrate   # DB 마이그레이션
```

## 자주 쓰는 명령

| 명령 | 설명 |
|---|---|
| `make api` | API 서버 실행 (http://localhost:8010, 문서는 `/docs`) |
| `make mobile` | Expo 개발 서버 실행 (포트 8082) |
| `make ios` | iOS 시뮬레이터용 개발 빌드 설치 (네이티브 패키지·`app.json`이 바뀌었을 때) |
| `make icons` | `mobile/assets/source/keepsake_icon.png`로 아이콘·스플래시 재생성 |
| `make test` | 백엔드 테스트 |
| `make lint` | 백엔드·scripts ruff + 모바일 타입 체크·린트 |
| `make api-types` | Pydantic 모델 → `mobile/src/api/schema.d.ts` 타입 재생성 |
| `make migration m="설명"` | 모델 변경으로 Alembic 마이그레이션 생성 |
| `make down` | 인프라 종료 |

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

- iOS 시뮬레이터: `http://localhost:8010` 그대로
- Android 에뮬레이터: `http://10.0.2.2:8010` (에뮬레이터 안의 localhost는 에뮬레이터 자신)
- 실기기: Mac의 LAN IP (`ipconfig getifaddr en0`)

`.env`는 git에 올라가지 않으므로 EAS 클라우드 빌드에는 포함되지 않는다. preview·production 빌드의 API 주소는 서버를 배포할 때(Phase 2) `eas.json`의 `env`나 EAS 환경 변수로 지정한다.
