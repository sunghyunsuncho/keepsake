import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

// 쓰기 함수가 notifyChange()를 부르면 useDbQuery로 읽는 화면이 다시 읽는다.
// 데이터가 작고 화면이 몇 개뿐이라 테이블별로 나누지 않는다.
type Listener = () => void;
const listeners = new Set<Listener>();

export function notifyChange() {
  listeners.forEach((listener) => listener());
}

export function subscribeChanges(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 화면에 들어올 때와, 화면이 보이는 동안 데이터가 바뀔 때 `load`를 다시 실행한다.
 * 뒤에 가려진 화면(다른 탭, 아래 스택)은 바뀐 것만 기억했다가 다시 보일 때 읽는다.
 * 메모를 입력하는 동안 사진첩·설정 화면까지 매번 다시 읽지 않기 위해서다.
 */
export function useDbQuery<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  // 늦게 도착한 이전 요청이 최신 결과를 덮어쓰지 않도록 요청 번호를 비교한다.
  const requestId = useRef(0);
  const reload = useCallback(() => {
    const id = ++requestId.current;
    loadRef
      .current()
      .then((result) => {
        if (id === requestId.current) {
          setData(result);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (id === requestId.current) setError(e instanceof Error ? e : new Error(String(e)));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      reload();
      return () => {
        focused.current = false;
      };
    }, [reload]),
  );
  // 가려진 동안의 변경은 다시 보일 때(위의 focus effect) 반영된다.
  useEffect(() => subscribeChanges(() => focused.current && reload()), [reload]);

  return { data, error, reload };
}
