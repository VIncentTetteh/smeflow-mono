import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import BusinessScreen from '../../app/(auth)/onboarding/business';
import { createBusiness } from '@/api/business.api';
import { useAuthStore } from '@/store/auth';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock('@/api/business.api', () => ({
  createBusiness: jest.fn(),
}));

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      bg: '#faf8f3',
      surface: '#fff',
      border: '#e8e5de',
      brand: '#1f6a4f',
      ink: '#2a2a22',
      muted: '#6b6860',
      danger: '#d03514',
    },
    fonts: {
      body: 'Inter_400Regular',
      bodySemiBold: 'Inter_600SemiBold',
      displaySemiBold: 'SourceSerif4_600SemiBold',
    },
    radii: { md: 10 },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  }),
}));

describe('business onboarding Ghana market fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      accessToken: 'token',
      role: 'owner',
      businessId: null,
    });
    (createBusiness as jest.Mock).mockResolvedValue({
      access_token: 'business-token',
      business: { id: 'business-1' },
    });
  });

  it('submits Ghana market metadata with the business profile', async () => {
    const screen = render(<BusinessScreen />);

    fireEvent.changeText(screen.getByPlaceholderText("Akosua's Provisions"), 'Akosua Stores');
    fireEvent.press(screen.getByText('Provision store'));
    fireEvent.changeText(screen.getByPlaceholderText('Greater Accra'), 'Ashanti');
    fireEvent.changeText(screen.getByPlaceholderText('Madina Market, Accra'), 'Kejetia Market, Kumasi');
    fireEvent.press(screen.getByText('Twi'));
    fireEvent.press(screen.getByText('Not VAT registered'));
    fireEvent.press(screen.getByText(/Continue/));

    await waitFor(() => {
      expect(createBusiness).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Akosua Stores',
          type: 'shop',
          region: 'Ashanti',
          market: 'Kejetia Market, Kumasi',
          preferred_language: 'tw',
          momo_provider: 'mtn',
          tax_vat_status: 'not_registered',
          template_slug: 'provision_store',
        })
      );
    });
  });
});
