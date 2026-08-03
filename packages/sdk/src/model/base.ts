import type { IRole } from '@teable/core';
import type {
  IGetBaseVo,
  ICreateTableRo,
  CollaboratorType,
  IBaseV2StatusVo,
} from '@teable/openapi';
import { createTable, deleteTable, permanentDeleteTable } from '@teable/openapi';

export class Base implements IGetBaseVo {
  id: string;
  name: string;
  spaceId: string;
  icon: string | null;
  role: IRole;
  collaboratorType?: CollaboratorType;
  restrictedAuthority?: boolean;
  enabledAuthority?: boolean;
  createdBy: string;
  isCanary?: boolean;
  v2Status?: IBaseV2StatusVo;

  constructor(base: IGetBaseVo) {
    const {
      id,
      name,
      spaceId,
      icon,
      role,
      collaboratorType,
      restrictedAuthority,
      enabledAuthority,
      createdBy,
      isCanary,
      v2Status,
    } = base;
    this.id = id;
    this.name = name;
    this.spaceId = spaceId;
    this.icon = icon;
    this.role = role;
    this.collaboratorType = collaboratorType;
    this.restrictedAuthority = restrictedAuthority;
    this.enabledAuthority = enabledAuthority;
    this.createdBy = createdBy;
    this.isCanary = isCanary;
    this.v2Status = v2Status;
  }

  async createTable(tableRo?: ICreateTableRo) {
    return createTable(this.id, tableRo);
  }

  async deleteTable(tableId: string, permanent?: boolean) {
    return permanent ? permanentDeleteTable(this.id, tableId) : deleteTable(this.id, tableId);
  }
}
