import type { IRole } from '@teable/core';
import type { IGetBaseVo, ICreateTableRo, CollaboratorType } from '@teable/openapi';
import { createTable, deleteTable, permanentDeleteTable } from '@teable/openapi';

export class Base implements IGetBaseVo {
  id: string;
  name: string;
  spaceId: string;
  icon: string | null;
  role: IRole;
  collaboratorType?: CollaboratorType;
  restrictedAuthority?: boolean;

  constructor(base: IGetBaseVo) {
    const { id, name, spaceId, icon, role, collaboratorType, restrictedAuthority } = base;
    this.id = id;
    this.name = name;
    this.spaceId = spaceId;
    this.icon = icon;
    this.role = role;
    this.collaboratorType = collaboratorType;
    this.restrictedAuthority = restrictedAuthority;
  }

  async createTable(tableRo?: ICreateTableRo) {
    return createTable(this.id, tableRo);
  }

  async deleteTable(tableId: string, permanent?: boolean) {
    return permanent ? permanentDeleteTable(this.id, tableId) : deleteTable(this.id, tableId);
  }
}
