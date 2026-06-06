import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class SaleItem extends Model {
  static table = 'sale_items';

  @field('sale_id') saleId: string;
  @field('item_id') itemId: string;
  @field('item_name') itemName: string;
  @field('qty') qty: number;
  @field('unit_price') unitPrice: number;
  @field('synced') synced: boolean;
}
