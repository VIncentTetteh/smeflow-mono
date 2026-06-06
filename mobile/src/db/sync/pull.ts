import { Q, type Database } from '@nozbe/watermelondb';
import { listCategories, listItems } from '@/api/inventory.api';
import { listCustomers, listSales } from '@/api/sales.api';
import type {
  ServerCategory,
  ServerCustomer,
  ServerItem,
  ServerSale,
  SyncTable,
} from './types';

const pullEndpoints: Array<{
  table: Exclude<SyncTable, 'sale_items' | 'stock_transactions'>;
  dataKey?: string;
}> = [
  { table: 'items', dataKey: 'items' },
  { table: 'item_categories' },
  { table: 'sales' },
  { table: 'customers', dataKey: 'items' },
];

function asNumber(value: string | number | null | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRows<T>(responseData: unknown, dataKey?: string): T[] {
  if (Array.isArray(responseData)) {
    return responseData as T[];
  }
  if (
    dataKey &&
    typeof responseData === 'object' &&
    responseData !== null &&
    Array.isArray((responseData as { [key: string]: unknown })[dataKey])
  ) {
    return (responseData as { [key: string]: T[] })[dataKey];
  }
  return [];
}

export function mapServerItem(item: ServerItem) {
  return {
    serverId: item.id,
    sku: item.sku ?? '',
    name: item.name,
    unit: item.unit ?? 'piece',
    costPrice: asNumber(item.cost_price),
    sellPrice: asNumber(item.sell_price),
    stockQty: asNumber(item.current_stock ?? item.stock_qty),
    lowStockThreshold: asNumber(item.low_stock_threshold, 5),
    barcode: item.barcode ?? null,
    categoryId: item.category_id ?? null,
    synced: true,
    idempotencyKey: '',
    deletedAt: null,
  };
}

export function mapServerCategory(category: ServerCategory) {
  return {
    serverId: category.id,
    name: category.name,
    synced: true,
  };
}

export function mapServerSale(sale: ServerSale) {
  return {
    serverId: sale.id,
    total: asNumber(sale.total),
    paymentMethod: sale.payment_method,
    status: sale.status,
    customerId: sale.customer_id ?? null,
    idempotencyKey: '',
    synced: true,
  };
}

export function mapServerCustomer(customer: ServerCustomer) {
  return {
    serverId: customer.id,
    name: customer.name,
    phone: customer.phone ?? null,
    tin: customer.tin ?? null,
    synced: true,
    idempotencyKey: '',
  };
}

async function findByServerId(database: Database, table: string, serverId: string) {
  const collection = database.get(table);
  const matches = await collection.query(Q.where('server_id', serverId)).fetch();
  return matches[0];
}

async function upsertRecord(database: Database, table: string, serverId: string, attrs: object) {
  const collection = database.get(table);
  const existing = await findByServerId(database, table, serverId);

  if (existing) {
    await existing.update((record) => {
      Object.assign(record as object, attrs);
    });
    return existing;
  }

  return collection.create((record) => {
    Object.assign(record as object, attrs);
  });
}

async function getLastPulledAt(database: Database, tableName: string) {
  const logs = await database
    .get('sync_log')
    .query(Q.where('table_name', tableName))
    .fetch();
  return Number((logs[0] as { lastPulledAt?: number } | undefined)?.lastPulledAt ?? 0);
}

async function writeLastPulledAt(database: Database, tableName: string, timestamp: number) {
  const logs = await database
    .get('sync_log')
    .query(Q.where('table_name', tableName))
    .fetch();
  const existing = logs[0];

  if (existing) {
    await existing.update((record) => {
      Object.assign(record as object, { lastPulledAt: timestamp });
    });
    return;
  }

  await database.get('sync_log').create((record) => {
    Object.assign(record as object, {
      tableName,
      lastPulledAt: timestamp,
      lastPushedAt: 0,
    });
  });
}

async function upsertSaleItems(database: Database, saleRecord: unknown, sale: ServerSale) {
  const saleId = (saleRecord as { id: string }).id;
  const collection = database.get('sale_items');
  const existingItems = await collection.query(Q.where('sale_id', saleId)).fetch();

  for (const item of existingItems) {
    await item.destroyPermanently();
  }

  for (const item of sale.items ?? []) {
    await collection.create((record) => {
      Object.assign(record as object, {
        saleId,
        itemId: item.item_id ?? '',
        itemName: item.description ?? 'Sale item',
        qty: asNumber(item.qty),
        unitPrice: asNumber(item.unit_price),
        synced: true,
      });
    });
  }
}

async function pullTable(
  database: Database,
  config: (typeof pullEndpoints)[number],
  now: number
) {
  const lastPulledAt = await getLastPulledAt(database, config.table);
  const changedSince = lastPulledAt ? new Date(lastPulledAt).toISOString() : undefined;
  const responseData =
    config.table === 'items'
      ? await listItems(changedSince ? { changed_since: changedSince } : undefined)
      : config.table === 'item_categories'
      ? await listCategories()
      : config.table === 'sales'
      ? await listSales(changedSince ? { changed_since: changedSince } : undefined)
      : await listCustomers();

  const rows =
    config.table === 'items'
      ? getRows<ServerItem>(responseData, config.dataKey)
      : config.table === 'item_categories'
      ? getRows<ServerCategory>(responseData, config.dataKey)
      : config.table === 'sales'
      ? getRows<ServerSale>(responseData, config.dataKey)
      : getRows<ServerCustomer>(responseData, config.dataKey);

  await database.write(async () => {
    for (const row of rows) {
      if (config.table === 'items') {
        await upsertRecord(database, 'items', row.id, mapServerItem(row as ServerItem));
      } else if (config.table === 'item_categories') {
        await upsertRecord(
          database,
          'item_categories',
          row.id,
          mapServerCategory(row as ServerCategory)
        );
      } else if (config.table === 'sales') {
        const saleRecord = await upsertRecord(database, 'sales', row.id, mapServerSale(row as ServerSale));
        await upsertSaleItems(database, saleRecord, row as ServerSale);
      } else {
        await upsertRecord(database, 'customers', row.id, mapServerCustomer(row as ServerCustomer));
      }
    }

    await writeLastPulledAt(database, config.table, now);
  });

  return rows.length;
}

export async function pullChanges(database: Database) {
  const pulled: Partial<Record<SyncTable, number>> = {};
  const errors: Array<{ table: SyncTable; message: string }> = [];
  const now = Date.now();

  for (const config of pullEndpoints) {
    try {
      pulled[config.table] = await pullTable(database, config, now);
    } catch (error) {
      errors.push({
        table: config.table,
        message: error instanceof Error ? error.message : 'Pull failed',
      });
    }
  }

  return { pulled, errors };
}
