import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class ItemCategory extends Model {
  static table = 'item_categories';

  @field('server_id') serverId: string | null;
  @field('name') name: string;
  @field('synced') synced: boolean;
}
