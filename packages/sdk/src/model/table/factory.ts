import type { ITableVo } from '@teable/openapi';
import { plainToInstance } from 'class-transformer';
import type { Doc } from 'sharedb/lib/client';
import { Table } from './table';

export function createTableInstance(tableSnapshot: ITableVo, doc?: Doc<ITableVo>) {
  const instance = plainToInstance(Table, tableSnapshot);
  // force inject object into instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp: any = instance;
  temp.doc = doc;
  temp.baseId = doc?.collection.split('_')[1];

  return instance;
}
