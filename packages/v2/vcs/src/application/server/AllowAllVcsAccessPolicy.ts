import {
  v2CoreTokens,
  type BaseId,
  type DomainError,
  type IExecutionContext,
  type IQueryBus,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { vcsDomainError } from '../../domain/errors';
import type { IBaseVcsPatch } from '../../domain/types';
import type { IVcsAccessPolicy, IVcsReadableTableScope } from '../../ports/server';
import { listLiveTablesInBase } from './serverHelpers';

@injectable()
export class AllowAllVcsAccessPolicy implements IVcsAccessPolicy {
  constructor(
    @inject(v2CoreTokens.queryBus)
    private readonly queryBus: IQueryBus
  ) {}

  async resolveReadableTables(
    ctx: IExecutionContext,
    baseId: BaseId,
    tableIds?: readonly string[]
  ): Promise<Result<readonly IVcsReadableTableScope[], DomainError>> {
    const tablesRes = await listLiveTablesInBase(this.queryBus, ctx, baseId);
    if (tablesRes.isErr()) {
      return err(tablesRes.error);
    }

    const filter = tableIds && tableIds.length > 0 ? new Set(tableIds) : undefined;
    const filtered = filter
      ? tablesRes.value.filter((table) => filter.has(table.id().toString()))
      : tablesRes.value;

    return ok(
      filtered.map((table) => ({
        table,
        tableId: table.id().toString(),
      }))
    );
  }

  async assertCanEnableVcs(
    _ctx: IExecutionContext,
    _baseId: BaseId
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async assertCanApplyPatch(
    ctx: IExecutionContext,
    baseId: BaseId,
    patch: IBaseVcsPatch
  ): Promise<Result<void, DomainError>> {
    const referencedIds = Array.from(
      new Set([
        ...patch.tablesDeleted.map((t) => t.tableId),
        ...patch.tablesUpdated.map((t) => t.tableId),
      ])
    );
    if (referencedIds.length === 0) {
      return ok(undefined);
    }

    const tablesRes = await listLiveTablesInBase(this.queryBus, ctx, baseId);
    if (tablesRes.isErr()) {
      return err(tablesRes.error);
    }

    const liveIds = new Set(tablesRes.value.map((t) => t.id().toString()));
    for (const tableId of referencedIds) {
      if (!liveIds.has(tableId)) {
        return err(
          vcsDomainError.forbidden({
            code: 'vcs.cross_base_table_forbidden',
            message: `Table ${tableId} does not belong to base ${baseId.toString()} or does not exist`,
            details: { baseId: baseId.toString(), tableId },
          })
        );
      }
    }

    return ok(undefined);
  }
}

const headlessWriteDisabledError = () =>
  err(
    vcsDomainError.forbidden({
      code: 'vcs.write_not_enabled_on_headless',
      message: 'VCS write routes are disabled; pass allowVcsWrite: true to enable.',
    })
  );

@injectable()
export class ReadOnlyVcsAccessPolicy extends AllowAllVcsAccessPolicy {
  override async assertCanEnableVcs(
    _ctx: IExecutionContext,
    _baseId: BaseId
  ): Promise<Result<void, DomainError>> {
    return headlessWriteDisabledError();
  }

  override async assertCanApplyPatch(
    _ctx: IExecutionContext,
    _baseId: BaseId,
    _patch: IBaseVcsPatch
  ): Promise<Result<void, DomainError>> {
    return headlessWriteDisabledError();
  }
}
