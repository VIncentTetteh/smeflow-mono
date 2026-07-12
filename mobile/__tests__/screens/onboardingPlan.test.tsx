import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import PlanSelectionScreen from '../../app/(auth)/onboarding/plan';
import { useSelectPlan } from '@/api/hooks/featureHooks';
import { trackEvent } from '@/lib/analytics';

const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
}));

jest.mock('@/api/hooks/featureHooks', () => ({
  useSelectPlan: jest.fn(),
}));

jest.mock('@/lib/analytics', () => ({
  trackEvent: jest.fn(),
  MOBILE_ANALYTICS_EVENTS: { ONBOARDING_COMPLETED: 'onboarding_completed' },
}));

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      bg: '#faf8f3', surface: '#fff', border: '#e8e5de', brand: '#1f6a4f',
      ink: '#2a2a22', muted: '#6b6860', danger: '#d03514',
    },
    fonts: {
      body: 'Inter_400Regular', bodySemiBold: 'Inter_600SemiBold', displaySemiBold: 'SourceSerif4_600SemiBold',
    },
    radii: { md: 10 },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  }),
}));

const mockUseSelectPlan = useSelectPlan as jest.Mock;

describe('Plan selection onboarding step', () => {
  let selectMutate: jest.Mock;

  beforeEach(() => {
    mockReplace.mockReset();
    mockBack.mockReset();
    (trackEvent as jest.Mock).mockReset();
    selectMutate = jest.fn();
    mockUseSelectPlan.mockReturnValue({ mutate: selectMutate, isPending: false });
  });

  it('completes onboarding on the free plan without calling the plan-selection API', async () => {
    const { getByText } = render(<PlanSelectionScreen />);
    fireEvent.press(getByText('Start using SMEflow'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/owner'));
    expect(selectMutate).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith('onboarding_completed', { tier: 'free' });
  });

  it('selects a paid plan and calls the plan API, completing onboarding on success', async () => {
    selectMutate.mockImplementation((_vars, { onSuccess }: { onSuccess: () => void }) => onSuccess());
    const { getByText } = render(<PlanSelectionScreen />);
    fireEvent.press(getByText('Pro'));
    fireEvent.press(getByText('Start using SMEflow'));

    await waitFor(() => {
      expect(selectMutate).toHaveBeenCalledWith({ tier: 'pro' }, expect.anything());
    });
    expect(mockReplace).toHaveBeenCalledWith('/owner');
    expect(trackEvent).toHaveBeenCalledWith('onboarding_completed', { tier: 'pro' });
  });

  it('shows an error and does not complete onboarding if plan selection fails', async () => {
    selectMutate.mockImplementation((_vars, { onError }: { onError: (e: Error) => void }) =>
      onError(new Error('Payment method required for paid plans.'))
    );
    const { getByText } = render(<PlanSelectionScreen />);
    fireEvent.press(getByText('Starter'));
    fireEvent.press(getByText('Start using SMEflow'));

    await waitFor(() => expect(getByText('Payment method required for paid plans.')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
