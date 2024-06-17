import type { SpaceRole } from '@teable/core';
import type { IGetBaseVo, ICreateTableRo } from '@teable/openapi';
import { Table } from './table/table';

export class Base implements IGetBaseVo {
  id: string;
  name: string;
  spaceId: string;
  icon: string | null;
  role: SpaceRole;

  constructor(base: IGetBaseVo) {
    const { id, name, spaceId, icon, role } = base;
    this.id = id;
    this.name = name;
    this.spaceId = spaceId;
    this.icon = icon;
    this.role = role;
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
