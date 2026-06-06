import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import Constants from 'expo-constants';
import type { AppSchema } from '@nozbe/watermelondb';
import { migrations } from './migrations';

export function adapter(schema: AppSchema) {
  if (Constants.appOwnership === 'expo') {
    return new LokiJSAdapter({
      schema,
      migrations,
      dbName: 'smeflow-expo-go',
      useWebWorker: false,
      useIncrementalIndexedDB: false,
      onSetUpError: (error) => console.error('DB setup error', error),
      onQuotaExceededError: (error) => console.error('DB quota exceeded', error),
    });
  }

  return new SQLiteAdapter({
    schema,
    migrations,
    dbName: 'smeflow',
    jsi: true,
    onSetUpError: (error) => console.error('DB setup error', error),
  });
}
