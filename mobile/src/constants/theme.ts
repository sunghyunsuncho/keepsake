/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import { Platform } from 'react-native';

// 중립색(글자·선·회색 바탕)은 Vernissage와 같은 결로 맞춘다: 순검정 대신 네이비 기가 도는 짙은 회색, 차가운 연회색 선.
// 포인트 색(accent)만 Keepsake의 주황이다.
export const Colors = {
  light: {
    text: '#171A1E',
    background: '#ffffff',
    backgroundElement: '#F7F7F8',
    backgroundSelected: '#E9E9ED',
    textSecondary: '#5F6A75',
    /** text와 textSecondary 사이 (앱 정보의 앱 이름 등) */
    textMid: '#495259',
    border: '#E7E7EB',
    /** 목록의 '>' 화살표 */
    chevron: '#DEDEE3',
    accent: '#B5651D',
    onAccent: '#ffffff',
    danger: '#C2362B',
  },
  dark: {
    text: '#ECEDEE',
    background: '#000000',
    backgroundElement: '#1C1D20',
    backgroundSelected: '#2C2E33',
    textSecondary: '#9BA1A6',
    textMid: '#B0B4BA',
    border: '#2C2E33',
    chevron: '#4A4D53',
    accent: '#E39A55',
    onAccent: '#1B1208',
    danger: '#FF6B5E',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;
