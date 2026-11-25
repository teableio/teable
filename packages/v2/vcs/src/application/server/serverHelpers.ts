import {
  BaseId,
  ListTablesQuery,
  Table,
  TableId,
  type Base,
  type DomainError,
  type IBaseRepository,
  type IExecutionContext,
  type IQueryBus,
  type ListTablesResult,
  type ITableRepository,
} from '@teable/v2-core';
import { err, ok, Result } from 'neverthrow';

import { vcsDomainError } from '../../domain/errors';
import type { ITableVcsSnapshot } from '../../domain/types';
import type { IVcsReadableTableScope } from '../../ports/server';
import { buildTableVcsSnapshot } from '../../snapshot/tableToVcsSnapshot';

export interface IResolvedBase {
  readonly baseId: BaseId;
  readonly base: Base;
}

export const parseBaseId = (rawBaseId: string): Result<BaseId, DomainError> => {
  const res = BaseId.create(rawBaseId);
  if (res.isErr()) {
    return err(
      vcsDomainError.validation({
        code: 'vcs.invalid_base_id',
        message: res.error.message,
      })
    );
  }
  return ok(res.value);
};

export const resolveExistingBase = async (
  baseRepository: IBaseRepository,
  ctx: IExecutionContext,
  rawBaseId: string
): Promise<Result<IResolvedBase, DomainError>> => {
  const baseIdRes = parseBaseId(rawBaseId);
  if (baseIdRes.isErr()) {
    return err(baseIdRes.error);
  }

  const baseRes = await baseRepository.findOne(ctx, baseIdRes.value);
  if (baseRes.isErr()) {
    return err(baseRes.error);
  }
  if (!baseRes.value) {
    return err(
      vcsDomainError.notFound({
        code: 'vcs.base_not_found',
        message: `Base ${rawBaseId} not found`,
      })
    );
  }

  return ok({
    baseId: baseIdRes.value,
    base: baseRes.value,
  });
};

export const listLiveTablesInBase = async (
  queryBus: IQueryBus,
  ctx: IExecutionContext,
  baseId: BaseId
): Promise<Result<readonly Table[], DomainError>> => {
  const queryRes = ListTablesQuery.create({ baseId: baseId.toString() });
  if (queryRes.isErr()) {
    return err(queryRes.error);
  }
  const execRes = await queryBus.execute<ListTablesQuery, ListTablesResult>(ctx, queryRes.value);
  if (execRes.isErr()) {
    return err(execRes.error);
  }
  return ok(execRes.value.tables);
};

/** Match the incoming-reference candidates that DeleteTableHandler coordinates. */
export async function listTableDeletionDependencies(
  tables: Pick<ITableRepository, 'find'>,
  context: IExecutionContext,
  deletedTableIds: readonly string[]
): Promise<Result<readonly string[], DomainError>> {
  if (!deletedTableIds.length) return ok([]);
  const ids = Result.combine(deletedTableIds.map((id) => TableId.create(id)));
  if (ids.isErr()) return err(ids.error);
  const spec = Table.specs()
    .orGroup((group) => {
      for (const id of ids.value) group.byIncomingReferenceToTable(id);
      return group;
    })
    .build();
  if (spec.isErr()) return err(spec.error);
  const found = await tables.find(context, spec.value);
  return found.map((values) => values.map((table) => table.id().toString()));
}

export const isScopeRecordForbidden = (scope: IVcsReadableTableScope): boolean =>
  Boolean(scope.isRowFiltered && scope.readableFieldIds && scope.readableFieldIds.length === 0);

export const buildScopedTableSnapshot = async (params: {
  readonly queryBus: IQueryBus;
  readonly context: IExecutionContext;
  readonly scope: IVcsReadableTableScope;
  readonly includeRecords: boolean;
}): Promise<Result<ITableVcsSnapshot, DomainError>> => {
  const includeRecords = params.includeRecords && !isScopeRecordForbidden(params.scope);
  return buildTableVcsSnapshot({
    queryBus: params.queryBus,
    context: params.context,
    table: params.scope.table,
    includeRecords,
    queryScope: params.scope.queryScope,
  });
};
