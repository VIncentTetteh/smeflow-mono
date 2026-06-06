import { buildInvoiceDraftFromSale, canGenerateInvoiceFromSale } from '@/features/saleInvoices';
import type { SaleResponseDto } from '@/types/sales';

const baseSale: SaleResponseDto = {
  id: 'sale-1',
  status: 'completed',
  payment_method: 'cash',
  subtotal: '120',
  tax_amount: '0',
  discount_amount: '0',
  total: '120',
  amount_paid: '120',
  balance_due: '0',
  notes: null,
  customer_id: 'customer-1',
  created_at: '2026-05-10T10:00:00Z',
  items: [
    {
      id: 'item-1',
      item_id: 'stock-1',
      description: 'Notebook',
      qty: '2',
      unit_price: '30',
      line_total: '60',
      vat_amount: '0',
    },
    {
      id: 'item-2',
      item_id: null,
      description: '',
      qty: '3',
      unit_price: '20',
      line_total: '60',
      vat_amount: '0',
    },
  ],
};

describe('sale invoice helpers', () => {
  it('builds a backend-aligned standalone invoice draft from sale line items', () => {
    expect(buildInvoiceDraftFromSale(baseSale)).toEqual({
      invoice_type: 'invoice',
      customer_name: null,
      line_items: [
        {
          description: 'Notebook',
          qty: '2',
          unit: null,
          unit_price: '30',
        },
        {
          description: 'Sale item',
          qty: '3',
          unit: null,
          unit_price: '20',
        },
      ],
    });
  });

  it('requires at least one sale item before invoice generation', () => {
    expect(canGenerateInvoiceFromSale(baseSale)).toBe(true);
    expect(canGenerateInvoiceFromSale({ ...baseSale, items: [] })).toBe(false);
  });
});
