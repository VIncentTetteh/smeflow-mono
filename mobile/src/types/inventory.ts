import type { DecimalString, ISODateTime, UUID } from './common';

export type StockAdjustReason = 'purchase' | 'damage' | 'adjustment' | 'transfer' | 'return';

export interface ItemCreateDto {
  name: string;
  unit: string;
  cost_price?: DecimalString;
  sell_price: DecimalString;
  initial_stock?: DecimalString;
  low_stock_threshold?: DecimalString;
  category_id?: UUID | null;
  sku?: string;
  barcode?: string;
}

export interface ItemUpdateDto {
  name?: string;
  unit?: string;
  cost_price?: DecimalString;
  sell_price?: DecimalString;
  low_stock_threshold?: DecimalString;
  category_id?: UUID | null;
  sku?: string;
  barcode?: string;
  is_active?: boolean;
}

export interface ItemResponseDto {
  id: UUID;
  name: string;
  unit: string;
  cost_price: DecimalString;
  sell_price: DecimalString;
  current_stock: DecimalString;
  low_stock_threshold: DecimalString;
  sku: string | null;
  barcode: string | null;
  is_active: boolean;
  category_id: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  is_low_stock: boolean;
}

export interface StockAdjustmentDto {
  item_id: UUID;
  qty_change: DecimalString;
  reason: StockAdjustReason;
  unit_cost?: DecimalString;
  notes?: string;
  client_created_at?: ISODateTime;
}

export interface StockAdjustmentResponseDto {
  id: UUID;
  item_id: UUID;
  type: string;
  qty_change: DecimalString;
  qty_before: DecimalString;
  qty_after: DecimalString;
  notes: string | null;
  created_at: ISODateTime;
}

export interface ItemDetailResponseDto extends ItemResponseDto {
  stock_history: StockAdjustmentResponseDto[];
}

export interface CategoryCreateDto {
  name: string;
}

export interface CategoryResponseDto {
  id: UUID;
  name: string;
  created_at: ISODateTime;
}

export interface PaginatedItemsDto {
  items: ItemResponseDto[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface BulkItemsPayloadDto {
  items: ItemCreateDto[];
}

export interface BulkImportResultDto {
  total: number;
  created: number;
  failed: number;
  errors: Array<{ row?: number; message?: string; field?: string }>;
  job_id?: string | null;
}

export interface BatchLookupRequestDto {
  barcodes?: string[];
  skus?: string[];
}

export interface ItemLookupResultDto {
  query: string;
  query_type: 'barcode' | 'sku';
  found: boolean;
  item: ItemResponseDto | null;
  error: string | null;
}

export interface BatchLookupResponseDto {
  total_queried: number;
  found: number;
  not_found: number;
  results: ItemLookupResultDto[];
}

export interface SupplierDto {
  id: UUID;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  created_at?: ISODateTime;
}

export interface CreateSupplierDto {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface POLineItemDto {
  id?: UUID;
  item_id: UUID;
  name?: string;
  qty: number;
  qty_received?: number;
  cost_price: number;
}

export interface PurchaseOrderDto {
  id: UUID;
  po_number?: string;
  supplier_id: UUID;
  supplier_name?: string;
  status: 'draft' | 'ordered' | 'submitted' | 'partially_received' | 'received' | 'cancelled';
  total?: number;
  expected_delivery_date?: string;
  reference_number?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
  line_items?: POLineItemDto[];
  created_at?: ISODateTime;
  received_at?: ISODateTime | null;
}

export interface CreatePurchaseOrderDto {
  supplier_id: string;
  expected_delivery_date: string;
  line_items: Array<{ item_id: string; qty: number; cost_price: number }>;
  reference_number?: string;
  payment_terms?: string;
  notes?: string;
}
