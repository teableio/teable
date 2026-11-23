import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Action } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
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
  type IVcsReadableTableScope,
  v2VcsServerTokens,
} from '@teable/v2-vcs/server';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { PermissionService } from '../../auth/permission.service';

const isForbiddenHttpError = (error: unknown): boolean =>
  error instanceof ForbiddenException ||
  (error instanceof HttpException && error.getStatus() === HttpStatus.FORBIDDEN);

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
      resolveReadableTables: (ctx, baseId, tableIds) =>
        this.resolveReadableTables(ctx, queryBus, runner, baseId, tableIds),
      assertCanEnableVcs: (ctx, baseId) => this.assertCanEnableVcs(ctx, baseId),
      assertCanApplyPatch: (ctx, baseId, patch) =>
        this.assertCanApplyPatch(ctx, queryBus, runner, baseId, patch),
    };
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
    requestedIds?: readonly string[]
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
      if (!perms.includes('table|read')) continue;
      const scopeRes = await this.resolveTableScope(ctx, runner, table);
      if (scopeRes.isErr()) return err(scopeRes.error);
      scopes.push(scopeRes.value);
    }
    return ok(scopes);
  }

  private async checkWritePerm(
    resourceId: string,
    actions: Action[],
    tokenId?: string
  ): Promise<Result<void, DomainError>> {
    if (actions.length === 0) return ok(undefined);
    try {
      const granted = await this.permissions.validPermissions(resourceId, actions, tokenId);
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
    patch: IBaseVcsPatch
  ): Promise<Result<void, DomainError>> {
    const prisma = this.getPrisma();
    const { tableIds, fieldIds, viewIds } = collectVcsPatchAddedIds(patch);
    if (tableIds.length > 0) {
      const hit = (await prisma.tableMeta.findFirst({
        where: { id: { in: tableIds } },
        select: { id: true, baseId: true },
      })) as { id: string; baseId: string } | null;
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
    if (
      fieldIds.length > 0 &&
      (await prisma.field.findFirst({ where: { id: { in: fieldIds } }, select: { id: true } }))
    ) {
      return err(
        domainError.forbidden({
          code: 'vcs.cross_base_id_claimed',
          message: 'Field id already claimed',
        })
      );
    }
    if (
      viewIds.length > 0 &&
      (await prisma.view.findFirst({ where: { id: { in: viewIds } }, select: { id: true } }))
    ) {
      return err(
        domainError.forbidden({
          code: 'vcs.cross_base_id_claimed',
          message: 'View id already claimed',
        })
      );
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
    patch: IBaseVcsPatch
  ): Promise<Result<void, DomainError>> {
    const baseStr = baseId.toString();
    const belongRes = await this.assertExistingTablesBelongToBase(baseStr, patch);
    if (belongRes.isErr()) return belongRes;
    const unclaimedRes = await this.assertAddedIdsUnclaimed(baseStr, patch);
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
    return this.assertScopedPatchAllowed(ctx, queryBus, runner, baseId, patch);
  }
}
