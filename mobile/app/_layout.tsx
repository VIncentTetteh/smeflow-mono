import 'react-native-reanimated';
import '@/lib/i18n';
import { useEffect, useState } from 'react';
import { AppState, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { DatabaseProvider } from '@nozbe/watermelondb/DatabaseProvider';
import { Toast } from '@/components/ui/Toast';
import { useToastStore } from '@/lib/toast';
import {
  useFonts,
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
} from '@expo-google-fonts/source-serif-4';
import {
  Inter_400Regular,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { database } from '@/db';
import { startSyncService } from '@/db/sync/service';
import { applySessionBootstrap, fetchSessionBootstrap } from '@/api/hooks/sessionHooks';
import { queryClient } from '@/api/queryClient';
import { biometricUnlock, isBiometricAvailable } from '@/lib/deviceFeatures';
import { getAuthRedirect } from '@/navigation/authRouting';
import { subscribeToAuthExpired } from '@/navigation/authEvents';
import { useAuthStore } from '@/store/auth';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SourceSerif4_400Regular,
    SourceSerif4_600SemiBold,
    Inter_400Regular,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
  });

  const isAuthenticated = useAuthStore((s) => !!s.accessToken);
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasBusinessContext = useAuthStore((s) => s.hasBusinessContext());
  const role = useAuthStore((s) => s.role);
  const businessId = useAuthStore((s) => s.businessId);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const setBootstrapStatus = useAuthStore((s) => s.setBootstrapStatus);
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);
  const [sessionCheckedForToken, setSessionCheckedForToken] = useState<string | null>(null);
  const [biometricCheckedForToken, setBiometricCheckedForToken] = useState<string | null>(null);
  const [biometricChecking, setBiometricChecking] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const router = useRouter();
  const segments = useSegments();
  const { message: toastMessage, tone: toastTone, visible: toastVisible, hide: hideToast } = useToastStore();

  useEffect(() => {
    if (!accessToken || !biometricEnabled) {
      setBiometricCheckedForToken(null);
      setBiometricError(null);
    }
  }, [accessToken, biometricEnabled]);

  useEffect(() => {
    if (!biometricChecking) return undefined;
    const timeout = setTimeout(() => {
      setBiometricChecking(false);
      setBiometricError('Biometric unlock timed out. Tap Unlock to try again or use phone login.');
    }, 10_000);
    return () => clearTimeout(timeout);
  }, [biometricChecking]);

  useEffect(() => {
    if (!fontsLoaded || !accessToken || sessionCheckedForToken === accessToken) return;
    let cancelled = false;

    async function validateStoredSession() {
      try {
        setBootstrapStatus('loading');
        const data = await fetchSessionBootstrap();
        if (!cancelled) {
          applySessionBootstrap(data);
          setSessionCheckedForToken(accessToken);
        }
      } catch {
        if (!cancelled) {
          setBootstrapStatus('invalid', 'Session expired');
          clearAuth();
          setSessionCheckedForToken(null);
          router.replace('/');
        }
      }
    }

    void validateStoredSession();
    return () => {
      cancelled = true;
    };
  }, [accessToken, clearAuth, fontsLoaded, router, sessionCheckedForToken, setBootstrapStatus]);

  useEffect(() => {
    if (!fontsLoaded || !isAuthenticated || !accessToken) return undefined;

    let refreshInFlight = false;
    const refreshSession = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const data = await fetchSessionBootstrap();
        applySessionBootstrap(data);
      } catch {
        // Auth expiry is handled by the API client interceptor.
      } finally {
        refreshInFlight = false;
      }
    };

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshSession();
    });
    return () => subscription.remove();
  }, [accessToken, fontsLoaded, isAuthenticated]);

  useEffect(() => {
    if (!fontsLoaded) return;
    const sessionIsBeingChecked =
      isAuthenticated && !!accessToken && sessionCheckedForToken !== accessToken;
    if (sessionIsBeingChecked) return;
    if (isAuthenticated && !!accessToken && biometricEnabled && biometricCheckedForToken !== accessToken) return;

    if (!segments.length) return;

    const redirect = getAuthRedirect({
      isAuthenticated,
      hasBusinessContext,
      role,
      segments: [...segments],
    });
    if (redirect) {
      router.replace(redirect as Href);
    }
  }, [accessToken, biometricCheckedForToken, biometricEnabled, hasBusinessContext, isAuthenticated, fontsLoaded, role, segments, router, sessionCheckedForToken]);

  useEffect(() => {
    if (!fontsLoaded || !isAuthenticated || !businessId) return undefined;
    return startSyncService(database);
  }, [businessId, fontsLoaded, isAuthenticated]);

  useEffect(() => {
    return subscribeToAuthExpired(() => {
      setSessionCheckedForToken(null);
      router.replace('/');
    });
  }, [router]);

  const needsBiometricUnlock =
    isAuthenticated &&
    !!accessToken &&
    biometricEnabled &&
    biometricCheckedForToken !== accessToken;

  if (!fontsLoaded || (isAuthenticated && !!accessToken && sessionCheckedForToken !== accessToken)) {
    return null;
  }

  if (needsBiometricUnlock) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fdf7eb' }}>
            <Text style={{ fontFamily: 'SourceSerif4_600SemiBold', fontSize: 24, color: '#1a1612', marginBottom: 8 }}>
              Unlock SMEflow
            </Text>
            <Text style={{ fontSize: 13, color: '#6f6a60', textAlign: 'center', marginBottom: 18 }}>
              Use your device biometrics to continue.
            </Text>
            {biometricError ? (
              <Text style={{ fontSize: 12.5, color: '#a33', textAlign: 'center', marginBottom: 12 }}>
                {biometricError}
              </Text>
            ) : null}
            <TouchableOpacity
              disabled={biometricChecking}
              onPress={async () => {
                setBiometricChecking(true);
                setBiometricError(null);
                try {
                  const available = await isBiometricAvailable();
                  const ok = available ? await biometricUnlock() : false;
                  if (ok) {
                    setBiometricCheckedForToken(accessToken);
                  } else {
                    setBiometricError('Biometric unlock failed. Try again or sign in with your phone number.');
                  }
                } finally {
                  setBiometricChecking(false);
                }
              }}
              style={{
                width: '100%',
                maxWidth: 320,
                height: 48,
                borderRadius: 12,
                backgroundColor: '#1a1612',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: biometricChecking ? 0.6 : 1,
              }}
            >
              <Text style={{ color: '#fdf7eb', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
                {biometricChecking ? 'Checking...' : 'Unlock'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setBiometricEnabled(false);
                clearAuth();
                setBiometricCheckedForToken(null);
                setBiometricChecking(false);
                router.replace('/');
              }}
              style={{ marginTop: 14, padding: 8 }}
            >
              <Text style={{ color: '#6f6a60', fontSize: 13 }}>Use phone number instead</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <DatabaseProvider database={database}>
            <View style={{ flex: 1 }}>
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: false }} />
              <Toast message={toastMessage} tone={toastTone} visible={toastVisible} onHide={hideToast} />
            </View>
          </DatabaseProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
