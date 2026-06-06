import { apiClient } from './client';
import type {
  BatchLookupRequestDto,
  BatchLookupResponseDto,
  BulkImportResultDto,
  BulkItemsPayloadDto,
  CategoryCreateDto,
  CategoryResponseDto,
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  ItemCreateDto,
  ItemDetailResponseDto,
  ItemResponseDto,
  ItemUpdateDto,
  PaginatedItemsDto,
  PurchaseOrderDto,
  StockAdjustmentDto,
  StockAdjustmentResponseDto,
  SupplierDto,
} from '@/types/inventory';

export interface ItemListParams {
  page?: number;
  page_size?: number;
  search?: string;
  category_id?: string;
  low_stock?: boolean;
  changed_since?: string;
}

export async function createItem(body: ItemCreateDto): Promise<ItemResponseDto> {
  const response = await apiClient.post<ItemResponseDto>('/api/v1/inventory/items', body);
  return response.data;
}

export async function bulkImportItems(body: BulkItemsPayloadDto): Promise<BulkImportResultDto> {
  const response = await apiClient.post<BulkImportResultDto>('/api/v1/inventory/items/bulk', body);
  return response.data;
}

export async function listItems(params?: ItemListParams): Promise<PaginatedItemsDto> {
  const response = await apiClient.get<PaginatedItemsDto>('/api/v1/inventory/items', { params });
  return response.data;
}

export async function lookupItem(params: { barcode?: string; sku?: string }): Promise<ItemResponseDto> {
  const response = await apiClient.get<ItemResponseDto>('/api/v1/inventory/items/lookup', {
    params,
  });
  return response.data;
}

export async function batchLookupItems(
  body: BatchLookupRequestDto
): Promise<BatchLookupResponseDto> {
  const response = await apiClient.post<BatchLookupResponseDto>(
    '/api/v1/inventory/items/lookup/batch',
    body
  );
  return response.data;
}

export async function getItem(itemId: string): Promise<ItemDetailResponseDto> {
  const response = await apiClient.get<ItemDetailResponseDto>(`/api/v1/inventory/items/${itemId}`);
  return response.data;
}

export async function updateItem(itemId: string, body: ItemUpdateDto): Promise<ItemResponseDto> {
  const response = await apiClient.patch<ItemResponseDto>(
    `/api/v1/inventory/items/${itemId}`,
    body
  );
  return response.data;
}

export async function deleteItem(itemId: string): Promise<void> {
  await apiClient.delete(`/api/v1/inventory/items/${itemId}`);
}

export async function adjustStock(
  body: StockAdjustmentDto
): Promise<StockAdjustmentResponseDto> {
  const response = await apiClient.post<StockAdjustmentResponseDto>(
    '/api/v1/inventory/adjust',
    body
  );
  return response.data;
}

export async function listCategories(): Promise<CategoryResponseDto[]> {
  const response = await apiClient.get<CategoryResponseDto[]>('/api/v1/inventory/categories');
  return response.data;
}

export async function createCategory(body: CategoryCreateDto): Promise<CategoryResponseDto> {
  const response = await apiClient.post<CategoryResponseDto>('/api/v1/inventory/categories', body);
  return response.data;
}

export async function listSuppliers(): Promise<SupplierDto[]> {
  const response = await apiClient.get<SupplierDto[]>('/api/v1/inventory/suppliers');
  return response.data;
}

export async function createSupplier(body: CreateSupplierDto): Promise<SupplierDto> {
  const response = await apiClient.post<SupplierDto>('/api/v1/inventory/suppliers', body);
  return response.data;
}

export async function updateSupplier(
  supplierId: string,
  body: Partial<CreateSupplierDto>
): Promise<SupplierDto> {
  const response = await apiClient.patch<SupplierDto>(
    `/api/v1/inventory/suppliers/${supplierId}`,
    body
  );
  return response.data;
}

export async function deleteSupplier(supplierId: string): Promise<void> {
  await apiClient.delete(`/api/v1/inventory/suppliers/${supplierId}`);
}

export async function listPurchaseOrders(): Promise<PurchaseOrderDto[]> {
  const response = await apiClient.get<PurchaseOrderDto[] | { items?: PurchaseOrderDto[] }>('/api/v1/inventory/purchase-orders');
  return Array.isArray(response.data) ? response.data : response.data.items ?? [];
}

export async function createPurchaseOrder(
  body: CreatePurchaseOrderDto
): Promise<PurchaseOrderDto> {
  const response = await apiClient.post<PurchaseOrderDto>(
    '/api/v1/inventory/purchase-orders',
    body
  );
  return response.data;
}

export async function receivePurchaseOrder(poId: string): Promise<PurchaseOrderDto> {
  const response = await apiClient.post<PurchaseOrderDto>(
    `/api/v1/inventory/purchase-orders/${poId}/receive`,
    {}
  );
  return response.data;
}

export interface ThresholdSuggestionDto {
  suggested_threshold: number;
  reasoning?: string;
}

export async function getThresholdSuggestion(itemId: string): Promise<ThresholdSuggestionDto> {
  const response = await apiClient.get<ThresholdSuggestionDto>(
    `/api/v1/inventory/items/${itemId}/threshold-suggestion`
  );
  return response.data;
}
