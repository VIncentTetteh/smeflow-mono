import { buildItemPayload, buildItemUpdatePayload, buildSalePayload } from '@/db/sync/push';
import { mapServerItem, mapServerSale } from '@/db/sync/pull';

jest.mock('@/api/client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe('sync mappers', () => {
  it('maps server inventory items to local model attrs', () => {
    expect(
      mapServerItem({
        id: 'server-item-1',
        name: 'Tomatoes',
        cost_price: '8.50',
        sell_price: '12.00',
        current_stock: '15',
        low_stock_threshold: '4',
        sku: 'TOM-1',
        unit: 'kg',
      })
    ).toMatchObject({
      costPrice: 8.5,
      lowStockThreshold: 4,
      name: 'Tomatoes',
      sellPrice: 12,
      serverId: 'server-item-1',
      sku: 'TOM-1',
      stockQty: 15,
      synced: true,
      unit: 'kg',
    });
  });

  it('maps server sales to local model attrs', () => {
    expect(
      mapServerSale({
        id: 'sale-1',
        payment_method: 'cash',
        status: 'paid',
        total: '20.75',
      })
    ).toMatchObject({
      paymentMethod: 'cash',
      serverId: 'sale-1',
      status: 'paid',
      total: 20.75,
    });
  });

  it('builds create-item payloads for the backend', () => {
    expect(
      buildItemPayload({
        barcode: '123',
        categoryId: 'cat-1',
        costPrice: 5,
        lowStockThreshold: 2,
        name: 'Rice',
        sellPrice: 8,
        sku: 'RICE',
        stockQty: 10,
        unit: 'bag',
      })
    ).toMatchObject({
      barcode: '123',
      category_id: 'cat-1',
      cost_price: 5,
      initial_stock: 10,
      low_stock_threshold: 2,
      name: 'Rice',
      sell_price: 8,
      sku: 'RICE',
      unit: 'bag',
    });
  });

  it('builds update-item payloads without initial stock', () => {
    expect(
      buildItemUpdatePayload({
        barcode: '123',
        categoryId: 'cat-1',
        costPrice: 5,
        lowStockThreshold: 2,
        name: 'Rice',
        sellPrice: 8,
        sku: 'RICE',
        stockQty: 10,
        unit: 'bag',
      })
    ).toMatchObject({
      barcode: '123',
      category_id: 'cat-1',
      cost_price: 5,
      low_stock_threshold: 2,
      name: 'Rice',
      sell_price: 8,
      sku: 'RICE',
      unit: 'bag',
    });
    expect(
      buildItemUpdatePayload({
        costPrice: 5,
        lowStockThreshold: 2,
        name: 'Rice',
        sellPrice: 8,
        stockQty: 10,
      })
    ).not.toHaveProperty('initial_stock');
  });

  it('builds sale payloads with server item IDs when available', async () => {
    const mockDb = {
      get: (table: string) => {
        if (table === 'sale_items') {
          return {
            query: () => ({
              fetch: async () => [
                {
                  itemId: 'local-item-1',
                  itemName: 'Tomatoes',
                  qty: 2,
                  unitPrice: 6,
                },
              ],
            }),
          };
        }

        return {
          find: async () => ({ serverId: 'server-item-1' }),
        };
      },
    };

    await expect(
      buildSalePayload(mockDb as never, {
        id: 'sale-local-1',
        idempotencyKey: 'idem-1',
        paymentMethod: 'cash',
      })
    ).resolves.toMatchObject({
      idempotency_key: 'idem-1',
      items: [
        {
          discount: 0,
          item_id: 'server-item-1',
          qty: 2,
          unit_price: 6,
        },
      ],
      payment_method: 'cash',
    });
  });

  it('builds MoMo sale payloads using backend payment_method and customer phone', async () => {
    const mockDb = {
      get: (table: string) => {
        if (table === 'sale_items') {
          return {
            query: () => ({
              fetch: async () => [
                {
                  itemId: 'local-item-1',
                  itemName: 'Tomatoes',
                  qty: 2,
                  unitPrice: 6,
                },
              ],
            }),
          };
        }

        return {
          find: async () => ({ serverId: 'server-item-1' }),
        };
      },
    };

    await expect(
      buildSalePayload(mockDb as never, {
        customerPhone: '+233244333444',
        id: 'sale-local-1',
        idempotencyKey: 'idem-1',
        paymentMethod: 'momo',
      })
    ).resolves.toMatchObject({
      customer_phone: '+233244333444',
      idempotency_key: 'idem-1',
      payment_method: 'momo',
    });
  });

  it('builds mixed sale payloads with payment splits', async () => {
    const mockDb = {
      get: (table: string) => {
        if (table === 'sale_items') {
          return {
            query: () => ({
              fetch: async () => [
                {
                  itemId: 'local-item-1',
                  itemName: 'Tomatoes',
                  qty: 2,
                  unitPrice: 10,
                },
              ],
            }),
          };
        }

        return {
          find: async () => ({ serverId: 'server-item-1' }),
        };
      },
    };

    await expect(
      buildSalePayload(mockDb as never, {
        id: 'sale-local-1',
        idempotencyKey: 'idem-1',
        paymentMethod: 'mixed',
        paymentSplitsJson: JSON.stringify([
          { method: 'cash', amount: 8 },
          { method: 'momo', amount: 12, phone: '+233244333444' },
        ]),
      })
    ).resolves.toMatchObject({
      payment_method: 'mixed',
      payment_splits: [
        { method: 'cash', amount: 8 },
        { method: 'momo', amount: 12, phone: '+233244333444' },
      ],
    });
  });

  it('builds credit sale payloads with customer details', async () => {
    const mockDb = {
      get: (table: string) => {
        if (table === 'sale_items') {
          return {
            query: () => ({
              fetch: async () => [
                {
                  itemId: 'local-item-1',
                  itemName: 'Tomatoes',
                  qty: 1,
                  unitPrice: 10,
                },
              ],
            }),
          };
        }

        return {
          find: async () => ({ serverId: 'server-item-1' }),
        };
      },
    };

    await expect(
      buildSalePayload(mockDb as never, {
        customerName: 'Ama Owusu',
        customerPhone: '+233244333444',
        id: 'sale-local-1',
        idempotencyKey: 'idem-1',
        paymentMethod: 'credit',
      })
    ).resolves.toMatchObject({
      customer_name: 'Ama Owusu',
      customer_phone: '+233244333444',
      payment_method: 'credit',
    });
  });
});
