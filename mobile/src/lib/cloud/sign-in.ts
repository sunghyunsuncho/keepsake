import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { CloudError, cloudApi, saveSession, unwrap } from '@/lib/cloud/session';

// Apple·Google ID 토큰을 서버에 보내 Keepsake 세션을 받는다. 토큰 검증은 서버가 한다.
// Google을 넣으면 iOS는 Apple 로그인을 함께 제공해야 한다 (App Store 심사 지침 4.8).

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export const googleSignInAvailable = Boolean(
  GOOGLE_WEB_CLIENT_ID && (Platform.OS !== 'ios' || GOOGLE_IOS_CLIENT_ID),
);

export async function appleSignInAvailable() {
  return Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync());
}

export class SignInCancelled extends Error {}

/** 로그인 실패를 사용자에게 보여줄 문장으로 바꾼다. 서버가 꺼져 있는 것과 Google 설정 문제를 구분해 알린다. */
export function describeSignInError(e: unknown) {
  if (e instanceof CloudError) {
    if (e.status === 401) return '로그인 정보를 확인하지 못했어요. 다시 시도해 주세요.';
    return '서버가 로그인을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  if (isErrorWithCode(e)) {
    if (e.code === statusCodes.IN_PROGRESS) return '이미 로그인하는 중이에요.';
    if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return 'Google Play 서비스를 사용할 수 없어요.';
    return `Google 로그인에 실패했어요 (${e.code}).`;
  }
  // fetch가 서버에 닿지 못하면 TypeError('Network request failed')를 던진다.
  if (e instanceof TypeError) return '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
  return '잠시 후 다시 시도해 주세요.';
}

export async function signInWithApple() {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new SignInCancelled();
    throw e;
  }
  if (!credential.identityToken) throw new Error('Apple 로그인 정보를 받지 못했어요');
  return exchange('apple', credential.identityToken, credential.email);
}

export async function signInWithGoogle() {
  // ID 토큰의 aud가 웹 클라이언트 ID가 되도록 webClientId를 준다 (서버의 GOOGLE_CLIENT_ID와 맞춘다).
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID });
  await GoogleSignin.hasPlayServices();
  let response;
  try {
    response = await GoogleSignin.signIn();
  } catch (e) {
    if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) throw new SignInCancelled();
    throw e;
  }
  if (!isSuccessResponse(response)) throw new SignInCancelled();
  if (!response.data.idToken) throw new Error('Google 로그인 정보를 받지 못했어요');
  return exchange('google', response.data.idToken, response.data.user.email);
}

async function exchange(provider: 'apple' | 'google', identityToken: string, email: string | null) {
  const session = unwrap(
    await cloudApi.POST('/auth/sign-in', {
      body: { provider, identity_token: identityToken, email },
    }),
  );
  await saveSession({ accessToken: session.access_token, userId: session.user_id });
  return session.user_id;
}

export async function signOutProviders() {
  if (googleSignInAvailable) {
    try {
      await GoogleSignin.signOut();
    } catch {
      // Google로 로그인하지 않았으면 할 일이 없다.
    }
  }
}
