import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localizeText, useTranslation } from '@/lib/i18n';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
  /** 앨범명·사람 이름·메모처럼 사용자가 입력한 값은 절대 번역하지 않는다. */
  localize?: boolean;
};

export function ThemedText({ style, type = 'default', themeColor, children, localize = true, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const { language } = useTranslation();
  // 기존 JSX 본문은 이 공통 지점에서 번역한다. 동적 React 노드는 원래대로 둔다.
  const localizedChildren = localize ? localizeChildren(children, language) : children;

  return <Text style={[{ color: theme[themeColor ?? 'text'] }, styles[type], style]} {...rest}>{localizedChildren}</Text>;
}

function localizeChildren(children: ReactNode, language: 'ko' | 'en' | 'ja'): ReactNode {
  if (typeof children === 'string') return localizeText(language, children);
  if (Array.isArray(children)) return children.map((child) => localizeChildren(child, language));
  return children;
}

// 굵기는 Vernissage와 같은 결: 본문 보통(400), 강조 600. 제목·숫자처럼 더 굵어야 하는 곳은 각 화면에서 정한다.
const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 400,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 600,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 400,
  },
  title: {
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#3c87f7',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
