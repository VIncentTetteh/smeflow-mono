import { useCallback, useEffect, useMemo, useState } from 'react';
import { Q, type Database } from '@nozbe/watermelondb';
import { adjustStock } from '@/api/inventory.api';
import { database as defaultDatabase } from '@/db';
import { refreshPendingCount } from '@/db/sync/service';

export interface LocalItem {
  id: string;
  serverId?: string | null;
  name: string;
  sku: string;
  unit: string;
  barcode?: string | null;
  categoryId?: string | null;
  category?: string;
  sellPrice: number;
  costPrice: number;
  stockQty: number;
  lowStockThreshold: number;
  synced: boolean;
}

export interface CartLine {
  item: LocalItem;
  qty: number;
  unitPrice?: number;
}

export type SalePaymentMethod = 'cash' | 'momo' | 'paystack' | 'credit' | 'mixed' | 'ghqr';

export interface PaymentSplit {
  method: 'cash' | 'momo';
  amount: number;
  phone?: string;
}

export interface SaleDraft {
  customerName?: string | null;
  customerPhone?: string | null;
  creditDueDate?: string | null;
  reminderConsent?: boolean;
  reminderChannel?: 'whatsapp' | 'sms' | null;
  notes?: string | null;
  paymentMethod: SalePaymentMethod;
  paymentProvider?: 'mtn' | 'telecel' | 'vodafone' | 'airteltigo' | null;
  paymentSplits?: PaymentSplit[];
}

export interface LocalItemDraft {
  name: string;
  unit: string;
  sku?: string;
  barcode?: string | null;
  costPrice: number;
  sellPrice: number;
  stockQty: number;
  lowStockThreshold: number;
  categoryId?: string | null;
}

export interface LocalCategory {
  id: string;
  serverId?: string | null;
  name: string;
  synced: boolean;
}

export type StockAdjustmentReason = 'purchase' | 'damage' | 'return' | 'transfer' | 'adjustment';

export interface StockMovement {
  id: string;
  itemId: string;
  type: StockAdjustmentReason | string;
  qtyChange: number;
  note?: string | null;
  synced: boolean;
  createdAt: number;
}

function fromWatermelon(record: unknown): LocalItem {
  const item = record as {
    id: string;
    serverId?: string | null;
    name: string;
    sku?: string;
    unit?: string | null;
    barcode?: string | null;
    categoryId?: string | null;
    sellPrice: number;
    costPrice: number;
    stockQty: number;
    lowStockThreshold: number;
    synced: boolean;
  };

  return {
    id: item.id,
    serverId: item.serverId,
    name: item.name,
    sku: item.sku ?? '',
    unit: item.unit ?? 'piece',
    barcode: item.barcode ?? null,
    categoryId: item.categoryId,
    sellPrice: item.sellPrice,
    costPrice: item.costPrice,
    stockQty: item.stockQty,
    lowStockThreshold: item.lowStockThreshold,
    synced: item.synced,
  };
}

function categoryFromWatermelon(record: unknown): LocalCategory {
  const category = record as {
    id: string;
    serverId?: string | null;
    name: string;
    synced: boolean;
  };

  return {
    id: category.id,
    serverId: category.serverId,
    name: category.name,
    synced: category.synced,
  };
}

function movementFromWatermelon(record: unknown): StockMovement {
  const movement = record as {
    id: string;
    itemId: string;
    type: string;
    qtyChange: number;
    note?: string | null;
    synced: boolean;
    createdTs?: number | null;
  };

  return {
    id: movement.id,
    itemId: movement.itemId,
    type: movement.type,
    qtyChange: movement.qtyChange,
    note: movement.note,
    synced: movement.synced,
    createdAt: movement.createdTs ?? 0,
  };
}

export function useLocalItems(database: Database = defaultDatabase) {
  const [items, setItems] = useState<LocalItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const records = await database.get('items').query(Q.where('deleted_at', null)).fetch();
      setItems(records.map(fromWatermelon));
    } finally {
      setLoading(false);
    }
  }, [database]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, reload };
}

export function useLocalCategories(database: Database = defaultDatabase) {
  const [categories, setCategories] = useState<LocalCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const records = await database.get('item_categories').query().fetch();
      setCategories(records.map(categoryFromWatermelon));
    } finally {
      setLoading(false);
    }
  }, [database]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { categories, loading, reload };
}

export function useFilteredItems(items: LocalItem[], query: string, filter: string) {
  return useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesQuery =
        !normalized ||
        item.name.toLowerCase().includes(normalized) ||
        item.sku.toLowerCase().includes(normalized) ||
        item.barcode?.toLowerCase().includes(normalized);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'low' && item.stockQty <= item.lowStockThreshold) ||
        item.category === filter ||
        item.categoryId === filter;
      return matchesQuery && matchesFilter;
    });
  }, [filter, items, query]);
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function recordOfflineSale(
  cart: CartLine[],
  payment: SalePaymentMethod | SaleDraft,
  database: Database = defaultDatabase
) {
  const total = cart.reduce((sum, line) => sum + (line.unitPrice ?? line.item.sellPrice) * line.qty, 0);
  const idempotencyKey = newId('idem');
  const saleDraft: SaleDraft =
    typeof payment === 'string' ? { paymentMethod: payment } : payment;
  const amountPaid =
    saleDraft.paymentMethod === 'cash'
      ? total
      : saleDraft.paymentMethod === 'mixed'
        ? (saleDraft.paymentSplits ?? [])
            .filter((split) => split.method === 'cash')
            .reduce((sum, split) => sum + split.amount, 0)
        : 0;
  const balanceDue = Math.max(0, total - amountPaid);
  let createdSaleId = '';

  await database.write(async () => {
    const sale = await database.get('sales').create((record) => {
      Object.assign(record as object, {
        amountPaid,
        balanceDue,
        clientCreatedAt: Date.now(),
        customerName: saleDraft.customerName?.trim() || null,
        customerPhone: saleDraft.customerPhone?.trim() || null,
        creditDueDate: saleDraft.creditDueDate || null,
        total,
        paymentMethod: saleDraft.paymentMethod,
        paymentSplitsJson: saleDraft.paymentSplits?.length
          ? JSON.stringify(saleDraft.paymentSplits)
          : null,
        status:
          saleDraft.paymentMethod === 'cash'
            ? 'completed'
            : saleDraft.paymentMethod === 'credit'
              ? 'credit'
              : saleDraft.paymentMethod === 'mixed'
                ? 'partial_payment'
                : 'pending_payment',
        customerId: null,
        idempotencyKey,
        synced: false,
      });
    });
    createdSaleId = sale.id;

    for (const line of cart) {
      await database.get('sale_items').create((record) => {
        Object.assign(record as object, {
          saleId: sale.id,
          itemId: line.item.id,
          itemName: line.item.name,
          qty: line.qty,
          unitPrice: line.unitPrice ?? line.item.sellPrice,
          synced: false,
        });
      });

      try {
        const itemRecord = await database.get('items').find(line.item.id);
        await itemRecord.update((record) => {
          Object.assign(record as object, {
            stockQty: Math.max(0, line.item.stockQty - line.qty),
            synced: false,
          });
        });
      } catch {
        throw new Error(`Cannot record sale for missing local item ${line.item.id}`);
      }
    }
  });

  await refreshPendingCount(database);
  return { id: createdSaleId, idempotencyKey, total };
}

export async function createLocalItem(
  draft: LocalItemDraft,
  database: Database = defaultDatabase
) {
  await database.write(async () => {
    await database.get('items').create((record) => {
      Object.assign(record as object, {
        serverId: null,
        sku: draft.sku?.trim() || `SKU-${Date.now()}`,
        name: draft.name.trim(),
        unit: draft.unit.trim() || 'piece',
        costPrice: draft.costPrice,
        sellPrice: draft.sellPrice,
        stockQty: draft.stockQty,
        lowStockThreshold: draft.lowStockThreshold,
        barcode: draft.barcode?.trim() || null,
        categoryId: draft.categoryId ?? null,
        synced: false,
        idempotencyKey: newId('item'),
        deletedAt: null,
      });
    });
  });

  await refreshPendingCount(database);
}

export async function updateLocalItem(
  item: LocalItem,
  draft: LocalItemDraft,
  database: Database = defaultDatabase
) {
  await database.write(async () => {
    const itemRecord = await database.get('items').find(item.id);
    await itemRecord.update((record) => {
      Object.assign(record as object, {
        sku: draft.sku?.trim() || item.sku,
        name: draft.name.trim(),
        unit: draft.unit.trim() || 'piece',
        costPrice: draft.costPrice,
        sellPrice: draft.sellPrice,
        stockQty: draft.stockQty,
        lowStockThreshold: draft.lowStockThreshold,
        barcode: draft.barcode?.trim() || null,
        categoryId: draft.categoryId ?? null,
        synced: false,
      });
    });
  });

  await refreshPendingCount(database);
}

export async function deleteLocalItem(item: LocalItem, database: Database = defaultDatabase) {
  await database.write(async () => {
    const itemRecord = await database.get('items').find(item.id);
    await itemRecord.update((record) => {
      Object.assign(record as object, {
        deletedAt: Date.now(),
        synced: false,
      });
    });
  });

  await refreshPendingCount(database);
}

export async function createLocalCategory(
  name: string,
  database: Database = defaultDatabase
): Promise<LocalCategory | null> {
  let created: LocalCategory | null = null;
  await database.write(async () => {
    const record = await database.get('item_categories').create((category) => {
      Object.assign(category as object, {
        serverId: null,
        name: name.trim(),
        synced: false,
      });
    });
    created = categoryFromWatermelon(record);
  });

  await refreshPendingCount(database);
  return created;
}

export async function adjustLocalStock(
  item: LocalItem,
  qtyChange: number,
  note: string,
  reason: StockAdjustmentReason = qtyChange >= 0 ? 'purchase' : 'adjustment',
  database: Database = defaultDatabase
) {
  const createdAt = Date.now();
  let createdTransaction: unknown | null = null;
  let nextStock = Math.max(0, item.stockQty + qtyChange);

  await database.write(async () => {
    try {
      const itemRecord = await database.get('items').find(item.id);
      await itemRecord.update((record) => {
        Object.assign(record as object, {
          stockQty: nextStock,
          synced: false,
        });
      });
    } catch {
      throw new Error(`Cannot adjust missing local item ${item.id}`);
    }

    createdTransaction = await database.get('stock_transactions').create((record) => {
      Object.assign(record as object, {
        itemId: item.id,
        type: reason,
        qtyChange,
        referenceId: null,
        note,
        synced: false,
        idempotencyKey: newId('stock'),
        createdTs: createdAt,
      });
    });
  });

  if (item.serverId && createdTransaction) {
    try {
      const response = await adjustStock({
        item_id: item.serverId,
        qty_change: qtyChange,
        reason,
        notes: note || undefined,
      });
      await database.write(async () => {
        await (createdTransaction as { update: (writer: (record: unknown) => void) => Promise<void> }).update((record) => {
          Object.assign(record as object, {
            serverId: response.id,
            synced: true,
          });
        });
        const itemRecord = await database.get('items').find(item.id);
        await itemRecord.update((record) => {
          Object.assign(record as object, {
            stockQty: Number(response.qty_after ?? nextStock),
            synced: true,
          });
        });
      });
    } catch {
      // Offline or backend unavailable: the local transaction remains unsynced for the sync service.
    }
  }

  await refreshPendingCount(database);
}

export async function listStockMovements(itemId: string, database: Database = defaultDatabase) {
  const records = await database
    .get('stock_transactions')
    .query(Q.where('item_id', itemId))
    .fetch();
  return records
    .map(movementFromWatermelon)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function listRecentSales(database: Database = defaultDatabase) {
  const records = await database.get('sales').query().fetch();
  return records.slice(0, 5).map((record) => {
    const sale = record as unknown as {
      amountPaid?: number | null;
      balanceDue?: number | null;
      customerName?: string | null;
      customerPhone?: string | null;
      id: string;
      paymentMethod: string;
      paymentSplitsJson?: string | null;
      status: string;
      synced: boolean;
      total: number;
    };
    return sale;
  });
}
