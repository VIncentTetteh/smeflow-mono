import { useEffect, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { createBusiness } from '@/api/business.api';
import { toApiErrorMessage } from '@/api/errors';
import { WizardScreen } from '@/components/layout/WizardScreen';
import { StyledTextInput } from '@/components/ui/Inputs';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import type { BusinessType, MomoProvider, PreferredLanguage, TaxVatStatus } from '@/types/business';

const BUSINESS_TEMPLATES: { label: string; slug: string; value: BusinessType }[] = [
  { label: 'Retail shop', slug: 'retail_shop', value: 'shop' },
  { label: 'Pharmacy', slug: 'pharmacy', value: 'pharmacy' },
  { label: 'Provision store', slug: 'provision_store', value: 'shop' },
  { label: 'Market trader', slug: 'market_trader', value: 'market_stall' },
  { label: 'Services', slug: 'services', value: 'service' },
  { label: 'Wholesaler', slug: 'wholesaler', value: 'shop' },
  { label: 'Agro-inputs', slug: 'agro_inputs', value: 'agriculture' },
];

const LANGUAGES: { label: string; value: PreferredLanguage }[] = [
  { label: 'English', value: 'en' },
  { label: 'Twi', value: 'tw' },
  { label: 'Ewe', value: 'ee' },
  { label: 'Ga', value: 'gaa' },
  { label: 'Pidgin', value: 'pcm' },
];

const VAT_STATUSES: { label: string; value: TaxVatStatus }[] = [
  { label: 'Not VAT registered', value: 'not_registered' },
  { label: 'VAT registered', value: 'registered' },
  { label: 'Exempt', value: 'exempt' },
  { label: 'Not sure', value: 'unknown' },
];

export default function BusinessScreen() {
  const [name, setName] = useState('');
  const [type, setType] = useState<BusinessType>('shop');
  const [templateSlug, setTemplateSlug] = useState('retail_shop');
  const [address, setAddress] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<PreferredLanguage>('en');
  const [momoProvider, setMomoProvider] = useState<MomoProvider>('mtn');
  const [taxVatStatus, setTaxVatStatus] = useState<TaxVatStatus>('unknown');
  const [tin, setTin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { colors, fonts, spacing } = useTheme();
  const accessToken = useAuthStore((state) => state.accessToken);
  const currentRole = useAuthStore((state) => state.role);
  const setBusinessContext = useAuthStore((state) => state.setBusinessContext);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  useEffect(() => {
    if (!accessToken) router.replace('/');
  }, [accessToken, router]);

  async function submit() {
    if (loading) return;
    if (!name.trim()) {
      setError('Enter your business name to continue.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await createBusiness({
        name: name.trim(),
        type,
        address: address.trim() || undefined,
        region: region.trim() || undefined,
        city: city.trim() || undefined,
        market: address.trim() || undefined,
        preferred_language: preferredLanguage,
        momo_provider: momoProvider,
        tax_vat_status: taxVatStatus,
        template_slug: templateSlug,
        tin: tin.trim() || undefined,
      });
      setBusinessContext({
        accessToken: data.access_token,
        businessId: data.business.id,
        role: currentRole === 'agent' ? 'owner' : (currentRole ?? 'owner'),
      });
      router.push('/onboarding/momo');
    } catch (submitError) {
      const message = toApiErrorMessage(submitError);
      if (message === 'Authentication required') {
        clearAuth();
        router.replace('/');
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (!accessToken) return null;

  return (
    <WizardScreen
      continueDisabled={!name.trim()}
      continueLabel="Continue · Wallets"
      continueLoading={loading}
      onContinue={submit}
      step={2}
      stepLabel="Business profile"
      title="Tell us about your shop"
      totalSteps={5}
    >
      <StyledTextInput
        label="Business name"
        onChangeText={(value) => { setName(value); setError(null); }}
        placeholder="Akosua's Provisions"
        value={name}
      />

      {/* Business type chips */}
      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Business template
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {BUSINESS_TEMPLATES.map((item) => {
            const selected = templateSlug === item.slug;
            return (
              <TouchableOpacity
                key={item.slug}
                onPress={() => {
                  setTemplateSlug(item.slug);
                  setType(item.value);
                }}
                style={{
                  paddingVertical: 7,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: selected ? colors.ink : colors.surface,
                  borderWidth: selected ? 0 : 1,
                  borderColor: colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {selected ? (
                  <Text style={{ fontSize: 11, color: '#fdf7eb', fontFamily: fonts.bodySemiBold }}>✓</Text>
                ) : null}
                <Text style={{
                  fontSize: 12,
                  fontFamily: fonts.bodySemiBold,
                  color: selected ? '#fdf7eb' : colors.muted,
                }}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <StyledTextInput
        label="Region"
        onChangeText={setRegion}
        placeholder="Greater Accra"
        value={region}
      />
      <StyledTextInput
        label="Town / City"
        onChangeText={setCity}
        placeholder="Accra"
        value={city}
      />
      <StyledTextInput
        label="Market / Community"
        onChangeText={setAddress}
        placeholder="Madina Market, Accra"
        value={address}
      />

      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Preferred language
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {LANGUAGES.map((item) => {
            const selected = preferredLanguage === item.value;
            return (
              <TouchableOpacity
                key={item.value}
                onPress={() => setPreferredLanguage(item.value)}
                style={{
                  paddingVertical: 7,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: selected ? colors.ink : colors.surface,
                  borderWidth: selected ? 0 : 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{
                  fontSize: 12,
                  fontFamily: fonts.bodySemiBold,
                  color: selected ? '#fdf7eb' : colors.muted,
                }}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Main MoMo provider
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          {(['mtn', 'vodafone', 'airteltigo'] as const).map((item) => {
            const selected = momoProvider === item;
            const label = item === 'mtn' ? 'MTN' : item === 'vodafone' ? 'Telecel' : 'AT Money';
            return (
              <TouchableOpacity
                key={item}
                onPress={() => setMomoProvider(item)}
                style={{
                  paddingVertical: 7,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: selected ? colors.ink : colors.surface,
                  borderWidth: selected ? 0 : 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{
                  fontSize: 12,
                  fontFamily: fonts.bodySemiBold,
                  color: selected ? '#fdf7eb' : colors.muted,
                }}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Tax / VAT status
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {VAT_STATUSES.map((item) => {
            const selected = taxVatStatus === item.value;
            return (
              <TouchableOpacity
                key={item.value}
                onPress={() => setTaxVatStatus(item.value)}
                style={{
                  paddingVertical: 7,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: selected ? colors.ink : colors.surface,
                  borderWidth: selected ? 0 : 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{
                  fontSize: 12,
                  fontFamily: fonts.bodySemiBold,
                  color: selected ? '#fdf7eb' : colors.muted,
                }}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <StyledTextInput
        autoCapitalize="characters"
        label="TIN (optional)"
        onChangeText={setTin}
        placeholder="P0007654321"
        value={tin}
      />

      {error ? <StatusMessage message={error} tone="error" /> : null}
    </WizardScreen>
  );
}
