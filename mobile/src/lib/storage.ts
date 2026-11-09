import { Directory, Paths } from 'expo-file-system';

// 앱은 사진을 따로 보관하지 않는다 (docs/PLAN.md §0 '사진 보관'). 여기 있는 것은 모두 캐시라
// OS가 지워도 다시 만들거나 받을 수 있다.
//
//   <cache>/cloud-display/{moment_id}.jpg   Cloud에서 받은 표시용 사진 (기기 사진첩에 원본이 없을 때)
//   <cache>/cloud-thumb/{moment_id}.jpg     Cloud에서 받은 썸네일 (목록·표지)
//   <cache>/shared-display/{item_id}.jpg     공유 앨범에서 다른 구성원이 올린 표시용 사진
//   <cache>/shared-thumb/{item_id}.jpg       공유 앨범 항목의 썸네일
//   <cache>/upload/                          Cloud에 올리는 동안만 두는 임시 파일

export function cacheDir(name: string) {
  const dir = new Directory(Paths.cache, name);
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Cloud에서 받아 둔 표시용 사진을 지운다. 서버 데이터가 지워진 뒤 기기에 남기지 않기 위해서다. */
export function clearCloudDisplayCache() {
  for (const name of ['cloud-display', 'cloud-thumb', 'shared-display', 'shared-thumb']) {
    const dir = new Directory(Paths.cache, name);
    if (dir.exists) dir.delete();
  }
}

/** 용량 단위로 정한 값(할당 등)은 "10GB"처럼 소수점 없이 보여 준다. */
export function formatSize(bytes: number) {
  const gb = bytes / 1024 / 1024 / 1024;
  return Number.isInteger(gb) && gb > 0 ? `${gb}GB` : formatBytes(bytes);
}

export function formatBytes(bytes: number) {
  if (bytes === 0) return '0KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
