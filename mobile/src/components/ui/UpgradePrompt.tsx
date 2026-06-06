import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';

interface UpgradePromptProps {
  feature: string;
  requiredPlan: 'starter' | 'pro';
  description: string;
}

export function UpgradePrompt({ feature, requiredPlan, description }: UpgradePromptProps) {
  const { colors, fonts, spacing } = useTheme();
  const router = useRouter();
  const planLabel = requiredPlan === 'pro' ? 'Pro' : 'Starter';

  return (
    <View
      style={[
        styles.container,
        { borderColor: colors.gold, backgroundColor: `${colors.gold}18`, gap: spacing.sm },
      ]}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.sm }}>
        <Text style={{ fontSize: 20 }}>⭐</Text>
        <Text style={{ fontFamily: fonts.bodySemiBold }}>{feature}</Text>
      </View>
      <Text style={{ color: colors.muted }}>{description}</Text>
      <Button
        label={`Upgrade to ${planLabel}`}
        onPress={() => router.push('/owner/billing')}
        variant="gold"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 16,
  },
});
