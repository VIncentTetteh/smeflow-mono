import { schema } from '@/db/schema';

describe('WatermelonDB schema', () => {
  it('has all required tables', () => {
    const tableNames = schema.tables.map((t: any) => t.name);
    expect(tableNames).toContain('items');
    expect(tableNames).toContain('item_categories');
    expect(tableNames).toContain('sales');
    expect(tableNames).toContain('sale_items');
    expect(tableNames).toContain('customers');
    expect(tableNames).toContain('stock_transactions');
    expect(tableNames).toContain('sync_log');
  });

  it('items table has synced, server_id, stock_qty, and idempotency_key columns', () => {
    const items = schema.tables.find((t: any) => t.name === 'items');
    const colNames = items?.columns.map((c: any) => c.name) ?? [];
    expect(colNames).toContain('synced');
    expect(colNames).toContain('server_id');
    expect(colNames).toContain('stock_qty');
    expect(colNames).toContain('unit');
    expect(colNames).toContain('idempotency_key');
  });

  it('sales table stores backend-compatible payment and customer fields', () => {
    const sales = schema.tables.find((t: any) => t.name === 'sales');
    const colNames = sales?.columns.map((c: any) => c.name) ?? [];
    expect(colNames).toContain('idempotency_key');
    expect(colNames).toContain('synced');
    expect(colNames).toContain('customer_phone');
    expect(colNames).toContain('customer_name');
    expect(colNames).toContain('payment_splits_json');
    expect(colNames).toContain('amount_paid');
    expect(colNames).toContain('balance_due');
    expect(colNames).toContain('client_created_at');
  });

  it('stock transactions store created_ts for audit history ordering', () => {
    const transactions = schema.tables.find((t: any) => t.name === 'stock_transactions');
    const colNames = transactions?.columns.map((c: any) => c.name) ?? [];
    expect(colNames).toContain('created_ts');
    expect(colNames).toContain('type');
    expect(colNames).toContain('qty_change');
  });
});
