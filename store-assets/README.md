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

시뮬레이터에 현재 소스를 포함한 Keepsake 개발 빌드와 각 화면에 쓸 데모 사진(파일명 `keepsake-demo-`로 시작, 4장 이상)이 있어야 한다. `capture`는 먼저 Development Client에 Metro 프로젝트 URL을 열고, 앱이 로드된 뒤 `keepsake://` 딥링크로 각 Expo Router 화면을 이동한다. 개발 빌드에서는 `storeCapture=1` 딥링크가 이 사진들로 데모 기록·앨범을 자동 구성하고 첫 사진은 상세 화면 캡처용 `moment/1`로 만든다. `previewLanguage`는 언어를 임시 전환하며 기기 설정은 저장하지 않는다. 이 자동 구성은 출시 빌드에서 실행하지 않으므로 Preview/production을 캡처할 때는 같은 데모 기록을 미리 준비해야 한다. 기본으로 18082(`npm start`)와 8081(`npx expo start`)을 순서대로 찾아 사용한다. Metro를 다른 주소나 포트에서 띄웠다면 `CAPTURE_DEV_SERVER_URL=http://192.168.0.10:8081 npm run capture`처럼 지정한다. Preview/production 빌드를 캡처할 때만 `CAPTURE_USE_APP_SCHEME=1`을 지정한다. 생성 전 `raw/` 원본의 저작권/개인정보를 확인하고, 생성된 `output/`은 릴리스 자산으로 커밋한다.

`npm run capture:ko`처럼 한 언어만 캡처할 수 있고, `CAPTURE_DELAY_MS=3000 npm run capture`로 화면 전환 대기를, `CAPTURE_STARTUP_DELAY_MS=20000`으로 첫 번들 로딩 대기를 늘릴 수 있다. App Store 업로드 전에는 `cd ../mobile && npm run metadata:lint && npm run metadata:push`를 실행한다.
