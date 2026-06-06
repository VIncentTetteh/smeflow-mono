import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: 'items',
          columns: [{ name: 'unit', type: 'string', isOptional: true }],
        }),
        addColumns({
          table: 'stock_transactions',
          columns: [{ name: 'created_ts', type: 'number', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: 'sales',
          columns: [
            { name: 'customer_phone', type: 'string', isOptional: true },
            { name: 'customer_name', type: 'string', isOptional: true },
            { name: 'payment_splits_json', type: 'string', isOptional: true },
            { name: 'amount_paid', type: 'number', isOptional: true },
            { name: 'balance_due', type: 'number', isOptional: true },
            { name: 'client_created_at', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        addColumns({
          table: 'sales',
          columns: [{ name: 'credit_due_date', type: 'string', isOptional: true }],
        }),
      ],
    },
  ],
});
