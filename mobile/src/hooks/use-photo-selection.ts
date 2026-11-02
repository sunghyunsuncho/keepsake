import type { Asset } from 'expo-media-library';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { Alert } from 'react-native';

import { captureAsset, CaptureError, removeMoment } from '@/lib/capture';
import { toDateKey } from '@/lib/dates';

export type SavedItem = { assetId: string; momentId: string; uri: string };

/**
 * 사진을 누르면 '고른 상태'만 표시한다(파일 복사 없음). 완료해야 기록을 만든다.
 * 이미 남긴 사진(saved에 있는 사진)을 누르면 확인한 뒤 기록에서 뺀다.
 */
export function usePhotoSelection(db: SQLiteDatabase, saved: Map<string, string>) {
  // 아직 완료하지 않은 선택. 고른 순서를 유지한다.
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  // saving 상태가 화면에 반영되기 전에 [남기기]를 한 번 더 누르면 같은 사진을 두 번 남길 수 있다.
  const inFlight = useRef(false);

  const toggle = (asset: Asset) => {
    // 목록의 칸은 이전 렌더의 함수를 들고 있을 수 있어 saving 상태 대신 ref로 확인한다.
    if (inFlight.current) return;
    const momentId = saved.get(asset.id);
    if (momentId) {
      Alert.alert(
        '기록에서 뺄까요?',
        '모든 앨범에서 사라지고, 남긴 메모와 장소도 지워져요. 기기 사진첩의 사진은 그대로예요.',
        [
          { text: '취소', style: 'cancel' },
          {
            text: '빼기',
            style: 'destructive',
            onPress: () => removeMoment(db, momentId, dayKeyOf(asset)),
          },
        ],
      );
      return;
    }
    setDraft((prev) =>
      prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id],
    );
  };

  /** 고른 사진을 남긴다. 실패한 사진은 선택 상태로 남겨 다시 시도할 수 있게 한다. */
  const complete = async (assets: Asset[]): Promise<SavedItem[]> => {
    if (inFlight.current) return [];
    const targets = draft
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is Asset => !!a);
    // 보관함에서 지워진 사진 등 목록에 없는 선택만 남았다면 비운다 (아래 막대가 계속 떠 있지 않도록).
    if (targets.length === 0) {
      setDraft([]);
      return [];
    }

    inFlight.current = true;
    setSaving({ done: 0, total: targets.length });
    const savedItems: SavedItem[] = [];
    const failed: string[] = [];
    let lastError: unknown;
    try {
      for (const [index, asset] of targets.entries()) {
        try {
          const momentId = await captureAsset(db, asset, dayKeyOf(asset));
          savedItems.push({ assetId: asset.id, momentId, uri: asset.uri });
        } catch (e) {
          failed.push(asset.id);
          lastError = e;
        }
        setSaving({ done: index + 1, total: targets.length });
      }
    } finally {
      inFlight.current = false;
      setSaving(null);
    }
    setDraft(failed);

    if (failed.length > 0) {
      Alert.alert(
        `${failed.length}장을 남기지 못했어요`,
        lastError instanceof CaptureError ? lastError.message : '잠시 후 다시 시도해 주세요.',
      );
    }
    return savedItems;
  };

  return { draft, saving, toggle, complete, clear: () => setDraft([]) };
}

/** 사진을 찍은 날(기기 시간대). 그날의 선택 기록(review_sessions)에 쓴다. */
export function dayKeyOf(asset: Asset) {
  return toDateKey(new Date(asset.creationTime || Date.now()));
}
