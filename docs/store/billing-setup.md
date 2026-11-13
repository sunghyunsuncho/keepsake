# 결제 연결 (RevenueCat)

> 기준 문서: [PRICING.md](../PRICING.md) §2.1(가격·체험), §5(상품 ID) · [PLAN.md](../PLAN.md) §2.3, Phase 3 '결제 연결'
> 최종 수정: 2026-11-13
>
> 코드는 준비돼 있다. 이 문서는 콘솔에서 할 일을 순서대로 적는다. 끝낸 단계는 체크하고 날짜를 남긴다.

## 0. 범위

- **지금 (사업자등록 전):** 개인 개발자 계정으로 테스트 결제까지 연결한다. 실제 돈은 오가지 않는다 (App Store 샌드박스, Play 라이선스 테스터).
- **나중 (사업자등록 후):** 실제 판매. 사업자등록·통신판매업 신고가 필요한지 세무사에게 확인한 뒤 연다. 그 전에 출시하면 무료 앱으로 내고, 구독 기능은 관리자 화면의 '구독 회원 (무상 제공)'으로 연다.
- Play 개인 계정(2023-11-13 이후 가입)은 정식 출시 전에 **테스터 12명 이상, 14일 연속 비공개 테스트**가 필요하다. 이 테스트 기간에 결제 확인도 같이 한다.

기다리는 시간이 긴 것부터 시작한다: ① Apple 유료 앱 계약, ② Play 첫 AAB 업로드, ③ Play 서비스 계정 권한 반영(최대 36시간).

## 1. 상품

| 요금제 | 기간 | 가격 | App Store 상품 ID | Play 구독 ID : 기본 요금제 ID |
|---|---|---|---|---|
| 10GB | 월간 | ₩1,500 | `keepsake_cloud_10gb_monthly` | `keepsake_cloud_10gb` : `monthly` |
| 10GB | 연간 | ₩15,000 | `keepsake_cloud_10gb_yearly` | `keepsake_cloud_10gb` : `yearly` |
| 100GB | 월간 | ₩3,900 | `keepsake_cloud_100gb_monthly` | `keepsake_cloud_100gb` : `monthly` |
| 100GB | 연간 | ₩39,000 | `keepsake_cloud_100gb_yearly` | `keepsake_cloud_100gb` : `yearly` |

- 상품 ID는 서버(`backend/app/plans.py`)와 앱(`mobile/src/lib/cloud/purchases.ts`)이 요금제를 알아보는 이름이다. **다르게 만들면 요금제를 알 수 없다.** 바꾸려면 두 파일을 함께 고친다.
- 스토어에 정확히 같은 가격 단계가 없으면 가장 가까운 단계를 고르고 PRICING.md §2.1을 고친다.
- 모든 상품에 첫 구독 30일 무료 체험을 붙인다.

## 2. App Store Connect

- [ ] **유료 앱 계약** (비즈니스 → 계약): 개인 계정이면 본인 명의 계좌와 세금 정보(W-8BEN)로 맺는다. 계약이 '활성'이 되어야 샌드박스 결제도 된다.
- [ ] 앱 → 수익화 → **구독** → 구독 그룹 `Keepsake 안전 보관` 하나를 만든다. 네 상품을 **모두 이 그룹에** 넣는다 (그래야 요금제를 바꿀 수 있고, 무료 체험이 Apple ID당 한 번이 된다).
  - 그룹 안 순서(수준): 100GB 상품들을 위에, 10GB 상품들을 아래에 둔다. 위가 업그레이드다.
  - 상품마다: 기간, 가격(대한민국 기준, 다른 나라는 자동 환산), 현지화(한국어·영어·일본어 표시 이름과 설명), 심사용 스크린샷(구독 화면).
  - 상품마다 **프로모션 오퍼(Introductory Offer) → 무료 → 1개월**, 모든 국가.
- [ ] 구독 → **결제 유예 기간(Billing Grace Period)** 켜기: 16일, 모든 갱신, 프로덕션과 샌드박스.
- [ ] 사용자 및 액세스 → 통합 → **인앱 구입** 키(.p8)를 만든다. 키 ID, 발급자(Issuer) ID와 파일을 보관한다 (파일은 한 번만 받을 수 있다).
- [ ] 사용자 및 액세스 → **Sandbox** → 테스터 계정을 만든다. 실제로 쓰지 않는 이메일이어야 한다. 국가는 대한민국.

## 3. Google Play Console

- [ ] 설정 → **결제 프로필**을 만든다 (개인 유형).
- [ ] **첫 AAB 업로드:** `cd mobile && npx eas-cli@latest build -p android --profile production` → 테스트 → **비공개 테스트** 트랙에 올린다. 결제 권한(`com.android.vending.BILLING`)은 `react-native-purchases`가 넣는다.
  - [ ] 업로드 뒤 설정 → 앱 서명의 **앱 서명 키 SHA-1**로 Google OAuth Android 클라이언트를 하나 더 만든다 (PLAN.md Phase 3).
- [ ] 수익 창출 → 제품 → **구독**: `keepsake_cloud_10gb`, `keepsake_cloud_100gb` 두 개.
  - 각 구독에 기본 요금제 `monthly`(1개월 자동 갱신), `yearly`(1년 자동 갱신), 가격 설정 후 활성화.
  - 기본 요금제마다 **유예 기간**(7일)과 **계정 보류**를 켠다.
  - 기본 요금제마다 오퍼 → **무료 체험 30일**, 자격은 '신규 고객 확보 → 이 앱의 구독을 구매한 적 없는 사용자'.
- [ ] 설정 → **라이선스 테스트**에 테스트할 Google 계정을 넣는다 (라이선스 응답: RESPOND_NORMALLY). 이 계정은 결제가 청구되지 않고, 갱신 주기가 짧아진다 (월간이 5분).
- [ ] **서비스 계정** (RevenueCat 안내 문서 'Creating Play Service Credentials'를 따른다)
  - Google Cloud Console(Play Console과 연결된 프로젝트)에서 *Google Play Android Developer API*, *Google Play Developer Reporting API*, *Cloud Pub/Sub API*를 켠다.
  - 서비스 계정을 만들고 JSON 키를 받는다. 역할: Pub/Sub Editor, Monitoring Viewer.
  - Play Console → 사용자 및 권한 → 서비스 계정 이메일을 초대한다. 권한: **앱 정보 보기, 재무 데이터 보기, 주문 및 구독 관리**.
  - 반영까지 최대 36시간이 걸린다. RevenueCat이 'Valid credentials'라고 하기 전까지 Play 상품을 불러오지 못한다.

## 4. RevenueCat

- [ ] 프로젝트 `Keepsake`를 만든다.
- [ ] **App Store 앱:** 번들 ID `com.atelierlabs.keepsake`, 인앱 구입 키(.p8)·키 ID·발급자 ID를 넣는다.
  - [ ] 화면에 나오는 **Apple Server Notification URL**을 App Store Connect → 앱 정보 → App Store 서버 알림에 붙인다 (프로덕션과 샌드박스 모두, 버전 2).
- [ ] **Play 앱:** 패키지 `com.atelierlabs.keepsake`, 서비스 계정 JSON을 올린다.
  - [ ] **Google developer notifications**: RevenueCat이 Pub/Sub 토픽을 만들게 하고, 토픽 이름을 Play Console → 수익 창출 설정 → 실시간 개발자 알림에 넣는다. '테스트 알림 보내기'로 확인한다.
- [ ] **Products:** 양쪽 스토어에서 여덟 개 상품을 가져온다 (Play는 `keepsake_cloud_10gb:monthly` 꼴로 보인다).
- [ ] **Entitlements:** 식별자 **`cloud`** 하나를 만들고 여덟 개 상품을 모두 붙인다. 서버 `REVENUECAT_ENTITLEMENT_ID` 기본값과 같아야 한다.
- [ ] **Offerings:** `default`를 만들어 **Current**로 지정하고 패키지 네 개를 둔다. 패키지마다 App Store 상품과 Play 상품을 하나씩 붙인다.

  | 패키지 식별자 | App Store | Play |
  |---|---|---|
  | `cloud_10gb_monthly` | `keepsake_cloud_10gb_monthly` | `keepsake_cloud_10gb:monthly` |
  | `cloud_10gb_yearly` | `keepsake_cloud_10gb_yearly` | `keepsake_cloud_10gb:yearly` |
  | `cloud_100gb_monthly` | `keepsake_cloud_100gb_monthly` | `keepsake_cloud_100gb:monthly` |
  | `cloud_100gb_yearly` | `keepsake_cloud_100gb_yearly` | `keepsake_cloud_100gb:yearly` |

  앱은 패키지 식별자가 아니라 상품 ID로 요금제를 알아보므로, 패키지 이름은 달라도 동작한다.
- [ ] **API keys** (Project settings → API keys)
  - 공개 SDK 키 두 개: iOS `appl_...`, Android `goog_...`
  - **비밀 키**를 새로 만든다. API 버전은 **V1**을 고른다 (서버가 `/v1/subscribers`를 쓴다. V2 키로는 조회·삭제가 실패한다).
- [ ] **Webhook** (Integrations → Webhooks → Add)
  - URL: `{{운영 API 주소}}/billing/revenuecat`
  - Authorization header: `Bearer ` 뒤에 무작위 값 (`openssl rand -hex 32`). 서버는 `Bearer `까지 포함한 값을 비교한다.
  - 환경: 프로덕션과 샌드박스 **모두** (App Store 심사도 샌드박스로 결제한다).

## 5. 키 넣기

**서버** (Railway 운영 환경 변수):

```
REVENUECAT_WEBHOOK_SECRET=<Webhook 무작위 값, 'Bearer ' 없이>
REVENUECAT_API_KEY=sk_...        # V1 비밀 키
REVENUECAT_ENTITLEMENT_ID=cloud  # 기본값과 같으면 생략
```

`ENV=production`에서는 앞의 두 값이 없으면 서버가 시작하지 않는다. 넣은 뒤 배포하고 `alembic upgrade head`가 돌았는지 확인한다 (`20261113_01`: 옛 요금제 이름 `cloud` → `cloud_10gb`).

**앱** (EAS 환경 변수 `preview`·`production`, 로컬은 `mobile/.env`):

```
EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_...
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_...
```

`npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_REVENUECAT_IOS_KEY --value appl_... --visibility plaintext`처럼 넣고, **다시 빌드**한다 (JS에 들어가는 값이라 OTA 업데이트로도 바뀌지만, 처음은 빌드로 확인한다). 키가 없으면 구독 화면은 '준비하고 있어요'만 보여 준다.

## 6. 확인

- [ ] RevenueCat Webhook 화면의 **Send test event** → 서버 응답 204 (TEST 이벤트는 기록만 한다).
- [ ] iOS: TestFlight 빌드, 기기의 설정 → App Store → 샌드박스 계정에 테스터로 로그인 → 구독 화면에 두 요금제·네 가격·'30일 무료'가 보인다.
- [ ] Android: 라이선스 테스터 계정으로 비공개 테스트 빌드 설치 → 같은 화면 확인.
- [ ] 10GB 월간 구독 → 설정의 '사용한 공간'이 `… / 10GB` → 안전 앨범 백업.
- [ ] 10GB → 100GB 올리기 → 바로 `… / 100GB`. Android는 구독이 두 개로 남지 않는지 Play 구독 관리에서 본다.
- [ ] 해지 → 만료(샌드박스는 월간이 몇 분) → 읽기 전용(유예) → 재구독하면 바로 복구.
- [ ] 다른 테스터로 해지 → 30일 경과(서버 `jobs.run(now=...)`로 시간 조작) → 사진 삭제.
- [ ] 같은 스토어 계정으로 다시 구독하면 무료 체험이 보이지 않는다.
- [ ] 구매 복원: 앱을 지웠다 다시 설치 → 로그인 → '구매 복원'.

샌드박스 갱신 주기(App Store): 1개월 → 5분, 1년 → 1시간, 하루 최대 12번 갱신 뒤 만료. 무료 체험 1개월도 5분이다.

## 7. 실제 판매로 바꿀 때

- [ ] 사업자등록 (필요하면 통신판매업 신고). App Store·Play의 판매자 정보와 정산 계좌를 사업자 명의에 맞출지 확인한다.
- [ ] 스토어 설명의 구독 안내([listing.md](listing.md) §4)와 약관 제6조가 최종 가격과 같은지 확인한다.
- [ ] App Store 심사 메모에 샌드박스 테스트 방법을 적는다 ([listing.md](listing.md) §8).
