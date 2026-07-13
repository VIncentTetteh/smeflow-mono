import React from 'react';
import { render } from '@testing-library/react-native';
import { Badge } from '@/components/ui/Badge';

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      brand: '#1f6a4f',
      danger: '#d03514',
      gold: '#e8c25a',
      info: '#5b6be5',
      ink: '#2a2a22',
      surface: '#fff',
      text: '#2a2a22',
    },
    fonts: { body: 'Inter_400Regular', bodySemiBold: 'Inter_600SemiBold' },
    radii: { full: 999 },
    spacing: { xs: 4, sm: 8 },
  }),
}));

describe('Badge', () => {
  it('renders the label for paid variant', () => {
    const { getByText } = render(<Badge variant="paid" label="Paid" />);
    expect(getByText('Paid')).toBeTruthy();
  });

  it('renders low-stock variant without crashing', () => {
    const { getByText } = render(<Badge variant="low-stock" label="Low stock" />);
    expect(getByText('Low stock')).toBeTruthy();
  });

  it('renders all 8 variants without crashing', () => {
    const variants: Array<NonNullable<React.ComponentProps<typeof Badge>['variant']>> = [
      'paid', 'pending', 'failed', 'synced', 'offline', 'low-stock', 'verified', 'draft'
    ];
    variants.forEach((v) => {
      const { getByText } = render(<Badge variant={v} label={v} />);
      expect(getByText(v)).toBeTruthy();
    });
  });
});
