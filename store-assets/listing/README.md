# 스토어 문구

Play Console에는 아래 언어별 파일을 붙여넣는다. App Store Connect의 동일한 정보와 스크린샷 경로는 `mobile/store.config.json`이 기준이며 `eas metadata:push`로 반영한다.

- `play-store.ko.md`, `play-store.en.md`, `play-store.ja.md`: Play 등록 정보
- `release-notes.*.md`: 버전별 변경 내용을 시작하는 템플릿

기능이나 가격을 바꾸면 이 문구, `mobile/store.config.json`, `store-assets/slides.ts`를 한 PR에서 함께 검토한다.
