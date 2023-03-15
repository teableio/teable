import type { ITableSnapshot, ITableVo } from '@teable-group/core';
import type { Connection, Doc } from '@teable/sharedb/lib/client';
import { plainToInstance } from 'class-transformer';
import { Table } from './table';

export function createTableInstance(
  table: ITableVo,
  doc?: Doc<ITableSnapshot>,
  connection?: Connection
) {
  const instance = plainToInstance(Table, table);
  // force inject object into instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp: any = instance;
  temp.doc = doc;
  temp.connection = connection;

  return instance;
}
