import { Tabs, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

export default function AgentLayout() {
  const { colors, spacing } = useTheme();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());
  const role = useAuthStore((state) => state.role);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/');
    } else if (role !== 'agent') {
      router.replace('/');
    }
  }, [isAuthenticated, role, router]);

  if (!isAuthenticated || role !== 'agent') {
    return null;
  }

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner style={{ marginHorizontal: spacing.sm, marginBottom: spacing.sm, marginTop: insets.top + spacing.xs }} />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.info,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons color={color} name="chart-timeline-variant" size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="pipeline"
          options={{
            title: 'Pipeline',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons color={color} name="account-multiple-outline" size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="onboard"
          options={{
            title: 'Onboard',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons color={color} name="account-plus-outline" size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons color={color} name="dots-horizontal" size={size} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}
