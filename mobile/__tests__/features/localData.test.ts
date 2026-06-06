jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  appOwnership: 'expo',
}));

jest.mock('@/api/inventory.api', () => ({
  adjustStock: jest.fn(),
}));

jest.mock('@/db/sync/service', () => ({
  refreshPendingCount: jest.fn().mockResolvedValue(0),
}));

import {
  adjustLocalStock,
  createLocalItem,
  deleteLocalItem,
  listStockMovements,
  updateLocalItem,
  type LocalItem,
} from '@/features/localData';
import { database } from '@/db';
import { adjustStock } from '@/api/inventory.api';

const SCOPED_TABLES = [
  'items',
  'item_categories',
  'sales',
  'sale_items',
  'customers',
  'stock_transactions',
  'sync_log',
] as const;

async function resetTestData() {
  await database.write(async () => {
    for (const table of SCOPED_TABLES) {
      const rows = await database.get(table).query().fetch();
      for (const row of rows) {
        await row.destroyPermanently();
      }
    }
  });
}

async function fetchItems() {
  return database.get('items').query().fetch();
}

function itemFromRecord(record: unknown): LocalItem {
  const row = record as {
    id: string;
    barcode?: string | null;
    categoryId?: string | null;
    costPrice: number;
    lowStockThreshold: number;
    name: string;
    sellPrice: number;
    serverId?: string | null;
    sku: string;
    stockQty: number;
    synced: boolean;
    unit?: string | null;
  };
  return {
    id: row.id,
    barcode: row.barcode,
    categoryId: row.categoryId,
    costPrice: row.costPrice,
    lowStockThreshold: row.lowStockThreshold,
    name: row.name,
    sellPrice: row.sellPrice,
    serverId: row.serverId,
    sku: row.sku,
    stockQty: row.stockQty,
    synced: row.synced,
    unit: row.unit ?? 'piece',
  };
}

describe('local inventory data', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await resetTestData();
  });

  afterEach(async () => {
    await resetTestData();
  });

  it('creates, updates, and soft-deletes local inventory items for sync', async () => {
    await createLocalItem({
      barcode: '6034000000012',
      costPrice: 8,
      lowStockThreshold: 3,
      name: 'Rice 5kg',
      sellPrice: 12,
      sku: 'RICE-5',
      stockQty: 10,
      unit: 'bag',
    }, database);

    const [createdRecord] = await fetchItems();
    const created = itemFromRecord(createdRecord);
    expect(created).toMatchObject({
      barcode: '6034000000012',
      lowStockThreshold: 3,
      name: 'Rice 5kg',
      stockQty: 10,
      synced: false,
    });

    await updateLocalItem(created, {
      barcode: '6034000000013',
      costPrice: 9,
      lowStockThreshold: 4,
      name: 'Rice 5kg updated',
      sellPrice: 14,
      sku: 'RICE-5B',
      stockQty: 8,
      unit: 'bag',
    }, database);

    const updated = itemFromRecord(await database.get('items').find(created.id));
    expect(updated).toMatchObject({
      barcode: '6034000000013',
      lowStockThreshold: 4,
      name: 'Rice 5kg updated',
      sellPrice: 14,
      stockQty: 8,
      synced: false,
    });

    await deleteLocalItem(updated, database);
    const deleted = await database.get('items').find(created.id);
    expect((deleted as unknown as { deletedAt?: number | null }).deletedAt).toEqual(expect.any(Number));
    expect((deleted as unknown as { synced?: boolean }).synced).toBe(false);
  });

  it('records stock adjustment fallback locally when backend adjustment fails', async () => {
    (adjustStock as jest.Mock).mockRejectedValue(new Error('offline'));
    await createLocalItem({
      costPrice: 8,
      lowStockThreshold: 3,
      name: 'Tomatoes',
      sellPrice: 12,
      stockQty: 10,
      unit: 'kg',
    }, database);
    const item = itemFromRecord((await fetchItems())[0]);

    await adjustLocalStock({ ...item, serverId: 'server-item-1' }, -4, 'Damaged bags', 'damage', database);

    const adjusted = itemFromRecord(await database.get('items').find(item.id));
    const movements = await listStockMovements(item.id, database);

    expect(adjusted).toMatchObject({ stockQty: 6, synced: false });
    expect(movements).toEqual([
      expect.objectContaining({
        itemId: item.id,
        note: 'Damaged bags',
        qtyChange: -4,
        synced: false,
        type: 'damage',
      }),
    ]);
  });
});
