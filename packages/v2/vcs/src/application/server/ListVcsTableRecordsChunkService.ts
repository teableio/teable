import {
  v2CoreTokens,
  type DomainError,
  type IBaseRepository,
  type IExecutionContext,
  type IQueryBus,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { vcsDomainError } from '../../domain/errors';
import type { IRecordVcsSnapshot, IVcsCloneRecordsChunk } from '../../domain/types';
import type { IVcsAccessPolicy } from '../../ports/server';
import { v2VcsServerTokens } from '../../ports/tokens';
import {
  DEFAULT_CLONE_RECORDS_CHUNK_SIZE,
  listTableRecordsChunkForVcs,
} from '../../snapshot/tableToVcsSnapshot';
import { isScopeRecordForbidden, resolveExistingBase } from './serverHelpers';

export interface IListVcsTableRecordsChunkInput {
  readonly baseId: string;
  readonly tableId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

const filterRecordsForReadableFields = (
  records: readonly IRecordVcsSnapshot[],
  readableFieldIds?: readonly string[]
): IRecordVcsSnapshot[] => {
  if (!readableFieldIds) {
    return [...records];
  }
  const allowed = new Set(readableFieldIds);
  return records.map((rec) => {
    const filteredFields: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(rec.fields)) {
      if (allowed.has(fieldId)) {
        filteredFields[fieldId] = value;
      }
    }
    return {
      ...rec,
      fields: filteredFields,
    };
  });
};

@injectable()
export class ListVcsTableRecordsChunkService {
  constructor(
    @inject(v2CoreTokens.baseRepository)
    private readonly baseRepository: IBaseRepository,
    @inject(v2CoreTokens.queryBus)
    private readonly queryBus: IQueryBus,
    @inject(v2VcsServerTokens.accessPolicy)
    private readonly accessPolicy: IVcsAccessPolicy
  ) {}

  async execute(
    ctx: IExecutionContext,
    input: IListVcsTableRecordsChunkInput
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>> {
    const resolved = await resolveExistingBase(this.baseRepository, ctx, input.baseId);
    if (resolved.isErr()) {
      return err(resolved.error);
    }
    const { baseId } = resolved.value;

    const scopesRes = await this.accessPolicy.resolveReadableTables(ctx, baseId, [input.tableId]);
    if (scopesRes.isErr()) {
      return err(scopesRes.error);
    }

    const scope = scopesRes.value.find((item) => item.tableId === input.tableId);
    if (!scope) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.table_not_found',
          message: `Table ${input.tableId} not found or not readable`,
        })
      );
    }

    if (isScopeRecordForbidden(scope)) {
      return ok({
        tableId: input.tableId,
        records: [],
        hasMore: false,
      });
    }

    const chunkLimit = Math.min(
      2_000,
      Math.max(1, Math.floor(input.limit ?? DEFAULT_CLONE_RECORDS_CHUNK_SIZE))
    );
    const chunkRes = await listTableRecordsChunkForVcs({
      queryBus: this.queryBus,
      context: ctx,
      table: scope.table,
      cursor: input.cursor,
      limit: chunkLimit,
      queryScope: scope.queryScope,
      preserveComputed: true,
    });
    if (chunkRes.isErr()) {
      return err(chunkRes.error);
    }

    return ok({
      ...chunkRes.value,
      records: filterRecordsForReadableFields(
        chunkRes.value.records,
        scope.tableAccessScope?.readableFieldIds
      ),
    });
  }
}
