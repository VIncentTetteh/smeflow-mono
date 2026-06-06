import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import { useUpdateMe } from '@/api/hooks/featureHooks';

function FieldLabel({ label }: { label: string }) {
  const { colors, fonts } = useTheme();
  return (
    <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
      {label}
    </Text>
  );
}

export default function EditProfileScreen() {
  const { colors, fonts } = useTheme();
  const user             = useAuthStore((s) => s.user);
  const setSessionContext = useAuthStore((s) => s.setSessionContext);
  const updateMe         = useUpdateMe();

  const [name, setName]           = useState(user?.name ?? '');
  const [ghanaCard, setGhanaCard] = useState('');
  const [tin, setTin]             = useState('');

  useEffect(() => {
    if (user) setName(user.name ?? '');
  }, [user]);

  const GHANA_CARD_RE = /^GHA-[0-9]{9}-[0-9]$/;
  const TIN_RE        = /^[0-9]{11}$/;

  const canSave = name.trim().length > 0 && !updateMe.isPending;

  const initials = name
    ? name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  function handleSave() {
    const cardVal = ghanaCard.trim();
    const tinVal  = tin.trim();

    if (cardVal && !GHANA_CARD_RE.test(cardVal)) {
      Alert.alert('Invalid Ghana Card ID', 'Format must be GHA-XXXXXXXXX-D (e.g. GHA-123456789-0).');
      return;
    }
    if (tinVal && !TIN_RE.test(tinVal)) {
      Alert.alert('Invalid TIN', 'TIN must be exactly 11 digits (numbers only).');
      return;
    }

    updateMe.mutate(
      {
        name:          name.trim() || undefined,
        ghana_card_id: cardVal || undefined,
        tin:           tinVal  || undefined,
      },
      {
        onSuccess: (updated) => {
          setSessionContext({
            user: {
              id:        updated.id,
              phone:     updated.phone,
              name:      updated.name ?? '',
              kycStatus: updated.kyc_status,
            },
          });
          Alert.alert('Saved', 'Your profile has been updated.');
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
            My Profile
          </Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={!canSave}
            style={{
              paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10,
              backgroundColor: canSave ? colors.ink : `${colors.ink}30`,
            }}
          >
            {updateMe.isPending
              ? <ActivityIndicator size="small" color="#fdf7eb" />
              : <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">

          {/* Avatar preview */}
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            <View style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: '#b6831e', alignItems: 'center', justifyContent: 'center',
              marginBottom: 8,
            }}>
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22, color: '#fff' }}>
                {initials}
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted }}>{user?.phone ?? ''}</Text>
          </View>

          {/* Full Name */}
          <View>
            <FieldLabel label="Full Name" />
            <TextInput
              style={inputStyle}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Kofi Mensah"
              placeholderTextColor={colors.muted}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>

          {/* Ghana Card */}
          <View>
            <FieldLabel label="Ghana Card ID" />
            <TextInput
              style={inputStyle}
              value={ghanaCard}
              onChangeText={(v) => setGhanaCard(v.toUpperCase())}
              placeholder="GHA-XXXXXXXXX-D"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="next"
            />
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
              Used for identity verification.
            </Text>
          </View>

          {/* Personal TIN */}
          <View>
            <FieldLabel label="Personal TIN" />
            <TextInput
              style={inputStyle}
              value={tin}
              onChangeText={(v) => setTin(v.replace(/\D/g, '').slice(0, 11))}
              placeholder="11 digits, e.g. 00123456789"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              autoCapitalize="none"
              maxLength={11}
              returnKeyType="done"
              onSubmitEditing={canSave ? handleSave : undefined}
            />
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
              Ghana Revenue Authority TIN — 11 digits.
            </Text>
          </View>

          {/* Read-only phone */}
          <View>
            <FieldLabel label="Phone Number" />
            <View style={[inputStyle, { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: `${colors.ink}05` }]}>
              <MaterialCommunityIcons name="lock-outline" size={14} color={colors.muted} />
              <Text style={{ fontSize: 14, color: colors.muted, fontFamily: fonts.mono }}>
                {user?.phone ?? '—'}
              </Text>
            </View>
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
              Phone number cannot be changed here. Contact support if needed.
            </Text>
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
