import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { appleSignInAvailable, googleSignInAvailable } from '@/lib/cloud/sign-in';
import { useTranslation } from '@/lib/i18n';
import { openLegalDocument } from '@/lib/legal';

type Provider = 'google' | 'apple';

// 버튼 모양은 Vernissage 로그인 화면과 같다: 로고 + 글자(16, semibold), 위아래 16, 모서리 12.
// 네이티브 AppleAuthenticationButton은 글자 크기가 버튼 높이에 따라 커져 Google 버튼과 맞지 않아,
// HIG가 허용하는 로고 + "Apple로 로그인" 모양으로 직접 그린다. 다크 모드에서는 흰 바탕에 검은 로고다.

/** Apple·Google 로그인 버튼. reason이 있으면 '로그인' 제목과 함께 왜 로그인하는지 먼저 알린다 (안전 보관 화면). */
export function SignInButtons({
  busy,
  reason,
  onApple,
  onGoogle,
  onCancel,
}: {
  busy: boolean;
  reason?: string;
  onApple: () => void;
  onGoogle: () => void;
  onCancel?: () => void;
}) {
  const [apple, setApple] = useState(false);
  // 누른 버튼에만 진행 표시를 한다.
  const [pressed, setPressed] = useState<Provider | null>(null);
  useEffect(() => {
    appleSignInAvailable().then(setApple);
  }, []);
  useEffect(() => {
    if (!busy) setPressed(null);
  }, [busy]);

  const press = (provider: Provider, action: () => void) => () => {
    if (busy) return;
    setPressed(provider);
    action();
  };

  return (
    <View style={styles.section}>
      {reason && (
        <>
          <ThemedText type="smallBold">로그인</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {reason}
          </ThemedText>
        </>
      )}
      <View style={styles.buttons}>
        {googleSignInAvailable && (
          <ProviderButton
            provider="google"
            label="Google 로그인"
            busy={busy}
            loading={busy && pressed === 'google'}
            onPress={press('google', onGoogle)}
          />
        )}
        {apple && (
          <ProviderButton
            provider="apple"
            label="Apple로 로그인"
            busy={busy}
            loading={busy && pressed === 'apple'}
            onPress={press('apple', onApple)}
          />
        )}
      </View>
      {!apple && !googleSignInAvailable ? (
        <ThemedText type="small" themeColor="textSecondary">
          이 빌드에서는 로그인을 사용할 수 없어요.
        </ThemedText>
      ) : (
        <LegalNotice />
      )}
      {onCancel && <Button label="돌아가기" variant="secondary" disabled={busy} onPress={onCancel} />}
    </View>
  );
}

function ProviderButton({
  provider,
  label,
  busy,
  loading,
  onPress,
}: {
  provider: Provider;
  label: string;
  busy: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const colors =
    provider === 'google'
      ? { background: dark ? theme.backgroundElement : '#FFFFFF', text: theme.text, border: theme.border }
      : { background: dark ? '#FFFFFF' : '#000000', text: dark ? '#000000' : '#FFFFFF', border: 'transparent' };

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.background, borderColor: colors.border },
        busy && !loading && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <>
          <View style={styles.logo}>
            <ProviderLogo provider={provider} color={colors.text} />
          </View>
          <ThemedText style={[styles.label, { color: colors.text }]}>{label}</ThemedText>
        </>
      )}
    </Pressable>
  );
}

/** 로그인하면 약관에 동의한 것으로 본다는 안내. 문서 이름을 누르면 홈페이지의 최신 문서를 연다. */
function LegalNotice() {
  const theme = useTheme();
  const { language } = useTranslation();
  const link = (doc: 'terms' | 'privacy', label: string) => (
    <ThemedText
      type="small"
      onPress={() => openLegalDocument(doc)}
      accessibilityRole="link"
      style={[styles.legalLink, { color: theme.textSecondary }]}>
      {label}
    </ThemedText>
  );
  const terms = { ko: '이용약관', en: 'Terms of Service', ja: '利用規約' }[language];
  const privacy = { ko: '개인정보 처리방침', en: 'Privacy Policy', ja: 'プライバシーポリシー' }[language];
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.legal}>
      {language === 'en' ? (
        <>By continuing, you agree to the {link('terms', terms)} and {link('privacy', privacy)}.</>
      ) : language === 'ja' ? (
        <>続行すると、{link('terms', terms)}と{link('privacy', privacy)}に同意したものとみなされます。</>
      ) : (
        <>계속하면 {link('terms', terms)}과 {link('privacy', privacy)}에 동의하게 돼요.</>
      )}
    </ThemedText>
  );
}

/** Google은 원색 G, Apple은 버튼 글자색과 같은 로고. Vernissage ProviderLogo와 같은 그림이다. */
function ProviderLogo({ provider, color }: { provider: Provider; color: string }) {
  if (provider === 'google') {
    return (
      <Svg width={18} height={18} viewBox="0 0 18 18">
        <Path fill="#EA4335" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.259h2.909c1.702-1.567 2.684-3.875 2.684-6.616Z" />
        <Path fill="#4285F4" d="M9 18c2.43 0 4.467-.805 5.956-2.179l-2.909-2.259c-.805.54-1.835.859-3.047.859-2.345 0-4.329-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
        <Path fill="#FBBC05" d="M3.963 10.707A5.41 5.41 0 0 1 3.681 9c0-.592.102-1.167.282-1.707V4.961H.956A9 9 0 0 0 0 9c0 1.452.348 2.826.956 4.039l2.332-2.332Z" />
        <Path fill="#34A853" d="M9 3.58c1.321 0 2.507.454 3.441 1.345l2.582-2.582C13.463.891 11.426 0 9 0a9 9 0 0 0-8.044 4.961l3.007 2.332C4.671 5.164 6.655 3.58 9 3.58Z" />
      </Svg>
    );
  }
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  buttons: { gap: Spacing.two },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    paddingVertical: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  logo: { width: 20, alignItems: 'center' },
  label: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
  legal: { textAlign: 'center' },
  legalLink: { textDecorationLine: 'underline' },
});
