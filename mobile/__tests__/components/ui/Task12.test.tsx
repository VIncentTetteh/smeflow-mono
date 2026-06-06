import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Modal, SnackBar } from '@/components/ui/Overlays';
import { ProviderChip, type PaymentProvider } from '@/components/ui/ProviderChip';
import { useSyncStore } from '@/store/sync';
import { useUIStore } from '@/store/ui';

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      brand: '#1f6a4f',
      border: '#e8e5de',
      danger: '#d03514',
      gold: '#e8c25a',
      ink: '#2a2a22',
      muted: '#6b6860',
      surface: '#fff',
      text: '#2a2a22',
    },
    fonts: {
      body: 'Inter_400Regular',
      bodySemiBold: 'Inter_600SemiBold',
      displaySemiBold: 'SourceSerif4_600SemiBold',
    },
    radii: { full: 999, lg: 16, md: 10 },
    spacing: { sm: 8, md: 16, lg: 24 },
  }),
}));

describe('OfflineBanner', () => {
  beforeEach(() => {
    useUIStore.setState({ isOffline: false });
    useSyncStore.setState({ pendingCount: 0 });
  });

  it('is hidden when online with no pending work', () => {
    const { queryByRole } = render(<OfflineBanner />);
    expect(queryByRole('alert')).toBeNull();
  });

  it('shows offline queue copy', () => {
    useUIStore.setState({ isOffline: true });
    useSyncStore.setState({ pendingCount: 1 });
    const { getByText } = render(<OfflineBanner />);
    expect(getByText('Offline mode. 1 action queued will sync when internet returns.')).toBeTruthy();
  });
});

describe('ProviderChip', () => {
  it('renders every provider label', () => {
    const providers: PaymentProvider[] = ['mtn', 'telecel', 'at', 'cash', 'ghqr'];
    const { getByText } = render(
      <>
        {providers.map((provider) => (
          <ProviderChip key={provider} provider={provider} />
        ))}
      </>
    );

    expect(getByText('MTN MoMo')).toBeTruthy();
    expect(getByText('Telecel Cash')).toBeTruthy();
    expect(getByText('AT Money')).toBeTruthy();
    expect(getByText('Cash')).toBeTruthy();
    expect(getByText('GhQR')).toBeTruthy();
  });

  it('returns the provider when pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(<ProviderChip provider="mtn" onPress={onPress} />);
    fireEvent.press(getByText('MTN MoMo'));
    expect(onPress).toHaveBeenCalledWith('mtn');
  });
});

describe('Overlays', () => {
  it('renders modal content and handles confirm', () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    const { getByText } = render(
      <Modal
        confirmLabel="Save"
        message="Confirm the action"
        onClose={onClose}
        onConfirm={onConfirm}
        title="Review"
        visible
      />
    );

    expect(getByText('Review')).toBeTruthy();
    fireEvent.press(getByText('Save'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders snackbar action', () => {
    const onAction = jest.fn();
    const { getByText } = render(
      <SnackBar actionLabel="Retry" message="Sync failed" onAction={onAction} visible />
    );

    fireEvent.press(getByText('Retry'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
