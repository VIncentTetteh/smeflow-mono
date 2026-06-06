export type SyncTable =
  | 'items'
  | 'item_categories'
  | 'sales'
  | 'sale_items'
  | 'customers'
  | 'stock_transactions';

export interface SyncResult {
  pulled: Partial<Record<SyncTable, number>>;
  pushed: Partial<Record<SyncTable, number>>;
  errors: Array<{ table: SyncTable; message: string }>;
}

export interface ServerItem {
  id: string;
  sku?: string | null;
  name: string;
  unit?: string | null;
  cost_price?: string | number | null;
  sell_price?: string | number | null;
  current_stock?: string | number | null;
  stock_qty?: string | number | null;
  low_stock_threshold?: string | number | null;
  barcode?: string | null;
  category_id?: string | null;
  updated_at?: string;
}

export interface ServerCategory {
  id: string;
  name: string;
  updated_at?: string;
}

export interface ServerSaleItem {
  id?: string;
  item_id?: string | null;
  description?: string | null;
  qty: string | number;
  unit_price: string | number;
}

export interface ServerSale {
  id: string;
  status: string;
  payment_method: string;
  total: string | number;
  customer_id?: string | null;
  items?: ServerSaleItem[];
  updated_at?: string;
}

export interface ServerCustomer {
  id: string;
  name: string;
  phone?: string | null;
  tin?: string | null;
  updated_at?: string;
}
