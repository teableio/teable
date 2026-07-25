import {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  HIGH_COMPLEXITY_THRESHOLD,
  type DomainError,
  type FieldComputeMetaDto,
  type IComputedActivityReader,
  type IExecutionContext,
  type TableComputeActivitySnapshot,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { DynamicDB } from '../../query-builder';
import { fieldActivityRowToDto, tableActivityRowToDto } from './ComputedActivityRowMapper';

const FIELD_ACTIVITY_TABLE = 'computed_field_activity';
const TABLE_ACTIVITY_TABLE = 'computed_table_activity';

const buildDiagnostics = (
  fields: ReadonlyArray<FieldComputeMetaDto>
): TableComputeActivitySnapshot['diagnostics'] => {
  const anomalies: TableComputeActivitySnapshot['diagnostics']['anomalies'] = [];
  let activeFieldCount = 0;
  let queuedFieldCount = 0;
  let calculatingFieldCount = 0;
  let failedFieldCount = 0;
  let highComplexityFieldCount = 0;

  for (const field of fields) {
    if (field.status === 'queued' || field.status === 'running') {
      activeFieldCount += 1;
    }
    if (field.status === 'queued') queuedFieldCount += 1;
    if (field.status === 'running') calculatingFieldCount += 1;
    if (field.status === 'failed') {
      failedFieldCount += 1;
      anomalies.push({
        fieldId: field.fieldId,
        kind: 'failed',
        message: field.lastError?.message ?? 'Computed field calculation failed',
      });
    }
    if (field.estimatedComplexity >= HIGH_COMPLEXITY_THRESHOLD) {
      highComplexityFieldCount += 1;
      anomalies.push({
        fieldId: field.fieldId,
        kind: 'high_complexity',
        message: `Estimated complexity ${field.estimatedComplexity} exceeds threshold ${HIGH_COMPLEXITY_THRESHOLD}`,
        estimatedComplexity: field.estimatedComplexity,
      });
    }
    if (field.hasAllTargetRecords && field.status !== 'idle') {
      anomalies.push({
        fieldId: field.fieldId,
        kind: 'all_target_records',
        message: 'Full-table recompute in progress or recently projected',
      });
    }
  }

  return {
    computeMode: 'server',
    activeFieldCount,
    queuedFieldCount,
    calculatingFieldCount,
    failedFieldCount,
    highComplexityFieldCount,
    anomalies,
  };
};

@injectable()
export class PostgresComputedActivityReader implements IComputedActivityReader {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async getByTableId(
    context: IExecutionContext | undefined,
    tableId: string
  ): Promise<Result<TableComputeActivitySnapshot, DomainError>> {
    try {
      const db = (getPostgresTransaction(context) ??
        resolvePostgresDbOrTx(this.db, context)) as unknown as Kysely<DynamicDB>;

      const fieldRows = await db
        .selectFrom(FIELD_ACTIVITY_TABLE)
        .selectAll()
        .where('table_id', '=', tableId)
        .execute();

      const tableRow = await db
        .selectFrom(TABLE_ACTIVITY_TABLE)
        .selectAll()
        .where('table_id', '=', tableId)
        .executeTakeFirst();

      const fields = fieldRows.map((row) => fieldActivityRowToDto(row as Record<string, unknown>));
      const table = tableRow ? tableActivityRowToDto(tableRow as Record<string, unknown>) : null;
      const baseId = table?.baseId ?? fields[0]?.baseId ?? '';

      return ok({
        tableId,
        baseId,
        table,
        fields,
        diagnostics: buildDiagnostics(fields),
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to load compute activity',
          details: {
            tableId,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      );
    }
  }
}
