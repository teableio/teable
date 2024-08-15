/* eslint-disable @typescript-eslint/naming-convention */
import { keys, pickBy } from 'lodash';
import { z } from '../../zod';
import {
  fieldActions,
  recordActions,
  viewActions,
  type FieldAction,
  type RecordAction,
  type ViewAction,
} from '../actions';
import { RolePermission } from './constant';
import { Role } from './types';

export const TableRole = {
  Creator: Role.Creator,
  Editor: Role.Editor,
  Viewer: Role.Viewer,
} as const;

export const tableRolesSchema = z.nativeEnum(TableRole);

export type ITableRole = z.infer<typeof tableRolesSchema>;

export type TablePermission = ViewAction | FieldAction | RecordAction;

export const TablePermissionActions: TablePermission[] = [
  ...viewActions,
  ...fieldActions,
  ...recordActions,
];

export const DefaultEnableActions = keys(
  pickBy(RolePermission[Role.Editor], (value) => value === true)
).filter((action) => TablePermissionActions.some((item) => item === action)) as TablePermission[];
