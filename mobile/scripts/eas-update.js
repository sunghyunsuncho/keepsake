#!/usr/bin/env node
// OTA 업데이트(EAS Update)를 보낸다: npm run update:prod -- "고친 내용" (README의 'OTA 업데이트')
//
// - EAS 환경 변수(EXPO_PUBLIC_API_URL 등)는 --environment로 받는다.
// - EXPO_PUBLIC_APP_ENV는 eas.json 빌드 프로필의 env에만 있어 eas update가 읽지 않는다. 빠지면 운영 앱이
//   테스트 광고를 띄우고(lib/ads.ts) Sentry 환경이 development가 되므로 여기서 빌드와 같은 값을 넣는다.
// - --clear-cache: Metro 캐시에 남은 옛 환경 변수 값이 번들에 들어가지 않게 한다.
// - SENTRY_AUTH_TOKEN이 있으면 업데이트 번들의 소스맵을 Sentry에 올린다.

const { execFileSync, spawnSync } = require('child_process');

const APP_ENV = { production: 'production', preview: 'staging' };

const channel = process.argv[2];
const message = process.argv.slice(3).join(' ').trim();
if (!APP_ENV[channel]) {
  console.error(`채널은 ${Object.keys(APP_ENV).join(' | ')} 중 하나예요.`);
  process.exit(1);
}
if (!message) {
  console.error(`무엇을 고쳤는지 적어 주세요: npm run update:${channel === 'production' ? 'prod' : channel} -- "고친 내용"`);
  process.exit(1);
}

const dirty = execFileSync('git', ['status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim();
if (dirty) console.warn('주의: 커밋하지 않은 변경이 업데이트에 함께 들어가요.\n' + dirty + '\n');

const env = { ...process.env, EXPO_PUBLIC_APP_ENV: APP_ENV[channel] };
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npx', [
  'eas-cli@latest',
  'update',
  '--channel',
  channel,
  '--environment',
  channel,
  '--message',
  message,
  '--clear-cache',
]);

if (process.env.SENTRY_AUTH_TOKEN) {
  run('npx', ['sentry-expo-upload-sourcemaps', 'dist']);
} else {
  console.warn('SENTRY_AUTH_TOKEN이 없어 소스맵을 올리지 않았어요. 이 업데이트의 오류는 압축된 코드 위치로 보여요.');
}
