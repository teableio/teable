import type { ITableSnapshot } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import { plainToInstance } from 'class-transformer';
import { Table } from './table';

export function createTableInstance(tableSnapshot: ITableSnapshot, doc?: Doc<ITableSnapshot>) {
  const instance = plainToInstance(Table, tableSnapshot.table);
  // force inject object into instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp: any = instance;
  temp.doc = doc;

  return instance;
}
