import { resolvePostgresDbOrTx } from '@teable/v2-adapter-db-postgres-shared';
import * as core from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

type PreparedRowLimitState = {
  readonly dbTableName: string;
  readonly maxRowCount: number;
};

export class PostgresTableRowLimitPlugin
  implements core.IRecordWritePlugin<PreparedRowLimitState | undefined>
{
  readonly name = 'postgres-table-row-limit';

  constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    private readonly maxFreeRowLimit: number
  ) {}

  supports(operation: core.RecordWriteOperationKind): boolean {
    return core.recordWriteOperationMayCreateRecords(operation);
  }

  async prepare(
    context: core.RecordWritePluginContext
  ): Promise<Result<PreparedRowLimitState | undefined, core.DomainError>> {
    if (!this.maxFreeRowLimit || this.getCreateCount(context) <= 0) {
      return ok(undefined);
    }

    try {
      const dbTableNameResult = context.table.dbTableName().andThen((name) => name.value());
      if (dbTableNameResult.isErr()) {
        return err(
          core.domainError.infrastructure({
            message: 'Failed to prepare row limit check: table context is missing dbTableName',
          })
        );
      }

      const db = resolvePostgresDbOrTx(this.db, context.executionContext, 'meta');
      const creditRow = await db
        .selectFrom('base')
        .innerJoin('space', 'space.id', 'base.space_id')
        .select(['space.credit as credit'])
        .where('base.id', '=', context.table.baseId().toString())
        .executeTakeFirst();

      return ok({
        dbTableName: dbTableNameResult.value,
        maxRowCount: creditRow?.credit ?? this.maxFreeRowLimit,
      });
    } catch (error) {
      return err(
        core.domainError.infrastructure({
          message: `Failed to prepare row limit check: ${describeError(error)}`,
        })
      );
    }
  }

  async guard(
    context: core.RecordWritePluginContext,
    preparedState: PreparedRowLimitState | undefined
  ): Promise<Result<void, core.DomainError>> {
    return this.checkRowLimit(context, preparedState);
  }

  async beforePersist(
    context: core.RecordWritePluginContext,
    preparedState: PreparedRowLimitState | undefined
  ): Promise<Result<void, core.DomainError>> {
    return this.checkRowLimit(context, preparedState);
  }

  private async checkRowLimit(
    context: core.RecordWritePluginContext,
    preparedState: PreparedRowLimitState | undefined
  ): Promise<Result<void, core.DomainError>> {
    const recordCount = this.getCreateCount(context);
    if (!preparedState || recordCount <= 0) {
      return ok(undefined);
    }

    try {
      const db = resolvePostgresDbOrTx(this.db, context.executionContext, 'meta');
      const countResult = await sql<{ count: string }>`
        select count(*) as count from ${sql.table(preparedState.dbTableName)}
      `.execute(db);

      const rowCount = Number(countResult.rows[0]?.count ?? 0);
      if (rowCount + recordCount > preparedState.maxRowCount) {
        return err(
          core.domainError.validation({
            code: 'validation.max_row_limit',
            message: `Exceed max row limit: ${preparedState.maxRowCount}, please contact us to increase the limit`,
            details: {
              maxRowCount: preparedState.maxRowCount,
              rowCount,
              recordCount,
            },
          })
        );
      }

      return ok(undefined);
    } catch (error) {
      return err(
        core.domainError.infrastructure({
          message: `Failed to check row limit: ${describeError(error)}`,
        })
      );
    }
  }

  private getCreateCount(context: core.RecordWritePluginContext): number {
    switch (context.kind) {
      case core.RecordWriteOperationKind.createOne:
      case core.RecordWriteOperationKind.submit:
      case core.RecordWriteOperationKind.duplicate:
        return 1;
      case core.RecordWriteOperationKind.duplicateStream:
      case core.RecordWriteOperationKind.createMany:
      case core.RecordWriteOperationKind.createStream:
      case core.RecordWriteOperationKind.importAppend:
        return context.payload.recordCount;
      case core.RecordWriteOperationKind.paste:
        return context.payload.createRecordCount;
      default:
        return 0;
    }
  }
}

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
};
