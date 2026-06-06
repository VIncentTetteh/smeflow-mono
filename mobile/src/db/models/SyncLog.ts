import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class SyncLog extends Model {
  static table = 'sync_log';

  @field('table_name') tableName: string;
  @field('last_pulled_at') lastPulledAt: number;
  @field('last_pushed_at') lastPushedAt: number;
}
