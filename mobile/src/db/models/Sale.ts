import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class Sale extends Model {
  static table = 'sales';

  @field('server_id') serverId: string | null;
  @field('total') total: number;
  @field('payment_method') paymentMethod: string;
  @field('status') status: string;
  @field('customer_id') customerId: string | null;
  @field('customer_phone') customerPhone: string | null;
  @field('customer_name') customerName: string | null;
  @field('credit_due_date') creditDueDate: string | null;
  @field('payment_splits_json') paymentSplitsJson: string | null;
  @field('amount_paid') amountPaid: number | null;
  @field('balance_due') balanceDue: number | null;
  @field('client_created_at') clientCreatedAt: number | null;
  @field('idempotency_key') idempotencyKey: string;
  @field('synced') synced: boolean;
}
