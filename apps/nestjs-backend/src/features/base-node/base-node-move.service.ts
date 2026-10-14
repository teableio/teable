/* eslint-disable sonarjs/no-duplicate-string */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Action, IBaseRole } from '@teable/core';
import { HttpErrorCode, Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IMoveBaseNodeBlocker,
  IMoveBaseNodeCandidate,
  IMoveBaseNodeCheckVo,
  IMoveBaseNodeCrossBaseLink,
  IMoveBaseNodeDependent,
  IMoveBaseNodeEmbeddedIdApp,
  IMoveBaseNodeItem,
} from '@teable/openapi';
import {
  BaseNodeResourceType,
  CollaboratorType,
  MoveBaseNodeBlockerCode,
  PrincipalType,
  IMoveBaseNodeRo,
} from '@teable/openapi';
import { keyBy } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { type IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { DistributedLockService } from '../../distributed-lock/distributed-lock.service';
import {
  generateBaseNodeListCacheKey,
  generateBaseShareListCacheKey,
} from '../../performance-cache/generate-keys';
import { PerformanceCacheService } from '../../performance-cache/service';
import type { IPerformanceCacheStore } from '../../performance-cache/types';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { AuditScope } from '../audit/audit-scope';
import { Audit } from '../audit/audit.decorator';
import { PermissionService } from '../auth/permission.service';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { SpaceDataDbMigrationGuardService } from '../space/space-data-db-migration-guard.service';
import type { ITableMovePlan } from '../table/table-move.service';
import { TableMoveService } from '../table/table-move.service';
import { BaseDependencyGraphService, nodeKey, parseNodeKey } from './base-dependency-graph.service';
import type { INodeKey } from './base-dependency-graph.service';
import { checkBaseNodePermission } from './base-node.permission.helper';
import { presenceHandler } from './helper';
import type { IBaseNodePermissionContext } from './types';
import { BaseNodeAction } from './types';

export type IMoveNodeEntry = {
  id: string;
  parentId: string | null;
  resourceType: BaseNodeResourceType;
  resourceId: string;
};

/**
 * Everything both phases of a cross-project move share. Built once by
 * `prepare`, consumed by `check` and `move`.
 */
export type IMoveNodeContext = {
  sourceBaseId: string;
  targetBaseId: string;
  spaceId: string;
  root: IMoveNodeEntry;
  /** root first, then its folder subtree, then any extra node brought along */
  nodes: IMoveNodeEntry[];
  items: IMoveBaseNodeItem[];
  /** resource ids grouped by type across the whole subtree */
  resourceIds: Map<BaseNodeResourceType, string[]>;
  tableIds: string[];
  blockers: IMoveBaseNodeBlocker[];
  crossBaseLinks: IMoveBaseNodeCrossBaseLink[];
  dependents: IMoveBaseNodeDependent[];
  candidates: IMoveBaseNodeCandidate[];
  dependencyClosure: IMoveBaseNodeItem[];
  embeddedIdApps: IMoveBaseNodeEmbeddedIdApp[];
  uninspectableApps: IMoveBaseNodeEmbeddedIdApp[];
  droppedPermissionRuleCount: number;
};

/**
 * Moves a project node (a folder's whole subtree included) into another
 * project of the same space.
 *
 * The node tree part is trivial; the work is re-homing each resource, which is
 * type-specific and edition-specific. Community handles folders, tables and
 * dashboards; the enterprise edition extends the protected hooks for
 * workflows, apps, routines and its permission matrix.
 */
@Injectable()
export class BaseNodeMoveService {
  protected readonly logger = new Logger(BaseNodeMoveService.name);

  constructor(
    protected readonly prismaService: PrismaService,
    protected readonly cls: ClsService<IClsStore>,
    protected readonly permissionService: PermissionService,
    protected readonly performanceCacheService: PerformanceCacheService<IPerformanceCacheStore>,
    protected readonly shareDbService: ShareDbService,
    protected readonly tableMoveService: TableMoveService,
    protected readonly dashboardService: DashboardService,
    protected readonly collaboratorService: CollaboratorService,
    protected readonly dependencyGraphService: BaseDependencyGraphService,
    @ThresholdConfig() protected readonly thresholdConfig: IThresholdConfig,
    @Inject(AuditScope) protected readonly audit: AuditScope,
    @Optional()
    @Inject(SpaceDataDbMigrationGuardService)
    protected readonly spaceDataDbMigrationGuard?: SpaceDataDbMigrationGuardService,
    @Optional()
    @Inject(DistributedLockService)
    protected readonly distributedLockService?: DistributedLockService
  ) {}

  // ---------------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------------

  async check(
    baseId: string,
    nodeId: string,
    targetBaseId: string,
    additionalNodeIds?: string[]
  ): Promise<IMoveBaseNodeCheckVo> {
    const ctx = await this.prepare(baseId, nodeId, targetBaseId, additionalNodeIds);
    return this.toCheckVo(ctx);
  }

  /**
   * Returns the id of the moved root node (unchanged) so the caller can read
   * it back from the target project.
   */
  @Audit({
    action: 'base.node.move',
    resourceId: (baseId: string) => baseId,
    params: (_baseId: string, nodeId: string, ro: IMoveBaseNodeRo) => ({
      nodeId,
      targetBaseId: ro.targetBaseId,
      additionalNodeIds: ro.additionalNodeIds,
    }),
    emit: true,
  })
  async move(baseId: string, nodeId: string, ro: IMoveBaseNodeRo): Promise<string> {
    const targetBaseId = ro.targetBaseId;
    if (!targetBaseId) {
      throw new CustomHttpException('targetBaseId is required', HttpErrorCode.VALIDATION_ERROR, {
        localization: { i18nKey: 'httpErrors.baseNode.targetBaseRequired' },
      });
    }
    let movedNodeId = '';
    await this.withMoveLocks([baseId, targetBaseId], async () => {
      movedNodeId = await this.moveLocked(baseId, nodeId, targetBaseId, ro);
    });
    return movedNodeId;
  }

  /**
   * Two moves touching the same project at once would read the same node
   * rows and physical names, then both try to relocate them; the second
   * would find its tables already gone. One move per project at a time, and
   * a second caller is told to retry rather than queued: a move is fast, and
   * queueing behind one means re-deciding on stale preview data anyway.
   */
  private async withMoveLocks(baseIds: string[], task: () => Promise<void>): Promise<void> {
    if (!this.distributedLockService || baseIds.length === 0) {
      await task();
      return;
    }
    const [head, ...rest] = baseIds;
    const ttlSeconds = Math.ceil(this.thresholdConfig.bigTransactionTimeout / 1000) + 30;
    const ran = await this.distributedLockService.runExclusive(
      `base-node-move:${head}`,
      ttlSeconds,
      () => this.withMoveLocks(rest, task)
    );
    if (!ran) {
      throw new CustomHttpException(
        `Another move involving project ${head} is in progress`,
        HttpErrorCode.CONFLICT,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.moveBlocked',
            context: { code: 'move_in_progress' },
          },
        }
      );
    }
  }

  private async moveLocked(
    baseId: string,
    nodeId: string,
    targetBaseId: string,
    ro: IMoveBaseNodeRo
  ): Promise<string> {
    const ctx = await this.prepare(baseId, nodeId, targetBaseId, ro.additionalNodeIds);
    if (ctx.blockers.length > 0) {
      const { code } = ctx.blockers[0];
      throw new CustomHttpException(
        `Cannot move node ${nodeId} to project ${targetBaseId}: ${code}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.moveBlocked',
            context: { code },
          },
        }
      );
    }

    const placement = await this.resolveTargetPlacement(ctx, ro);
    const plan = await this.tableMoveService.prepareMove(baseId, targetBaseId, ctx.tableIds);

    try {
      await this.prismaService.$tx(
        async () => {
          await this.moveResources(ctx, plan, ro);
          await this.ensurePluginCollaborators(ctx);
          await this.moveShares(ctx);
          await this.moveNodeRows(ctx, placement);
          await this.afterMetaMove(ctx);
          /**
           * Last, so the two halves are as close to simultaneous as two
           * databases allow.
           *
           * Table data lives in a schema named after its project and every
           * query is built from the name the metadata records, so the physical
           * relocation and the metadata have to agree. They cannot commit
           * together — the data lives behind its own connection, and may be a
           * different server entirely — so there is always a window where one
           * has landed and the other has not, and a process killed inside it
           * leaves tables that are intact but unreachable.
           *
           * Running it here does not close that window, it shrinks it to a
           * single commit. Ahead of the transaction it spanned everything
           * above: a token re-minted per app, a snapshot rewritten per
           * workflow, each with its own network call.
           *
           * Nothing above reads table *data* — the metadata phase only rewrites
           * rows in the main database — so the tables being still in the old
           * schema for the length of this transaction is not observable here.
           */
          await this.tableMoveService.applyPhysicalMove(plan);
        },
        { timeout: this.thresholdConfig.bigTransactionTimeout }
      );
    } catch (error) {
      this.logger.error(
        `[move-node] failed: node=${nodeId} ${baseId} -> ${targetBaseId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      await this.tableMoveService.rollbackPhysicalMove(plan);
      throw error;
    }

    await this.afterMoveCommitted(ctx, plan);
    return ctx.root.id;
  }

  // ---------------------------------------------------------------------------
  // preparation & checks
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line sonarjs/cognitive-complexity
  protected async prepare(
    baseId: string,
    nodeId: string,
    targetBaseId: string,
    additionalNodeIds?: string[]
  ): Promise<IMoveNodeContext> {
    const prisma = this.prismaService.txClient();
    const rootRow = await prisma.baseNode.findFirst({
      where: { baseId, id: nodeId },
      select: { id: true, parentId: true, resourceType: true, resourceId: true },
    });
    if (!rootRow) {
      throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
        localization: { i18nKey: 'httpErrors.baseNode.notFound' },
      });
    }
    const root = this.toEntry(rootRow);
    const nodes = await this.collectNodes(baseId, root, additionalNodeIds);

    const resourceIds = new Map<BaseNodeResourceType, string[]>();
    for (const node of nodes) {
      const list = resourceIds.get(node.resourceType) ?? [];
      list.push(node.resourceId);
      resourceIds.set(node.resourceType, list);
    }
    const tableIds = resourceIds.get(BaseNodeResourceType.Table) ?? [];

    const bases = await prisma.base.findMany({
      where: { id: { in: [baseId, targetBaseId] }, deletedTime: null },
      select: { id: true, spaceId: true, v2Enabled: true },
    });
    const source = bases.find((b) => b.id === baseId);
    const target = bases.find((b) => b.id === targetBaseId);

    const ctx: IMoveNodeContext = {
      sourceBaseId: baseId,
      targetBaseId,
      spaceId: source?.spaceId ?? '',
      root,
      nodes,
      items: await this.buildItems(baseId, nodes),
      resourceIds,
      tableIds,
      blockers: [],
      crossBaseLinks: [],
      dependents: [],
      candidates: [],
      dependencyClosure: [],
      embeddedIdApps: [],
      uninspectableApps: [],
      droppedPermissionRuleCount: 0,
    };

    // --- base level ---------------------------------------------------------
    if (targetBaseId === baseId) {
      ctx.blockers.push({ code: MoveBaseNodeBlockerCode.SameBase });
      return ctx;
    }
    if (!target || !source) {
      ctx.blockers.push({ code: MoveBaseNodeBlockerCode.TargetNotFound });
      return ctx;
    }
    if (target.spaceId !== source.spaceId) {
      ctx.blockers.push({ code: MoveBaseNodeBlockerCode.DifferentSpace });
    }
    if (Boolean(target.v2Enabled) !== Boolean(source.v2Enabled)) {
      ctx.blockers.push({ code: MoveBaseNodeBlockerCode.V2Mismatch });
    }
    if (!(await this.isBaseWritable(baseId))) {
      ctx.blockers.push({ code: MoveBaseNodeBlockerCode.SourceNotWritable });
    }
    if (!(await this.isBaseWritable(targetBaseId))) {
      ctx.blockers.push({ code: MoveBaseNodeBlockerCode.TargetNotWritable });
    }

    // --- node level ---------------------------------------------------------
    const supported = new Set(this.getSupportedResourceTypes());
    const itemMap = keyBy(ctx.items, 'nodeId');
    for (const node of nodes) {
      if (!supported.has(node.resourceType)) {
        ctx.blockers.push({
          code: MoveBaseNodeBlockerCode.UnsupportedResource,
          node: itemMap[node.id],
        });
      }
    }

    // A node of a kind this edition cannot move is reported above and left out
    // of the checks below: the permission map has no row for a type it does not
    // know, and there is nothing to say about the permissions of a move that
    // cannot happen.
    await this.checkPermissions(
      ctx,
      itemMap,
      ctx.nodes.filter((node) => supported.has(node.resourceType))
    );
    await this.checkFolders(ctx, itemMap);

    if (tableIds.length > 0) {
      const pending = await this.tableMoveService.countPendingComputedTasks(baseId, tableIds);
      if (pending > 0) {
        ctx.blockers.push({ code: MoveBaseNodeBlockerCode.PendingComputedTasks });
      }
    }

    // --- side effects (informational) --------------------------------------
    // First, because everything below reads what this leaves behind, and it is
    // the one place that decides how much source a check is willing to read.
    ctx.uninspectableApps = await this.readAppSources(ctx);
    ctx.crossBaseLinks = await this.tableMoveService.collectCrossBaseLinks(baseId, tableIds);
    ctx.dependents = await this.collectDependents(ctx);
    ctx.droppedPermissionRuleCount = await this.countDroppedPermissionRules(ctx);
    const reachable = await this.collectCandidates(ctx);
    ctx.candidates = reachable.candidates;
    ctx.dependencyClosure = reachable.closure;
    ctx.embeddedIdApps = await this.inspectMovedApps(ctx);

    return ctx;
  }

  private toCheckVo(ctx: IMoveNodeContext): IMoveBaseNodeCheckVo {
    return {
      allowed: ctx.blockers.length === 0,
      blockers: ctx.blockers,
      nodes: ctx.items,
      crossBaseLinks: ctx.crossBaseLinks,
      dependents: ctx.dependents,
      candidates: ctx.candidates,
      dependencyClosure: ctx.dependencyClosure,
      embeddedIdApps: ctx.embeddedIdApps,
      uninspectableApps: ctx.uninspectableApps,
      droppedPermissionRuleCount: ctx.droppedPermissionRuleCount,
    };
  }

  private toEntry(row: {
    id: string;
    parentId: string | null;
    resourceType: string;
    resourceId: string;
  }): IMoveNodeEntry {
    return { ...row, resourceType: row.resourceType as BaseNodeResourceType };
  }

  /** The root's subtree plus the subtree of every node brought along, each node once. */
  private async collectNodes(
    baseId: string,
    root: IMoveNodeEntry,
    additionalNodeIds: string[] = []
  ): Promise<IMoveNodeEntry[]> {
    const nodes = await this.collectSubtree(baseId, root);
    const seen = new Set(nodes.map((n) => n.id));
    const extraIds = [...new Set(additionalNodeIds)].filter((id) => !seen.has(id));
    if (extraIds.length === 0) return nodes;

    const rows = await this.prismaService.txClient().baseNode.findMany({
      where: { baseId, id: { in: extraIds } },
      select: { id: true, parentId: true, resourceType: true, resourceId: true },
    });
    const found = new Set(rows.map((row) => row.id));
    const missing = extraIds.find((id) => !found.has(id));
    if (missing) {
      throw new CustomHttpException(`Node ${missing} not found`, HttpErrorCode.NOT_FOUND, {
        localization: { i18nKey: 'httpErrors.baseNode.notFound' },
      });
    }
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      for (const node of await this.collectSubtree(baseId, this.toEntry(row))) {
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        nodes.push(node);
      }
    }
    return nodes;
  }

  /**
   * Nodes of the source project sitting on the other end of something that is
   * moving: bringing one along keeps that reference inside a single project.
   * One level deep on purpose — picking one and asking again reveals what it
   * is in turn connected to, instead of dragging a whole graph at once.
   */
  /**
   * Everything in this project connected to what is moving.
   *
   * The project's whole dependency graph is built once and then walked, so a
   * chain — an app, the table it reads, the automation watching that table —
   * comes back in one answer instead of one ring per round trip. Breaking
   * references are followed all the way out because every hop is something
   * that stops working; link edges stop at the first ring, since they keep
   * working either way and their closure is the whole project.
   */
  /**
   * Two answers off one graph.
   *
   * `candidates` is a single ring: what stops working if only the chosen nodes
   * go. Nothing further can break, because a pair that both stay outside the
   * moving set is never pulled apart.
   *
   * `closure` is the other question — what would have to travel for no
   * reference to be split at all — so it follows every reference as far as it
   * goes, a scan's findings included.
   *
   * Leaving those out was tempting (acting on a stale id in a comment moves a
   * node for nothing) but it breaks the promise and can make things worse: a
   * node left behind on an unread edge may reference several nodes the closure
   * *does* take, so ticking the box would cost it more references than leaving
   * everything alone did. Partial co-location is the one outcome to avoid, and
   * the honest guard against over-moving is the count on the offer, not a
   * quietly narrower set.
   */
  private async collectCandidates(
    ctx: IMoveNodeContext
  ): Promise<{ candidates: IMoveBaseNodeCandidate[]; closure: IMoveBaseNodeItem[] }> {
    const movingKeys = ctx.nodes.map((node) => nodeKey(node.resourceType, node.resourceId));
    const graph = await this.dependencyGraphService.build(ctx.sourceBaseId);
    const found = graph.search(movingKeys, { referenceDepth: 1 });
    const closureKeys = new Set(
      graph
        .search(movingKeys)
        .filter((item) => item.kind === 'reference')
        .map((item) => item.key)
    );
    if (found.length === 0 && closureKeys.size === 0) return { candidates: [], closure: [] };

    const rows = await this.prismaService.txClient().baseNode.findMany({
      where: {
        baseId: ctx.sourceBaseId,
        OR: [...new Set([...found.map((item) => item.key), ...closureKeys])].map(parseNodeKey),
      },
      select: { id: true, parentId: true, resourceType: true, resourceId: true },
    });
    const named = await this.buildItems(
      ctx.sourceBaseId,
      rows.map((row) => this.toEntry(row))
    );

    // a neighbour can be reached from something moving or from another
    // neighbour, so both sides feed the lookup
    const reached = new Map<INodeKey, { name: string; nodeId: string }>();
    const remember = (item: IMoveBaseNodeItem) =>
      reached.set(nodeKey(item.resourceType, item.resourceId), {
        name: item.name,
        nodeId: item.nodeId,
      });
    ctx.items.forEach(remember);
    named.forEach(remember);

    const byKey = new Map(found.map((item) => [item.key, item]));
    const closure = named.filter((item) =>
      closureKeys.has(nodeKey(item.resourceType, item.resourceId))
    );
    const candidates = named
      .map((item) => {
        const hit = byKey.get(nodeKey(item.resourceType, item.resourceId));
        if (!hit) return undefined;
        const related = hit.reachedFrom
          .map((key) => reached.get(key))
          .filter((entry): entry is { name: string; nodeId: string } => Boolean(entry));
        return {
          ...item,
          reason: hit.kind,
          role: hit.role,
          depth: hit.depth,
          relatedNames: related.map((entry) => entry.name),
          relatedNodeIds: related.map((entry) => entry.nodeId),
          ...(hit.uncertain ? { uncertain: true } : {}),
        };
      })
      .filter((item): item is IMoveBaseNodeCandidate => Boolean(item))
      .sort(
        (a, b) =>
          a.depth - b.depth || Number(b.reason === 'reference') - Number(a.reason === 'reference')
      );
    return { candidates, closure };
  }

  private async collectSubtree(baseId: string, root: IMoveNodeEntry): Promise<IMoveNodeEntry[]> {
    const nodes: IMoveNodeEntry[] = [root];
    let frontier = [root.id];
    const seen = new Set(frontier);
    while (frontier.length > 0) {
      const children = await this.prismaService.txClient().baseNode.findMany({
        where: { baseId, parentId: { in: frontier } },
        select: { id: true, parentId: true, resourceType: true, resourceId: true },
        orderBy: { order: 'asc' },
      });
      frontier = [];
      for (const child of children) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        nodes.push(this.toEntry(child));
        frontier.push(child.id);
      }
    }
    return nodes;
  }

  private async buildItems(baseId: string, nodes: IMoveNodeEntry[]): Promise<IMoveBaseNodeItem[]> {
    const byType = new Map<BaseNodeResourceType, string[]>();
    nodes.forEach((n) =>
      byType.set(n.resourceType, [...(byType.get(n.resourceType) ?? []), n.resourceId])
    );
    const names = new Map<string, string>();
    for (const [type, ids] of byType) {
      const resolved = await this.resolveResourceNames(baseId, type, ids);
      resolved.forEach((name, id) => names.set(`${type}_${id}`, name));
    }
    return nodes.map((n) => ({
      nodeId: n.id,
      resourceType: n.resourceType,
      resourceId: n.resourceId,
      name: names.get(`${n.resourceType}_${n.resourceId}`) ?? n.resourceId,
    }));
  }

  private async isBaseWritable(baseId: string): Promise<boolean> {
    if (!this.spaceDataDbMigrationGuard) return true;
    try {
      await this.spaceDataDbMigrationGuard.assertBaseWritable(baseId);
      return true;
    } catch {
      return false;
    }
  }

  private async checkPermissions(
    ctx: IMoveNodeContext,
    itemMap: Record<string, IMoveBaseNodeItem>,
    nodes: IMoveNodeEntry[]
  ) {
    const sourceContext = await this.getSourcePermissionContext(ctx.sourceBaseId);
    const targetContext = await this.getTargetPermissionContext(ctx.targetBaseId);
    for (const node of nodes) {
      if (!checkBaseNodePermission(node, BaseNodeAction.Delete, sourceContext)) {
        ctx.blockers.push({
          code: MoveBaseNodeBlockerCode.NoSourcePermission,
          node: itemMap[node.id],
        });
      }
      if (!targetContext || !checkBaseNodePermission(node, BaseNodeAction.Create, targetContext)) {
        ctx.blockers.push({
          code: MoveBaseNodeBlockerCode.NoTargetPermission,
          node: itemMap[node.id],
        });
      }
    }
  }

  private async checkFolders(ctx: IMoveNodeContext, itemMap: Record<string, IMoveBaseNodeItem>) {
    const folderIds = ctx.resourceIds.get(BaseNodeResourceType.Folder) ?? [];
    if (folderIds.length === 0) return;
    const prisma = this.prismaService.txClient();
    const names = await prisma.baseNodeFolder.findMany({
      where: { id: { in: folderIds } },
      select: { id: true, name: true },
    });
    const conflicts = await prisma.baseNodeFolder.findMany({
      where: { baseId: ctx.targetBaseId, name: { in: names.map((f) => f.name) } },
      select: { name: true },
    });
    const conflictNames = new Set(conflicts.map((c) => c.name));
    for (const folder of names) {
      if (!conflictNames.has(folder.name)) continue;
      const node = ctx.nodes.find(
        (n) => n.resourceType === BaseNodeResourceType.Folder && n.resourceId === folder.id
      );
      ctx.blockers.push({
        code: MoveBaseNodeBlockerCode.FolderNameConflict,
        node: node ? itemMap[node.id] : undefined,
      });
    }
  }

  /**
   * Resolves where the root lands in the target project and enforces the
   * folder-depth limit there. `parentId` names a folder node of the target;
   * `anchorId` a sibling in the target whose parent is used (the node is
   * appended after the last sibling — exact anchor ordering is a same-project
   * concern).
   */
  private async resolveTargetPlacement(
    ctx: IMoveNodeContext,
    ro: IMoveBaseNodeRo
  ): Promise<{ parentId: string | null }> {
    const prisma = this.prismaService.txClient();
    let parentId: string | null = null;
    if (ro.parentId) {
      const parent = await prisma.baseNode.findFirst({
        where: { baseId: ctx.targetBaseId, id: ro.parentId },
        select: { id: true, resourceType: true },
      });
      if (!parent) {
        throw new CustomHttpException(`Parent ${ro.parentId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: { i18nKey: 'httpErrors.baseNode.parentNotFound' },
        });
      }
      if (parent.resourceType !== BaseNodeResourceType.Folder) {
        throw new CustomHttpException(
          `Parent ${ro.parentId} is not a folder`,
          HttpErrorCode.VALIDATION_ERROR,
          { localization: { i18nKey: 'httpErrors.baseNode.parentIsNotFolder' } }
        );
      }
      parentId = parent.id;
    } else if (ro.anchorId) {
      const anchor = await prisma.baseNode.findFirst({
        where: { baseId: ctx.targetBaseId, id: ro.anchorId },
        select: { parentId: true },
      });
      if (!anchor) {
        throw new CustomHttpException(`Anchor ${ro.anchorId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: { i18nKey: 'httpErrors.baseNode.anchorNotFound' },
        });
      }
      parentId = anchor.parentId;
    }

    const subtreeDepth = this.getFolderSubtreeDepth(ctx);
    const parentDepth = parentId ? await this.getFolderDepth(ctx.targetBaseId, parentId) : 0;
    if (parentDepth + subtreeDepth > this.thresholdConfig.baseNodeMaxFolderDepth) {
      throw new CustomHttpException('Folder depth limit exceeded', HttpErrorCode.VALIDATION_ERROR, {
        localization: { i18nKey: 'httpErrors.baseNode.folderDepthLimitExceeded' },
      });
    }
    return { parentId };
  }

  /** Number of nested folder levels the moved subtree contributes (0 for a leaf). */
  private getFolderSubtreeDepth(ctx: IMoveNodeContext): number {
    const folders = ctx.nodes.filter((n) => n.resourceType === BaseNodeResourceType.Folder);
    if (folders.length === 0) return 0;
    const childrenOf = new Map<string | null, IMoveNodeEntry[]>();
    folders.forEach((f) => {
      const list = childrenOf.get(f.parentId) ?? [];
      list.push(f);
      childrenOf.set(f.parentId, list);
    });
    const depthFrom = (id: string): number =>
      1 + Math.max(0, ...(childrenOf.get(id) ?? []).map((c) => depthFrom(c.id)));
    const movedIds = new Set(ctx.nodes.map((n) => n.id));
    const topFolders = folders.filter((f) => !f.parentId || !movedIds.has(f.parentId));
    return Math.max(0, ...topFolders.map((f) => depthFrom(f.id)));
  }

  /** Number of folders on the path from the root down to and including `nodeId`. */
  private async getFolderDepth(baseId: string, nodeId: string): Promise<number> {
    const folders = await this.prismaService.txClient().baseNode.findMany({
      where: { baseId, resourceType: BaseNodeResourceType.Folder },
      select: { id: true, parentId: true },
    });
    const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
    let depth = 0;
    let current: string | null | undefined = nodeId;
    const seen = new Set<string>();
    while (current && parentOf.has(current) && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      current = parentOf.get(current);
    }
    return depth;
  }

  // ---------------------------------------------------------------------------
  // execution
  // ---------------------------------------------------------------------------

  /** Type-specific re-homing, inside the metadata transaction. */
  protected async moveResources(
    ctx: IMoveNodeContext,
    plan: ITableMovePlan,
    _ro: IMoveBaseNodeRo
  ): Promise<void> {
    const prisma = this.prismaService.txClient();
    const folderIds = ctx.resourceIds.get(BaseNodeResourceType.Folder) ?? [];
    if (folderIds.length > 0) {
      await prisma.baseNodeFolder.updateMany({
        where: { id: { in: folderIds }, baseId: ctx.sourceBaseId },
        data: { baseId: ctx.targetBaseId, lastModifiedBy: this.cls.get('user.id') },
      });
    }

    await this.tableMoveService.applyMetaMove(plan);

    for (const id of ctx.resourceIds.get(BaseNodeResourceType.Dashboard) ?? []) {
      await this.dashboardService.moveDashboardToBase(ctx.sourceBaseId, ctx.targetBaseId, id);
    }
  }

  /**
   * Installing a plugin invites its service account into the project; the
   * installs that just changed project need that account in the target too.
   */
  private async ensurePluginCollaborators(ctx: IMoveNodeContext) {
    const prisma = this.prismaService.txClient();
    const dashboardIds = ctx.resourceIds.get(BaseNodeResourceType.Dashboard) ?? [];
    const panels =
      ctx.tableIds.length > 0
        ? await prisma.pluginPanel.findMany({
            where: { tableId: { in: ctx.tableIds } },
            select: { id: true },
          })
        : [];
    const menus =
      ctx.tableIds.length > 0
        ? await prisma.pluginContextMenu.findMany({
            where: { tableId: { in: ctx.tableIds } },
            select: { pluginInstallId: true },
          })
        : [];
    const views =
      ctx.tableIds.length > 0
        ? await prisma.view.findMany({
            where: { tableId: { in: ctx.tableIds } },
            select: { id: true },
          })
        : [];
    const positionIds = [...dashboardIds, ...panels.map((p) => p.id), ...views.map((v) => v.id)];
    const installIds = menus.map((m) => m.pluginInstallId);
    if (positionIds.length === 0 && installIds.length === 0) return;

    const installs = await prisma.pluginInstall.findMany({
      where: {
        baseId: ctx.targetBaseId,
        OR: [{ positionId: { in: positionIds } }, { id: { in: installIds } }],
      },
      select: { plugin: { select: { pluginUser: true } } },
    });
    const pluginUsers = [
      ...new Set(
        installs.map((i) => i.plugin.pluginUser).filter((id): id is string => Boolean(id))
      ),
    ];
    if (pluginUsers.length === 0) return;

    const existing = await prisma.collaborator.findMany({
      where: {
        resourceId: ctx.targetBaseId,
        resourceType: CollaboratorType.Base,
        principalType: PrincipalType.User,
        principalId: { in: pluginUsers },
      },
      select: { principalId: true },
    });
    const present = new Set(existing.map((c) => c.principalId));
    const missing = pluginUsers.filter((id) => !present.has(id));
    if (missing.length === 0) return;
    // same standing a fresh install would grant
    await this.collaboratorService.createBaseCollaborator({
      collaborators: missing.map((principalId) => ({
        principalId,
        principalType: PrincipalType.User,
      })),
      baseId: ctx.targetBaseId,
      role: Role.Owner as IBaseRole,
      skipEvent: true,
    });
  }

  /**
   * A share follows its node.
   *
   * A share row holds nothing that belongs to a project beyond the column
   * itself, and the entry point people are given carries only the share id —
   * the project is resolved from it — so that link keeps working. The unique
   * pair is (project, node) and the node travels with its own id, so the
   * destination cannot already hold a conflicting row. Whole-base shares have
   * no node and are correctly left behind.
   *
   * What does not survive is a deep URL someone copied out of the address bar:
   * those spell the project out and the share page rejects a mismatch. Revoking
   * instead would break every link including the good one, so following is the
   * better of the two — but it is not "nothing breaks".
   */
  private async moveShares(ctx: IMoveNodeContext) {
    const prisma = this.prismaService.txClient();
    await prisma.baseShare.updateMany({
      where: { baseId: ctx.sourceBaseId, nodeId: { in: ctx.nodes.map((n) => n.id) } },
      data: { baseId: ctx.targetBaseId },
    });
  }

  private async moveNodeRows(ctx: IMoveNodeContext, placement: { parentId: string | null }) {
    const prisma = this.prismaService.txClient();
    const userId = this.cls.get('user.id');
    const maxOrder = await prisma.baseNode.aggregate({
      where: { baseId: ctx.targetBaseId, parentId: placement.parentId },
      _max: { order: true },
    });
    await prisma.baseNode.updateMany({
      where: { id: { in: ctx.nodes.map((n) => n.id) }, baseId: ctx.sourceBaseId },
      data: { baseId: ctx.targetBaseId, lastModifiedBy: userId },
    });

    // nodes inside a moved folder keep their parent; every other moved node
    // lands at the destination, the one that was asked for first
    const movedIds = new Set(ctx.nodes.map((n) => n.id));
    const topLevel = ctx.nodes.filter((n) => !n.parentId || !movedIds.has(n.parentId));
    topLevel.sort((a, b) => Number(b.id === ctx.root.id) - Number(a.id === ctx.root.id));
    let order = (maxOrder._max.order ?? 0) + 1;
    for (const node of topLevel) {
      await prisma.baseNode.update({
        where: { id: node.id },
        data: { parentId: placement.parentId, order: order++, lastModifiedBy: userId },
      });
    }
  }

  /** Cache and realtime fan-out once everything is durable. */
  protected async afterMoveCommitted(ctx: IMoveNodeContext, plan: ITableMovePlan): Promise<void> {
    await this.tableMoveService.afterMoveCommitted(plan);
    for (const baseId of [ctx.sourceBaseId, ctx.targetBaseId]) {
      await this.performanceCacheService.del(generateBaseNodeListCacheKey(baseId));
      await this.performanceCacheService.del(generateBaseShareListCacheKey(baseId));
      if (this.shareDbService.shareDbAdapter.closed) continue;
      presenceHandler(baseId, this.shareDbService, (presence) => {
        presence.submit({ event: 'flush' });
      });
    }
  }

  // ---------------------------------------------------------------------------
  // edition hooks
  // ---------------------------------------------------------------------------

  protected getSupportedResourceTypes(): BaseNodeResourceType[] {
    return [
      BaseNodeResourceType.Folder,
      BaseNodeResourceType.Table,
      BaseNodeResourceType.Dashboard,
    ];
  }

  protected async resolveResourceNames(
    baseId: string,
    type: BaseNodeResourceType,
    ids: string[]
  ): Promise<Map<string, string>> {
    const prisma = this.prismaService.txClient();
    const select = { id: true, name: true } as const;
    let rows: { id: string; name: string }[] = [];
    switch (type) {
      case BaseNodeResourceType.Folder:
        rows = await prisma.baseNodeFolder.findMany({ where: { baseId, id: { in: ids } }, select });
        break;
      case BaseNodeResourceType.Table:
        rows = await prisma.tableMeta.findMany({ where: { baseId, id: { in: ids } }, select });
        break;
      case BaseNodeResourceType.Dashboard:
        rows = await prisma.dashboard.findMany({ where: { baseId, id: { in: ids } }, select });
        break;
      default:
        rows = [];
    }
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Permissions the caller holds in the source project (already resolved by the guard). */
  protected async getSourcePermissionContext(_baseId: string): Promise<IBaseNodePermissionContext> {
    return { permissionSet: new Set(this.cls.get('permissions') ?? []) };
  }

  /** Permissions the caller holds in the target project; undefined when they have none. */
  protected async getTargetPermissionContext(
    targetBaseId: string
  ): Promise<IBaseNodePermissionContext | undefined> {
    try {
      const permissions = (await this.permissionService.getPermissions(
        targetBaseId,
        this.cls.get('accessTokenId')
      )) as Action[];
      return { permissionSet: new Set(permissions) };
    } catch {
      return undefined;
    }
  }

  /** Resources staying behind that reference a moved table by id. */
  protected async collectDependents(_ctx: IMoveNodeContext): Promise<IMoveBaseNodeDependent[]> {
    return [];
  }

  /**
   * Reads the source of every app in the project, so each question below is
   * answered from one inventory rather than from its own budget, and returns
   * the apps that could not be read.
   *
   * Those have to be said out loud: an app whose code was never inspected must
   * not look like an app with nothing to report. Nothing else here can make
   * that statement — by the time the questions below see an app they cannot
   * tell "nothing found" from "never looked".
   */
  protected async readAppSources(_ctx: IMoveNodeContext): Promise<IMoveBaseNodeEmbeddedIdApp[]> {
    return [];
  }

  /** Moved apps whose own source names the project they are leaving. */
  protected async inspectMovedApps(_ctx: IMoveNodeContext): Promise<IMoveBaseNodeEmbeddedIdApp[]> {
    return [];
  }

  /** Permission rules bound to the moved nodes in the source project that will be dropped. */
  protected async countDroppedPermissionRules(_ctx: IMoveNodeContext): Promise<number> {
    return 0;
  }

  /** Runs inside the metadata transaction after every row has been re-homed. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected async afterMetaMove(_ctx: IMoveNodeContext): Promise<void> {}
}
