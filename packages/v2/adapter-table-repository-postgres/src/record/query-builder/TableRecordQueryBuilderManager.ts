import {
  v2CoreTokens,
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
  type Table,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { formulaSqlPgTokens, type IPgTypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
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
    private readonly tableRepository: ITableRepository,
    @inject(formulaSqlPgTokens.typeValidationStrategy)
    private readonly typeValidationStrategy: IPgTypeValidationStrategy
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

    const executeCreate = async (): Promise<Result<ITableRecordQueryBuilder, DomainError>> => {
      const builder =
        mode === 'stored'
          ? new StoredTableRecordQueryBuilder(db).from(table)
          : new ComputedTableRecordQueryBuilder(db, {
              typeValidationStrategy: this.typeValidationStrategy,
              preferStoredLastModifiedFormula: true,
            }).from(table);

      const prepareSpan = context.tracer?.startSpan('teable.queryBuilder.prepare');

      const executePrepare = async (): Promise<Result<ITableRecordQueryBuilder, DomainError>> => {
        const prepareResult = await builder.prepare({
          context,
          tableRepository: this.tableRepository,
        });

        if (prepareResult.isErr()) {
          return err(prepareResult.error);
        }

        return ok(builder);
      };

      try {
        // Use withSpan to set prepareSpan as active context so pg queries become children
        if (prepareSpan && context.tracer) {
          return await context.tracer.withSpan(prepareSpan, executePrepare);
        }
        return await executePrepare();
      } finally {
        prepareSpan?.end();
      }
    };

    try {
      // Use withSpan to set span as active context so pg queries become children
      if (span && context.tracer) {
        return await context.tracer.withSpan(span, executeCreate);
      }
      return await executeCreate();
    } finally {
      span?.end();
    }
  }
}
