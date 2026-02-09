import * as core from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2PostgresStateTokens } from '../di/tokens';

@injectable()
export class PostgresTableRowLimitService implements core.IRecordCreateConstraint {
  constructor(
    @inject(v2PostgresStateTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2PostgresStateTokens.maxFreeRowLimit)
    private readonly maxFreeRowLimit: number
  ) {}

  async checkCreate(
    _context: core.IExecutionContext,
    tableId: core.TableId,
    recordCount: number
  ): Promise<Result<void, core.DomainError>> {
    if (!this.maxFreeRowLimit || recordCount <= 0) return ok(undefined);

    try {
      const metaRow = await this.db
        .selectFrom('table_meta')
        .innerJoin('base', 'base.id', 'table_meta.base_id')
        .innerJoin('space', 'space.id', 'base.space_id')
        .select(['table_meta.db_table_name as db_table_name', 'space.credit as credit'])
        .where('table_meta.id', '=', tableId.toString())
        .where('table_meta.deleted_time', 'is', null)
        .executeTakeFirst();

      if (!metaRow?.db_table_name) {
        return ok(undefined);
      }

      const maxRowCount = metaRow.credit ?? this.maxFreeRowLimit;

      const countResult = await sql<{ count: string }>`
        select count(*) as count from ${sql.table(metaRow.db_table_name)}
      `.execute(this.db);

      const rowCount = Number(countResult.rows[0]?.count ?? 0);

      if (rowCount >= maxRowCount) {
        return err(
          core.domainError.validation({
            code: 'validation.max_row_limit',
            message: `Exceed max row limit: ${maxRowCount}, please contact us to increase the limit`,
            details: { maxRowCount, rowCount, recordCount },
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
}

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
};
