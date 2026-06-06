import { Database } from '@nozbe/watermelondb';
import { adapter } from './adapter';
import { wmSchema } from './schema';
import { Item } from './models/Item';
import { ItemCategory } from './models/ItemCategory';
import { Sale } from './models/Sale';
import { SaleItem } from './models/SaleItem';
import { Customer } from './models/Customer';
import { StockTransaction } from './models/StockTransaction';
import { SyncLog } from './models/SyncLog';

export const database = new Database({
  adapter: adapter(wmSchema),
  modelClasses: [Item, ItemCategory, Sale, SaleItem, Customer, StockTransaction, SyncLog],
});
