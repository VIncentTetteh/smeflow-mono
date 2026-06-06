import { buildSaleDraft, findItemByBarcode, nextCartForQuantityChange } from '@/features/sellCart';
import type { CartLine, LocalItem } from '@/features/localData';

const items = [
  {
    id: 'rice-local',
    serverId: 'rice-server',
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
  {
    id: 'oil-local',
    serverId: 'oil-server',
    name: 'Oil',
    sku: 'OIL',
    unit: 'bottle',
    barcode: null,
    sellPrice: 40,
    costPrice: 25,
    stockQty: 0,
    lowStockThreshold: 2,
    synced: true,
  },
] as LocalItem[];

describe('sell cart helpers', () => {
  it('adds scanned barcode matches from local inventory', () => {
    expect(findItemByBarcode(items, ' 6034000000012 ')?.id).toBe('rice-local');
  });

  it('caps quantity at available stock and reports the limit', () => {
    const result = nextCartForQuantityChange([], items, 'rice-local', 1);
    expect(result.cart).toEqual([{ item: items[0], qty: 1 }]);

    const capped = nextCartForQuantityChange(result.cart, items, 'rice-local', 5);
    expect(capped.cart[0].qty).toBe(2);
    expect(capped.reason).toBe('stock-limit');
  });

  it('does not add out-of-stock items', () => {
    const result = nextCartForQuantityChange([], items, 'oil-local', 1);
    expect(result.cart).toEqual([]);
    expect(result.reason).toBe('out-of-stock');
  });

  it('removes an item when quantity drops to zero', () => {
    const cart = [{ item: items[0], qty: 1 }] as CartLine[];
    expect(nextCartForQuantityChange(cart, items, 'rice-local', -1).cart).toEqual([]);
  });

  it('requires a customer for credit sales', () => {
    expect(() => buildSaleDraft({ mode: 'credit' })).toThrow('Customer name is required for credit sales.');
    expect(() => buildSaleDraft({ mode: 'credit', customerName: 'Ama Buyer' })).toThrow('valid Ghana phone number');
    expect(buildSaleDraft({ mode: 'credit', customerName: 'Ama Buyer', customerPhone: '0244333444', creditDueDate: '2099-01-01' })).toMatchObject({
      customerName: 'Ama Buyer',
      customerPhone: '+233244333444',
      creditDueDate: '2099-01-01',
      paymentMethod: 'credit',
    });
  });

  it('retires direct momo and keeps ghqr available for walk-in customers', () => {
    expect(() => buildSaleDraft({ mode: 'momo', customerPhone: '0244333444' })).toThrow('Direct MoMo RequestToPay is retired');
    expect(buildSaleDraft({ mode: 'ghqr' })).toMatchObject({
      notes: 'Payment method: GhQR',
      paymentMethod: 'ghqr',
    });
  });

  it('retires mixed direct momo payment drafts', () => {
    expect(() => buildSaleDraft({ mode: 'mixed' })).toThrow('Direct MoMo RequestToPay is retired');
  });
});
