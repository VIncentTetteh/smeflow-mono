'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface Item {
  id: string;
  name: string;
  unit: string;
  cost_price: string;
  sell_price: string;
  current_stock: string;
  low_stock_threshold: string;
  sku: string | null;
  barcode: string | null;
  is_active: boolean;
  category_id: string | null;
  description: string | null;
  image_url: string | null;
  storefront_visible: boolean;
  is_low_stock: boolean;
}

export interface PaginatedItems {
  items: Item[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface Category {
  id: string;
  name: string;
  created_at: string;
}

export interface ItemCreate {
  name: string;
  unit: string;
  sell_price: number;
  cost_price?: number;
  initial_stock?: number;
  low_stock_threshold?: number;
  category_id?: string | null;
  sku?: string | null;
  barcode?: string | null;
}

const INV = ['store', 'inventory'] as const;

export function useItems(params?: { search?: string; category_id?: string; page?: number }) {
  return useQuery({
    queryKey: [...INV, 'items', params?.search ?? '', params?.category_id ?? '', params?.page ?? 1],
    queryFn: async () => {
      const res = await apiClient.get<PaginatedItems>('/inventory/items', {
        params: {
          search: params?.search || undefined,
          category_id: params?.category_id || undefined,
          page: params?.page,
        },
      });
      return res.data;
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: [...INV, 'categories'],
    queryFn: async () => (await apiClient.get<Category[]>('/inventory/categories')).data,
  });
}

export function useRestockAlerts() {
  return useQuery({
    queryKey: [...INV, 'restock-alerts'],
    queryFn: async () => (await apiClient.get('/inventory/restock-alerts')).data as unknown[],
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemCreate) => apiClient.post('/inventory/items', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...INV, 'items'] }),
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<ItemCreate> & {
        is_active?: boolean;
        storefront_visible?: boolean;
        description?: string | null;
      };
    }) => apiClient.patch(`/inventory/items/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...INV, 'items'] }),
  });
}

export function useUploadItemImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return apiClient
        .post<Item>(`/inventory/items/${id}/image`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...INV, 'items'] }),
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/inventory/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...INV, 'items'] }),
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      item_id: string;
      qty_change: number;
      reason: string;
      unit_cost?: number;
      notes?: string;
    }) => apiClient.post('/inventory/adjust', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...INV, 'items'] }),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiClient.post('/inventory/categories', { name }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...INV, 'categories'] }),
  });
}

// ── Suppliers ─────────────────────────────────────────────────────────────────
export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export function useSuppliers() {
  return useQuery({
    queryKey: [...INV, 'suppliers'],
    queryFn: async () => (await apiClient.get<Supplier[]>('/inventory/suppliers')).data,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; phone?: string; email?: string; address?: string }) =>
      apiClient.post('/inventory/suppliers', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...INV, 'suppliers'] }),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/inventory/suppliers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...INV, 'suppliers'] }),
  });
}

// ── Purchase Orders ─────────────────────────────────────────────────────────────
export interface PurchaseOrder {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  status: string;
  total_amount?: string | number;
  expected_date?: string | null;
  created_at?: string;
}

export function usePurchaseOrders() {
  return useQuery({
    queryKey: [...INV, 'purchase-orders'],
    queryFn: async () => (await apiClient.get<PurchaseOrder[]>('/inventory/purchase-orders')).data,
  });
}

export function useReceivePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poId: string) =>
      apiClient.post(`/inventory/purchase-orders/${poId}/receive`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...INV, 'purchase-orders'] });
      qc.invalidateQueries({ queryKey: [...INV, 'items'] });
    },
  });
}
