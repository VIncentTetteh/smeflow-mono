import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class Item extends Model {
  static table = 'items';

  @field('server_id') serverId: string | null;
  @field('sku') sku: string;
  @field('name') name: string;
  @field('unit') unit: string | null;
  @field('cost_price') costPrice: number;
  @field('sell_price') sellPrice: number;
  @field('stock_qty') stockQty: number;
  @field('low_stock_threshold') lowStockThreshold: number;
  @field('barcode') barcode: string | null;
  @field('category_id') categoryId: string | null;
  @field('synced') synced: boolean;
  @field('idempotency_key') idempotencyKey: string;
  @field('deleted_at') deletedAt: number | null;
}
