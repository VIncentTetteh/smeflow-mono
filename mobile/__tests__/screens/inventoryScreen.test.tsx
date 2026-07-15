jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

const mockReload = jest.fn();
const mockCreateItemMutate = jest.fn();
const mockAdjustStockMutate = jest.fn();
const mockMutation = jest.fn();
const mockRefetch = jest.fn();
let mockBarcodeCallback: ((result: { data: string }) => void) | undefined;

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => callback(),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

jest.mock('expo-camera', () => ({
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned?: (result: { data: string }) => void }) => {
    mockBarcodeCallback = onBarcodeScanned;
    return null;
  },
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
    stockQty: 12,
    lowStockThreshold: 3,
    synced: true,
  },
  {
    id: 'item-2',
    serverId: 'server-item-2',
    name: 'Tomatoes',
    sku: 'TOM-1',
    unit: 'kg',
    barcode: '6034000000099',
    sellPrice: 10,
    costPrice: 7,
    stockQty: 1,
    lowStockThreshold: 3,
    synced: true,
  },
];

jest.mock('@/features/localData', () => ({
  useLocalItems: () => ({ items: mockItems, loading: false, reload: mockReload }),
}));

jest.mock('@/db/sync/service', () => ({
  syncNow: jest.fn().mockResolvedValue({ pulled: {}, pushed: {}, errors: [] }),
}));

jest.mock('@/api/hooks/featureHooks', () => ({
  useAdjustStock: () => ({ isPending: false, mutate: mockAdjustStockMutate }),
  useCreateItem: () => ({ isPending: false, mutate: mockCreateItemMutate }),
  useCreatePurchaseOrder: () => ({ isPending: false, mutate: mockMutation }),
  useCreateSupplier: () => ({ isPending: false, mutate: mockMutation }),
  useDeleteSupplier: () => ({ isPending: false, mutate: mockMutation }),
  useInventoryItems: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  usePurchaseOrders: () => ({ data: [], isLoading: false, isError: false, refetch: mockRefetch }),
  useReceivePurchaseOrder: () => ({ isPending: false, mutateAsync: mockMutation }),
  useSalesHistory: () => ({ data: [] }),
  useSuppliers: () => ({
    data: [{ id: 'supplier-1', name: 'Akosua Wholesale', phone: '0244000000' }],
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }),
  useThresholdSuggestion: () => ({ isPending: false, mutate: mockMutation }),
  useTopItems: () => ({ data: [], isLoading: false, isError: false, refetch: mockRefetch }),
  useUpdateItem: () => ({ isPending: false, mutate: mockMutation }),
  useUpdateSupplier: () => ({ isPending: false, mutate: mockMutation }),
}));

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import InventoryScreen from '../../app/owner/inventory';

describe('inventory screen pilot coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBarcodeCallback = undefined;
  });

  it('searches by SKU/barcode and filters low-stock items', () => {
    const screen = render(<InventoryScreen />);

    expect(screen.getByText('2 items · 1 low')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText('Search items, SKU, barcode'), 'RICE-5');
    expect(screen.getByText('Rice 5kg')).toBeTruthy();
    expect(screen.queryByText('Tomatoes')).toBeNull();

    fireEvent.changeText(screen.getByPlaceholderText('Search items, SKU, barcode'), '');
    fireEvent.press(screen.getByText('Low stock'));
    expect(screen.getByText('Tomatoes')).toBeTruthy();
    expect(screen.queryByText('Rice 5kg')).toBeNull();
  });

  it('uses a section switch for suppliers and purchase orders while quick chips stay item-focused', () => {
    const screen = render(<InventoryScreen />);

    expect(screen.getByText('Rice 5kg')).toBeTruthy();
    expect(screen.getByText('Items')).toBeTruthy();
    expect(screen.getByText('Orders')).toBeTruthy();
    expect(screen.queryByText('Categories')).toBeNull();
    expect(screen.getByText('Add item')).toBeTruthy();

    fireEvent.press(screen.getByText('Suppliers'));
    expect(screen.getByText('Add supplier')).toBeTruthy();
    expect(screen.getByText('Akosua Wholesale')).toBeTruthy();
    expect(screen.queryByText('Rice 5kg')).toBeNull();

    fireEvent.press(screen.getByText('Orders'));
    expect(screen.getByText('Create PO')).toBeTruthy();
    expect(screen.getByText('No purchase orders yet')).toBeTruthy();
    expect(screen.queryByText('Rice 5kg')).toBeNull();
    expect(screen.queryByText('Akosua Wholesale')).toBeNull();

    fireEvent.press(screen.getByText('Items'));
    expect(screen.getByText('Rice 5kg')).toBeTruthy();
  });

  it('submits add-item payloads with barcode and stock fields', async () => {
    const screen = render(<InventoryScreen />);

    fireEvent.press(screen.getAllByText('plus')[0]);
    fireEvent.changeText(screen.getByPlaceholderText('Indomie Chicken 70g'), 'Indomie Chicken 70g');
    fireEvent.changeText(screen.getByPlaceholderText('piece'), 'piece');
    fireEvent.changeText(screen.getByPlaceholderText('SKU-001'), 'IND-70');
    fireEvent.changeText(screen.getByPlaceholderText('3.50'), '4.50');
    fireEvent.changeText(screen.getByPlaceholderText('2.00'), '3.10');
    fireEvent.changeText(screen.getByPlaceholderText('50'), '24');
    fireEvent.changeText(screen.getByPlaceholderText('Scan or type barcode'), '6034000000015');
    fireEvent.press(screen.getByText('Add to inventory'));

    await waitFor(() => {
      expect(mockCreateItemMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          barcode: '6034000000015',
          cost_price: 3.1,
          initial_stock: 24,
          name: 'Indomie Chicken 70g',
          sell_price: 4.5,
          sku: 'IND-70',
          unit: 'piece',
        }),
        expect.any(Object)
      );
    });
  });

  it('opens item detail and records restock adjustment with purchase reason', async () => {
    const screen = render(<InventoryScreen />);

    fireEvent.press(screen.getByText('Tomatoes'));
    expect(screen.getByText('Restock now')).toBeTruthy();

    fireEvent.press(screen.getByText('Restock now'));
    fireEvent.changeText(screen.getByPlaceholderText('24'), '8');
    fireEvent.press(screen.getByText('Confirm Restock'));

    await waitFor(() => {
      expect(mockAdjustStockMutate).toHaveBeenCalledWith(
        { item_id: 'item-2', qty_change: 8, reason: 'purchase' },
        expect.any(Object)
      );
    });
  });

  it('attaches scanned barcode to the add-item form', async () => {
    const screen = render(<InventoryScreen />);

    fireEvent.press(screen.getAllByText('plus')[0]);
    fireEvent.press(screen.getByText('barcode-scan'));

    await waitFor(() => expect(mockBarcodeCallback).toBeTruthy());
    act(() => {
      mockBarcodeCallback?.({ data: '6034000000020' });
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('6034000000020')).toBeTruthy();
    });
  });
});
