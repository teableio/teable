import type { ITablePermissionVo } from '@teable/openapi';
import { createContext } from 'react';

type ITablePermissionContext = ITablePermissionVo;

export const TablePermissionContextDefaultValue: ITablePermissionContext = {
  table: {},
  field: {
    create: false,
    fields: {},
  },
  view: {},
  record: {},
};

export const TablePermissionContext = createContext<ITablePermissionContext>(
  TablePermissionContextDefaultValue
);
