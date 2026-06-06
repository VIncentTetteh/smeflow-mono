import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import { useUpdateBusinessProfile } from '@/api/hooks/sessionHooks';
import type { BusinessType } from '@/types/business';

const BUSINESS_TYPES: Array<{ value: BusinessType; label: string }> = [
  { value: 'market_stall', label: 'Market Stall' },
  { value: 'shop',         label: 'Shop / Retail' },
  { value: 'artisan',      label: 'Artisan / Craftsperson' },
  { value: 'restaurant',   label: 'Restaurant / Food' },
  { value: 'pharmacy',     label: 'Pharmacy' },
  { value: 'salon',        label: 'Salon / Beauty' },
  { value: 'transport',    label: 'Transport' },
  { value: 'agriculture',  label: 'Agriculture / Farming' },
  { value: 'service',      label: 'Professional Services' },
  { value: 'other',        label: 'Other' },
];

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  const { colors, fonts } = useTheme();
  return (
    <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
      {label}{required ? <Text style={{ color: colors.danger }}> *</Text> : null}
    </Text>
  );
}

export default function EditBusinessScreen() {
  const { colors, fonts } = useTheme();
  const business = useAuthStore((s) => s.business);
  const updateBusiness = useUpdateBusinessProfile();

  const [name, setName]           = useState(business?.name ?? '');
  const [type, setType]           = useState<BusinessType>((business?.type as BusinessType) ?? 'shop');
  const [tin, setTin]             = useState(business?.tin ?? '');
  const [address, setAddress]     = useState(business?.address ?? '');
  const [ghanaCard, setGhanaCard] = useState(business?.ghana_card_ref ?? '');
  const [showTypePicker, setShowTypePicker] = useState(false);

  useEffect(() => {
    if (business) {
      setName(business.name ?? '');
      setType((business.type as BusinessType) ?? 'shop');
      setTin(business.tin ?? '');
      setAddress(business.address ?? '');
      setGhanaCard(business.ghana_card_ref ?? '');
    }
  }, [business]);

  const canSave = name.trim().length > 0 && !updateBusiness.isPending;
  const selectedTypeLabel = BUSINESS_TYPES.find((t) => t.value === type)?.label ?? type;

  function handleSave() {
    updateBusiness.mutate(
      {
        name:           name.trim(),
        type,
        tin:            tin.trim() || undefined,
        address:        address.trim() || undefined,
        ghana_card_ref: ghanaCard.trim() || undefined,
      },
      {
        onSuccess: () => {
          Alert.alert('Saved', 'Business profile updated.');
          router.back();
        },
        onError: (e: Error) => Alert.alert('Could not save', e.message),
      }
    );
  }

  const inputStyle = {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.ink, backgroundColor: colors.bg,
    fontFamily: fonts.body,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{
          paddingHorizontal: 16, paddingVertical: 12,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          borderBottomWidth: 1, borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={colors.ink} />
          </TouchableOpacity>
          <Text style={{ flex: 1, fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink }}>
            Business Profile
          </Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={!canSave}
            style={{
              paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10,
              backgroundColor: canSave ? colors.ink : `${colors.ink}30`,
            }}
          >
            {updateBusiness.isPending
              ? <ActivityIndicator size="small" color="#fdf7eb" />
              : <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">

          {/* Business Name */}
          <View>
            <FieldLabel label="Business Name" required />
            <TextInput
              style={inputStyle}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Akosua's Provisions"
              placeholderTextColor={colors.muted}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>

          {/* Business Type */}
          <View>
            <FieldLabel label="Business Type" required />
            <TouchableOpacity
              onPress={() => setShowTypePicker((p) => !p)}
              style={[inputStyle, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
            >
              <Text style={{ fontSize: 14, color: colors.ink, fontFamily: fonts.body }}>{selectedTypeLabel}</Text>
              <MaterialCommunityIcons
                name={showTypePicker ? 'chevron-up' : 'chevron-down'}
                size={18} color={colors.muted}
              />
            </TouchableOpacity>
            {showTypePicker && (
              <View style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                backgroundColor: colors.surface, marginTop: 4, overflow: 'hidden',
              }}>
                {BUSINESS_TYPES.map((bt, i) => (
                  <TouchableOpacity
                    key={bt.value}
                    onPress={() => { setType(bt.value); setShowTypePicker(false); }}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 12,
                      borderBottomWidth: i < BUSINESS_TYPES.length - 1 ? 1 : 0,
                      borderBottomColor: colors.border,
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    }}
                  >
                    <Text style={{ fontSize: 13.5, color: colors.ink, fontFamily: fonts.body }}>{bt.label}</Text>
                    {type === bt.value && (
                      <MaterialCommunityIcons name="check" size={16} color={colors.brand} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* TIN */}
          <View>
            <FieldLabel label="Tax ID (TIN)" />
            <TextInput
              style={inputStyle}
              value={tin}
              onChangeText={setTin}
              placeholder="e.g. C0012345678"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              returnKeyType="next"
            />
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
              Required for VAT registration and GRA-compliant invoices.
            </Text>
          </View>

          {/* Address */}
          <View>
            <FieldLabel label="Business Address" />
            <TextInput
              style={[inputStyle, { minHeight: 72, textAlignVertical: 'top' }]}
              value={address}
              onChangeText={setAddress}
              placeholder="e.g. Shop 4, Kejetia Market, Kumasi"
              placeholderTextColor={colors.muted}
              multiline
              returnKeyType="next"
            />
          </View>

          {/* Ghana Card Ref */}
          <View>
            <FieldLabel label="Ghana Card / Business Reg. No." />
            <TextInput
              style={inputStyle}
              value={ghanaCard}
              onChangeText={setGhanaCard}
              placeholder="e.g. GHA-123456789-0"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              returnKeyType="done"
              onSubmitEditing={canSave ? handleSave : undefined}
            />
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
