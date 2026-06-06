import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class Customer extends Model {
  static table = 'customers';

  @field('server_id') serverId: string | null;
  @field('name') name: string;
  @field('phone') phone: string | null;
  @field('tin') tin: string | null;
  @field('synced') synced: boolean;
  @field('idempotency_key') idempotencyKey: string;
}
