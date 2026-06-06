import { Card } from './Card';
import { Text } from './Text';
import { useTheme } from '@/lib/theme';

interface StatusMessageProps {
  title?: string;
  message: string;
  tone?: 'error' | 'info' | 'success';
}

export function StatusMessage({ title, message, tone = 'info' }: StatusMessageProps) {
  const { colors, fonts, spacing } = useTheme();
  const toneColor =
    tone === 'error' ? colors.danger : tone === 'success' ? colors.brand : colors.info;

  return (
    <Card
      style={{
        backgroundColor: `${toneColor}12`,
        borderColor: `${toneColor}44`,
        gap: spacing.xs,
        shadowOpacity: 0,
      }}
    >
      {title ? (
        <Text style={{ color: toneColor, fontFamily: fonts.bodySemiBold }}>{title}</Text>
      ) : null}
      <Text style={{ color: colors.text }}>{message}</Text>
    </Card>
  );
}
