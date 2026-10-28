import { Directory, File, Paths } from 'expo-file-system';

// 앱이 보관하는 사진 파일 위치.
//
//   <document>/library/photos/{moment_id}/original.{ext}
//   <document>/library/photos/{moment_id}/display.jpg
//
// iOS는 앱을 업데이트하면 컨테이너 절대 경로가 바뀔 수 있으므로 DB에는 library 기준
// 상대 경로("photos/{id}/display.jpg")만 저장하고, 쓸 때 resolveLibraryFile()로 푼다.
// ZIP 내보내기는 library 폴더를 그대로 압축하므로 ZIP 안의 경로도 이 상대 경로와 같다.
export const libraryDir = new Directory(Paths.document, 'library');

export function photoDirPath(momentId: string) {
  return `photos/${momentId}`;
}

export function photoDir(momentId: string) {
  return new Directory(libraryDir, photoDirPath(momentId));
}

export function resolveLibraryFile(relativePath: string) {
  return new File(libraryDir, relativePath);
}

export function libraryUri(relativePath: string | null | undefined) {
  return relativePath ? resolveLibraryFile(relativePath).uri : undefined;
}

export function ensureDir(dir: Directory) {
  dir.create({ intermediates: true, idempotent: true });
}

export function deletePhotoDir(momentId: string) {
  const dir = photoDir(momentId);
  if (dir.exists) dir.delete();
}

/** 임시 작업 폴더. 내보내기·가져오기 중간 파일을 둔다. */
export function freshCacheDir(name: string) {
  const dir = new Directory(Paths.cache, name);
  if (dir.exists) dir.delete();
  ensureDir(dir);
  return dir;
}

/** react-native-zip-archive는 `file://` 없는, 디코딩된 경로를 받는다. */
export function toNativePath(uri: string) {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

export function formatBytes(bytes: number) {
  if (bytes === 0) return '0KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
