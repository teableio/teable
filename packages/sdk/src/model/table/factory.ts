import { ITableSnapshot, ITableVo } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import { Connection, Doc } from 'sharedb/lib/client';
import { Table } from './table';

export function createTableInstance(
  table: ITableVo,
  doc?: Doc<ITableSnapshot>,
  connection?: Connection
) {
  const instance = plainToInstance(Table, table);
  // force inject object into instance
  const temp: any = instance;
  temp.doc = doc;
  temp.connection = connection;

  return instance;
}
