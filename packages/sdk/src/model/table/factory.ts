import type { ITableVo } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import { plainToInstance } from 'class-transformer';
import { Table } from './table';

export function createTableInstance(tableSnapshot: ITableVo, doc?: Doc<ITableVo>) {
  const instance = plainToInstance(Table, tableSnapshot);
  // force inject object into instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp: any = instance;
  temp.doc = doc;

  return instance;
}
