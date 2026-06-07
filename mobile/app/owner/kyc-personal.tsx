import { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { submitUserKyc } from '@/api/auth.api';
import { toApiErrorMessage } from '@/api/errors';
import { StyledTextInput } from '@/components/ui/Inputs';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';

function formatGhanaCard(value: string): string {
  const stripped = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (stripped.length <= 3) return stripped;
  if (stripped.length <= 12) return `${stripped.slice(0, 3)}-${stripped.slice(3)}`;
  return `${stripped.slice(0, 3)}-${stripped.slice(3, 12)}-${stripped.slice(12, 13)}`;
}

function validGhanaCard(value: string): boolean {
  return /^GHA-\d{9}-\d$/.test(value);
}

export default function KycPersonalScreen() {
  const router = useRouter();
  const { colors, fonts, spacing } = useTheme();

  const [ghanaCardId, setGhanaCardId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | undefined>();

  async function submit() {
    if (loading) return;
    if (!validGhanaCard(ghanaCardId)) {
      setCardError('Enter Ghana Card in the format GHA-123456789-0.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await submitUserKyc({ ghana_card_id: ghanaCardId });
      router.back();
    } catch (err) {
      setError(toApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
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
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink }}>
            Personal verification
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
            Submit your Ghana Card number
          </Text>
        </View>
      </View>

      <View style={{ flex: 1, padding: 16, gap: spacing.md }}>
        <View style={{ gap: 4 }}>
          <StyledTextInput
            autoCapitalize="characters"
            error={cardError}
            label="Ghana Card number"
            maxLength={15}
            onChangeText={(value) => {
              setGhanaCardId(formatGhanaCard(value));
              setCardError(undefined);
              setError(null);
            }}
            placeholder="GHA-123456789-0"
            value={ghanaCardId}
          />
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Format: GHA-XXXXXXXXX-X
          </Text>
        </View>

        {error ? <StatusMessage message={error} tone="error" /> : null}

        <Button
          label="Submit Ghana Card"
          loading={loading}
          onPress={submit}
          variant="primary"
        />
      </View>
    </SafeAreaView>
  );
}
