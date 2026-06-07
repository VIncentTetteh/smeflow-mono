import { Tabs, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import { registerDevice } from '@/api/auth.api';
import { useBillingWorkspace } from '@/api/hooks/featureHooks';

export default function OwnerLayout() {
  const { colors, spacing } = useTheme();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());
  const hasBusinessContext = useAuthStore((state) => state.hasBusinessContext());
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const deviceRegistered = useRef(false);

  useBillingWorkspace(); // Prime React Query cache so plan gates have data before screens mount

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/');
    } else if (!hasBusinessContext) {
      router.replace('/onboarding/business');
    }
  }, [hasBusinessContext, isAuthenticated, router]);

  // Register FCM/APNS device token on first authenticated mount so push notifications work
  useEffect(() => {
    if (!isAuthenticated || !hasBusinessContext || deviceRegistered.current) return;

    async function registerPush() {
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') return;

        const tokenData = await Notifications.getExpoPushTokenAsync();
        await registerDevice({
          token: tokenData.data,
          platform: Platform.OS === 'ios' ? 'apns' : 'fcm',
        });
        deviceRegistered.current = true;
      } catch {
        // Non-critical — push registration failure must not block app usage
      }
    }

    void registerPush();
  }, [isAuthenticated, hasBusinessContext]);

  if (!isAuthenticated || !hasBusinessContext) {
    return null;
  }

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner style={{ marginHorizontal: spacing.sm, marginBottom: spacing.sm, marginTop: insets.top + spacing.xs }} />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.brand,
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
            title: 'Home',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons color={color} name="view-dashboard-outline" size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="sell"
          options={{
            title: 'Sell',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons color={color} name="cart-outline" size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="inventory"
          options={{
            title: 'Stock',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons color={color} name="archive-outline" size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="assistant"
          options={{
            title: 'Assistant',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons color={color} name="message-text-outline" size={size} />
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
        <Tabs.Screen name="sales" options={{ href: null, title: 'Sales' }} />
        <Tabs.Screen name="invoices" options={{ href: null }} />
        <Tabs.Screen name="account-recovery" options={{ href: null }} />
        <Tabs.Screen name="analytics" options={{ href: null, title: 'Analytics' }} />
        <Tabs.Screen name="stock" options={{ href: null, title: 'Analytics' }} />
        <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
        <Tabs.Screen name="team" options={{ href: null, title: 'Team & Roles' }} />
        <Tabs.Screen name="sync" options={{ href: null, title: 'Offline & Sync' }} />
        <Tabs.Screen name="kyc-status" options={{ href: null, title: 'KYC Status' }} />
        <Tabs.Screen name="kyc-personal" options={{ href: null, title: 'Personal Verification' }} />
        <Tabs.Screen name="kyc-business" options={{ href: null, title: 'Business Verification' }} />
        <Tabs.Screen name="credit" options={{ href: null, title: 'Credit & Loans' }} />
        <Tabs.Screen name="payroll" options={{ href: null, title: 'Payroll' }} />
        <Tabs.Screen name="tax" options={{ href: null, title: 'Tax & Compliance' }} />
        <Tabs.Screen name="billing" options={{ href: null, title: 'Billing & Plan' }} />
        <Tabs.Screen name="cashier" options={{ href: null, title: 'Cashier' }} />
        <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
        <Tabs.Screen name="message-deliveries" options={{ href: null, title: 'Customer Messages' }} />
        <Tabs.Screen name="referrals" options={{ href: null, title: 'Refer a trader' }} />
        <Tabs.Screen name="payments-history" options={{ href: null, title: 'Payments' }} />
        <Tabs.Screen name="reconciliation" options={{ href: null, title: 'Reconciliation' }} />
        <Tabs.Screen name="new-invoice" options={{ href: null, title: 'New Invoice' }} />
        <Tabs.Screen name="customers" options={{ href: null, title: 'Customers' }} />
        <Tabs.Screen name="add-business" options={{ href: null }} />
        <Tabs.Screen name="edit-business" options={{ href: null, title: 'Edit Business' }} />
        <Tabs.Screen name="edit-profile" options={{ href: null, title: 'Edit Profile' }} />
      </Tabs>
    </View>
  );
}
