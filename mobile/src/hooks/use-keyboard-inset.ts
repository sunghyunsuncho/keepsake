import { windowFrame } from '@modules/photo-meta';
import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

/**
 * 화면 아래가 창 아래와 맞닿은 화면에서, 키보드가 가리는 높이. 이만큼 아래를 비우면 입력란이 키보드 위로 올라온다.
 *
 * - Android 15 edge-to-edge: 시스템이 창을 줄여 주지 않는다 → 키보드 높이.
 * - iOS 전체 화면(iPhone 포함): ScrollView의 automaticallyAdjustKeyboardInsets가 맞추므로 0.
 * - iPadOS 창 모드·Stage Manager: 창이 화면 가운데 떠 있으면 RN이 화면 좌표(키보드)와 창 좌표(스크롤뷰)를
 *   그대로 비교해 여백을 만들지 못한다. 창의 화면 위치로 직접 계산한다.
 */
export function useKeyboardInset() {
  const android = useAndroidKeyboardHeight(true);
  const ios = useIOSWindowedKeyboardInset();
  return Platform.OS === 'android' ? android : ios;
}

function useIOSWindowedKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let latest = 0;
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      const call = ++latest;
      windowFrame()
        .then((frame) => {
          if (call !== latest || !frame) return;
          // RN은 창 좌표와 화면 좌표를 세로로만 비교하므로, 창 위쪽이 화면 위쪽과 같으면(전체 화면, Split View)
          // RN 계산이 맞다. 그때는 손대지 않는다 (두 번 비우면 키보드 위에 빈 틈이 생긴다).
          const alignedTop = Math.abs(frame.y) < 0.5;
          setInset(alignedTop ? 0 : Math.max(0, frame.y + frame.height - e.endCoordinates.screenY));
        })
        .catch(() => {});
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => {
      latest++;
      setInset(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return inset;
}

/**
 * Android에서 키보드가 가리는 높이. 시스템이 키보드만큼 창을 줄여 주지 않아(edge-to-edge, Modal)
 * KeyboardAvoidingView가 창 크기 변화를 받지 못하므로, 이만큼 아래를 띄운다. iOS는 늘 0.
 */
export function useAndroidKeyboardHeight(active: boolean) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android' || !active) return;
    // 보고되는 높이에 아래 내비게이션 영역이 빠지는 기기가 있어, 화면 아래에서 키보드 윗변까지를 함께 본다.
    const shown = Keyboard.addListener('keyboardDidShow', (e) =>
      setHeight(Math.max(e.endCoordinates.height, Dimensions.get('screen').height - e.endCoordinates.screenY)),
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
      setHeight(0);
    };
  }, [active]);
  return height;
}
