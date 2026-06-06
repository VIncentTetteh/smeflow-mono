import { Text as RNText, type TextStyle, type TextProps } from 'react-native';
import { useTheme } from '@/lib/theme';

interface StyledTextProps extends TextProps {
  style?: TextStyle;
}

export function Text({ style, children, ...props }: StyledTextProps) {
  const { colors, fonts } = useTheme();
  return (
    <RNText
      style={[{ fontFamily: fonts.body, color: colors.text, fontSize: 14 }, style]}
      {...props}
    >
      {children}
    </RNText>
  );
}

export function Heading({ style, children, ...props }: StyledTextProps) {
  const { colors, fonts } = useTheme();
  return (
    <RNText
      style={[{ fontFamily: fonts.displaySemiBold, color: colors.text, fontSize: 28 }, style]}
      {...props}
    >
      {children}
    </RNText>
  );
}

export function MonoText({ style, children, ...props }: StyledTextProps) {
  const { colors, fonts } = useTheme();
  return (
    <RNText
      style={[{ fontFamily: fonts.mono, color: colors.text, fontSize: 13 }, style]}
      {...props}
    >
      {children}
    </RNText>
  );
}
