import type { RoutineAction, AppAction, AutomationAction, TableAction } from '@teable/core';

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
  routinePermissionMap?: Record<string, RoutineAction[]>;
};

/** What decides which nodes the caller sees: in the node tree, and in what is said about them. */
export type IBaseNodeVisibilityContext = IBaseNodePermissionContext & {
  /** Set inside a node share: only the shared node and what lies under it is visible. */
  shareNodeId?: string;
  /**
   * Hide the folders the member cannot access, as the nodes they cannot read already are. A folder
   * has no permission of its own: for a member the authority matrix restricts, it is accessible
   * only through something readable inside it.
   */
  hideInaccessibleFolders?: boolean;
};
