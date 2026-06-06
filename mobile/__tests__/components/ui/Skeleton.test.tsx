import React from 'react';
import { render } from '@testing-library/react-native';
import { Skeleton, CardSkeleton } from '@/components/ui/Skeleton';

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: { border: '#e8e5de', brand: '#1f6a4f' },
    spacing: { xs: 4, sm: 8, md: 16 },
    fonts: {},
    radii: {},
  }),
}));

describe('Skeleton', () => {
  it('renders without crashing', () => {
    render(<Skeleton />);
  });

  it('accepts and forwards testID', () => {
    const { getByTestId } = render(<Skeleton testID="skeleton-bar" />);
    expect(getByTestId('skeleton-bar')).toBeTruthy();
  });

  it('renders with custom dimensions', () => {
    render(<Skeleton width="60%" height={24} borderRadius={8} />);
  });

  it('CardSkeleton renders without crashing', () => {
    render(<CardSkeleton />);
  });
});
