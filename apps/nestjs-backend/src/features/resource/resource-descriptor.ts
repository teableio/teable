import { SortFunc, type Action } from '@teable/core';
import { TrashType } from '@teable/openapi';
import type { PreviewResourceKind } from '@teable/v2-command-explain';
// The enum itself, not the events barrel: the barrel's base-node event reads this table.
import { Events } from '../../event-emitter/events/event.enum';

/** Where a kind of resource lives: a space and a project stand alone, the rest are its nodes. */
export enum ResourceLevel {
  Space = 'space',
  Base = 'base',
  Node = 'node',
}

/** What a scope is checked on: the project the resource is in, or the resource itself. */
export enum ResourceScopeTarget {
  Base = 'base',
  Resource = 'resource',
}

/**
 * What every edition knows of a kind of resource without running anything. The edition's own
 * kinds are listed too: like the enums and actions they name, this table is shared, while the
 * code that acts on them (the handlers) lives with the edition.
 */
export interface IResourceDescriptor {
  level: ResourceLevel;
  /** What it is called to a user or an agent: a workflow is an automation. */
  noun: string;
  /**
   * What reading, creating, updating and deleting one takes, its node's included. Bringing one
   * back from the trash takes `create`, purging it `delete`.
   */
  actions: { read: Action; create: Action; update: Action; delete: Action };
  /** Its page in a project; unset for a kind with none of its own. */
  url?: (baseId: string, resourceId: string, viewId?: string | null) => string;
  /**
   * When it goes in a folder delete, lowest first: what can be put back goes first and what
   * cannot goes last, since an app goes offline and links into a table turn into text, so a
   * failure before them leaves nothing lost.
   */
  folderDeleteOrder?: number;
  /** What a folder delete preview counts it as; unset ones count as host resources. */
  folderDeletePreviewKind?: PreviewResourceKind;
  /** Where `create` is checked when one is restored (a table's on the table). */
  restoreOn: ResourceScopeTarget;
  /** Browsing or emptying a project's trash always takes this kind's `delete`. */
  requiredToBrowseTrash: boolean;
  /**
   * The event whose soft delete puts one in the trash, and the payload key naming it. A folder
   * has none: its delete writes its trash rows as it runs.
   */
  trashedBy: { event: Events; idKey: string } | null;
  /**
   * The events that change its node, and the payload key naming it: `{ [key]: { id } }` on
   * create and update, `[key]Id` on delete. Set exactly for `ResourceLevel.Node`.
   */
  nodeEvents?: { create: Events; update: Events; delete: Events; payloadKey: string };
  /**
   * Its own table, a row per resource with its `name` and `deleted_time` (and, but for a
   * project, its `base_id`): a last visit checks one is still there, a project digest reads
   * the names. `hasIcon` and `hasDescription` say which of those columns it also has;
   * `spaceSearch`, whether a space search lists the kind.
   */
  dbTable?: { name: string; hasIcon: boolean; hasDescription: boolean; spaceSearch: boolean };
  /**
   * A project keeps the user's last visited one of this kind; before any visit, the first by
   * `firstBy` opens (any one when unset). A table's visit, kept with its views, is its own.
   */
  lastVisit?: { firstBy?: { column: string; direction: SortFunc } };
}

export const RESOURCE_DESCRIPTORS: Record<TrashType, IResourceDescriptor> = {
  [TrashType.Space]: {
    level: ResourceLevel.Space,
    noun: 'space',
    actions: {
      read: 'space|read',
      create: 'space|create',
      update: 'space|update',
      delete: 'space|delete',
    },
    restoreOn: ResourceScopeTarget.Resource,
    requiredToBrowseTrash: false,
    trashedBy: { event: Events.SPACE_DELETE, idKey: 'spaceId' },
  },
  [TrashType.Base]: {
    level: ResourceLevel.Base,
    noun: 'base',
    actions: {
      read: 'base|read',
      create: 'base|create',
      update: 'base|update',
      delete: 'base|delete',
    },
    restoreOn: ResourceScopeTarget.Resource,
    requiredToBrowseTrash: false,
    trashedBy: { event: Events.BASE_DELETE, idKey: 'baseId' },
    dbTable: { name: 'base', hasIcon: true, hasDescription: false, spaceSearch: true },
  },
  [TrashType.Table]: {
    level: ResourceLevel.Node,
    noun: 'table',
    actions: {
      read: 'table|read',
      create: 'table|create',
      update: 'table|update',
      delete: 'table|delete',
    },
    restoreOn: ResourceScopeTarget.Resource,
    requiredToBrowseTrash: true,
    trashedBy: { event: Events.TABLE_DELETE, idKey: 'tableId' },
    url: (baseId, resourceId, viewId) =>
      viewId
        ? `/base/${baseId}/table/${resourceId}/${viewId}`
        : `/base/${baseId}/table/${resourceId}`,
    folderDeleteOrder: 4,
    folderDeletePreviewKind: 'table',
    nodeEvents: {
      create: Events.TABLE_CREATE,
      update: Events.TABLE_UPDATE,
      delete: Events.TABLE_DELETE,
      payloadKey: 'table',
    },
    dbTable: { name: 'table_meta', hasIcon: true, hasDescription: true, spaceSearch: true },
  },
  [TrashType.Folder]: {
    level: ResourceLevel.Node,
    noun: 'folder',
    actions: {
      read: 'base|read',
      create: 'base|update',
      update: 'base|update',
      delete: 'base|update',
    },
    restoreOn: ResourceScopeTarget.Base,
    requiredToBrowseTrash: false,
    trashedBy: null,
    nodeEvents: {
      create: Events.BASE_FOLDER_CREATE,
      update: Events.BASE_FOLDER_UPDATE,
      delete: Events.BASE_FOLDER_DELETE,
      payloadKey: 'folder',
    },
    dbTable: {
      name: 'base_node_folder',
      hasIcon: false,
      hasDescription: false,
      spaceSearch: false,
    },
  },
  [TrashType.Dashboard]: {
    level: ResourceLevel.Node,
    noun: 'dashboard',
    actions: {
      read: 'base|read',
      create: 'base|update',
      update: 'base|update',
      delete: 'base|update',
    },
    restoreOn: ResourceScopeTarget.Base,
    requiredToBrowseTrash: false,
    trashedBy: { event: Events.DASHBOARD_DELETE, idKey: 'dashboardId' },
    url: (baseId, resourceId) => `/base/${baseId}/dashboard/${resourceId}`,
    folderDeleteOrder: 2,
    nodeEvents: {
      create: Events.DASHBOARD_CREATE,
      update: Events.DASHBOARD_UPDATE,
      delete: Events.DASHBOARD_DELETE,
      payloadKey: 'dashboard',
    },
    dbTable: { name: 'dashboard', hasIcon: false, hasDescription: false, spaceSearch: true },
    lastVisit: {},
  },
  [TrashType.App]: {
    level: ResourceLevel.Node,
    noun: 'app',
    actions: { read: 'app|read', create: 'app|create', update: 'app|update', delete: 'app|delete' },
    restoreOn: ResourceScopeTarget.Base,
    requiredToBrowseTrash: true,
    trashedBy: { event: Events.APP_DELETE, idKey: 'appId' },
    url: (baseId, resourceId) => `/base/${baseId}/app/${resourceId}`,
    folderDeleteOrder: 3,
    folderDeletePreviewKind: 'app',
    nodeEvents: {
      create: Events.APP_CREATE,
      update: Events.APP_UPDATE,
      delete: Events.APP_DELETE,
      payloadKey: 'app',
    },
    dbTable: { name: 'app', hasIcon: false, hasDescription: true, spaceSearch: true },
    lastVisit: { firstBy: { column: 'last_modified_time', direction: SortFunc.Desc } },
  },
  [TrashType.Workflow]: {
    level: ResourceLevel.Node,
    noun: 'automation',
    actions: {
      read: 'automation|read',
      create: 'automation|create',
      update: 'automation|update',
      delete: 'automation|delete',
    },
    restoreOn: ResourceScopeTarget.Base,
    requiredToBrowseTrash: true,
    trashedBy: { event: Events.WORKFLOW_DELETE, idKey: 'workflowId' },
    url: (baseId, resourceId) => `/base/${baseId}/automation/${resourceId}`,
    folderDeleteOrder: 0,
    folderDeletePreviewKind: 'workflow',
    nodeEvents: {
      create: Events.WORKFLOW_CREATE,
      update: Events.WORKFLOW_UPDATE,
      delete: Events.WORKFLOW_DELETE,
      payloadKey: 'workflow',
    },
    dbTable: { name: 'workflow', hasIcon: false, hasDescription: true, spaceSearch: true },
    lastVisit: { firstBy: { column: 'order', direction: SortFunc.Asc } },
  },
  [TrashType.Routine]: {
    level: ResourceLevel.Node,
    noun: 'routine',
    actions: {
      read: 'routine|read',
      create: 'routine|create',
      update: 'routine|update',
      delete: 'routine|delete',
    },
    restoreOn: ResourceScopeTarget.Base,
    requiredToBrowseTrash: true,
    trashedBy: { event: Events.ROUTINE_DELETE, idKey: 'routineId' },
    url: (baseId, resourceId) => `/base/${baseId}/routine/${resourceId}`,
    folderDeleteOrder: 1,
    nodeEvents: {
      create: Events.ROUTINE_CREATE,
      update: Events.ROUTINE_UPDATE,
      delete: Events.ROUTINE_DELETE,
      payloadKey: 'routine',
    },
    dbTable: { name: 'routine', hasIcon: false, hasDescription: false, spaceSearch: true },
    lastVisit: { firstBy: { column: 'created_time', direction: SortFunc.Asc } },
  },
};

/** The descriptor of a kind; undefined for a type no edition knows (a corrupt row). */
export const resourceDescriptorOf = (type: string): IResourceDescriptor | undefined =>
  RESOURCE_DESCRIPTORS[type as TrashType];
