import type { ICreateTableRo } from '@teable-group/core';
import type { Connection } from '@teable/sharedb/lib/client';
import { Table } from './table/table';

export class Space {
  constructor(private connection: Connection) {}

  async createTable(tableRo: ICreateTableRo) {
    return Table.createTable(tableRo);
  }

  async deleteTable(tableId: string) {
    return Table.deleteTable(tableId);
  }
}
