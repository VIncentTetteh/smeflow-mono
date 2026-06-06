import type { StandaloneInvoiceCreateDto } from '@/types/invoices';
import type { SaleResponseDto } from '@/types/sales';

export function canGenerateInvoiceFromSale(sale?: SaleResponseDto | null): boolean {
  return Boolean(sale?.items?.length);
}

export function buildInvoiceDraftFromSale(sale: SaleResponseDto): StandaloneInvoiceCreateDto {
  return {
    invoice_type: 'invoice',
    customer_name: null,
    line_items: sale.items.map((item) => ({
      description: item.description?.trim() || 'Sale item',
      qty: item.qty,
      unit: null,
      unit_price: item.unit_price,
    })),
  };
}
