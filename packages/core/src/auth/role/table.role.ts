/* eslint-disable @typescript-eslint/naming-convention */
import { keys } from 'lodash';
import type { FieldActions, RecordActions, ViewActions } from '../actions';

export enum TableRole {
  Manager = 'manager',
  Editor = 'editor',
  Viewer = 'viewer',
  None = 'none',
}

export type TablePermission = ViewActions | FieldActions | RecordActions;

export const tablePermissions: Record<TableRole, Record<TablePermission, boolean>> = {
  [TableRole.Manager]: {
    'view|create': true,
    'view|delete': true,
    'view|read': true,
    'view|update': true,
    'field|create': true,
    'field|delete': true,
    'field|read': true,
    'field|update': true,
    'record|create': true,
    'record|comment': true,
    'record|delete': true,
    'record|read': true,
    'record|update': true,
  },
  [TableRole.Editor]: {
    'view|create': false,
    'view|delete': false,
    'view|read': true,
    'view|update': false,
    'field|create': false,
    'field|delete': false,
    'field|read': true,
    'field|update': false,
    'record|create': false,
    'record|comment': true,
    'record|delete': false,
    'record|read': true,
    'record|update': true,
  },
  [TableRole.Viewer]: {
    'view|create': false,
    'view|delete': false,
    'view|read': true,
    'view|update': false,
    'field|create': false,
    'field|delete': false,
    'field|read': true,
    'field|update': false,
    'record|create': false,
    'record|comment': true,
    'record|delete': false,
    'record|read': true,
    'record|update': false,
  },
  [TableRole.None]: {
    'view|create': false,
    'view|delete': false,
    'view|read': false,
    'view|update': false,
    'field|create': false,
    'field|delete': false,
    'field|read': false,
    'field|update': false,
    'record|create': false,
    'record|comment': false,
    'record|delete': false,
    'record|read': false,
    'record|update': false,
  },
};

export const TablePermissionActions = keys(tablePermissions.manager) as TablePermission[];
