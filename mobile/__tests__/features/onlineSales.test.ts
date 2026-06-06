import { apiClient } from '@/api/client';
import { syncNow } from '@/db/sync/service';
import { buildOnlineSalePayload, createPaystackSaleIntentFromCart, recordSaleOnlineFirst } from '@/features/onlineSales';
import { recordOfflineSale } from '@/features/localData';
import { getTrackedEventsForTest, resetTrackedEventsForTest } from '@/lib/analytics';

jest.mock('@/api/client', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

jest.mock('@/db/sync/service', () => ({
  syncNow: jest.fn(),
}));

jest.mock('@/features/localData', () => ({
  recordOfflineSale: jest.fn(),
}));

const cart = [
  {
    item: {
      id: 'local-item-1',
      serverId: 'server-item-1',
      name: 'Tomatoes',
      sku: 'TOM-1',
      unit: 'kg',
      sellPrice: 12,
      costPrice: 8,
      stockQty: 50,
      lowStockThreshold: 5,
      synced: true,
    },
    qty: 2,
  },
];

describe('online-first sales', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTrackedEventsForTest();
  });

  it('builds backend-compatible sale payloads from the cart', () => {
    expect(
      buildOnlineSalePayload(
        cart,
        {
          customerPhone: '+233244333444',
          paymentMethod: 'momo',
          paymentProvider: 'telecel',
        },
        'idem-1'
      )
    ).toMatchObject({
      customer_phone: '+233244333444',
      idempotency_key: 'idem-1',
      items: [{ item_id: 'server-item-1', qty: 2, unit_price: '12.00' }],
      payment_method: 'momo',
      payment_provider: 'telecel',
    });
  });

  it('builds mixed payment payloads with formatted split amounts and customer phone', () => {
    expect(
      buildOnlineSalePayload(
        cart,
        {
          customerName: 'Ama Buyer',
          customerPhone: '+233244333444',
          paymentMethod: 'mixed',
          paymentProvider: 'mtn',
          paymentSplits: [
            { method: 'cash', amount: 10 },
            { method: 'momo', amount: 14, phone: '+233244333444' },
          ],
        },
        'idem-mixed-1'
      )
    ).toMatchObject({
      customer_name: 'Ama Buyer',
      customer_phone: '+233244333444',
      idempotency_key: 'idem-mixed-1',
      payment_method: 'mixed',
      payment_provider: 'mtn',
      payment_splits: [
        { method: 'cash', amount: '10.00' },
        { method: 'momo', amount: '14.00', phone: '+233244333444' },
      ],
    });
  });

  it('records the sale online first and starts sync refresh', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        balance_due: '0.00',
        invoice_id: 'invoice-1',
        payment_request_id: null,
        sale_id: 'sale-1',
        total: '24.00',
      },
    });

    await expect(recordSaleOnlineFirst(cart, { paymentMethod: 'cash' })).resolves.toMatchObject({
      invoiceId: 'invoice-1',
      mode: 'online',
      saleId: 'sale-1',
      total: 24,
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/sales/record',
      expect.objectContaining({
        items: [expect.objectContaining({ item_id: 'server-item-1' })],
        payment_method: 'cash',
      })
    );
    expect(recordOfflineSale).not.toHaveBeenCalled();
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(getTrackedEventsForTest()).toEqual([
      expect.objectContaining({
        name: 'first_sale_recorded',
        properties: expect.objectContaining({
          mode: 'online',
          paymentMethod: 'cash',
        }),
      }),
    ]);
  });

  it('queues offline only when the online path cannot be reached', async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(new Error('Network Error'));
    (recordOfflineSale as jest.Mock).mockResolvedValue({
      id: 'local-sale-1',
      idempotencyKey: 'local-idem-1',
      total: 24,
    });

    await expect(recordSaleOnlineFirst(cart, { paymentMethod: 'cash' })).resolves.toMatchObject({
      balanceDue: 0,
      idempotencyKey: 'local-idem-1',
      mode: 'offline',
      saleId: 'local-sale-1',
      total: 24,
    });
    expect(getTrackedEventsForTest()).toEqual([
      expect.objectContaining({
        name: 'first_sale_recorded',
        properties: expect.objectContaining({
          mode: 'offline',
          paymentMethod: 'cash',
        }),
      }),
    ]);
  });

  it('does not hide backend validation errors behind offline fallback', async () => {
    (apiClient.post as jest.Mock).mockRejectedValue({
      response: { status: 422 },
    });

    await expect(recordSaleOnlineFirst(cart, { paymentMethod: 'cash' })).rejects.toMatchObject({
      response: { status: 422 },
    });
    expect(recordOfflineSale).not.toHaveBeenCalled();
  });

  it('does not allow MoMo sales through the offline sale recorder', async () => {
    await expect(recordSaleOnlineFirst(cart, { paymentMethod: 'momo' })).rejects.toThrow(
      'MoMo sales must use the verified Paystack prompt flow.'
    );
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(recordOfflineSale).not.toHaveBeenCalled();
  });

  it('creates a Paystack checkout intent for any enabled customer channel', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: {
        payment_id: 'payment-paystack-1',
        external_ref: 'ps-ref',
        status: 'pending',
        total: '24.00',
        payment_url: 'https://checkout.paystack.com/test',
        qr_image_url: 'https://example.com/qr.png',
      },
    });
    await expect(
      createPaystackSaleIntentFromCart(cart, { paymentMethod: 'paystack' })
    ).resolves.toMatchObject({
      paymentId: 'payment-paystack-1',
      paymentUrl: 'https://checkout.paystack.com/test',
      qrImageUrl: 'https://example.com/qr.png',
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/sales/payment-intents',
      expect.objectContaining({ payment_method: 'paystack' })
    );
  });

});
