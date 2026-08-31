import { resolvePostgresDbOrTx } from '@teable/v2-adapter-db-postgres-shared';
import * as core from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export interface ITableRowLimitPolicy {
  resolveMaxRowCount(
    context: core.RecordWritePluginContext
  ): Promise<Result<number, core.DomainError>>;
}

export class StaticTableRowLimitPolicy implements ITableRowLimitPolicy {
  constructor(private readonly maxRowCount: number) {}

  async resolveMaxRowCount(): Promise<Result<number, core.DomainError>> {
    return ok(this.maxRowCount);
  }
}

export class SpaceCreditTableRowLimitPolicy implements ITableRowLimitPolicy {
  constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    private readonly fallbackMaxRowCount: number
  ) {}

  async resolveMaxRowCount(
    context: core.RecordWritePluginContext
  ): Promise<Result<number, core.DomainError>> {
    try {
      const tableId = context.table.id().toString();
      const row = await this.db
        .selectFrom('table_meta')
        .innerJoin('base', 'base.id', 'table_meta.base_id')
        .innerJoin('space', 'space.id', 'base.space_id')
        .select('space.credit')
        .where('table_meta.id', '=', tableId)
        .where('table_meta.deleted_time', 'is', null)
        .executeTakeFirst();

      return ok(row?.credit ?? this.fallbackMaxRowCount);
    } catch (error) {
      return err(
        core.domainError.infrastructure({
          message: `Failed to resolve row limit policy: ${describeError(error)}`,
        })
      );
    }
  }
}

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
    private readonly rowLimitPolicy: ITableRowLimitPolicy
  ) {}

  supports(operation: core.RecordWriteOperationKind): boolean {
    return core.recordWriteOperationMayCreateRecords(operation);
  }

  async prepare(
    context: core.RecordWritePluginContext
  ): Promise<Result<PreparedRowLimitState | undefined, core.DomainError>> {
    if (this.getCreateCount(context) <= 0) {
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

      const maxRowCountResult = await this.rowLimitPolicy.resolveMaxRowCount(context);
      if (maxRowCountResult.isErr()) {
        return err(maxRowCountResult.error);
      }

      return ok({
        dbTableName: dbTableNameResult.value,
        maxRowCount: maxRowCountResult.value,
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
    // Truncation is only meaningful here: guard runs before the caller
    // materializes domain records from the payload arrays it shares with us.
    return this.checkRowLimit(context, preparedState, { allowTruncate: true });
  }

  async beforePersist(
    context: core.RecordWritePluginContext,
    preparedState: PreparedRowLimitState | undefined
  ): Promise<Result<void, core.DomainError>> {
    // By now the records to insert are already built from the payload, so
    // truncating the payload would silently change nothing — this in-transaction
    // backstop must fail closed when a concurrent writer consumed the capacity.
    return this.checkRowLimit(context, preparedState, { allowTruncate: false });
  }

  private async checkRowLimit(
    context: core.RecordWritePluginContext,
    preparedState: PreparedRowLimitState | undefined,
    options: { allowTruncate: boolean }
  ): Promise<Result<void, core.DomainError>> {
    const recordCount = this.getCreateCount(context);
    if (!preparedState || recordCount <= 0) {
      return ok(undefined);
    }

    try {
      const db = resolvePostgresDbOrTx(this.db, context.executionContext, 'data');
      const countResult = await sql<{ count: string }>`
        select count(*) as count from ${sql.table(preparedState.dbTableName)}
      `.execute(db);

      const rowCount = Number(countResult.rows[0]?.count ?? 0);
      const remaining = preparedState.maxRowCount - rowCount;
      if (recordCount <= remaining) {
        return ok(undefined);
      }
      if (options.allowTruncate && remaining > 0 && truncateCreatePayload(context, remaining)) {
        return ok(undefined);
      }

      return err(
        core.domainError.validation({
          code: core.tableDataSafetyLimitErrors.rowsPerTableMax.code,
          message: `Exceed max row limit: ${preparedState.maxRowCount}, please contact us to increase the limit`,
          details: {
            max: preparedState.maxRowCount,
            maxRowCount: preparedState.maxRowCount,
            rowCount,
            recordCount,
          },
          localization: {
            i18nKey: core.tableDataSafetyLimitErrors.rowsPerTableMax.i18nKey,
            context: { max: preparedState.maxRowCount },
          },
        })
      );
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

const truncateCreatePayload = (
  context: core.RecordWritePluginContext,
  allowed: number
): boolean => {
  if (context.kind !== core.RecordWriteOperationKind.createMany) {
    return false;
  }
  if (!context.payload.isolateRowOverflow) {
    return false;
  }
  // Deliberate in-place mutation through the readonly payload contract: the
  // caller keeps building records from this same array, so truncation must
  // shorten it in place rather than replace it.
  const payload = context.payload as {
    -readonly [K in keyof typeof context.payload]: (typeof context.payload)[K];
  } & { recordsFieldValues: core.RecordWriteFieldValues[] };
  if (!Array.isArray(payload.recordsFieldValues)) {
    return false;
  }
  payload.recordsFieldValues.length = allowed;
  payload.recordCount = allowed;
  return true;
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
};
