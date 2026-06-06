import { appSchema, tableSchema } from '@nozbe/watermelondb';

// Raw WatermelonDB schema for use with the Database adapter
export const wmSchema = appSchema({
  version: 4,
  tables: [
    tableSchema({
      name: 'items',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'sku', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'unit', type: 'string', isOptional: true },
        { name: 'cost_price', type: 'number' },
        { name: 'sell_price', type: 'number' },
        { name: 'stock_qty', type: 'number' },
        { name: 'low_stock_threshold', type: 'number' },
        { name: 'barcode', type: 'string', isOptional: true },
        { name: 'category_id', type: 'string', isOptional: true },
        { name: 'synced', type: 'boolean' },
        { name: 'idempotency_key', type: 'string' },
        { name: 'deleted_at', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'item_categories',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'name', type: 'string' },
        { name: 'synced', type: 'boolean' },
      ],
    }),
    tableSchema({
      name: 'sales',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'total', type: 'number' },
        { name: 'payment_method', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'customer_id', type: 'string', isOptional: true },
        { name: 'customer_phone', type: 'string', isOptional: true },
        { name: 'customer_name', type: 'string', isOptional: true },
        { name: 'credit_due_date', type: 'string', isOptional: true },
        { name: 'payment_splits_json', type: 'string', isOptional: true },
        { name: 'amount_paid', type: 'number', isOptional: true },
        { name: 'balance_due', type: 'number', isOptional: true },
        { name: 'client_created_at', type: 'number', isOptional: true },
        { name: 'idempotency_key', type: 'string' },
        { name: 'synced', type: 'boolean' },
      ],
    }),
    tableSchema({
      name: 'sale_items',
      columns: [
        { name: 'sale_id', type: 'string' },
        { name: 'item_id', type: 'string' },
        { name: 'item_name', type: 'string' },
        { name: 'qty', type: 'number' },
        { name: 'unit_price', type: 'number' },
        { name: 'synced', type: 'boolean' },
      ],
    }),
    tableSchema({
      name: 'customers',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'name', type: 'string' },
        { name: 'phone', type: 'string', isOptional: true },
        { name: 'tin', type: 'string', isOptional: true },
        { name: 'synced', type: 'boolean' },
        { name: 'idempotency_key', type: 'string' },
      ],
    }),
    tableSchema({
      name: 'stock_transactions',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'item_id', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'qty_change', type: 'number' },
        { name: 'reference_id', type: 'string', isOptional: true },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'synced', type: 'boolean' },
        { name: 'idempotency_key', type: 'string' },
        { name: 'created_ts', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'sync_log',
      columns: [
        { name: 'table_name', type: 'string' },
        { name: 'last_pulled_at', type: 'number' },
        { name: 'last_pushed_at', type: 'number' },
      ],
    }),
  ],
});

// Testable schema view: exposes tables as an array where each table has
// a columns array, matching the shape expected by schema tests.
export const schema = {
  version: wmSchema.version,
  tables: Object.values(wmSchema.tables).map((table) => ({
    name: table.name,
    columns: table.columnArray,
  })),
};
