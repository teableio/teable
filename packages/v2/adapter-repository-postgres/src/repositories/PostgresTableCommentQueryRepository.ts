import { resolvePostgresDbOrTx } from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  type DomainError,
  type IExecutionContext,
  type ITableCommentCount,
  type ITableCommentQueryRepository,
  type TableId,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { v2PostgresStateTokens } from '../di/tokens';

@injectable()
export class PostgresTableCommentQueryRepository implements ITableCommentQueryRepository {
  constructor(
    @inject(v2PostgresStateTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async countByRecordIds(
    context: IExecutionContext,
    tableId: TableId,
    recordIds: ReadonlyArray<string>
  ): Promise<Result<ReadonlyArray<ITableCommentCount>, DomainError>> {
    if (recordIds.length === 0) return ok([]);

    try {
      const db = resolvePostgresDbOrTx(this.db, context, 'meta');
      const rows = await db
        .selectFrom('comment')
        .select('record_id as recordId')
        .select((eb) => eb.fn.countAll<string | number | bigint>().as('count'))
        .where('table_id', '=', tableId.toString())
        .where('record_id', 'in', recordIds)
        .where('deleted_time', 'is', null)
        .groupBy('record_id')
        .execute();

      return ok(rows.map((row) => ({ recordId: row.recordId, count: Number(row.count) })));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to count table comments: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }
}
