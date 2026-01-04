import {
  v2CoreTokens,
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
  type Table,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import { ComputedTableRecordQueryBuilder } from './computed';
import type { DynamicDB, ITableRecordQueryBuilder } from './ITableRecordQueryBuilder';
import { StoredTableRecordQueryBuilder } from './stored';

/** Query mode determines how fields are resolved */
export type QueryMode = 'computed' | 'stored';

export interface IQueryBuilderManagerOptions {
  /** Query mode. Defaults to 'computed' */
  mode?: QueryMode;
}

/**
 * Manager that creates the appropriate query builder based on configuration.
 *
 * For 'computed' mode:
 * - Creates ComputedTableRecordQueryBuilder
 * - Builder's prepare() loads foreign tables for link/lookup/rollup fields
 *
 * For 'stored' mode:
 * - Creates StoredTableRecordQueryBuilder that reads pre-stored values
 * - Builder's prepare() is no-op
 */
@injectable()
export class TableRecordQueryBuilderManager {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository
  ) {}

  /**
   * Create a query builder for the given table.
   * Calls prepare() on the builder to let it load any required data.
   *
   * @param context - Execution context for repository calls
   * @param table - The main table to query
   * @param options - Optional mode configuration
   * @returns Result containing the prepared query builder
   */
  async createBuilder(
    context: IExecutionContext,
    table: Table,
    options?: IQueryBuilderManagerOptions
  ): Promise<Result<ITableRecordQueryBuilder, DomainError>> {
    const db = this.db as unknown as Kysely<DynamicDB>;
    const mode = options?.mode ?? 'stored';

    // Start tracing span for query builder creation
    const span = context.tracer?.startSpan('teable.queryBuilder.create');

    try {
      const builder =
        mode === 'stored'
          ? new StoredTableRecordQueryBuilder(db).from(table)
          : new ComputedTableRecordQueryBuilder(db).from(table);

      // Let the builder prepare itself (load foreign tables, etc.)
      return safeTry<ITableRecordQueryBuilder, DomainError>(
        async function* (this: TableRecordQueryBuilderManager) {
          const prepareSpan = context.tracer?.startSpan('teable.queryBuilder.prepare');
          try {
            yield* await builder.prepare({
              context,
              tableRepository: this.tableRepository,
            });

            return ok(builder);
          } finally {
            prepareSpan?.end();
          }
        }.bind(this)
      );
    } finally {
      span?.end();
    }
  }
}
