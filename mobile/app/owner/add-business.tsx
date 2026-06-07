import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { StyledTextInput } from '@/components/ui/Inputs';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { createBusiness } from '@/api/business.api';
import { toApiErrorMessage, is402Error } from '@/api/errors';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import type { BusinessType } from '@/types/business';

const BUSINESS_TYPES: Array<{ label: string; value: BusinessType }> = [
  { label: 'Retail shop', value: 'shop' },
  { label: 'Market stall', value: 'market_stall' },
  { label: 'Restaurant', value: 'restaurant' },
  { label: 'Service business', value: 'service' },
  { label: 'Artisan', value: 'artisan' },
  { label: 'Other', value: 'other' },
];

export default function AddBusinessScreen() {
  const { colors, fonts, spacing } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const setBusinessContext = useAuthStore((s) => s.setBusinessContext);

  const [name, setName] = useState('');
  const [type, setType] = useState<BusinessType>('shop');
  const [address, setAddress] = useState('');
  const [tin, setTin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeRequired, setUpgradeRequired] = useState(false);

  async function submit() {
    if (loading || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await createBusiness({
        name: name.trim(),
        type,
        address: address.trim() || undefined,
        tin: tin.trim() || undefined,
      });
      setBusinessContext({
        accessToken: data.access_token,
        businessId: data.business.id,
        role: 'owner',
      });
      queryClient.clear();
      router.replace('/owner');
    } catch (err) {
      if (is402Error(err)) {
        setUpgradeRequired(true);
      } else {
        setError(toApiErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        flexDirection: 'row', alignItems: 'center', gap: 10,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={colors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink }}>Add a business</Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>Create a new business profile</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: spacing.md ?? 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <StyledTextInput
          label="Business name"
          onChangeText={(v) => { setName(v); setError(null); setUpgradeRequired(false); }}
          placeholder="Akosua's Provisions"
          value={name}
        />

        {/* Business type chips */}
        <View style={{ gap: spacing.xs ?? 6 }}>
          <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Business type
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {BUSINESS_TYPES.map((item) => {
              const selected = type === item.value;
              return (
                <TouchableOpacity
                  key={item.value}
                  onPress={() => setType(item.value)}
                  style={{
                    paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999,
                    backgroundColor: selected ? colors.ink : colors.surface,
                    borderWidth: selected ? 0 : 1, borderColor: colors.border,
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                  }}
                >
                  {selected ? (
                    <Text style={{ fontSize: 11, color: '#fdf7eb', fontFamily: fonts.bodySemiBold }}>✓</Text>
                  ) : null}
                  <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: selected ? '#fdf7eb' : colors.muted }}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <StyledTextInput
          label="Market / Community"
          onChangeText={setAddress}
          placeholder="Madina Market, Accra"
          value={address}
        />
        <StyledTextInput
          autoCapitalize="characters"
          label="TIN (optional)"
          onChangeText={setTin}
          placeholder="P0007654321"
          value={tin}
        />

        {error ? <StatusMessage message={error} tone="error" /> : null}

        {upgradeRequired ? (
          <UpgradePrompt
            feature="Multiple businesses"
            requiredPlan="starter"
            description="You've reached your plan's business limit. Upgrade to add more businesses to your account."
          />
        ) : null}

        <TouchableOpacity
          onPress={submit}
          disabled={loading || !name.trim() || upgradeRequired}
          style={{
            height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
            backgroundColor: loading || !name.trim() || upgradeRequired ? `${colors.brand}50` : colors.brand,
            marginTop: 8,
          }}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Create business</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
