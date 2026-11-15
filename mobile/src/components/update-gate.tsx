import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Colors } from '@/constants/theme';
import { deviceLanguage } from '@/db/settings';
import { localizeText } from '@/lib/i18n';

// 앱을 새로 켤 때 네이티브 expo-updates가 새 OTA 업데이트를 확인·내려받는 동안 앱 대신 이 화면을 띄우고,
// 다 받으면 바로 다시 시작해 첫 실행부터 새 버전으로 들어간다 (Vernissage의 UpdateGate와 같은 방식).
// checkForUpdateAsync를 직접 부르지 않는다: app.json의 checkAutomatically=ON_LOAD로 네이티브가 이미 확인하고 있고,
// JS 호출은 그 절차가 끝날 때까지 기다리기만 한다. 그래서 네이티브 상태(useUpdates)를 지켜본다.
// 앱 트리를 그리지 않으므로, 곧 버릴 번들로 로그인·동기화를 시작하지 않는다.

// 확인이 이보다 늦으면(느린 망) 기다리지 않고 들어간다. 받던 업데이트는 다음 실행에 적용된다.
const CHECK_TIMEOUT_MS = 4000;
const DOWNLOAD_TIMEOUT_MS = 20000;
// 업데이트가 없어 금방 지나갈 때 문구가 깜빡이지 않게 늦게 보인다.
const CONTENT_FADE_DELAY_MS = 500;

// 네이티브 스플래시와 같은 바탕·이미지 크기 (app.json expo-splash-screen)
const SPLASH_BACKGROUND = '#F4F1EC';
const SPLASH_IMAGE_WIDTH = 160;
const SPLASH_IMAGE_HEIGHT = Math.round((SPLASH_IMAGE_WIDTH * 1024) / 885);

/** 개발·업데이트 꺼짐·비상 실행(받은 업데이트가 실패해 내장 번들로 돌아옴)에서는 게이트 없이 들어간다. */
export function shouldShowUpdateGate() {
  return !__DEV__ && Updates.isEnabled && !Updates.isEmergencyLaunch;
}

type Step = 'checking' | 'downloading' | 'applying';

export function UpdateGate({ onDone }: { onDone: () => void }) {
  const {
    isStartupProcedureRunning,
    isChecking,
    isDownloading,
    isUpdateAvailable,
    isUpdatePending,
    checkError,
    downloadError,
    downloadProgress,
    restartCount,
    lastCheckForUpdateTimeSinceRestart,
  } = Updates.useUpdates();
  const [step, setStep] = useState<Step>('checking');
  const [downloadStartedAt, setDownloadStartedAt] = useState<number | null>(null);
  // 들어가기와 다시 시작은 한 번만 한다 (상태가 연달아 바뀌거나 제한 시간과 겹쳐도).
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDoneRef.current();
  }, []);

  useEffect(() => {
    if (finished.current) return;
    if (isUpdatePending) {
      // 이미 한 번 다시 시작한 실행에서는 또 시작하지 않는다 (재시작이 반복되지 않게).
      if (restartCount > 0) return finish();
      setStep('applying');
      finished.current = true;
      Updates.reloadAsync({
        reloadScreenOptions: { backgroundColor: SPLASH_BACKGROUND, spinner: { enabled: false }, fade: true },
      }).catch(() => onDoneRef.current());
      return;
    }
    if (checkError || downloadError) return finish();
    if (isDownloading) {
      setDownloadStartedAt((startedAt) => startedAt ?? Date.now());
      setStep('downloading');
      return;
    }
    // 시작 절차가 끝났거나(다시 시작한 직후 포함) 확인 결과 새 버전이 없으면 바로 들어간다.
    if (!isStartupProcedureRunning) return finish();
    if (!isChecking && lastCheckForUpdateTimeSinceRestart && !isUpdateAvailable) finish();
  }, [
    isStartupProcedureRunning,
    isChecking,
    isDownloading,
    isUpdateAvailable,
    isUpdatePending,
    checkError,
    downloadError,
    restartCount,
    lastCheckForUpdateTimeSinceRestart,
    finish,
  ]);

  // 단계마다 제한 시간. 내려받기는 네이티브가 뒤에서 이어 받아 다음 실행에 적용한다.
  useEffect(() => {
    if (step === 'applying') return;
    const timer = setTimeout(finish, step === 'checking' ? CHECK_TIMEOUT_MS : DOWNLOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [step, finish]);

  return <UpdateGateView step={step} downloadProgress={downloadProgress} downloadStartedAt={downloadStartedAt} />;
}

function UpdateGateView({
  step,
  downloadProgress,
  downloadStartedAt,
}: {
  step: Step;
  downloadProgress?: number;
  downloadStartedAt: number | null;
}) {
  // 시작 절차의 내려받기는 진행률을 보내지 않을 때가 많다. 실제 값이 오면 쓰고, 없으면 단계 구간 안에서
  // 시간에 따라 천천히 차오르게 한다 (끝에 닿지 않는다). 확인 0~18% → 내려받기 20~95% → 적용 100%.
  // 막대와 숫자가 뒤로 가지 않게 지금까지의 최댓값을 보여 준다.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const stepStartedAt = Date.now();
    const advance = () => {
      let target: number;
      if (step === 'applying') {
        target = 1;
      } else if (step === 'downloading') {
        const seconds = (Date.now() - (downloadStartedAt ?? stepStartedAt)) / 1000;
        target = downloadProgress ? 0.2 + 0.75 * downloadProgress : 0.2 + 0.7 * (1 - Math.exp(-seconds / 4));
      } else {
        const seconds = (Date.now() - stepStartedAt) / 1000;
        target = 0.18 * (1 - Math.exp(-seconds / 1.2));
      }
      setShown((previous) => Math.max(previous, target));
    };
    advance();
    if (step === 'applying') return;
    const interval = setInterval(advance, 200);
    return () => clearInterval(interval);
  }, [step, downloadProgress, downloadStartedAt]);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(shown, {
      duration: step === 'applying' ? 250 : 400,
      easing: Easing.out(Easing.quad),
    });
  }, [shown, step, progress]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` as const }));

  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withDelay(CONTENT_FADE_DELAY_MS, withTiming(1, { duration: 250 }));
  }, [opacity]);
  const contentStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // 저장된 앱 언어는 기록 DB를 열어야 알 수 있어 기기 언어로 보여 준다.
  const message = localizeText(deviceLanguage(), '새 버전을 준비하고 있어요');
  return (
    <View style={styles.container}>
      {/* 이미지는 네이티브 스플래시와 같은 자리에 두고, 문구는 그 아래에 띄워 화면이 이어져 보이게 한다. */}
      <Image source={require('../../assets/images/splash-icon.png')} style={styles.image} resizeMode="contain" />
      <Animated.View style={[styles.content, contentStyle]}>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, fillStyle]} />
        </View>
        <Text style={styles.percent}>{Math.round(shown * 100)}%</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SPLASH_BACKGROUND,
  },
  image: { width: SPLASH_IMAGE_WIDTH, height: SPLASH_IMAGE_HEIGHT },
  content: {
    position: 'absolute',
    top: '50%',
    marginTop: SPLASH_IMAGE_HEIGHT / 2 + 32,
    width: '100%',
    maxWidth: 240,
    alignItems: 'center',
  },
  message: { fontSize: 14, color: Colors.light.textSecondary, marginBottom: 12 },
  track: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.light.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 2, backgroundColor: Colors.light.accent },
  percent: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '500',
    color: Colors.light.textSecondary,
    fontVariant: ['tabular-nums'],
  },
});
