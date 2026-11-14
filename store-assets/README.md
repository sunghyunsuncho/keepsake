# Keepsake store assets

실제 iOS 시뮬레이터 화면을 캡처해 Google Play와 App Store 규격의 마케팅 스크린샷으로 합성한다. 슬라이드 구성과 문구의 단일 기준은 `slides.ts`, Apple 등록 정보의 기준은 `mobile/store.config.json`, Play 원문은 `listing/`이다.

```bash
cd mobile && npm start             # 다른 터미널에서 Metro를 18082 포트로 실행
cd store-assets
npm install
npx playwright install chromium # 최초 1회
npm run capture                 # ko/en/ja 실제 앱 화면 캡처
npm run generate:all            # Play + App Store PNG 생성
```

시뮬레이터에 현재 소스를 포함한 Keepsake 개발 빌드와 데모 사진이 있어야 한다. 데모 사진·기록·앨범 구성은 `mobile/src/components/store-demo-photos.json` 한 곳에 있다 (앨범 이름·메모·장소는 세 언어 공용으로 영어). 저장소 루트에서 `make demo-photos SOURCE=~/Desktop`을 실행하면 목록의 원본(`SOURCE` 아래 `source` 경로)에 촬영 시각·GPS를 넣어 부팅된 시뮬레이터 사진첩에 추가한다. 화면에 다른 사진이 섞이지 않게 사진첩이 빈 시뮬레이터에서 하고, 안전 사진첩·공유 앨범까지 채우려면 안전 보관을 쓸 수 있는 계정으로 로그인해 둔다. 그다음 앱을 연 상태에서 `xcrun simctl openurl booted 'keepsake:///?storeCapture=1&storeReset=1'`을 한 번 보내면 지금 공간의 기록·앨범·내가 만든 공유 앨범을 지우고 데모(기기 앨범, 연결한 안전 앨범, 공유 앨범, 오늘 고를 사진, 정리 후보, 1년 전 오늘)를 새로 만든다. 공유 앨범의 다른 가족 구성원(Mom·Dad·Grandma)과 그들이 담은 사진은 이어서 저장소 루트에서 `make demo-family SOURCE=~/Desktop`으로 넣는다 (로컬 API 서버 필요, 목록은 같은 JSON의 `sharedAlbums[].members`). 같은 단계에서 담은 사람이 구성원에게 쓴 글(`sharedAlbums[].captions`)과 구성원끼리 남긴 댓글(`comments`)도 넣는다 (세 언어 공용으로 영어). 이야기 카드에 글과 최근 댓글 한 줄이 보인다. 사진은 그대로 두고 글과 댓글만 다시 넣으려면 `cd backend && uv run --with pillow python -m scripts.store_demo_family --text-only`. 데모를 `storeReset=1`로 다시 만들면 공유 앨범도 새로 생기므로 이 단계도 다시 실행한다. 공유 앨범 슬라이드 경로의 `{shared:Our Family}`는 로컬 Postgres(docker compose)에서 앨범 ID를 찾는다. `capture`는 먼저 Development Client에 Metro 프로젝트 URL을 열고, 앱이 로드된 뒤 `keepsake://` 딥링크로 각 Expo Router 화면을 이동한다. 개발 빌드에서는 `storeCapture=1` 딥링크가 아직 구성하지 않았으면 같은 데모를 만들고, 앨범 화면을 이야기 보기로 맞춘다. 상세 화면 캡처용 기록은 `moment/1`이고, 앨범 이야기·지도 슬라이드의 경로에 쓴 `{album:Europe Trip}`은 캡처할 때 시뮬레이터 DB에서 그 이름의 앨범 ID로 바뀐다. `previewLanguage`는 앱 언어를 임시 전환하며 기기 설정은 저장하지 않는다. 지도 지명은 시스템 언어를 따르므로 `capture`가 언어마다 시뮬레이터 언어(AppleLanguages)를 바꿔 앱을 다시 켜고, 끝나면 원래 값으로 되돌린다. 슬라이드는 Google Play 상한에 맞춰 8장 이하로 둔다. 이 자동 구성은 출시 빌드에서 실행하지 않으므로 Preview/production을 캡처할 때는 같은 데모 기록을 미리 준비해야 한다. 기본으로 18082(`npm start`)와 8081(`npx expo start`)을 순서대로 찾아 사용한다. Metro를 다른 주소나 포트에서 띄웠다면 `CAPTURE_DEV_SERVER_URL=http://192.168.0.10:8081 npm run capture`처럼 지정한다. Preview/production 빌드를 캡처할 때만 `CAPTURE_USE_APP_SCHEME=1`을 지정한다. 생성 전 `raw/` 원본의 저작권/개인정보를 확인하고, 생성된 `output/`은 릴리스 자산으로 커밋한다.

Play 그래픽 이미지(1024x500)는 `npm run feature-graphic`으로 ko/en/ja를 한 번에 만든다(캡처 원본 불필요, `npm run generate`에도 포함). 옆 폴더 atelierlabs 저장소의 `sites/keepsake/` 언어별 홈페이지 히어로에서 첫 배경 사진·아이콘·현지어 이름·슬로건·설명을 읽어 그리므로, 홈페이지 히어로를 바꾼 뒤 다시 실행하면 된다. 저장소 위치가 다르면 `ATELIERLABS_DIR=...`로 지정한다. 결과는 `output/feature-graphic.png`(ko), `feature-graphic.en-US.png`, `feature-graphic.ja.png`.

`npm run capture:ko`처럼 한 언어만 캡처할 수 있고, `CAPTURE_DELAY_MS=3000 npm run capture`로 화면 전환 대기를, `CAPTURE_STARTUP_DELAY_MS=20000`으로 첫 번들 로딩 대기를 늘릴 수 있다. App Store 업로드 전에는 `cd ../mobile && npm run metadata:lint && npm run metadata:push`를 실행한다.
