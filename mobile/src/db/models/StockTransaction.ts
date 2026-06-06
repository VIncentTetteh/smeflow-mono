import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class StockTransaction extends Model {
  static table = 'stock_transactions';

  @field('server_id') serverId: string | null;
  @field('item_id') itemId: string;
  @field('type') type: string;
  @field('qty_change') qtyChange: number;
  @field('reference_id') referenceId: string | null;
  @field('note') note: string | null;
  @field('synced') synced: boolean;
  @field('idempotency_key') idempotencyKey: string;
  @field('created_ts') createdTs: number | null;
}
