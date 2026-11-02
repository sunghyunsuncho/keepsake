import { Directory, Paths } from 'expo-file-system';

// 앱은 사진을 따로 보관하지 않는다 (docs/PLAN.md §0 '사진 보관'). 여기 있는 것은 모두 캐시라
// OS가 지워도 다시 만들거나 받을 수 있다.
//
//   <cache>/cloud-display/{moment_id}.jpg   Cloud에서 받은 표시용 사진 (기기 사진첩에 원본이 없을 때)
//   <cache>/upload/                          Cloud에 올리는 동안만 두는 임시 파일

export function cacheDir(name: string) {
  const dir = new Directory(Paths.cache, name);
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Cloud에서 받아 둔 표시용 사진을 지운다. 서버 데이터가 지워진 뒤 기기에 남기지 않기 위해서다. */
export function clearCloudDisplayCache() {
  const dir = new Directory(Paths.cache, 'cloud-display');
  if (dir.exists) dir.delete();
}

export function formatBytes(bytes: number) {
  if (bytes === 0) return '0KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
