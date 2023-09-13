import type { ICreateTableRo } from '@teable-group/core';
import type { BaseSchema } from '@teable-group/openapi';
import knex from 'knex';
import { axios } from '../config';
import { Table } from './table/table';

export class Base implements BaseSchema.IGetBaseVo {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static knex = knex({ client: 'sqlite3' });

  id: string;
  name: string;
  spaceId: string;
  order: number;
  icon: string | null;

  constructor(base: BaseSchema.IGetBaseVo) {
    const { id, name, order, spaceId, icon } = base;
    this.id = id;
    this.name = name;
    this.spaceId = spaceId;
    this.order = order;
    this.icon = icon;
  }

  static async sqlQuery(tableId: string, viewId: string, sql: string) {
    const response = await axios.post<unknown[]>(`/base/sqlQuery`, {
      sql,
      tableId,
      viewId,
    });
    return response.data;
  }

  async createTable(tableRo?: ICreateTableRo) {
    return Table.createTable(this.id, tableRo);
  }

  async deleteTable(tableId: string) {
    return Table.deleteTable(this.id, tableId);
  }
}
