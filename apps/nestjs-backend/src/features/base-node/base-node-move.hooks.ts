import type {
  IMoveBaseNodeDependent,
  IMoveBaseNodeEmbeddedIdApp,
  IMoveBaseNodeItem,
  IMoveBaseNodeRo,
} from '@teable/openapi';
import type { IMoveNodeContext } from './base-node-move.service';
import type { IBaseNodePermissionContext, IBaseNodeVisibilityContext } from './types';

/**
 * What an edition's authority model adds to a cross-project move: the mover's standing in each
 * project beyond their base role, and what becomes of the rules bound to the nodes moved.
 */
export interface IBaseNodeMovePermissionProvider {
  /** The mover's standing in the source project, given what their base role grants there. */
  getSourcePermissionContext(
    baseId: string,
    base: IBaseNodePermissionContext
  ): Promise<IBaseNodePermissionContext>;
  /** The mover's standing in the target project; `byRole` answers from their base role. */
  getTargetPermissionContext(
    baseId: string,
    byRole: () => Promise<IBaseNodePermissionContext | undefined>
  ): Promise<IBaseNodePermissionContext | undefined>;
  /** What a check made outside the project's routes sees, given the target standing. */
  getPermissionContextOutsideRoute(
    baseId: string,
    context: IBaseNodePermissionContext | undefined
  ): Promise<IBaseNodeVisibilityContext | undefined>;
  /** Rules bound to the moved nodes in the source project that the move drops. */
  countDroppedPermissionRules(ctx: IMoveNodeContext): Promise<number>;
  /** In the metadata transaction, once every row is re-homed. */
  afterMetaMove(ctx: IMoveNodeContext): Promise<void>;
  /** Once the move has committed. */
  afterMoveCommitted(ctx: IMoveNodeContext): Promise<void>;
}

/** The authority model's provider, when an edition has one. */
export const BASE_NODE_MOVE_PERMISSION_PROVIDER = Symbol('BASE_NODE_MOVE_PERMISSION_PROVIDER');

/**
 * What an edition does around a move beyond each kind's own re-homing: reading its apps' source,
 * their sandboxes, and the records that follow every moved resource.
 */
export interface IBaseNodeMoveExtension {
  /** Reads the source of every app in the project; returns the apps it could not read. */
  readAppSources(ctx: IMoveNodeContext): Promise<IMoveBaseNodeEmbeddedIdApp[]>;
  /** Moved apps whose own source names the project they are leaving. */
  inspectMovedApps(ctx: IMoveNodeContext): Promise<IMoveBaseNodeEmbeddedIdApp[]>;
  /** Moved apps whose sandbox is running. */
  collectSandboxApps(ctx: IMoveNodeContext): Promise<IMoveBaseNodeItem[]>;
  /** Dependents the node kinds do not report themselves, listed after theirs. */
  collectDependents(ctx: IMoveNodeContext): Promise<IMoveBaseNodeDependent[]>;
  /** Once the move is certain to be attempted, before anything changes; may refuse it. */
  beforeMove(ctx: IMoveNodeContext, ro: IMoveBaseNodeRo): Promise<void>;
  /** In the metadata transaction, after every kind's resources moved. */
  afterResourcesMoved(ctx: IMoveNodeContext): Promise<void>;
  /** Once the move has committed, before its deferred tasks run. */
  afterMoveCommitted(ctx: IMoveNodeContext): Promise<void>;
}

/** The edition's move extension, when it has one. */
export const BASE_NODE_MOVE_EXTENSION = Symbol('BASE_NODE_MOVE_EXTENSION');
