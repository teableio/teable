import type { ICreateTableRo } from '@teable-group/core';
import type { IGetBaseVo } from '@teable-group/openapi';
import knex from 'knex';
import { Table } from './table/table';

export class Base implements IGetBaseVo {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static knex = knex({ client: 'sqlite3' });

  id: string;
  name: string;
  spaceId: string;
  order: number;
  icon: string | null;

  constructor(base: IGetBaseVo) {
    const { id, name, order, spaceId, icon } = base;
    this.id = id;
    this.name = name;
    this.spaceId = spaceId;
    this.order = order;
    this.icon = icon;
  }

  async sqlQuery(tableId: string, viewId: string, sql: string) {
    return Table.sqlQuery(this.id, tableId, { viewId, sql });
  }

  async createTable(tableRo?: ICreateTableRo) {
    return Table.createTable(this.id, tableRo);
  }

  async deleteTable(tableId: string) {
    return Table.deleteTable(this.id, tableId);
  }
}
