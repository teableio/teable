import {
  domainError,
  type ILogger,
  isDomainError,
  v2CoreTokens,
  type DomainError,
  FieldType,
  type IExecutionContext,
  type ITableRecordQueryRepository,
  RecordByIdSpec,
  type ITableRecordQueryOptions,
  type ITableRecordQueryResult,
  type ITableRecordQueryStreamOptions,
  type RecordId,
  type ISpecification,
  type ITableRecordConditionSpecVisitor,
  type Table,
  type TableRecordReadModel,
  type TableRecord,
  type TableRecordQueryMode,
  OffsetPagination,
  PageLimit,
  PageOffset,
  isFieldOrderBy,
  isSystemColumnOrderBy,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Expression, Kysely, SqlBool } from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import { FieldOutputColumnVisitor } from '../query-builder';
import type {
  TableRecordQueryBuilderManager,
  FieldOutputColumn,
  DynamicDB,
} from '../query-builder';
import { TableRecordConditionWhereVisitor } from '../visitors';

const RECORD_ID_COLUMN = '__id';
const RECORD_VERSION_COLUMN = '__version';
const TABLE_ALIAS = 't';
const ORDER_COLUMN_CACHE_TTL_MS = 5_000;

type OrderColumnExistsCacheEntry = {
  exists: boolean;
  cachedAt: number;
};

@injectable()
export class PostgresTableRecordQueryRepository implements ITableRecordQueryRepository {
  private readonly orderColumnExistsCache = new Map<string, OrderColumnExistsCacheEntry>();

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager)
    private readonly queryBuilderManager: TableRecordQueryBuilderManager,
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
  ) {}

  async find(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    // Start tracing span for record query
    const span = context.tracer?.startSpan('teable.repository.record.find');

    const executeFind = async (): Promise<Result<ITableRecordQueryResult, DomainError>> => {
      return await safeTry<ITableRecordQueryResult, DomainError>(
        async function* (this: PostgresTableRecordQueryRepository) {
          // Create query builder via manager (it handles prepare)
          const queryBuilder = yield* await this.queryBuilderManager.createBuilder(context, table, {
            mode: resolveQueryMode(table, options?.mode),
          });
          const dbTableName = yield* table.dbTableName();
          const tableName = yield* dbTableName.value();
          const [schemaName, tableNameOnly] = tableName.split('.');
          const dynamicDb = this.db as unknown as Kysely<DynamicDB>;

          const orderBy = options?.orderBy;
          if (orderBy && orderBy.length > 0) {
            for (const sort of orderBy) {
              if (isFieldOrderBy(sort)) {
                // Order by user-defined field
                queryBuilder.orderBy(sort.fieldId, sort.direction);
              } else if (isSystemColumnOrderBy(sort)) {
                // Order by system column
                const column = sort.column;
                // Check if it's a view row order column that might not exist
                if (column.startsWith('__row_')) {
                  // Check if the view row order column exists
                  const columnExists = await this.getOrderColumnExists(
                    dynamicDb,
                    schemaName,
                    tableNameOnly,
                    column
                  );

                  if (columnExists) {
                    queryBuilder.orderBy(column as '__auto_number', sort.direction);
                  } else {
                    // Fall back to auto_number if view row order column doesn't exist
                    queryBuilder.orderBy('__auto_number', 'asc');
                  }
                } else {
                  // Standard system column (e.g., __auto_number, __created_time)
                  queryBuilder.orderBy(column as '__auto_number', sort.direction);
                }
              }
            }
          } else {
            // Default ordering by auto_number
            queryBuilder.orderBy('__auto_number', 'asc');
          }

          // Apply pagination if provided
          if (options?.pagination) {
            queryBuilder.limit(options.pagination.limit().toNumber());
            queryBuilder.offset(options.pagination.offset().toNumber());
          }

          // Apply filter spec if provided
          if (spec) {
            queryBuilder.where(spec);
          }

          const whereClause = spec ? buildWhereClause(spec) : ok(null);
          if (whereClause.isErr()) {
            return err(whereClause.error);
          }

          // Query order columns if requested
          let orderColumns: string[] = [];
          if (options?.includeOrders) {
            // Query for order columns
            const orderColumnsResult = await sql<{ column_name: string }>`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_schema = ${schemaName}
              AND table_name = ${tableNameOnly}
              AND column_name LIKE '__row_%'
            `.execute(dynamicDb);

            orderColumns = orderColumnsResult.rows.map((r) => r.column_name);
          }

          // Build the query
          let builtQuery = yield* queryBuilder.build();

          // Add order columns to the query if requested
          if (orderColumns.length > 0) {
            for (const col of orderColumns) {
              builtQuery = builtQuery.select(sql.ref(`${TABLE_ALIAS}.${col}`).as(col));
            }
          }

          const compiled = builtQuery.compile();
          this.logger.debug(`find:mode:${queryBuilder.mode}:sql\n${compiled.sql}`, {
            parameters: compiled.parameters,
          });

          // Collect field column mappings
          const fieldColumns = yield* new FieldOutputColumnVisitor().collect(table);

          try {
            const shouldQueryTotal = options?.includeTotal !== false;
            const rowsPromise = builtQuery.execute();
            const countPromise = shouldQueryTotal
              ? dynamicDb
                  .selectFrom(`${tableName} as ${TABLE_ALIAS}`)
                  .select(sql<string>`count(*)`.as('count'))
                  .$if(whereClause.value !== null, (qb) =>
                    qb.where(whereClause.value as Expression<SqlBool>)
                  )
                  .executeTakeFirstOrThrow()
              : Promise.resolve<{ count: string }>({ count: '0' });

            const [rows, countResult] = await Promise.all([rowsPromise, countPromise]);

            const records = mapRowsToReadModels(fieldColumns, rows, orderColumns);
            const total = shouldQueryTotal ? parseInt(countResult.count, 10) : records.length;

            return ok({ records, total });
          } catch (error) {
            span?.recordError(describeError(error));
            return err(
              domainError.unexpected({
                message: `Failed to load table records: ${describeError(error)}`,
              })
            );
          }
        }.bind(this)
      );
    };

    try {
      // Use withSpan to set span as active context so pg queries become children
      if (span && context.tracer) {
        return await context.tracer.withSpan(span, executeFind);
      }
      return await executeFind();
    } finally {
      span?.end();
    }
  }

  async findOne(
    context: IExecutionContext,
    table: Table,
    recordId: RecordId,
    options?: Pick<ITableRecordQueryOptions, 'mode'>
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    const span = context.tracer?.startSpan('teable.repository.record.findOne');

    const executeFindOne = async (): Promise<Result<TableRecordReadModel, DomainError>> => {
      return await safeTry<TableRecordReadModel, DomainError>(
        async function* (this: PostgresTableRecordQueryRepository) {
          // Create query builder via manager
          const queryBuilder = yield* await this.queryBuilderManager.createBuilder(context, table, {
            mode: resolveQueryMode(table, options?.mode),
          });

          // Filter by record ID via specification
          const recordSpec = RecordByIdSpec.create(recordId);
          queryBuilder.where(recordSpec);

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

            const records = mapRowsToReadModels(fieldColumns, rows, []);
            return ok(records[0]);
          } catch (error) {
            span?.recordError(describeError(error));
            return err(
              domainError.unexpected({
                message: `Failed to load record: ${describeError(error)}`,
              })
            );
          }
        }.bind(this)
      );
    };

    try {
      // Use withSpan to set span as active context so pg queries become children
      if (span && context.tracer) {
        return await context.tracer.withSpan(span, executeFindOne);
      }
      return await executeFindOne();
    } finally {
      span?.end();
    }
  }

  async *findStream(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    const DEFAULT_BATCH_SIZE = 500;
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    let currentOffset = options?.pagination?.offset ?? 0;
    const maxLimit = options?.pagination?.limit ?? Infinity;
    let yieldedCount = 0;

    while (yieldedCount < maxLimit) {
      const remainingLimit = maxLimit - yieldedCount;
      const currentBatchSize = Math.min(batchSize, remainingLimit);

      // Create PageLimit and PageOffset value objects
      const pageLimitResult = PageLimit.create(currentBatchSize);
      if (pageLimitResult.isErr()) {
        yield err(pageLimitResult.error);
        return;
      }
      const pageOffsetResult = PageOffset.create(currentOffset);
      if (pageOffsetResult.isErr()) {
        yield err(pageOffsetResult.error);
        return;
      }

      // Use the existing find method for batched queries
      const pagination = OffsetPagination.create(pageLimitResult.value, pageOffsetResult.value);

      const result = await this.find(context, table, spec, {
        mode: options?.mode,
        pagination,
        orderBy: options?.orderBy,
        includeTotal: false,
      });

      if (result.isErr()) {
        yield err(result.error);
        return;
      }

      const { records } = result.value;
      if (records.length === 0) {
        // No more records
        break;
      }

      // Yield each record individually
      for (const record of records) {
        yield ok(record);
        yieldedCount++;
      }

      // Move to next batch
      currentOffset += records.length;

      // If we got fewer records than requested, we've reached the end
      if (records.length < currentBatchSize) {
        break;
      }
    }
  }

  private async getOrderColumnExists(
    db: Kysely<DynamicDB>,
    schemaName: string,
    tableName: string,
    columnName: string
  ): Promise<boolean> {
    const now = Date.now();
    const cacheKey = `${schemaName}.${tableName}.${columnName}`;
    const cached = this.orderColumnExistsCache.get(cacheKey);
    if (cached && now - cached.cachedAt <= ORDER_COLUMN_CACHE_TTL_MS) {
      return cached.exists;
    }

    const columnCheckResult = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = ${schemaName}
        AND table_name = ${tableName}
        AND column_name = ${columnName}
      ) as exists
    `.execute(db);

    const exists = Boolean(columnCheckResult.rows[0]?.exists);
    this.orderColumnExistsCache.set(cacheKey, {
      exists,
      cachedAt: now,
    });
    return exists;
  }
}

const mapRowsToReadModels = (
  fieldColumns: ReadonlyArray<FieldOutputColumn>,
  rows: ReadonlyArray<Record<string, unknown>>,
  orderColumns: string[] = []
): ReadonlyArray<TableRecordReadModel> => {
  return rows.map((row) => {
    const rawId = row[RECORD_ID_COLUMN];
    const id = typeof rawId === 'string' ? rawId : String(rawId);

    const rawVersion = row[RECORD_VERSION_COLUMN];
    const version = typeof rawVersion === 'number' ? rawVersion : Number(rawVersion) || 0;

    // Extract system columns for undo/redo support
    const rawAutoNumber = row['__auto_number'];
    const autoNumber =
      typeof rawAutoNumber === 'number'
        ? rawAutoNumber
        : rawAutoNumber != null
          ? Number(rawAutoNumber)
          : undefined;

    const rawCreatedTime = row['__created_time'];
    const createdTime =
      rawCreatedTime instanceof Date
        ? rawCreatedTime.toISOString()
        : typeof rawCreatedTime === 'string'
          ? rawCreatedTime
          : undefined;

    const rawCreatedBy = row['__created_by'];
    const createdBy = typeof rawCreatedBy === 'string' ? rawCreatedBy : undefined;

    const rawLastModifiedTime = row['__last_modified_time'];
    const lastModifiedTime =
      rawLastModifiedTime instanceof Date
        ? rawLastModifiedTime.toISOString()
        : typeof rawLastModifiedTime === 'string'
          ? rawLastModifiedTime
          : undefined;

    const rawLastModifiedBy = row['__last_modified_by'];
    const lastModifiedBy = typeof rawLastModifiedBy === 'string' ? rawLastModifiedBy : undefined;

    // Extract order values if order columns were requested
    let orders: Record<string, number> | undefined;
    if (orderColumns.length > 0) {
      orders = {};
      for (const colName of orderColumns) {
        const orderValue = row[colName];
        if (typeof orderValue === 'number') {
          // Extract viewId from column name (format: __row_{viewId})
          const viewId = colName.replace('__row_', '');
          orders[viewId] = orderValue;
        }
      }
      if (Object.keys(orders).length === 0) {
        orders = undefined;
      }
    }

    const fields: Record<string, unknown> = {};
    for (const column of fieldColumns) {
      fields[column.fieldId.toString()] = row[column.columnAlias];
    }
    return {
      id,
      fields,
      version,
      autoNumber,
      createdTime,
      createdBy,
      lastModifiedTime,
      lastModifiedBy,
      orders,
    };
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

const buildWhereClause = (
  spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
): Result<Expression<SqlBool> | null, DomainError> => {
  const visitor = new TableRecordConditionWhereVisitor({ tableAlias: TABLE_ALIAS });
  const acceptResult = spec.accept(visitor);
  if (acceptResult.isErr()) {
    return err(acceptResult.error);
  }
  const whereResult = visitor.where();
  if (whereResult.isErr()) {
    return err(whereResult.error);
  }
  return ok(whereResult.value as unknown as Expression<SqlBool>);
};

const resolveQueryMode = (
  table: Table,
  mode: TableRecordQueryMode | undefined
): TableRecordQueryMode => {
  if (mode) return mode;
  const needsComputedLinks = table
    .getFields()
    .some((field) => field.type().equals(FieldType.link()));
  if (needsComputedLinks) return 'computed';
  const hasConditionalFields = table
    .getFields()
    .some(
      (field) =>
        field.type().equals(FieldType.conditionalRollup()) ||
        field.type().equals(FieldType.conditionalLookup())
    );
  return hasConditionalFields ? 'computed' : 'stored';
};
