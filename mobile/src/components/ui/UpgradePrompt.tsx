import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';

interface UpgradePromptProps {
  feature: string;
  requiredPlan: 'starter' | 'pro';
  description: string;
  fullScreen?: boolean;
}

export function UpgradePrompt({ feature, requiredPlan, description, fullScreen = false }: UpgradePromptProps) {
  const { colors, fonts, spacing } = useTheme();
  const router = useRouter();
  const planLabel = requiredPlan === 'pro' ? 'Pro' : 'Starter';

  if (fullScreen) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <Text style={{ fontSize: 52 }}>⭐</Text>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink, textAlign: 'center' }}>
          {feature}
        </Text>
        <Text style={{ color: colors.muted, textAlign: 'center', fontSize: 15, lineHeight: 22 }}>
          {description}
        </Text>
        <View style={{ width: '100%', marginTop: 8 }}>
          <Button
            label={`Upgrade to ${planLabel}`}
            onPress={() => router.push('/owner/billing')}
            variant="gold"
          />
        </View>
      </View>
    );
  }

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
