import { Alert, Linking, ScrollView, TouchableOpacity, View } from 'react-native';
import { useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { biometricUnlock, isBiometricAvailable } from '@/lib/deviceFeatures';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type SectionItem = { icon: IconName; label: string; sub: string };

export default function SettingsScreen() {
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const signOut = useAuthStore((s) => s.clearAuth);
  const user = useAuthStore((s) => s.user);
  const business = useAuthStore((s) => s.business);
  const members = useAuthStore((s) => s.members);
  const momoAccounts = useAuthStore((s) => s.momoAccounts);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    isBiometricAvailable().then(setBiometricAvailable).catch(() => setBiometricAvailable(false));
  }, []);

  const primaryMomo = momoAccounts?.find((m: { is_primary?: boolean }) => m.is_primary) ?? momoAccounts?.[0];
  const momoSub = primaryMomo
    ? `${String(primaryMomo.provider ?? '').toUpperCase()} primary · ${String(primaryMomo.phone ?? '')}`
    : 'No wallet linked';

  const SECTIONS: Array<{ title: string; items: SectionItem[] }> = [
    {
      title: 'Business',
      items: [
        { icon: 'store',               label: 'Business profile',     sub: business?.name ?? 'Set up your profile' },
        { icon: 'account-group',       label: 'Team & roles',         sub: `${members?.length ?? 0} member${(members?.length ?? 0) !== 1 ? 's' : ''}` },
        { icon: 'cash-multiple',       label: 'Wallets & payouts',    sub: momoSub },
        { icon: 'file-document',       label: 'Tax profile',          sub: 'VAT, TIN and filing settings' },
      ],
    },
    {
      title: 'App',
      items: [
        { icon: 'web',                 label: 'Language',             sub: 'English · with Twi assistant' },
        { icon: 'bell-outline',        label: 'Notifications',        sub: 'Sales, low-stock, tax due' },
        { icon: 'sync',                label: 'Offline & sync',       sub: 'Auto · over Wi-Fi or 3G+' },
        {
          icon: 'shield-outline',
          label: 'Privacy & security',
          sub: biometricAvailable
            ? `Biometric unlock ${biometricEnabled ? 'on' : 'off'}`
            : 'Biometrics unavailable',
        },
      ],
    },
    {
      title: 'Help',
      items: [
        { icon: 'phone',               label: 'Talk to a person',     sub: '0800-SMEFLOW · Mon-Sat 7am-9pm' },
        { icon: 'whatsapp',            label: 'WhatsApp support',     sub: '+233 24 000 7654' },
        { icon: 'information-outline', label: 'About SMEFlow',        sub: `v${Constants.expoConfig?.version ?? '?'} · Terms · Privacy` },
      ],
    },
  ];

  function handleSettingItem(label: string) {
    switch (label) {
      case 'Business profile':
        router.push('/owner/edit-business');
        break;
      case 'Team & roles':
        router.push('/owner/team');
        break;
      case 'Wallets & payouts':
        router.push('/owner/payments-history');
        break;
      case 'Tax profile':
        router.push('/owner/tax');
        break;
      case 'Language':
        Alert.alert('Language', 'English is the active language. Twi is available in the AI chat assistant.');
        break;
      case 'Notifications':
        router.push('/owner/notifications');
        break;
      case 'Offline & sync':
        router.push('/owner/sync');
        break;
      case 'Privacy & security':
        if (!biometricAvailable) {
          Alert.alert('Biometrics unavailable', 'Set up Face ID, Touch ID, or device biometrics in your phone settings first.');
          break;
        }
        if (biometricEnabled) {
          setBiometricEnabled(false);
          Alert.alert('Biometric unlock off', 'SMEflow will use phone-code login next time.');
          break;
        }
        biometricUnlock().then((ok) => {
          if (ok) {
            setBiometricEnabled(true);
            Alert.alert('Biometric unlock on', 'Next time SMEflow opens your stored session, biometrics will unlock it.');
          } else {
            Alert.alert('Could not enable', 'Biometric confirmation was cancelled or failed.');
          }
        });
        break;
      case 'Talk to a person':
        Linking.canOpenURL('tel:0800763569').then((can) => {
          if (can) Linking.openURL('tel:0800763569');
          else Alert.alert('Call support', 'SMEFlow support line: 0800 763 569');
        });
        break;
      case 'WhatsApp support':
        Linking.openURL('https://wa.me/233240007654');
        break;
      case 'About SMEFlow':
        Alert.alert('SMEFlow', 'Version 0.42.1\nBuilt for Ghana\'s SMEs\n© 2026 SMEFlow Inc.');
        break;
    }
  }

  function handleSignOut() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => { signOut(); router.replace('/'); } },
    ]);
  }

  const displayName = user?.name ?? '';
  const initials = displayName ? displayName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase() : '?';
  const phone = user?.phone ?? '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Settings</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
        {/* User avatar card */}
        <TouchableOpacity
          onPress={() => router.push('/owner/edit-profile')}
          style={{
            backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
            borderRadius: 16, padding: 14,
            flexDirection: 'row', alignItems: 'center', gap: 12,
          }}
        >
          <View style={{
            width: 50, height: 50, borderRadius: 25,
            backgroundColor: '#b6831e', alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 17, color: '#fff' }}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 17, color: colors.ink }}>{displayName || '—'}</Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.muted }}>{phone || 'Not set'}</Text>
          </View>
          <View style={{
            paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
            backgroundColor: `${colors.brand}15`, flexDirection: 'row', alignItems: 'center', gap: 4,
          }}>
            <MaterialCommunityIcons name="shield-check" size={12} color={colors.brand} />
            <Text style={{ fontSize: 11, fontFamily: fonts.bodySemiBold, color: colors.brand }}>Verified</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.muted} />
        </TouchableOpacity>

        {SECTIONS.map((sec) => (
          <View key={sec.title}>
            <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
              {sec.title}
            </Text>
            <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
              {sec.items.map((item, i) => (
                <TouchableOpacity key={item.label} onPress={() => handleSettingItem(item.label)} style={{
                  flexDirection: 'row', gap: 11, paddingHorizontal: 12, paddingVertical: 11,
                  alignItems: 'center',
                  borderBottomWidth: i < sec.items.length - 1 ? 1 : 0, borderBottomColor: colors.border,
                }}>
                  <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: `${colors.ink}08`, alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialCommunityIcons name={item.icon} size={15} color={colors.muted} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{item.label}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{item.sub}</Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={colors.muted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <TouchableOpacity onPress={handleSignOut} style={{ paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.danger }}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
