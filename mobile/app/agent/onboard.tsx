import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PhoneInput, StyledTextInput } from '@/components/ui/Inputs';
import { Screen, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useOnboardTrader } from '@/api/hooks/featureHooks';
import { isValidGhanaPhone } from '@/lib/phone';
import { useTheme } from '@/lib/theme';
import type { OnboardTraderResultDto } from '@/types/agents';

// G-M8: validated business type picker (matches backend enum)
const BUSINESS_TYPES = [
  { label: 'Market stall', value: 'market_stall' },
  { label: 'Retail shop', value: 'retail_shop' },
  { label: 'Food & beverage', value: 'food_beverage' },
  { label: 'Services', value: 'services' },
  { label: 'Artisan / Craft', value: 'artisan' },
  { label: 'Other', value: 'other' },
];

function BusinessTypePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { colors, fonts, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = BUSINESS_TYPES.find((t) => t.value === value);

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.bg,
        }}
      >
        <Text style={{ fontSize: 14, color: selected ? colors.ink : colors.muted }}>
          {selected?.label ?? 'Select business type'}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={18} color={colors.muted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 34 }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink }}>Business type</Text>
          </View>
          {BUSINESS_TYPES.map((t) => (
            <TouchableOpacity
              key={t.value}
              onPress={() => { onChange(t.value); setOpen(false); }}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 14,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                backgroundColor: value === t.value ? `${colors.brand}08` : 'transparent',
              }}
            >
              <Text style={{ fontSize: 15, color: colors.ink }}>{t.label}</Text>
              {value === t.value && <MaterialCommunityIcons name="check" size={18} color={colors.brand} />}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>
    </>
  );
}

// G-M9: Success screen shown after onboarding
function SuccessView({
  result,
  onDone,
  onKYC,
}: {
  result: OnboardTraderResultDto;
  onDone: () => void;
  onKYC: () => void;
}) {
  const { colors, fonts, spacing } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 16 }}>
      <View style={{
        width: 64, height: 64, borderRadius: 32,
        backgroundColor: `${colors.brand}15`,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <MaterialCommunityIcons name="check-circle-outline" size={36} color={colors.brand} />
      </View>
      <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink, textAlign: 'center' }}>
        Trader added!
      </Text>
      <Text style={{ fontSize: 14, color: colors.muted, textAlign: 'center' }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.ink }}>{result.businessName}</Text>
        {result.isNewUser ? ' is a new account' : ' is an existing user'}.
        {result.kycSubmitted ? ' KYC submitted for review.' : ' No KYC documents collected yet.'}
      </Text>
      {!result.kycSubmitted && (
        <TouchableOpacity
          onPress={onKYC}
          style={{
            width: '100%', height: 48, borderRadius: 12,
            backgroundColor: colors.inverse,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fdf7eb' }}>
            Collect KYC documents
          </Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={onDone}
        style={{
          width: '100%', height: 48, borderRadius: 12,
          borderWidth: 1, borderColor: colors.border,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.muted }}>
          Onboard another trader
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function OnboardScreen() {
  const { colors, spacing } = useTheme();
  const router = useRouter();

  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessType, setBusinessType] = useState('market_stall');
  const [walletPhone, setWalletPhone] = useState('');
  const [address, setAddress] = useState('');
  const [ghanaCard, setGhanaCard] = useState('');
  const [tin, setTin] = useState('');

  // G-M9: success state
  const [successResult, setSuccessResult] = useState<OnboardTraderResultDto | null>(null);

  // G-M7: React Query mutation instead of raw sequential apiClient calls
  const onboard = useOnboardTrader();

  function resetForm() {
    setBusinessName('');
    setOwnerName('');
    setPhone('');
    setBusinessType('market_stall');
    setWalletPhone('');
    setAddress('');
    setGhanaCard('');
    setTin('');
    setSuccessResult(null);
  }

  async function submit() {
    if (!businessName.trim() || !ownerName.trim() || !phone.trim()) {
      Alert.alert('Missing details', 'Business name, owner name and a valid phone are required.');
      return;
    }
    if (!isValidGhanaPhone(phone)) {
      Alert.alert('Invalid owner phone', 'Enter a valid Ghana phone number for the business owner.');
      return;
    }
    if (walletPhone.trim() && !isValidGhanaPhone(walletPhone)) {
      Alert.alert(
        'Invalid wallet phone',
        'Enter a valid Ghana phone number for the MoMo wallet, or leave it blank to use the owner phone.'
      );
      return;
    }

    onboard.mutate(
      {
        phone: phone.trim(),
        ownerName: ownerName.trim(),
        businessName: businessName.trim(),
        businessType,
        address: address.trim() || undefined,
        walletPhone: walletPhone.trim() || undefined,
        ghanaCard: ghanaCard.trim() || undefined,
        tin: tin.trim() || undefined,
      },
      {
        // G-M9: navigate to success view
        onSuccess: (result) => setSuccessResult(result),
        onError: (err: Error) => {
          const detail = (err as any)?.response?.data?.detail;
          Alert.alert('Onboarding failed', detail ?? err.message ?? 'Check the trader details and try again.');
        },
      }
    );
  }

  // G-M9: show success screen after completion
  if (successResult) {
    return (
      <Screen>
        <SuccessView
          result={successResult}
          onDone={resetForm}
          onKYC={() => {
            Alert.alert(
              'KYC documents',
              'Ask the trader to open their own SMEflow app and complete verification under Settings → KYC, or take photos of documents to submit later.',
              [{ text: 'OK', onPress: resetForm }]
            );
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionHeader title="Onboard trader" subtitle="Capture details — KYC can be collected on-site" />
      <Card style={{ gap: spacing.md }}>
        <StyledTextInput
          label="Business name *"
          onChangeText={setBusinessName}
          placeholder="Akosua Trading"
          value={businessName}
        />
        <StyledTextInput
          label="Owner name *"
          onChangeText={setOwnerName}
          placeholder="Akosua Mensah"
          value={ownerName}
        />

        {/* G-M8: validated picker instead of free text */}
        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: 'bodySemiBold', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Business type
        </Text>
        <BusinessTypePicker value={businessType} onChange={setBusinessType} />

        <Text style={{ color: colors.muted, fontSize: 12 }}>Owner phone *</Text>
        <PhoneInput onChangeText={setPhone} value={phone} />

        <Text style={{ color: colors.muted, fontSize: 12 }}>MoMo wallet phone (leave blank to use owner phone)</Text>
        <PhoneInput onChangeText={setWalletPhone} value={walletPhone} />

        <StyledTextInput
          label="Market or address"
          onChangeText={setAddress}
          placeholder="Makola Market, Accra"
          value={address}
        />
        <StyledTextInput
          label="Ghana Card (optional)"
          onChangeText={setGhanaCard}
          placeholder="GHA-123456789-1"
          value={ghanaCard}
          autoCapitalize="characters"
        />
        <StyledTextInput
          label="TIN (optional)"
          onChangeText={setTin}
          placeholder="C0012345678"
          value={tin}
          autoCapitalize="characters"
        />

        {/* G-M7: mutation-based submit with loading state */}
        {onboard.isPending && (
          <View style={{ alignItems: 'center', paddingVertical: 8, gap: 6 }}>
            <ActivityIndicator size="small" color={colors.brand} />
            <Text style={{ fontSize: 12, color: colors.muted }}>Setting up trader account…</Text>
          </View>
        )}

        <Button
          loading={onboard.isPending}
          label="Start onboarding"
          onPress={submit}
        />
      </Card>
    </Screen>
  );
}
