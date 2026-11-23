import {
  BaseId,
  ListTablesQuery,
  type Base,
  type DomainError,
  type IBaseRepository,
  type IExecutionContext,
  type IQueryBus,
  type ListTablesResult,
  type Table,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

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
