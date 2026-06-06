jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReload = jest.fn();
const mockRecordSaleOnlineFirst = jest.fn();
const mockCreateMomoSaleIntentFromCart = jest.fn();
const mockVerifyMomoSaleIntent = jest.fn();
const mockCreatePaystackSaleIntentFromCart = jest.fn();
const mockVerifyPaystackSaleIntent = jest.fn();
const mockGenerateGhqrMutate = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => callback(),
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: true }, jest.fn().mockResolvedValue({ granted: true })],
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: unknown }) => (
      <View style={style}>{children}</View>
    ),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    MaterialCommunityIcons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

jest.mock('@/db/sync/service', () => ({
  syncNow: jest.fn().mockResolvedValue({ pulled: {}, pushed: {}, errors: [] }),
}));

jest.mock('@/api/hooks/featureHooks', () => ({
  useGenerateGhQR: () => ({
    mutate: mockGenerateGhqrMutate,
    reset: jest.fn(),
    data: { qr_image_url: 'https://example.com/manual-qr.png' },
    isPending: false,
  }),
  useInvoiceBySale: () => ({ data: null, isLoading: false }),
}));

jest.mock('@/features/onlineSales', () => ({
  createMomoSaleIntentFromCart: (...args: unknown[]) => mockCreateMomoSaleIntentFromCart(...args),
  createPaystackSaleIntentFromCart: (...args: unknown[]) => mockCreatePaystackSaleIntentFromCart(...args),
  recordSaleOnlineFirst: (...args: unknown[]) => mockRecordSaleOnlineFirst(...args),
  verifyMomoSaleIntent: (...args: unknown[]) => mockVerifyMomoSaleIntent(...args),
  verifyPaystackSaleIntent: (...args: unknown[]) => mockVerifyPaystackSaleIntent(...args),
}));

const mockItems = [
  {
    id: 'item-1',
    serverId: 'server-item-1',
    name: 'Rice 5kg',
    sku: 'RICE-5',
    unit: 'bag',
    barcode: '6034000000012',
    sellPrice: 120,
    costPrice: 80,
    stockQty: 2,
    lowStockThreshold: 1,
    synced: true,
  },
];

jest.mock('@/features/localData', () => ({
  useFilteredItems: (items: typeof mockItems, query: string, filter: string) => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'low' && item.stockQty > item.lowStockThreshold) return false;
      if (!normalized) return true;
      return [item.name, item.sku, item.barcode].some((value) =>
        String(value ?? '').toLowerCase().includes(normalized)
      );
    });
  },
  useLocalItems: () => ({ items: mockItems, loading: false, reload: mockReload }),
}));

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import SellScreen from '../../app/owner/sell';
import { useAuthStore } from '@/store/auth';

describe('sell screen pilot coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      business: { id: 'biz-1', name: 'Ama Shop', type: 'shop', tin: null },
    });
    mockRecordSaleOnlineFirst.mockResolvedValue({
      idempotencyKey: 'idem-1',
      mode: 'online',
      saleId: 'sale-1',
      total: 120,
    });
    mockCreateMomoSaleIntentFromCart.mockResolvedValue({
      paymentId: 'payment-1',
      providerMessage: 'Authorize on phone',
      saleId: null,
      status: 'pending',
      total: 120,
    });
    mockCreatePaystackSaleIntentFromCart.mockResolvedValue({
      paymentId: 'payment-paystack-1',
      paymentUrl: 'https://checkout.paystack.com/test',
      qrImageUrl: 'https://example.com/qr.png',
      status: 'pending',
      total: 120,
    });
    mockVerifyPaystackSaleIntent.mockResolvedValue({
      paymentId: 'payment-paystack-1',
      saleId: 'sale-paystack-1',
      status: 'success',
      total: 120,
      channel: 'mobile_money',
      providerDetail: 'mtn',
    });
  });

  it('keeps the merchant in-app while the customer pays with Paystack', async () => {
    const screen = render(<SellScreen />);
    fireEvent.press(screen.getByText('Add'));
    fireEvent.press(screen.getByText('Charge GH₵ 120.00'));
    expect(screen.queryByText('Send RequestToPay')).toBeNull();
    expect(screen.queryByText('MTN MoMo')).toBeNull();
    expect(screen.queryByText('Telecel Cash')).toBeNull();
    expect(screen.queryByText('AT Money')).toBeNull();
    fireEvent.press(screen.getByText('Online checkout'));
    expect(screen.getByText('Funds enter your Payments wallet after provider confirmation.')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText('Create Paystack payment')));
    await waitFor(() => {
      expect(mockCreatePaystackSaleIntentFromCart).toHaveBeenCalled();
      expect(screen.getByText('Share payment link')).toBeTruthy();
      expect(screen.getByText('Check payment now')).toBeTruthy();
    });

    await act(async () => fireEvent.press(screen.getByText('Check payment now')));
    await waitFor(() => {
      expect(screen.getByText('Sale recorded')).toBeTruthy();
      expect(screen.getByText('Provider-confirmed funds move to Payments wallet.')).toBeTruthy();
    });
  });

  it('adds/removes cart items and records a cash sale receipt', async () => {
    const screen = render(<SellScreen />);

    fireEvent.press(screen.getByText('Add'));
    expect(screen.getByText('Charge GH₵ 120.00')).toBeTruthy();

    fireEvent.press(screen.getByText('minus'));
    expect(screen.getByText('Add items below to start a sale.')).toBeTruthy();

    fireEvent.press(screen.getByText('Add'));
    fireEvent.press(screen.getByText('Charge GH₵ 120.00'));
    await act(async () => {
      fireEvent.press(screen.getByText('Cash'));
    });

    await waitFor(() => {
      expect(mockRecordSaleOnlineFirst).toHaveBeenCalledWith(
        [expect.objectContaining({ qty: 1 })],
        expect.objectContaining({ paymentMethod: 'cash' })
      );
      expect(screen.getByText('Sale recorded')).toBeTruthy();
    });
  });

  it('keeps customer phone optional without showing direct MoMo network choices', async () => {
    const screen = render(<SellScreen />);

    fireEvent.press(screen.getByText('Add'));
    fireEvent.press(screen.getByText('Charge GH₵ 120.00'));
    expect(screen.queryByPlaceholderText('Customer phone (optional)')).toBeNull();
    fireEvent.press(screen.getByText('Add customer details'));
    expect(screen.getByPlaceholderText('Customer phone (optional)')).toBeTruthy();
    expect(screen.queryByText('Send RequestToPay')).toBeNull();
    expect(screen.queryByText('MTN MoMo')).toBeNull();
  });

  it('labels manual QR as a sale-only payment path', async () => {
    mockGenerateGhqrMutate.mockImplementation((_body, options) => options?.onSuccess?.());
    const screen = render(<SellScreen />);

    fireEvent.press(screen.getByText('Add'));
    fireEvent.press(screen.getByText('Charge GH₵ 120.00'));

    expect(screen.getByText('Online checkout')).toBeTruthy();
    expect(screen.getByText('Adds to payout wallet after confirmation')).toBeTruthy();
    expect(screen.getByText('Manual QR')).toBeTruthy();
    expect(screen.getByText('Records sale only')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('Manual QR'));
    });

    expect(screen.getByText('Manual QR payment')).toBeTruthy();
    expect(screen.getByText('This records the sale only. It will not enter payout balance unless a provider confirmation is received.')).toBeTruthy();
    expect(screen.getByText('Payment confirmed manually — record sale')).toBeTruthy();
  });
});
