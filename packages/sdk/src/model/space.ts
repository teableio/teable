import type { ICreateTableRo } from '@teable-group/core';
import { Table } from './table/table';

export class Space {
  async createTable(tableRo?: ICreateTableRo) {
    return Table.createTable(tableRo);
  }

  async deleteTable(tableId: string) {
    return Table.deleteTable(tableId);
  }
}
