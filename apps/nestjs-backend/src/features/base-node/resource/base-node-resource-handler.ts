import type {
  BaseNodeResourceType,
  IBaseNodeResourceMeta,
  IBaseNodeResourceMetaWithId,
  ICreateBaseNodeRo,
  IDuplicateBaseNodeRo,
  IMoveBaseNodeDependent,
  IUpdateBaseNodeRo,
} from '@teable/openapi';
import type { PreviewEffect } from '@teable/v2-command-explain';
import type { ITableMovePlan } from '../../table/table-move.service';
import type { IDependencyEdge } from '../base-dependency-graph.service';
import type { IMoveNodeContext } from '../base-node-move.service';
import type {
  IFolderDeleteItem,
  IFolderDeleteReference,
  IFolderSubtreeNode,
} from '../base-node.service';

/** A resource as the node list reads it, before the users it names are looked up. */
export type IBaseNodeResourceInput = Omit<
  IBaseNodeResourceMeta,
  'createdByUser' | 'lastModifiedByUser' | 'createdTime' | 'lastModifiedTime'
> & {
  id: string;
  type?: BaseNodeResourceType;
  createdBy?: string | null;
  createdTime?: Date | string | null;
  lastModifiedBy?: string | null;
  lastModifiedTime?: Date | string | null;
};

/** What creating one takes: the node route's body, less where the node goes. */
export type IBaseNodeResourceCreateRo = Omit<ICreateBaseNodeRo, 'resourceType' | 'parentId'>;

/**
 * What the project's node tree does to the resource behind a node of one kind. The tree keeps the
 * nodes; the handler reads, creates, renames, copies and deletes what they point at.
 */
export interface IBaseNodeResourceHandler {
  readonly type: BaseNodeResourceType;
  /** The project's live ones, or those of them named. */
  list(baseId: string, ids?: string[]): Promise<IBaseNodeResourceInput[]>;
  create(baseId: string, ro: IBaseNodeResourceCreateRo): Promise<IBaseNodeResourceMetaWithId>;
  update(baseId: string, id: string, ro: IUpdateBaseNodeRo): Promise<void>;
  /** Unset for a kind that is not copied. */
  duplicate?(
    baseId: string,
    id: string,
    ro: IDuplicateBaseNodeRo
  ): Promise<IBaseNodeResourceMetaWithId>;
  delete(baseId: string, id: string, permanent?: boolean): Promise<void>;
  /**
   * Before a folder delete trashes its subtree, under its lock, with every node in it: stops what
   * still works on the ones of this kind. Throwing ends the delete with nothing deleted.
   */
  beforeFolderDelete?(baseId: string, subtree: IFolderSubtreeNode[]): Promise<void>;
  /** What deleting a folder holding these items does beyond them; every item is passed. */
  folderDeleteEffects?(
    baseId: string,
    items: IFolderDeleteItem[],
    reference: IFolderDeleteReference
  ): Promise<PreviewEffect[]>;
  /** Its edges to the project's tables, for the graph a cross-project move checks. */
  dependencyEdges?(baseId: string, tableIds: string[]): Promise<IDependencyEdge[]>;
  /** The names of these in a project, for a move's preview. */
  getNames?(baseId: string, ids: string[]): Promise<Map<string, string>>;
  /**
   * Re-homes the moved ones, in the move's metadata transaction; unset for a kind that does not
   * move. Kinds move in the handler list's order: tables before what references them.
   */
  moveResources?(ctx: IMoveNodeContext, plan: ITableMovePlan): Promise<void>;
  /** Ones that reference a table across projects once the move is done, in either direction. */
  listMoveDependents?(ctx: IMoveNodeContext): Promise<IMoveBaseNodeDependent[]>;
}

/** The handlers an edition's base-node module lists, in the order the tree lists their kinds. */
export const BASE_NODE_RESOURCE_HANDLERS = Symbol('BASE_NODE_RESOURCE_HANDLERS');
