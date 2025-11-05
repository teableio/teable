import type { ITablePermissionVo } from '@teable/openapi';
import { createContext } from 'react';

type ITablePermissionContext = ITablePermissionVo;

export const TablePermissionContextDefaultValue: ITablePermissionContext = {
  table: {} as Record<string, boolean>,
  field: {} as Record<string, boolean>,
  view: {} as Record<string, boolean>,
  record: {} as Record<string, boolean>,
};

export const TablePermissionContext = createContext<ITablePermissionContext>(
  TablePermissionContextDefaultValue
);
