import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Role, type Action } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IFieldDeletePreviewAuthorization } from '@teable/v2-command-explain';
import {
  type BaseId,
  type DomainError,
  type IExecutionContext,
  type IQueryBus,
  ListTablesQuery,
  type ListTablesResult,
  MAX_RECORDS_LIMIT,
  RecordQueryOperationKind,
  type RecordQueryPluginRunner,
  type Table,
  domainError,
  err,
  isForbiddenError,
  ok,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import {
  assertVcsTableScopeAllowsMutation,
  assertVcsTableScopeAllowsTableDelete,
  buildAllowedVcsTableIdSet,
  buildBlockedVcsTableScope,
  buildReadableVcsTableScope,
  collectVcsPatchAddedIds,
  collectVcsPatchWriteActions,
  type IBaseVcsPatch,
  type Result,
} from '@teable/v2-vcs';
import {
  type IVcsAccessPolicy,
  type IVcsHistoryTableScope,
  type VcsHistoryAccess,
  type IVcsReadableTableScope,
  type IVcsRollbackRestore,
  v2VcsServerTokens,
} from '@teable/v2-vcs/server';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { getBaseCached } from '../../../utils/meta-ancestry-cache';
import { PermissionService } from '../../auth/permission.service';
import { getTableDeletePreviewAuthorization } from '../v2-delete-preview-resource-authorization';
import { VCS_HISTORY_AUTHORITY, type IVcsHistoryAuthority } from './vcs-history-authority';

const isForbiddenHttpError = (error: unknown): boolean =>
  error instanceof ForbiddenException ||
  (error instanceof HttpException && error.getStatus() === HttpStatus.FORBIDDEN);

const currentReadActions: Action[] = ['table|read', 'field|read', 'record|read'];
const historyReadActions: Action[] = [...currentReadActions, 'table_record_history|read'];
const eeRecordHistoryActions: Action[] = [...currentReadActions, 'record|update'];
const eeHistoryReadActions: Action[] = [...eeRecordHistoryActions, 'table_record_history|read'];
const fullHistoryReadActions: Action[] = [
  ...historyReadActions,
  'view|read',
  'base|read_all',
  'table|trash_read',
  'table|archive_read',
];

type HistoryScope = Omit<IVcsHistoryTableScope, 'readableViewIds'>;

// Only explicit historical children can revive a claimed ID. Implicit symmetric IDs still
// go through the global claim check unless the inverse also adds them on their own table.
function rollbackChildClaims(patch: IBaseVcsPatch, restore: IVcsRollbackRestore) {
  const fields = new Map<string, string>();
  const views = new Map<string, string>();
  for (const table of patch.tablesAdded) {
    if (!restore.tableIds.includes(table.id)) continue;
    for (const field of table.fields) fields.set(field.id, table.id);
    for (const view of table.views) views.set(view.id, table.id);
  }
  for (const change of patch.tablesUpdated) {
    for (const field of change.fieldsAdded) fields.set(field.id, change.tableId);
    for (const view of change.viewsAdded) views.set(view.id, change.tableId);
  }
  return { fields, views };
}

@Injectable()
export class NestVcsAccessPolicy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  registerOnContainer(container: DependencyContainer): void {
    container.registerInstance(v2VcsServerTokens.accessPolicy, this.forContainer(container));
  }

  forContainer(container: DependencyContainer): IVcsAccessPolicy {
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const runner = container.isRegistered(v2CoreTokens.recordQueryPluginRunner)
      ? container.resolve<RecordQueryPluginRunner>(v2CoreTokens.recordQueryPluginRunner)
      : undefined;
    return {
      resolveHistoryAccess: (ctx, baseId) =>
        this.resolveHistoryAccess(
          ctx,
          queryBus,
          runner,
          baseId,
          getTableDeletePreviewAuthorization(container),
          container.isRegistered(VCS_HISTORY_AUTHORITY)
            ? container.resolve<IVcsHistoryAuthority>(VCS_HISTORY_AUTHORITY)
            : undefined
        ),
      resolveReadableTables: (ctx, baseId, tableIds) =>
        this.resolveReadableTables(ctx, queryBus, runner, baseId, tableIds),
      assertCanEnableVcs: (ctx, baseId) => this.assertCanEnableVcs(ctx, baseId),
      assertCanApplyPatch: (ctx, baseId, patch, restore) =>
        this.assertCanApplyPatch(ctx, queryBus, runner, baseId, patch, restore),
    };
  }

  private async resolveHistoryAccess(
    ctx: IExecutionContext,
    queryBus: IQueryBus,
    runner: RecordQueryPluginRunner | undefined,
    baseId: BaseId,
    metadata: IFieldDeletePreviewAuthorization | undefined,
    authority: IVcsHistoryAuthority | undefined
  ): Promise<Result<VcsHistoryAccess, DomainError>> {
    const base = baseId.toString();
    const token = this.cls.get('accessTokenId');
    // Share-view queries require the shared view's filters and field projection. A base
    // history request has no view context in which to evaluate those restrictions.
    if (this.cls.get('shareViewId') || this.cls.get('user.id') !== ctx.actorId.toString()) {
      return err(
        domainError.forbidden({
          code: 'vcs.history_forbidden',
          message: 'Base history access denied.',
        })
      );
    }
    const readBase = await this.checkWritePerm(base, ['base|read'], token);
    if (readBase.isErr()) return err(readBase.error);
    const requiredActions = authority ? eeHistoryReadActions : historyReadActions;
    if (this.cls.get('baseShare') || this.cls.get('baseShareId') || this.cls.get('template')) {
      const permissions = this.cls.get('permissions');
      if (!requiredActions.every((action) => permissions?.includes(action))) {
        return ok({ kind: 'scoped', tables: [] });
      }
    }
    const scopes = await this.resolveReadableTables(
      ctx,
      queryBus,
      runner,
      baseId,
      undefined,
      authority ? ['table|read'] : historyReadActions
    );
    if (scopes.isErr()) return err(scopes.error);
    const admitted: HistoryScope[] = [];
    for (const scope of scopes.value) {
      if (!authority) {
        admitted.push(scope);
        continue;
      }
      const grant = await authority.resolveTableGrant(base, scope.tableId);
      if (requiredActions.every((action) => grant.actions.includes(action))) {
        admitted.push({ ...scope, historyFieldsForRecords: grant.historyFieldsForRecords });
      } else if (
        grant.historyFieldsForRecords &&
        eeRecordHistoryActions.every((action) => grant.actions.includes(action))
      ) {
        admitted.push({
          ...scope,
          recordHistoryOnly: true,
          historyFieldsForRecords: grant.historyFieldsForRecords,
        });
      }
    }

    // Only an explicit unrestricted host role grants access to deleted entities. Even
    // an empty base can be a restricted actor's entire live projection.
    const ordinaryUser =
      !this.cls.get('baseShare') &&
      !this.cls.get('baseShareId') &&
      !this.cls.get('template') &&
      !this.cls.get('tempAuthBaseId') &&
      !this.cls.get('authSource') &&
      !this.cls.get('appId') &&
      !this.cls.get('workflowContext') &&
      !this.cls.get('entry');
    if (
      ordinaryUser &&
      admitted.every((s) => !s.isRowFiltered && !s.readableFieldIds && !s.historyFieldsForRecords)
    ) {
      const { spaceId } = await this.permissions.getUpperIdByBaseId(base);
      if ((await this.permissions.getRoleBySpaceId(spaceId)) === Role.Owner) {
        const effective = token ? await this.readTablePermissions(base, token) : undefined;
        if (
          !effective ||
          (fullHistoryReadActions.every((action) => effective.includes(action)) &&
            (!authority || effective.includes('record|update')))
        ) {
          const count = await this.getPrisma().tableMeta.count({
            where: { baseId: base, deletedTime: null },
          });
          if (count === admitted.length) return ok({ kind: 'full' });
        }
      }
    }

    // The CE/EE registrar installs the same canReadResource implementation for field
    // and table previews. It checks table membership, token ceilings and per-view RBAC.
    if (!metadata)
      return err(
        domainError.forbidden({
          code: 'vcs.history_forbidden',
          message: 'Metadata authorization unavailable.',
        })
      );
    const tables: IVcsHistoryTableScope[] = [];
    for (const scope of admitted) {
      const { table, tableId } = scope;
      const allowed = scope.readableFieldIds && new Set(scope.readableFieldIds);
      const readableFieldIds: string[] = [];
      for (const field of table.getFields()) {
        const id = field.id().toString();
        if (allowed && !allowed.has(id)) continue;
        const grant = await metadata.canReadResource(ctx, { kind: 'field', tableId, id });
        if (grant.isErr()) return err(grant.error);
        if (grant.value) readableFieldIds.push(id);
      }
      if (!readableFieldIds.length) continue;
      const readableViewIds = new Set<string>();
      if (scope.recordHistoryOnly) {
        tables.push({ ...scope, readableFieldIds, readableViewIds });
        continue;
      }
      for (const view of table.views()) {
        const id = view.id().toString();
        const grant = await metadata.canReadResource(ctx, { kind: 'view', tableId, id });
        if (grant.isErr()) return err(grant.error);
        if (grant.value) readableViewIds.add(id);
      }
      tables.push({ ...scope, readableFieldIds, readableViewIds });
    }
    if (authority && (!tables.length || tables.some((scope) => scope.recordHistoryOnly))) {
      const currentBase = await getBaseCached(this.cls, this.getPrisma(), base);
      const recordHistoryWindow =
        tables.length && currentBase
          ? await authority.resolveRecordHistoryWindow(currentBase.spaceId)
          : undefined;
      return ok({
        kind: 'scoped',
        tables,
        currentBaseName: currentBase?.name || base,
        recordHistoryWindow,
      });
    }
    return ok({ kind: 'scoped', tables });
  }

  private getPrisma(): PrismaService {
    const svc = this.prisma as unknown as { txClient?: () => PrismaService };
    return typeof svc.txClient === 'function' ? svc.txClient() : this.prisma;
  }

  private async resolveTableScope(
    ctx: IExecutionContext,
    runner: RecordQueryPluginRunner | undefined,
    table: Table
  ): Promise<Result<IVcsReadableTableScope, DomainError>> {
    const tableId = table.id().toString();
    if (!runner) return ok({ table, tableId });
    const prep = await runner.prepare({
      kind: RecordQueryOperationKind.list,
      executionContext: ctx,
      table,
      payload: { ignoreViewQuery: true, limit: MAX_RECORDS_LIMIT, offset: 0 },
    });
    if (prep.isErr()) {
      return isForbiddenError(prep.error)
        ? ok(buildBlockedVcsTableScope(table, tableId))
        : err(prep.error);
    }
    const guard = await prep.value.guard();
    const scoped = guard.andThen(() => prep.value.getScope());
    if (scoped.isErr()) {
      return isForbiddenError(scoped.error)
        ? ok(buildBlockedVcsTableScope(table, tableId))
        : err(scoped.error);
    }
    return ok(buildReadableVcsTableScope(table, tableId, scoped.value));
  }

  private async readTablePermissions(resourceId: string, tokenId?: string): Promise<string[]> {
    try {
      return await this.permissions.getPermissions(resourceId, tokenId);
    } catch (error) {
      if (isForbiddenHttpError(error)) {
        return [];
      }
      throw error;
    }
  }

  async resolveReadableTables(
    ctx: IExecutionContext,
    queryBus: IQueryBus,
    runner: RecordQueryPluginRunner | undefined,
    baseId: BaseId,
    requestedIds?: readonly string[],
    readActions: readonly Action[] = ['table|read']
  ): Promise<Result<readonly IVcsReadableTableScope[], DomainError>> {
    const query = ListTablesQuery.create({ baseId: baseId.toString() });
    if (query.isErr()) return err(query.error);
    const listed = await queryBus.execute<ListTablesQuery, ListTablesResult>(ctx, query.value);
    if (listed.isErr()) return err(listed.error);
    const shareVisible = await this.permissions.getBaseShareVisibleResourceIds(
      baseId.toString(),
      'table'
    );
    const allow = buildAllowedVcsTableIdSet(
      requestedIds,
      shareVisible ? new Set(shareVisible) : shareVisible
    );
    const candidates = listed.value.tables
      .filter((t) => !allow || allow.has(t.id().toString()))
      .sort((a, b) => a.id().toString().localeCompare(b.id().toString()));
    const tokenId = this.cls.get('accessTokenId');
    const scopes: IVcsReadableTableScope[] = [];
    for (const table of candidates) {
      const perms = await this.readTablePermissions(table.id().toString(), tokenId);
      if (!readActions.every((action) => perms.includes(action))) continue;
      const scopeRes = await this.resolveTableScope(ctx, runner, table);
      if (scopeRes.isErr()) return err(scopeRes.error);
      scopes.push(scopeRes.value);
    }
    return ok(scopes);
  }

  private async checkWritePerm(
    resourceId: string,
    actions: Action[],
    tokenId?: string,
    includeInactive?: boolean
  ): Promise<Result<void, DomainError>> {
    if (actions.length === 0) return ok(undefined);
    try {
      const granted = await this.permissions.validPermissions(
        resourceId,
        actions,
        tokenId,
        includeInactive
      );
      const missing = Array.isArray(granted) ? actions.filter((a) => !granted.includes(a)) : [];
      if (missing.length > 0) {
        return err(
          domainError.forbidden({
            code: 'vcs.forbidden',
            message: `Missing permissions on ${resourceId}: ${missing.join(', ')}`,
          })
        );
      }
      return ok(undefined);
    } catch (error) {
      if (isForbiddenHttpError(error)) {
        return err(
          domainError.forbidden({ code: 'vcs.forbidden', message: (error as Error).message })
        );
      }
      throw error;
    }
  }

  async assertCanEnableVcs(
    _ctx: IExecutionContext,
    baseId: BaseId
  ): Promise<Result<void, DomainError>> {
    const tokenId = this.cls.get('accessTokenId');
    return this.checkWritePerm(baseId.toString(), ['base|update'], tokenId);
  }

  private async assertExistingTablesBelongToBase(
    baseId: string,
    patch: IBaseVcsPatch
  ): Promise<Result<void, DomainError>> {
    const refIds = [
      ...new Set([
        ...patch.tablesDeleted.map((t) => t.tableId),
        ...patch.tablesUpdated.map((t) => t.tableId),
      ]),
    ];
    if (refIds.length === 0) return ok(undefined);
    const rows = (await this.getPrisma().tableMeta.findMany({
      where: { id: { in: refIds }, deletedTime: null },
      select: { id: true, baseId: true },
    })) as Array<{ id: string; baseId: string }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of refIds) {
      const row = byId.get(id);
      if (!row) {
        return err(
          domainError.notFound({ code: 'table.not_found', message: `Table ${id} not found` })
        );
      }
      if (row.baseId !== baseId) {
        return err(
          domainError.forbidden({
            code: 'vcs.cross_base_table_forbidden',
            message: `Table ${id} does not belong to base ${baseId}`,
          })
        );
      }
    }
    return ok(undefined);
  }

  private async assertAddedIdsUnclaimed(
    baseId: string,
    patch: IBaseVcsPatch,
    restore?: IVcsRollbackRestore
  ): Promise<Result<void, DomainError>> {
    const prisma = this.getPrisma();
    const { tableIds, fieldIds, viewIds } = collectVcsPatchAddedIds(patch);
    const eligible = restore && rollbackChildClaims(patch, restore);
    if (tableIds.length > 0) {
      const where = { id: { in: tableIds } };
      const hit = restore?.tableIds.length
        ? (
            await prisma.tableMeta.findMany({
              where,
              select: { id: true, baseId: true, deletedTime: true },
            })
          ).find(
            (row) => row.baseId !== baseId || !row.deletedTime || !restore.tableIds.includes(row.id)
          )
        : await prisma.tableMeta.findFirst({ where, select: { id: true, baseId: true } });
      if (hit) {
        return err(
          hit.baseId !== baseId
            ? domainError.forbidden({
                code: 'vcs.cross_base_id_claimed',
                message: `Table ${hit.id} already claimed`,
              })
            : domainError.conflict({
                code: 'vcs.table_exists',
                message: `Table ${hit.id} already exists`,
              })
        );
      }
    }
    const select = {
      id: true,
      tableId: true,
      deletedTime: true,
      table: { select: { baseId: true } },
    } as const;
    const restoredChildren = new Set<string>();
    for (const kind of ['field', 'view'] as const) {
      const ids = kind === 'field' ? fieldIds : viewIds;
      if (!ids.length) continue;
      const where = { id: { in: ids } };
      const owners = kind === 'field' ? eligible?.fields : eligible?.views;
      let claimed: boolean;
      if (owners?.size) {
        const rows =
          kind === 'field'
            ? await prisma.field.findMany({ where, select })
            : await prisma.view.findMany({ where, select });
        claimed = rows.some(
          (row) =>
            !row.deletedTime || row.table.baseId !== baseId || owners.get(row.id) !== row.tableId
        );
        for (const row of rows) restoredChildren.add(row.tableId);
      } else {
        const query = { where, select: { id: true } };
        claimed = Boolean(
          kind === 'field'
            ? await prisma.field.findFirst(query)
            : await prisma.view.findFirst(query)
        );
      }
      if (claimed) {
        return err(
          domainError.forbidden({
            code: 'vcs.cross_base_id_claimed',
            message: `${kind === 'field' ? 'Field' : 'View'} id already claimed`,
          })
        );
      }
    }
    for (const tableId of restoredChildren) {
      // Restoring the parent below already checks its trash permission.
      if (restore?.tableIds.includes(tableId)) continue;
      const permission = await this.checkWritePerm(
        tableId,
        ['table|trash_update'],
        this.cls.get('accessTokenId')
      );
      if (permission.isErr()) return permission;
    }
    return ok(undefined);
  }

  private async assertScopedPatchAllowed(
    ctx: IExecutionContext,
    queryBus: IQueryBus,
    runner: RecordQueryPluginRunner | undefined,
    baseId: BaseId,
    patch: IBaseVcsPatch
  ): Promise<Result<void, DomainError>> {
    if (!runner) return ok(undefined);
    const targetIds = [
      ...new Set([
        ...patch.tablesUpdated.map((t) => t.tableId),
        ...patch.tablesDeleted.map((t) => t.tableId),
      ]),
    ];
    if (targetIds.length === 0) return ok(undefined);
    const scopesRes = await this.resolveReadableTables(ctx, queryBus, runner, baseId, targetIds);
    if (scopesRes.isErr()) return err(scopesRes.error);
    const byId = new Map(scopesRes.value.map((s) => [s.tableId, s]));
    for (const delTable of patch.tablesDeleted) {
      const check = assertVcsTableScopeAllowsTableDelete(delTable, byId.get(delTable.tableId));
      if (check.isErr()) return check;
    }
    for (const tp of patch.tablesUpdated) {
      const scope = byId.get(tp.tableId);
      if (!scope) continue;
      const check = assertVcsTableScopeAllowsMutation(tp, scope);
      if (check.isErr()) return check;
    }
    return ok(undefined);
  }

  async assertCanApplyPatch(
    ctx: IExecutionContext,
    queryBus: IQueryBus,
    runner: RecordQueryPluginRunner | undefined,
    baseId: BaseId,
    patch: IBaseVcsPatch,
    restore?: IVcsRollbackRestore
  ): Promise<Result<void, DomainError>> {
    const baseStr = baseId.toString();
    const belongRes = await this.assertExistingTablesBelongToBase(baseStr, patch);
    if (belongRes.isErr()) return belongRes;
    const unclaimedRes = await this.assertAddedIdsUnclaimed(baseStr, patch, restore);
    if (unclaimedRes.isErr()) return unclaimedRes;
    const tokenId = this.cls.get('accessTokenId');
    const checks: Array<readonly [string, Action[]]> = [
      ...(patch.tablesAdded.length > 0 ? [[baseStr, ['table|create'] as Action[]] as const] : []),
      ...patch.tablesDeleted.map((d) => [d.tableId, ['table|delete'] as Action[]] as const),
      ...patch.tablesUpdated.map((tp) => [tp.tableId, collectVcsPatchWriteActions(tp)] as const),
    ];
    for (const [resId, actions] of checks) {
      const permRes = await this.checkWritePerm(resId, actions, tokenId);
      if (permRes.isErr()) return permRes;
    }
    if (restore?.tableIds.length) {
      const changes = new Map(restore.tableChanges.map((change) => [change.tableId, change]));
      for (const id of restore.tableIds) {
        const change = changes.get(id);
        const actions: Action[] = [
          'table|trash_update',
          ...(change ? collectVcsPatchWriteActions(change) : []),
        ];
        const permission = await this.checkWritePerm(id, actions, tokenId, true);
        if (permission.isErr()) return permission;
      }
    }
    return this.assertScopedPatchAllowed(ctx, queryBus, runner, baseId, patch);
  }
}
