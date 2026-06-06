import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type { AppSchema } from '@nozbe/watermelondb';
import { migrations } from './migrations';

export function adapter(schema: AppSchema) {
  return new LokiJSAdapter({
    schema,
    migrations,
    dbName: 'smeflow-web',
    useWebWorker: false,
    useIncrementalIndexedDB: true,
    onSetUpError: (error) => console.error('DB setup error', error),
    onQuotaExceededError: (error) => console.error('DB quota exceeded', error),
  });
}
