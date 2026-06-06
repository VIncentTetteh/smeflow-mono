jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import MockAdapter from 'axios-mock-adapter';
import { apiClient } from '@/api/client';
import OnboardScreen from '../../app/agent/onboard';

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
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
      text: '#2a2a22',
    },
    fonts: {
      body: 'Inter_400Regular',
      bodySemiBold: 'Inter_600SemiBold',
      displaySemiBold: 'SourceSerif4_600SemiBold',
    },
    radii: { md: 10 },
    spacing: { sm: 8, md: 16 },
  }),
}));

const mock = new MockAdapter(apiClient);

describe('agent onboarding phone normalization', () => {
  beforeEach(() => {
    mock.reset();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes 0-prefixed owner and +233 wallet phones before submitting', async () => {
    mock.onPost('/api/v1/agents/onboarding/start').reply(200, { user_id: 'user-1' });
    mock.onPost('/api/v1/agents/onboarding/business').reply(200, { business_id: 'biz-1' });
    mock.onPost('/api/v1/agents/onboarding/business/biz-1/wallet').reply(200, { id: 'wallet-1' });
    mock.onPost('/api/v1/agents/onboarding/business/biz-1/complete').reply(200, { ok: true });

    const { getByLabelText, getAllByLabelText, getByText } = render(<OnboardScreen />);

    fireEvent.changeText(getByLabelText('Business name'), 'Akosua Trading');
    fireEvent.changeText(getByLabelText('Owner name'), 'Akosua Mensah');
    fireEvent.changeText(getAllByLabelText('Ghana phone number')[0], '0244123456');
    fireEvent.changeText(getAllByLabelText('Ghana phone number')[1], '+233 24 412 3456');

    fireEvent.press(getByText('Start onboarding'));

    await waitFor(() => {
      expect(mock.history.post).toHaveLength(4);
    });
    expect(JSON.parse(mock.history.post[0].data)).toMatchObject({
      phone: '+233244123456',
      name: 'Akosua Mensah',
    });
    expect(JSON.parse(mock.history.post[2].data)).toMatchObject({
      phone: '+233244123456',
    });
  });

  it('blocks submission when an optional wallet phone is invalid', async () => {
    const { getByLabelText, getAllByLabelText, getByText } = render(<OnboardScreen />);

    fireEvent.changeText(getByLabelText('Business name'), 'Akosua Trading');
    fireEvent.changeText(getByLabelText('Owner name'), 'Akosua Mensah');
    fireEvent.changeText(getAllByLabelText('Ghana phone number')[0], '244123456');
    fireEvent.changeText(getAllByLabelText('Ghana phone number')[1], '1234');

    fireEvent.press(getByText('Start onboarding'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Invalid wallet phone',
        'Enter a valid Ghana phone number for the MoMo wallet, or leave it blank to use the owner phone.'
      );
    });
    expect(mock.history.post).toHaveLength(0);
  });
});
