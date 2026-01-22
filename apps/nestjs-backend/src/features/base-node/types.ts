import type { AppAction, AutomationAction, TableAction } from '@teable/core';

export enum BaseNodeAction {
  Read = 'base_node|read',
  Create = 'base_node|create',
  Update = 'base_node|update',
  Delete = 'base_node|delete',
}

export type IBaseNodePermissionContext = {
  tablePermissionMap?: Record<string, TableAction[]>;
  permissionSet: Set<string>;
  appPermissionMap?: Record<string, AppAction[]>;
  workflowPermissionMap?: Record<string, AutomationAction[]>;
};
