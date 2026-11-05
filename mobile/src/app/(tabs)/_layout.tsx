import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.accent,
        headerTitleAlign: 'left',
        headerTitleStyle: { fontSize: 22, lineHeight: 30, fontWeight: '700' },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '사진 고르기',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="images-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="album"
        options={{
          title: '기기 사진첩',
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="cloud-library"
        options={{
          title: '안전 사진첩',
          tabBarIcon: ({ color, size }) => <Ionicons name="cloud-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
