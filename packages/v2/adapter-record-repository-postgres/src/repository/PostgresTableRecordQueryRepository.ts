import * as core from '@teable/v2-core';
import {
  domainError,
  type ILogger,
  isDomainError,
  v2CoreTokens,
  type DomainError,
  type ITableRecordQueryOptions,
  type ITableRecordQueryResult,
  type RecordId,
  type TableRecordReadModel,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import {
  FieldOutputColumnVisitor,
  type FieldOutputColumn,
  TableRecordQueryBuilderManager,
  type DynamicDB,
} from '../query-builder';

const RECORD_ID_COLUMN = '__id';

@injectable()
export class PostgresTableRecordQueryRepository implements core.ITableRecordQueryRepository {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager)
    private readonly queryBuilderManager: TableRecordQueryBuilderManager,
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
  ) {}

  async find(
    context: core.IExecutionContext,
    table: core.Table,
    _spec?: core.ISpecification<core.TableRecord, core.ITableRecordConditionSpecVisitor>,
    options?: core.ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    return safeTry<ITableRecordQueryResult, DomainError>(
      async function* (this: PostgresTableRecordQueryRepository) {
        // Start tracing span for record query
        const span = context.tracer?.startSpan('teable.repository.record.find');

        try {
          // Create query builder via manager (it handles prepare)
          const queryBuilder = yield* await this.queryBuilderManager.createBuilder(context, table, {
            mode: options?.mode,
          });

          // Default ordering by auto_number
          queryBuilder.orderBy('__auto_number', 'asc');

          // Apply pagination if provided
          if (options?.pagination) {
            queryBuilder.limit(options.pagination.limit().toNumber());
            queryBuilder.offset(options.pagination.offset().toNumber());
          }

          // Build the query
          const builtQuery = yield* queryBuilder.build();

          const compiled = builtQuery.compile();
          this.logger.debug(`find:mode:${queryBuilder.mode}:sql\n${compiled.sql}`, {
            parameters: compiled.parameters,
          });

          // Collect field column mappings
          const fieldColumns = yield* new FieldOutputColumnVisitor().collect(table);

          try {
            // Execute data query and count query in parallel
            const dbTableName = yield* table.dbTableName();
            const name = yield* dbTableName.value();
            const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
            const countQuery = dynamicDb.selectFrom(name).select(sql<string>`count(*)`.as('count'));

            const [rows, countResult] = await Promise.all([
              builtQuery.execute(),
              countQuery.executeTakeFirstOrThrow(),
            ]);

            const records = mapRowsToReadModels(fieldColumns, rows);
            const total = parseInt(countResult.count, 10);

            return ok({ records, total });
          } catch (error) {
            span?.recordError(describeError(error));
            return err(
              domainError.unexpected({
                message: `Failed to load table records: ${describeError(error)}`,
              })
            );
          }
        } finally {
          span?.end();
        }
      }.bind(this)
    );
  }

  async findOne(
    context: core.IExecutionContext,
    table: core.Table,
    recordId: RecordId,
    options?: Pick<ITableRecordQueryOptions, 'mode'>
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    return safeTry<TableRecordReadModel, DomainError>(
      async function* (this: PostgresTableRecordQueryRepository) {
        const span = context.tracer?.startSpan('teable.repository.record.findOne');

        try {
          // Create query builder via manager
          const queryBuilder = yield* await this.queryBuilderManager.createBuilder(context, table, {
            mode: options?.mode,
          });

          // Filter by record ID
          queryBuilder.whereRecordId(recordId.toString());

          // Limit to 1
          queryBuilder.limit(1);

          // Build the query
          const builtQuery = yield* queryBuilder.build();

          const compiled = builtQuery.compile();
          this.logger.debug(`findOne:mode:${queryBuilder.mode}:sql\n${compiled.sql}`, {
            parameters: compiled.parameters,
          });

          // Collect field column mappings
          const fieldColumns = yield* new FieldOutputColumnVisitor().collect(table);

          try {
            const rows = await builtQuery.execute();

            if (rows.length === 0) {
              return err(
                domainError.notFound({ code: 'record.not_found', message: 'Record not found' })
              );
            }

            const records = mapRowsToReadModels(fieldColumns, rows);
            return ok(records[0]);
          } catch (error) {
            span?.recordError(describeError(error));
            return err(
              domainError.unexpected({
                message: `Failed to load record: ${describeError(error)}`,
              })
            );
          }
        } finally {
          span?.end();
        }
      }.bind(this)
    );
  }
}

const mapRowsToReadModels = (
  fieldColumns: ReadonlyArray<FieldOutputColumn>,
  rows: ReadonlyArray<Record<string, unknown>>
): ReadonlyArray<core.TableRecordReadModel> => {
  return rows.map((row) => {
    const rawId = row[RECORD_ID_COLUMN];
    const id = typeof rawId === 'string' ? rawId : String(rawId);

    const fields: Record<string, unknown> = {};
    for (const column of fieldColumns) {
      fields[column.fieldId.toString()] = row[column.columnAlias];
    }
    return { id, fields };
  });
};

const describeError = (error: unknown): string => {
  if (isDomainError(error)) return error.message;
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};
