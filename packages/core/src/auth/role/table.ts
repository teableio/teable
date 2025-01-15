/* eslint-disable @typescript-eslint/naming-convention */
import { z } from '../../zod';
import type { TableAction, FieldAction, RecordAction, ViewAction } from '../actions';
import { Role } from './types';

export const TableRole = {
  Creator: Role.Creator,
  Editor: Role.Editor,
  Viewer: Role.Viewer,
} as const;

export const tableRolesSchema = z.nativeEnum(TableRole);

export type ITableRole = z.infer<typeof tableRolesSchema>;

export type TablePermission = ViewAction | FieldAction | RecordAction | TableAction;
