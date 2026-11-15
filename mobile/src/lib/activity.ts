import * as Application from 'expo-application';
import { Platform } from 'react-native';

import type { components } from '@/api/schema';
import { cloudApi, loadSession } from '@/lib/cloud/session';

// 로그인한 사용자의 활동 기록 (backend app/activity.py). 기기 안에서 끝나는 주요 액션과 앱 사용을 서버에 남긴다.
// Local 사용자(로그인하지 않음)는 보내지 않는다. 메모·장소·앨범 이름 같은 글은 보내지 않고 수와 종류만 보낸다.

type EventType = components['schemas']['EventRequest']['event_type'];
type Properties = Record<string, number | boolean | string | null>;

const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;

/** 기다리지 않고 보낸다. 실패해도 사용자 액션을 막지 않고 다시 보내지 않는다. */
export function trackEvent(eventType: EventType, properties?: Properties, entityRef?: string) {
  loadSession()
    .then((session) => {
      if (!session) return;
      return cloudApi.POST('/events', {
        body: {
          event_type: eventType,
          entity_ref: entityRef ?? null,
          properties: properties ?? null,
          platform,
          app_version: Application.nativeApplicationVersion,
        },
      });
    })
    .catch(() => {});
}
