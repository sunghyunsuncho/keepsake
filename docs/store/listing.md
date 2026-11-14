# 스토어 등록 정보 (초안)

> 실제 릴리스 문구·스크린샷 경로의 기준은 [`store-assets/`](../../store-assets/README.md)와
> [`mobile/store.config.json`](../../mobile/store.config.json)이다. 이 문서는 개인정보 라벨·심사
> 메모처럼 콘솔에 수동 입력하는 출시 체크리스트를 보관한다.

> 작성: 2026-10-30 · 수정: 2026-11-13 (문구 톤, 공유 앨범·효율 보관·앨범 지도 추가) · 상태: 초안
>
> 글자 수 제한은 스토어 기준이다 (App Store 이름·부제 30자, 프로모션 텍스트 170자, 키워드 100바이트, 설명 4,000자 / Play 앱 이름 30자, 간단한 설명 80자, 자세한 설명 4,000자).
> 남은 `{{ }}`를 채운다. 가격·용량·체험 기간은 [PRICING.md](../PRICING.md) §2를 따른다 (2026-11-13 확정).

## 1. 기본 정보

| 항목 | App Store | Google Play |
|---|---|---|
| 앱 이름 | Keepsake - 추억 기록·앨범 공유 (en: Keepsake - Albums & Memories, ja: Keepsake - 思い出の記録・共有) | 같음 |
| 부제 / 간단한 설명 | 간직할 사진만 골라 함께 보는 앨범 | 간직하고 싶은 사진만 골라 메모를 남기고, 가족과 함께 보는 나만의 사진첩 |
| 카테고리 | 사진 및 비디오 (보조: 라이프스타일) | 사진 |
| 연령 등급 | 4+ | 전체 이용가 |
| 번들 ID / 패키지 | com.atelierlabs.keepsake | com.atelierlabs.keepsake |
| 지원 URL | {{지원 페이지}} | {{지원 페이지}} |
| 개인정보처리방침 URL | https://keepsake.atelierlabs.co.kr/legal/privacy-policy (영어: /en/legal/privacy-policy) | 같음 |
| 이용약관(EULA) | https://keepsake.atelierlabs.co.kr/legal/terms-of-service (영어: /en/legal/terms-of-service, 구독 앱은 설명이나 EULA 칸에 링크 필수) | 같음 |

### 1.1 문구에서 내세우는 것 (2026-11-13)

문구 톤은 '~해요' 체로 부드럽게 쓴다. 기능 이름(놓친 사진, 그날의 기억, 앨범 지도, 안전 보관, 효율 보관, 공유 앨범)은 앱 화면의 이름 그대로 쓴다.

1. **고르기:** 지난번에 본 다음 사진부터 이어서 고른다. 놓친 사진, 고르기 알림
2. **기록:** 사진마다 메모. 장소는 사진 좌표로 채운다 (현재 위치 권한 없음)
3. **내가 보기 편한 앨범:** 사진을 복사하지 않아 앨범을 늘려도 휴대폰 용량을 더 쓰지 않는다. 앨범 지도, 그날의 기억
4. **정리:** 남기지 않은 사진은 원할 때만 지운다
5. **공유 앨범 (핵심):** 부모님·가족과 함께 보는 앨범. 초대 코드로 참여하고, 구독하지 않은 사람도 로그인하면 보고 담는다. 앨범 용량은 구성원이 나눠 준 할당의 합. 만드는 사람은 안전 보관 구독이 필요하다 (PRICING.md §3)
6. **안전 보관 (유료):** 휴대폰에서 지워도·잃어버려도 남는다. iPhone ↔ Android에서 같은 사진을 본다 (Apple 로그인은 iOS에만 있어 Google 계정일 때만). 효율 보관은 휴대폰에서 보기 충분한 긴 변 2048px로 줄여 용량을 아낀다. 원본 보관도 고를 수 있다
7. **로그인 없이 시작:** 핵심 기능은 무료. 로그인하면 기록을 무료로 백업한다

## 2. 키워드 (App Store, 100바이트)

`사진정리,사진첩,앨범,공유앨범,가족앨범,사진일기,추억,메모,갤러리,지도`

한국어는 한 글자가 3바이트라 약 33자다. 이름·부제에 있는 단어(사진, 남기다, 함께)는 다시 넣지 않아도 검색된다. `npm run metadata:lint`(mobile)가 길이를 확인한다.

## 3. 프로모션 텍스트 (App Store, 170자)

사진은 함께 볼 때 더 즐거워요. 오래 간직하고 싶은 순간을 골라 메모와 함께 남기고, 부모님·가족과 함께 보는 공유 앨범에서 언제든 같이 꺼내 보세요.

## 4. 설명

> 두 스토어에 같은 글을 쓴다. 아래는 유료 판매를 시작한 뒤의 글이다. 결제를 열기 전(지금)의 `mobile/store.config.json`·`store-assets/listing/play-store.*.md`에는 '구독 안내' 단락 대신 안전 보관 제목 아래에 "안전 보관 구독은 지금 준비하고 있어요. 조금만 기다려 주세요!"를 둔다. 결제를 열면 그 줄을 빼고 '구독 안내'를 더한다. 구독 안내는 App Store 심사 요건(가격·기간·자동 갱신·해지 방법·약관 링크)이다.
>
> App Store 설명에는 이모지를 쓸 수 없다(`eas metadata:push`가 거부한다). `mobile/store.config.json`에는 소제목 앞 이모지를 빼고 넣는다. `•` 글머리표는 괜찮다. Play 설명은 아래 글 그대로 둔다.

```
수많은 사진 속에서, 정말 간직하고 싶은 순간만 골라 보세요.

사진은 하루에도 수십 장씩 쌓이는데, 다시 꺼내 보는 사진은 몇 장 되지 않죠. Keepsake는 오래 간직하고 싶은 순간을 직접 고르고, 그때의 이야기를 적어 두었다가, 시간이 지나 다시 펼쳐 볼 수 있게 도와주는 나만의 사진첩이에요.

📷 매일 몇 장씩, 편하게 골라요
• 지난번에 본 다음 사진부터 이어서 보여 드려요. 어디까지 봤는지 기억하지 않아도 돼요
• 깜빡 지나친 사진은 '놓친 사진'으로 다시 챙겨 드려요
• 원하는 주기와 시간에 고르기 알림을 보내 드려요

✏️ 사진에 그날의 이야기를 남겨요
• 그때의 마음이나 기억을 짧은 메모로 적어 두세요
• 사진을 찍은 장소는 알아서 채워 드려요 (현재 위치 권한은 필요 없어요)

📚 내가 보기 편한 앨범
• 여행, 가족, 계절처럼 내가 보기 편한 방식으로 앨범을 만들어요
• 사진을 복사하지 않고 원본을 가리키기만 해서, 앨범을 여러 개 만들어도 휴대폰 용량은 그대로예요
• 앨범 지도에서 사진을 찍은 곳을 따라 둘러볼 수 있어요
• '그날의 기억'이 몇 년 전 오늘의 사진을 조용히 꺼내 보여 드려요

🧹 남기지 않은 사진은 가볍게 정리해요
• 다 고르고 나면 남기지 않은 사진을 한눈에 보고, 원할 때만 정리할 수 있어요

👨‍👩‍👧 가족과 함께 보는 공유 앨범
사진은 함께 볼 때 더 즐거워요. 부모님, 가족, 친구와 앨범 하나를 만들어 언제든 같이 열어 보세요.
• 초대 코드 하나로 참여하고, 각자 남긴 사진을 함께 담아요
• 구독하지 않은 가족도 로그인만 하면 함께 보고 사진을 담을 수 있어요
• 앨범 용량은 참여한 사람들이 조금씩 나눠 준 만큼 함께 써요

🔒 Keepsake 안전 보관 (선택 구독)
• 안전 앨범에 담은 사진과 동영상을 보관해 드려요. 휴대폰 사진첩에서 지우거나 휴대폰을 잃어버려도 그대로 남아요
• iPhone에서 올린 사진을 Android에서도 그대로 볼 수 있어요 (Google 계정으로 로그인)
• 휴대폰으로 보기에 충분히 선명한 크기(긴 변 2048px)로 줄여 담는 '효율 보관'으로 용량을 아껴요. 꼭 지키고 싶은 사진은 원본 그대로 보관할 수도 있어요
• 공유 앨범은 안전 보관을 구독하면 만들 수 있어요

🌱 로그인 없이 바로 시작해요
고르기, 메모, 앨범, 지도, 정리는 모두 무료예요. 기록은 이 기기에만 저장되고, 로그인하면 메모·장소·앨범을 무료로 백업해 새 휴대폰에서도 이어 볼 수 있어요.

구독 안내
• 안전 보관 10GB: 월 ₩1,500 / 연 ₩15,000
• 안전 보관 100GB: 월 ₩3,900 / 연 ₩39,000
• 처음 구독하면 30일 동안 무료로 써 볼 수 있어요 (스토어 계정당 한 번). 체험이 끝나기 24시간 전까지 해지하지 않으면 고른 요금으로 결제돼요
• 결제는 구매를 확인할 때 Apple ID(또는 Google 계정)로 청구돼요
• 지금 기간이 끝나기 24시간 전까지 해지하지 않으면 자동으로 갱신돼요
• 구독 관리와 해지는 기기의 계정 설정에서 할 수 있어요
• 구독이 끝나도 30일 동안은 보관한 파일을 내려받을 수 있고, 그 뒤에는 파일이 삭제돼요. 기록 백업은 로그인한 동안 계속돼요

개인정보처리방침: https://keepsake.atelierlabs.co.kr/legal/privacy-policy
이용약관: https://keepsake.atelierlabs.co.kr/legal/terms-of-service
```

정리(지우기) 동작은 설명에 넣지 않고 앱 안 확인 창에서 알린다: iPhone은 '최근 삭제된 항목'에 30일 동안 있고(iCloud 사진을 쓰면 다른 기기에서도 지워짐), Android 11 이상은 기기 휴지통으로 옮겨지며, 그보다 낮은 버전은 되돌릴 수 없다.

## 5. 스크린샷 문구

6.9인치(iPhone) 필수, 6.5인치는 6.9인치로 대체 가능. Play는 휴대전화 스크린샷 2~8장. 문구의 기준은 `store-assets/slides.ts`이고, 고치면 `npm run generate:all`로 다시 만든다.

| 순서 | 화면 | 큰 문구 | 작은 문구 |
|---|---|---|---|
| 1 | 고르기 | 오늘 찍은 사진 중, 몇 장만 / 십 년 뒤에도 보고 싶은 사진을 골라요 | 지난번에 본 다음 사진부터 차례로 살펴봐요 |
| 2 | 기록 화면 (사진 + 메모) | 사진에 그날의 기억을 / 메모와 장소를 함께 남겨요 | 사진 한 장이 그날의 이야기가 돼요 |
| 3 | 기기 사진첩 | 다시 보고 싶어지는 / 나만의 작은 사진첩 | 여행·가족·계절의 이야기로 묶어 보세요 |
| 4 | 안전 사진첩 | 남긴 사진은 지키고 / 휴대폰은 가볍게 | 새 휴대폰에서도 그대로 다시 볼 수 있어요 |
| 5 | 정리 | 남기지 않은 사진은 / 한 번 더 보고 가볍게 | 정리할 사진을 한눈에 보고 천천히 골라요 |
| 6 | 설정 | 로그인 없이 시작해도 / 기억은 계속 쌓여요 | 원하면 로그인해 기록을 무료로 이어 볼 수 있어요 |

다음에 다시 캡처할 때: 공유 앨범(구성원 이름표가 보이는 앨범 화면)과 앨범 지도 화면을 넣는다. 공유 앨범이 핵심 기능인데 지금 스크린샷에는 없다. 데모 공유 앨범은 서버 데이터라 `storeCapture` 자동 구성에 없어서, 캡처 전에 시험 계정 두 개로 미리 만들어 둔다.

스크린샷용 데이터는 실제 개인 사진이 아닌, 직접 찍은 풍경·음식 사진이나 사용권이 있는 사진으로 만든다.

## 6. App Store 개인정보 보호 라벨 (App Privacy)

추적(Tracking): **함**. 안전 보관을 구독하지 않은 사용자에게 Google AdMob 광고를 보여 주고, 사용자가 앱 추적 투명성(ATT)을 허용하면 광고 식별자로 맞춤형 광고를 요청한다 (`mobile/src/lib/ads.ts`). ATT를 거부해도 앱은 모두 쓸 수 있고 비개인화 광고만 나온다.

수집하는 데이터 (Cloud 사용자만 해당. 모두 '사용자와 연결됨', 목적은 '앱 기능'):

| 유형 | 항목 | 메모 |
|---|---|---|
| 연락처 정보 | 이메일 주소 | 로그인 시 Apple·Google이 준 경우 |
| 사용자 콘텐츠 | 사진 또는 비디오, 기타 사용자 콘텐츠(메모) | Cloud 백업 |
| 위치 | 정확한 위치 | 사진 EXIF 좌표를 기록과 함께 백업. 기기 현재 위치는 읽지 않지만 라벨 정의상 해당한다 |
| 식별자 | 사용자 ID | 서버 계정 ID, RevenueCat app_user_id |
| 식별자 | 기기 ID | 재설치 후 사진 연결 복구용 기기 구분값(해시) |
| 구입 항목 | 구입 내역 | RevenueCat 구독 확인 |
| 진단 | 충돌 데이터, 기타 진단 데이터 | 앱은 계정을 지정하지 않지만, 네이티브 충돌 이벤트에 Sentry 설치 ID가 붙는다 (2026-11-02 확인). 제출 전 라벨 분류를 다시 판단한다 |

광고(Google AdMob SDK)가 수집하는 데이터 ('사용자와 연결되지 않음'. 목적은 '타사 광고'와 '분석'. 추적에 쓰임은 기기 ID만). 제출 직전 Google의 [AdMob App Store 데이터 공개 안내](https://developers.google.com/admob/ios/privacy/data-disclosure)와 다시 맞춘다:

| 유형 | 항목 | 메모 |
|---|---|---|
| 위치 | 대략적인 위치 | IP 주소로 추정 |
| 식별자 | 기기 ID | IDFA(ATT 허용 시), IDFV. **추적에 사용** |
| 사용 데이터 | 제품 상호작용, 광고 데이터 | 광고 노출·클릭 |
| 진단 | 충돌 데이터, 성능 데이터, 기타 진단 데이터 | SDK 자체 진단 |

Local만 쓰면 Keepsake 서버로 가는 데이터가 없지만(광고 데이터는 Google로 간다), 라벨은 앱 전체 기준이라 위 항목을 모두 적는다. 기기 운영체제의 주소 변환(Apple CLGeocoder)은 개발자가 받는 데이터가 아니므로 라벨에 넣지 않는다.

## 7. Google Play 데이터 보안 (Data safety)

| 질문 | 답 |
|---|---|
| 데이터를 수집하거나 공유하나요 | 수집함, 공유함 (광고: Google AdMob. 그 밖의 위탁 처리업체는 '공유'가 아님) |
| 광고 포함 (앱 콘텐츠 > 광고) | 예 |
| 광고 ID 사용 (앱 콘텐츠 > 광고 ID) | 예, 광고·분석 목적 |
| 전송 중 암호화 | 예 (HTTPS) |
| 데이터 삭제 요청 방법 | 앱 안에서 계정 삭제 가능 + 웹 삭제 요청 주소 {{필수: 앱을 지운 사람도 요청할 수 있는 웹페이지 또는 이메일 안내}} |
| 위치 - 정확한 위치 | 수집, 선택(Cloud 사용 시), 앱 기능 |
| 개인 정보 - 이메일 주소, 사용자 ID | 수집, 선택, 앱 기능·계정 관리 |
| 기기 또는 기타 ID | 수집, 선택(Cloud 사용 시), 앱 기능 |
| 사진 및 동영상 - 사진 | 수집, 선택, 앱 기능 |
| 앱 활동 - 기타 사용자 생성 콘텐츠(메모) | 수집, 선택, 앱 기능 |
| 금융 정보 - 구매 내역 | 수집, 선택, 앱 기능 |
| 앱 정보 및 성능 - 비정상 종료 로그, 기타 진단 데이터 | 수집, 필수(앱 안에서 끌 수 없음), 분석 |
| 위치 - 대략적인 위치 | 수집·공유(AdMob, IP 기반), 필수, 광고·분석·사기 방지 |
| 기기 또는 기타 ID (광고 ID) | 수집·공유(AdMob), 필수, 광고·분석·사기 방지 |
| 앱 활동 - 앱 상호작용 | 수집·공유(AdMob, 광고 노출·클릭), 필수, 광고·분석 |
| 앱 정보 및 성능 - 비정상 종료 로그, 진단 데이터 | 공유(AdMob SDK 진단), 필수, 분석 |

광고 항목은 구독하지 않은 사용자에게만 해당하지만 앱 안에서 끌 수 없으므로 '필수'로 적는다. 제출 직전 Google의 [AdMob Play 데이터 보안 안내](https://developers.google.com/admob/android/privacy/play-data-disclosure)와 다시 맞춘다.

Android의 OS Geocoder(Google)도 개발자가 받는 데이터가 아니므로 넣지 않는다.

## 8. 심사 메모 (App Review Information)

```
Keepsake works without an account. All core features (selecting photos and videos,
writing memos, albums, album map, cleanup) are available for free and store data only on the device.

Signing in with Apple or Google (free) backs up notes, places, and albums,
and lets people join shared albums by invite code.

Keepsake Secure Storage is an optional auto-renewing subscription that keeps
the photos and videos in secure albums and lets the subscriber create a
shared album. Invited members can view and add photos without subscribing.
Shared albums are invite-only. Members can report a photo (flag button in the
full-screen viewer) or a member (Manage album > Members), and block people,
which hides their photos for the blocker in every shared album.
Blocked people can be managed in Settings > Account > Blocked people.
Reports are reviewed by our team, who can remove the photo or the member.
Account deletion: Settings > Cloud > Delete account.

Demo account for Cloud: {{심사용 Apple 샌드박스 계정 또는 데모 로그인 방법}}
The app reads location coordinates already embedded in photos to suggest
a place name. It never requests the device's current location.
```
