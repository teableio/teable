import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { BaseNodeResourceType } from './types';

export const MOVE_BASE_NODE_CHECK = '/base/{baseId}/node/{nodeId}/move-check';

export const moveBaseNodeCheckRoSchema = z.object({
  targetBaseId: z.string(),
  /** extra nodes to move in the same operation; the preview accounts for them */
  additionalNodeIds: z.array(z.string()).optional(),
});

export type IMoveBaseNodeCheckRo = z.infer<typeof moveBaseNodeCheckRoSchema>;

export enum MoveBaseNodeBlockerCode {
  SameBase = 'same_base',
  TargetNotFound = 'target_not_found',
  DifferentSpace = 'different_space',
  V2Mismatch = 'v2_mismatch',
  SourceNotWritable = 'source_not_writable',
  TargetNotWritable = 'target_not_writable',
  NoSourcePermission = 'no_source_permission',
  NoTargetPermission = 'no_target_permission',
  FolderNameConflict = 'folder_name_conflict',
  UnsupportedResource = 'unsupported_resource',
  PendingComputedTasks = 'pending_computed_tasks',
}

export const moveBaseNodeItemSchema = z.object({
  nodeId: z.string(),
  resourceType: z.nativeEnum(BaseNodeResourceType),
  resourceId: z.string(),
  name: z.string(),
});

export type IMoveBaseNodeItem = z.infer<typeof moveBaseNodeItemSchema>;

export const moveBaseNodeBlockerSchema = z.object({
  code: z.nativeEnum(MoveBaseNodeBlockerCode),
  /** node the blocker applies to; absent for base-level blockers */
  node: moveBaseNodeItemSchema.optional(),
});

export type IMoveBaseNodeBlocker = z.infer<typeof moveBaseNodeBlockerSchema>;

/**
 * A link-family field whose two ends will live in different projects after the
 * move. Data is untouched: the link keeps working as a cross-project link.
 */
export const moveBaseNodeCrossBaseLinkSchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  fieldId: z.string(),
  fieldName: z.string(),
  type: z.string(),
  foreignTableId: z.string(),
  foreignTableName: z.string(),
  /** 'outgoing': the field lives on a moved table; 'incoming': it lives on a table staying behind */
  direction: z.enum(['outgoing', 'incoming']),
});

export type IMoveBaseNodeCrossBaseLink = z.infer<typeof moveBaseNodeCrossBaseLinkSchema>;

/**
 * A resource that is not part of the move but references a moved table by id
 * (workflow trigger/action, dashboard plugin, app). It keeps its reference and
 * may fail at runtime because the table now lives in another project.
 */
export const moveBaseNodeDependentSchema = z.object({
  resourceType: z.nativeEnum(BaseNodeResourceType),
  resourceId: z.string(),
  name: z.string(),
  /** the moved table(s) it references */
  tableIds: z.array(z.string()),
  /** the reference was inferred by scanning source, so it may be wrong or incomplete */
  uncertain: z.boolean().optional(),
});

export type IMoveBaseNodeDependent = z.infer<typeof moveBaseNodeDependentSchema>;

/**
 * A node of the source project that is connected to something being moved and
 * can be brought along. Picking one and asking again narrows the warnings and
 * may surface what that node is in turn connected to.
 */
export const moveBaseNodeCandidateSchema = z.object({
  nodeId: z.string(),
  resourceType: z.nativeEnum(BaseNodeResourceType),
  resourceId: z.string(),
  name: z.string(),
  /**
   * 'reference': an automation, app or dashboard names the other side by id,
   * so leaving them apart can break it at run time.
   * 'link': a link field connects them; the data keeps working across projects.
   */
  reason: z.enum(['reference', 'link']),
  /**
   * Which end of that connection it is, and so who suffers if the two are
   * separated. 'dependent': it names something being moved, so it is the thing
   * that stops working. 'dependency': something being moved names it, so it is
   * unharmed and what breaks is the mover that loses sight of it.
   */
  role: z.enum(['dependent', 'dependency']),
  /** names of the items it is connected to, moving ones and other candidates alike */
  relatedNames: z.array(z.string()),
  /**
   * Node ids behind {@link relatedNames}, in the same order. A client can hang
   * this candidate under whichever of them it is already showing and so draw
   * the reachable set as the tree the search actually walked.
   */
  relatedNodeIds: z.array(z.string()),
  /** hops from the node being moved; 1 is directly connected to it */
  depth: z.number(),
  /** the connection was inferred by scanning source, so it may be wrong or incomplete */
  uncertain: z.boolean().optional(),
});

export type IMoveBaseNodeCandidate = z.infer<typeof moveBaseNodeCandidateSchema>;

/**
 * An app being moved whose own source names the project it is leaving.
 *
 * The move never edits an app's code: the platform re-issues the token and
 * rebuilds the injected environment, and the source stays exactly as written.
 * So an app listed here will keep reading the project it left until someone
 * opens it and changes that, which is the whole reason this list is reported
 * rather than quietly acted on. The count comes from a source scan, so it is a
 * floor and not a total — ids the app assembles at run time never appear.
 */
export const moveBaseNodeEmbeddedIdAppSchema = z.object({
  resourceId: z.string(),
  name: z.string(),
  /** places the old project id appears in its source; 0 when it could not be read */
  occurrences: z.number(),
});

export type IMoveBaseNodeEmbeddedIdApp = z.infer<typeof moveBaseNodeEmbeddedIdAppSchema>;

export const moveBaseNodeCheckVoSchema = z.object({
  allowed: z.boolean(),
  blockers: z.array(moveBaseNodeBlockerSchema),
  /** every node that will change project (the node itself plus, for folders, its subtree) */
  nodes: z.array(moveBaseNodeItemSchema),
  crossBaseLinks: z.array(moveBaseNodeCrossBaseLinkSchema),
  dependents: z.array(moveBaseNodeDependentSchema),
  /** connected nodes that could move along, none of them already moving */
  candidates: z.array(moveBaseNodeCandidateSchema),
  /** moved apps whose source hard-codes the id of the project they are leaving */
  embeddedIdApps: z.array(moveBaseNodeEmbeddedIdAppSchema),
  /** moved apps whose source could not be read, so nothing about them was checked */
  uninspectableApps: z.array(moveBaseNodeEmbeddedIdAppSchema),
  /** authority-matrix / node permission rules on moved nodes that will be dropped (EE) */
  droppedPermissionRuleCount: z.number(),
  /**
   * Everything that would have to travel for no reference to be pulled apart:
   * the transitive closure over reference edges, minus whatever is already
   * moving. Pass it back as `additionalNodeIds` to ask about that whole set —
   * the answer then carries its blockers and its side effects too, and holds no
   * broken reference left.
   *
   * References a scan only found in text are included. Excluding them would
   * leave their owners behind while taking what they point at, so a node might
   * end up missing more than if nothing had been brought along at all. The
   * guard against over-moving is the size of this set, shown before it is
   * accepted, not a quietly narrower definition of it.
   */
  dependencyClosure: z.array(moveBaseNodeItemSchema),
});

export type IMoveBaseNodeCheckVo = z.infer<typeof moveBaseNodeCheckVoSchema>;

export const MoveBaseNodeCheckRoute: RouteConfig = registerRoute({
  method: 'post',
  path: MOVE_BASE_NODE_CHECK,
  title: 'Preview moving a project node to another project',
  description:
    'Dry-run of moving a node into another project of the same space: reports blockers and side effects without changing anything.',
  request: {
    params: z.object({
      baseId: z.string(),
      nodeId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: moveBaseNodeCheckRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Move preview',
      content: {
        'application/json': {
          schema: moveBaseNodeCheckVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const moveBaseNodeCheck = async (
  baseId: string,
  nodeId: string,
  ro: IMoveBaseNodeCheckRo
) => {
  return axios.post<IMoveBaseNodeCheckVo>(urlBuilder(MOVE_BASE_NODE_CHECK, { baseId, nodeId }), ro);
};
