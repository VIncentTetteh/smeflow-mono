import type { Database } from '@nozbe/watermelondb';

const SCOPED_TABLES = [
  'items',
  'item_categories',
  'sales',
  'sale_items',
  'customers',
  'stock_transactions',
  'sync_log',
] as const;

export async function resetScopedLocalData(database?: Database) {
  const activeDatabase = database ?? (await import('@/db')).database;
  await activeDatabase.write(async () => {
    for (const table of SCOPED_TABLES) {
      const rows = await activeDatabase.get(table).query().fetch();
      for (const row of rows) {
        await row.destroyPermanently();
      }
    }
  });

  const { refreshPendingCount } = await import('@/db/sync/service');
  await refreshPendingCount(activeDatabase);
}
