import { ITableSnapshot, ITableVo } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import { Doc } from 'sharedb/lib/client';
import { Table } from './table';

export function createTableInstance(table: ITableVo, doc?: Doc<ITableSnapshot>) {
  const instance = plainToInstance(Table, table);
  // force inject object into instance
  const temp: any = instance;
  temp.doc = doc;

  return instance;
}
