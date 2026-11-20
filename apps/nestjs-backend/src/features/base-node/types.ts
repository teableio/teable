import type { Action } from '@teable/core';
import type { BaseNodeResourceType } from '@teable/openapi';

export enum BaseNodeAction {
  Read = 'base_node|read',
  Create = 'base_node|create',
  Update = 'base_node|update',
  Delete = 'base_node|delete',
}

/**
 * What the authority matrix grants a restricted member, per kind and resource. A kind with a map
 * here is decided by it alone; the rest by the member's base role.
 */
export type IBaseNodePermissionMaps = Partial<
  Record<BaseNodeResourceType, Record<string, Action[]>>
>;

export type IBaseNodePermissionContext = {
  permissionSet: Set<string>;
  nodePermissionMaps?: IBaseNodePermissionMaps;
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
