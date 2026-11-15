import { useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { trackEvent } from '@/lib/activity';
import { useCloudSession } from '@/lib/cloud/session';

// 백그라운드에 이만큼 머물다 돌아와야 새 app_open으로 센다. 앱 스위처를 잠깐 스친 것은 같은 실행으로 본다.
const RESUME_THRESHOLD_MS = 5 * 60 * 1000;

// 이번 실행을 cold_start로 셌는지(또는 세지 않기로 했는지). 실행 중에 로그인하거나 로그아웃 뒤 다시 로그인해도
// 앱을 새로 켠 것으로 세지 않는다. 로그인은 서버가 signed_in으로 남긴다.
let launchHandled = false;

/** 로그인한 동안 앱 실행(app_open)과 화면 진입(screen_view)을 기록한다 (lib/activity.ts). */
export function ActivityTracker() {
  const session = useCloudSession();
  const sessionLoaded = session !== undefined;
  const signedIn = Boolean(session);
  // 라우트 모양만 보낸다 ("moment/[id]"). 그룹 이름 "(tabs)"는 뺀다. 첫 탭은 빈 값이라 "index"로 둔다.
  const segments = useSegments() as string[];
  const screen = segments.filter((segment) => !segment.startsWith('(')).join('/') || 'index';

  useEffect(() => {
    if (!sessionLoaded) return;
    if (!signedIn) {
      launchHandled = true;
      return;
    }
    // 알림 처리 등으로 백그라운드에서 켜진 실행은 화면에 나올 때 센다.
    const countLaunch = () => {
      if (launchHandled) return;
      launchHandled = true;
      trackEvent('app_open', { trigger: 'cold_start' });
    };
    if (AppState.currentState === 'active') countLaunch();
    let backgroundedAt: number | null = null;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (!launchHandled) {
          countLaunch();
        } else if (backgroundedAt !== null && Date.now() - backgroundedAt >= RESUME_THRESHOLD_MS) {
          trackEvent('app_open', { trigger: 'resume' });
        }
        backgroundedAt = null;
      } else if (backgroundedAt === null) {
        backgroundedAt = Date.now();
      }
    });
    return () => subscription.remove();
  }, [sessionLoaded, signedIn]);

  const lastScreen = useRef<string | null>(null);
  useEffect(() => {
    if (!signedIn) {
      lastScreen.current = null;
      return;
    }
    if (screen === lastScreen.current) return;
    lastScreen.current = screen;
    trackEvent('screen_view', undefined, `screen:${screen}`);
  }, [signedIn, screen]);

  return null;
}
