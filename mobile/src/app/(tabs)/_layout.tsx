import { Tabs } from 'expo-router';
import { BookOpenIcon, CloudIcon, GearSixIcon, ImagesIcon } from 'phosphor-react-native';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationBell } from '@/components/notification-bell';
import { TAB_TITLE_STYLE } from '@/components/tab-title';
import { useTheme } from '@/hooks/use-theme';

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 56 : 64;
const TAB_ICON_SIZE = 24;

export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Android는 안전 영역 값이 첫 화면에서 늦게 올 수 있어 제스처 영역을 넘도록 최소 24를 둔다.
  const bottomPad = Platform.OS === 'ios' ? Math.max(insets.bottom, 10) : Math.max(insets.bottom + 10, 24);
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        // Vernissage와 같은 탭바: 높이 56(iOS) / 64(Android) + 아래 여백, 아이콘 24, 탭 이름 10.
        tabBarStyle: {
          height: TAB_BAR_HEIGHT + bottomPad,
          paddingTop: 10,
          paddingBottom: bottomPad,
          backgroundColor: theme.background,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
          shadowColor: theme.text,
          shadowOffset: { width: 0, height: -1 },
          shadowOpacity: 0.04,
          shadowRadius: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '500', letterSpacing: 0.3, marginTop: 1 },
        headerTitleAlign: 'left',
        headerTitleStyle: { ...TAB_TITLE_STYLE, color: theme.text },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.background },
        // 모든 탭 오른쪽 위에 알림 내역 버튼을 둔다 (고르기 탭은 머리글을 직접 그린다).
        headerRight: () => <NotificationBell />,
        headerRightContainerStyle: { paddingRight: 12 },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '사진 고르기',
          tabBarIcon: ({ color, focused }) => <ImagesIcon size={TAB_ICON_SIZE} color={color} weight={focused ? 'fill' : 'light'} />,
        }}
      />
      <Tabs.Screen
        name="album"
        options={{
          title: '기기 사진첩',
          tabBarIcon: ({ color, focused }) => <BookOpenIcon size={TAB_ICON_SIZE} color={color} weight={focused ? 'fill' : 'light'} />,
        }}
      />
      <Tabs.Screen
        name="cloud-library"
        options={{
          title: '안전 사진첩',
          tabBarIcon: ({ color, focused }) => <CloudIcon size={TAB_ICON_SIZE} color={color} weight={focused ? 'fill' : 'light'} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarIcon: ({ color, focused }) => (
            <GearSixIcon size={TAB_ICON_SIZE} color={color} weight={focused ? 'fill' : 'light'} />
          ),
        }}
      />
    </Tabs>
  );
}
