import { Q, type Database } from '@nozbe/watermelondb';
import type { AxiosError } from 'axios';
import {
  adjustStock,
  createCategory,
  createItem,
  deleteItem,
  updateItem,
} from '@/api/inventory.api';
import { recordSale } from '@/api/sales.api';
import type { StockAdjustReason } from '@/types/inventory';
import type { SalePaymentMethod } from '@/types/sales';
import type { SyncTable } from './types';

type LocalRecord = {
  id: string;
  update: (writer: (record: unknown) => void) => Promise<void>;
};

function toServerId(record: unknown) {
  return (record as { serverId?: string | null }).serverId ?? undefined;
}

function markSyncedAttrs(serverId?: string) {
  return serverId ? { serverId, synced: true } : { synced: true };
}

async function markSynced(record: LocalRecord, serverId?: string) {
  await record.update((draft) => {
    Object.assign(draft as object, markSyncedAttrs(serverId));
  });
}

async function getUnsynced(database: Database, table: SyncTable) {
  return database.get(table).query(Q.where('synced', false)).fetch();
}

function isForbidden(error: unknown) {
  return (error as AxiosError | undefined)?.response?.status === 403;
}

async function findServerId(database: Database, table: string, localId?: string | null) {
  if (!localId) {
    return undefined;
  }
  try {
    const record = await database.get(table).find(localId);
    return toServerId(record);
  } catch {
    return undefined;
  }
}

export function buildItemPayload(item: unknown) {
  const row = item as {
    barcode?: string | null;
    categoryId?: string | null;
    costPrice: number;
    lowStockThreshold: number;
    name: string;
    sellPrice: number;
    sku?: string | null;
    stockQty: number;
    unit?: string | null;
    deletedAt?: number | null;
  };

  return {
    barcode: row.barcode || undefined,
    category_id: row.categoryId || undefined,
    cost_price: row.costPrice,
    initial_stock: row.stockQty,
    low_stock_threshold: row.lowStockThreshold,
    name: row.name,
    sell_price: row.sellPrice,
    sku: row.sku || undefined,
    unit: row.unit || 'piece',
  };
}

export function buildItemUpdatePayload(item: unknown) {
  const payload = buildItemPayload(item);
  const { initial_stock: _initialStock, ...updatePayload } = payload;
  return updatePayload;
}

export function buildCategoryPayload(category: unknown) {
  return { name: (category as { name: string }).name };
}

export async function buildSalePayload(database: Database, sale: unknown) {
  const row = sale as {
    clientCreatedAt?: number | null;
    customerId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    creditDueDate?: string | null;
    id: string;
    idempotencyKey: string;
    paymentSplitsJson?: string | null;
    paymentMethod: string;
  };
  const saleItems = await database.get('sale_items').query(Q.where('sale_id', row.id)).fetch();
  const paymentSplits = row.paymentSplitsJson ? JSON.parse(row.paymentSplitsJson) : undefined;

  return {
    client_created_at: row.clientCreatedAt ? new Date(row.clientCreatedAt).toISOString() : undefined,
    customer_name: row.customerName || undefined,
    customer_phone: row.customerPhone || undefined,
    credit_due_date: row.creditDueDate || undefined,
    discount_amount: 0,
    idempotency_key: row.idempotencyKey,
    items: await Promise.all(
      saleItems.map(async (item) => {
        const itemRow = item as unknown as {
          itemId?: string | null;
          itemName: string;
          qty: number;
          unitPrice: number;
        };
        const serverItemId = await findServerId(database, 'items', itemRow.itemId);

        return {
          description: serverItemId ? undefined : itemRow.itemName,
          discount: 0,
          item_id: serverItemId,
          qty: itemRow.qty,
          unit_price: itemRow.unitPrice,
        };
      })
    ),
    payment_method: row.paymentMethod,
    payment_splits: paymentSplits,
  };
}

export async function buildStockAdjustmentPayload(database: Database, transaction: unknown) {
  const row = transaction as {
    itemId: string;
    note?: string | null;
    qtyChange: number;
    type: string;
  };
  const serverItemId = await findServerId(database, 'items', row.itemId);

  if (!serverItemId) {
    throw new Error('Cannot sync stock adjustment before item has a server_id');
  }

  return {
    item_id: serverItemId,
    notes: row.note || undefined,
    qty_change: row.qtyChange,
    reason: row.type,
  };
}

async function pushCategories(database: Database) {
  const categories = await getUnsynced(database, 'item_categories');
  let pushed = 0;

  for (const category of categories as unknown as LocalRecord[]) {
    let response;
    try {
      response = await createCategory(buildCategoryPayload(category));
    } catch (error) {
      if (isForbidden(error)) {
        break;
      }
      throw error;
    }
    await database.write(async () => {
      await markSynced(category, response.id);
    });
    pushed += 1;
  }

  return pushed;
}

async function pushItems(database: Database) {
  const items = await getUnsynced(database, 'items');
  let pushed = 0;

  for (const item of items as unknown as LocalRecord[]) {
    const row = item as unknown as { serverId?: string | null; deletedAt?: number | null };
    if (row.deletedAt && row.serverId) {
      await deleteItem(row.serverId);
      await database.write(async () => {
        await markSynced(item);
      });
      pushed += 1;
      continue;
    }
    if (row.deletedAt && !row.serverId) {
      await database.write(async () => {
        await markSynced(item);
      });
      pushed += 1;
      continue;
    }

    let response;
    try {
      response = row.serverId
        ? await updateItem(row.serverId, buildItemUpdatePayload(item))
        : await createItem(buildItemPayload(item));
    } catch (error) {
      if (isForbidden(error)) {
        break;
      }
      throw error;
    }
    await database.write(async () => {
      await markSynced(item, response.id);
    });
    pushed += 1;
  }

  return pushed;
}

async function pushSales(database: Database) {
  const sales = await getUnsynced(database, 'sales');
  let pushed = 0;

  for (const sale of sales as unknown as LocalRecord[]) {
    const payload = await buildSalePayload(database, sale);
    const response = await recordSale({
      ...payload,
      payment_method: payload.payment_method as SalePaymentMethod,
    });
    const saleItems = await database.get('sale_items').query(Q.where('sale_id', sale.id)).fetch();

    await database.write(async () => {
      await markSynced(sale, response.sale_id);
      for (const item of saleItems as unknown as LocalRecord[]) {
        await markSynced(item);
      }
    });
    pushed += 1;
  }

  return pushed;
}

async function pushStockTransactions(database: Database) {
  const transactions = await getUnsynced(database, 'stock_transactions');
  let pushed = 0;

  for (const transaction of transactions as unknown as LocalRecord[]) {
    const payload = await buildStockAdjustmentPayload(database, transaction);
    const response = await adjustStock({
      ...payload,
      reason: payload.reason as StockAdjustReason,
    });
    await database.write(async () => {
      await markSynced(transaction, response.id);
    });
    pushed += 1;
  }

  return pushed;
}

export async function countPendingRecords(database: Database) {
  const tables: SyncTable[] = [
    'items',
    'item_categories',
    'sales',
    'sale_items',
    'customers',
    'stock_transactions',
  ];
  const counts = await Promise.all(
    tables.map(async (table) => {
      const records = await getUnsynced(database, table);
      return records.length;
    })
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

export async function pushChanges(database: Database) {
  const pushed: Partial<Record<SyncTable, number>> = {};
  const errors: Array<{ table: SyncTable; message: string }> = [];

  const pushers: Array<{ table: SyncTable; run: () => Promise<number> }> = [
    { table: 'item_categories', run: () => pushCategories(database) },
    { table: 'items', run: () => pushItems(database) },
    { table: 'sales', run: () => pushSales(database) },
    { table: 'stock_transactions', run: () => pushStockTransactions(database) },
  ];

  for (const pusher of pushers) {
    try {
      pushed[pusher.table] = await pusher.run();
    } catch (error) {
      errors.push({
        table: pusher.table,
        message: error instanceof Error ? error.message : 'Push failed',
      });
    }
  }

  return { pushed, errors };
}
