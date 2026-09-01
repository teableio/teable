import {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
  setTableComputedDownstreamHint,
} from '@teable/v2-adapter-db-postgres-shared';
import * as core from '@teable/v2-core';
import { domainError, isDomainError, type DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql, type CompiledQuery, type InsertObject, type Transaction } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ITableDbFieldMeta, ITableDbMeta } from '../db/tableDbMeta';
import { v2PostgresStateTokens } from '../di/tokens';
import { joinDbTableName } from '../naming';
import { TableFieldPersistenceBuilder, type TableFieldRow } from './TableFieldPersistenceBuilder';
import { TableMetaUpdateVisitor } from './visitors/TableMetaUpdateVisitor';
import {
  ITableMetaWhere,
  type TableWhereSpecInfo,
  TableWhereVisitor,
} from './visitors/TableWhereVisitor';

class TableUpdateRollback extends Error {
  constructor(readonly domainError: DomainError) {
    super('table update rolled back');
  }
}

const formatSpecDetails = (specInfo: TableWhereSpecInfo): string => {
  const parts: string[] = [];
  if (specInfo.tableId) parts.push(`tableId=${specInfo.tableId}`);
  if (specInfo.viewId) parts.push(`viewId=${specInfo.viewId}`);
  if (specInfo.viewIds) parts.push(`viewIds=${specInfo.viewIds.join(',')}`);
  if (specInfo.incomingReferenceToTableId) {
    parts.push(`incomingReferenceToTableId=${specInfo.incomingReferenceToTableId}`);
  }
  if (specInfo.baseId) parts.push(`baseId=${specInfo.baseId}`);
  if (specInfo.tableIds?.length) parts.push(`tableIds=${specInfo.tableIds.join(',')}`);
  if (specInfo.tableName) parts.push(`tableName=${specInfo.tableName}`);
  if (specInfo.nameLike) parts.push(`nameLike=${specInfo.nameLike}`);
  return parts.join(' ');
};

type SelectChoiceDto = { id: string; name: string; color: string };

const deduplicateSelectChoices = (
  choices: ReadonlyArray<SelectChoiceDto>
): ReadonlyArray<SelectChoiceDto> => {
  const seen = new Set<string>();
  const deduped: SelectChoiceDto[] = [];
  for (const choice of choices) {
    const normalizedName = choice.name.trim();
    if (!normalizedName) continue;
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    deduped.push({ ...choice, name: normalizedName });
  }
  return deduped;
};

/** Correlated to table_meta.id in find/findOne. Not a second round-trip. */
const outboundReferenceExistsExpr = sql<boolean>`exists (
  select 1
  from reference r
  inner join field f_from on f_from.id = r.from_field_id
  inner join field f_to on f_to.id = r.to_field_id
  where f_from.table_id = table_meta.id
    and f_from.deleted_time is null
    and f_to.deleted_time is null
)`;

const META_INSERT_BATCH_SIZE = 500;

// Reads resolve tables with the 'active' (ready-only) state. A schema update
// that requires physical repair marks the table provision_state='pending' for
// the duration of the update; without a grace window, concurrent read paths
// flap into "Table not found" (T6660). Wait briefly for provisioning to finish
// before declaring the table missing. Values resolve per call so tests and
// deployments can tune them via env.
const DEFAULT_PROVISION_READY_WAIT_MS = 10_000;
const DEFAULT_PROVISION_READY_POLL_MS = 100;

const resolveNonNegativeMs = (raw: string | undefined, fallback: number): number => {
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

const provisionReadyWaitMs = (): number =>
  resolveNonNegativeMs(
    process.env.V2_TABLE_PROVISION_READY_WAIT_MS,
    DEFAULT_PROVISION_READY_WAIT_MS
  );

const provisionReadyPollMs = (): number =>
  resolveNonNegativeMs(
    process.env.V2_TABLE_PROVISION_READY_POLL_MS,
    DEFAULT_PROVISION_READY_POLL_MS
  );

// Same executor form as the sleep helper in
// @teable/v2-adapter-db-postgres-shared/unitOfWork — Promise.withResolvers is
// not in this package's TS lib target.
const sleep = (ms: number): Promise<void> => {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const chunks = <T>(values: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

const v1SymbolOperatorMap: Record<string, string> = {
  '=': 'is',
  '!=': 'isNot',
  '>': 'isGreater',
  '>=': 'isGreaterEqual',
  '<': 'isLess',
  '<=': 'isLessEqual',
  LIKE: 'contains',
  'NOT LIKE': 'doesNotContain',
  IN: 'isAnyOf',
  'NOT IN': 'isNoneOf',
  HAS: 'hasAllOf',
  'IS NULL': 'isEmpty',
  'IS NOT NULL': 'isNotEmpty',
  'IS WITH IN': 'isWithIn',
};

const tableProvisionStateToOperationStatus = (
  state: core.TableProvisionState
): core.SchemaOperationStatus => {
  if (state === 'ready') return 'ready';
  if (state === 'error') return 'error';
  return 'pending';
};

const shouldFilterDeletedChildren = (state: core.TableQueryState): boolean =>
  state === 'active' || state === 'activeWithPending' || state === 'activeAnyProvision';

const toIsoTimestamp = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const jsonbValue = (value: unknown): ReturnType<typeof sql> => {
  if (value === undefined) {
    return sql`NULL`;
  }
  return sql`${JSON.stringify(value)}::jsonb`;
};

@injectable()
export class PostgresTableRepository implements core.ITableRepository {
  constructor(
    @inject(v2PostgresStateTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2PostgresStateTokens.tableMapper)
    private readonly tableMapper: core.ITableMapper
  ) {}

  @core.TraceSpan()
  async insert(
    context: core.IExecutionContext,
    table: core.Table
  ): Promise<Result<core.Table, DomainError>> {
    const now = new Date();
    const actorId = context.actorId.toString();
    const baseId = table.baseId().toString();
    const tableToPersist = table;

    let tableDbMeta: ITableDbMeta | undefined;
    const transaction = getPostgresTransaction<V1TeableDatabase>(context, 'meta');
    const persist = async (trx: Kysely<V1TeableDatabase>): Promise<Result<void, DomainError>> => {
      const order = sql<number>`
        (
          select coalesce(max("order"), 0) + 1
          from table_meta
          where base_id = ${baseId}
        )
      `;
      const existingDbTableNameResult = tableToPersist
        .dbTableName()
        .andThen((name) => name.value());
      const dbTableNameResult = existingDbTableNameResult.isOk()
        ? ok(existingDbTableNameResult.value)
        : ok(joinDbTableName(baseId, tableToPersist.id().toString()));
      if (dbTableNameResult.isErr()) return err(dbTableNameResult.error);
      const dbTableName = dbTableNameResult.value;

      if (existingDbTableNameResult.isOk()) {
        const existingTable = await trx
          .selectFrom('table_meta')
          .select('id')
          .where('base_id', '=', baseId)
          .where('db_table_name', '=', dbTableName)
          .executeTakeFirst();
        if (existingTable) {
          return err(
            domainError.validation({ message: `dbTableName ${dbTableName} already exists` })
          );
        }
      }

      const dtoResult = this.tableMapper.toDTO(tableToPersist);
      if (dtoResult.isErr()) return err(dtoResult.error);
      const dto = dtoResult.value;
      const serializedViewQueryById = new Map(
        dto.views.map((view) => [view.id, this.serializeViewQuery(view)] as const)
      );

      const fieldRowBuilder = new TableFieldPersistenceBuilder({
        table: tableToPersist,
        tableMapper: this.tableMapper,
        now,
        actorId,
        dto,
      });
      const dbFieldMetaResult = fieldRowBuilder.buildDbFieldMeta();
      if (dbFieldMetaResult.isErr()) return err(dbFieldMetaResult.error);
      tableDbMeta = await this.buildTableDbMeta(
        trx,
        dto,
        baseId,
        dbFieldMetaResult.value,
        dbTableName
      );
      const tableDbMetaValue = tableDbMeta;
      if (!tableDbMetaValue)
        return err(domainError.validation({ message: 'Missing table db metadata' }));
      const fieldValuesResult = fieldRowBuilder.buildRowsFromDbMeta(tableDbMetaValue.fields);
      if (fieldValuesResult.isErr()) return err(fieldValuesResult.error);

      const fieldRows: ReadonlyArray<TableFieldRow> = fieldValuesResult.value;
      const viewRows = dto.views.map((v, i) => ({
        ...(serializedViewQueryById.get(v.id) ?? {
          filter: null,
          sort: null,
          group: null,
        }),
        id: v.id,
        name: v.name,
        description: v.description ?? null,
        table_id: dto.id,
        type: v.type,
        options: v.options === undefined ? null : JSON.stringify(v.options),
        // v1 assigns 0-based view orders; keep parity so export order
        // normalization round-trips (see BaseExportService.generateViewConfig).
        order: v.order ?? i,
        version: 1,
        column_meta: JSON.stringify(v.columnMeta),
        is_locked: v.isLocked ?? null,
        enable_share: v.enableShare ?? null,
        share_id: v.shareId ?? null,
        share_meta: v.shareMeta === undefined ? null : JSON.stringify(v.shareMeta),
        created_time: now,
        last_modified_time: now,
        deleted_time: null,
        created_by: actorId,
        last_modified_by: actorId,
      }));

      const tableMetaColumns = sql.join([
        sql.ref('id'),
        sql.ref('base_id'),
        sql.ref('name'),
        sql.ref('description'),
        sql.ref('icon'),
        sql.ref('db_table_name'),
        sql.ref('db_view_name'),
        sql.ref('version'),
        sql.ref('order'),
        sql.ref('created_time'),
        sql.ref('last_modified_time'),
        sql.ref('deleted_time'),
        sql.ref('created_by'),
        sql.ref('last_modified_by'),
      ]);
      const tableMetaValues = sql`(${sql.join([
        dto.id,
        baseId,
        dto.name,
        dto.description ?? null,
        dto.icon ?? null,
        tableDbMetaValue.dbTableName,
        null,
        1,
        order,
        now,
        now,
        null,
        actorId,
        actorId,
      ])})`;

      const fieldColumns = sql.join([
        sql.ref('id'),
        sql.ref('name'),
        sql.ref('description'),
        sql.ref('options'),
        sql.ref('meta'),
        sql.ref('ai_config'),
        sql.ref('type'),
        sql.ref('cell_value_type'),
        sql.ref('is_multiple_cell_value'),
        sql.ref('db_field_type'),
        sql.ref('db_field_name'),
        sql.ref('not_null'),
        sql.ref('unique'),
        sql.ref('is_primary'),
        sql.ref('is_computed'),
        sql.ref('is_lookup'),
        sql.ref('is_conditional_lookup'),
        sql.ref('is_pending'),
        sql.ref('has_error'),
        sql.ref('lookup_linked_field_id'),
        sql.ref('lookup_options'),
        sql.ref('table_id'),
        sql.ref('order'),
        sql.ref('version'),
        sql.ref('created_time'),
        sql.ref('last_modified_time'),
        sql.ref('deleted_time'),
        sql.ref('created_by'),
        sql.ref('last_modified_by'),
      ]);
      const fieldValues = fieldRows.length
        ? sql.join(
            fieldRows.map(
              (row) =>
                sql`(${sql.join([
                  row.id,
                  row.name,
                  row.description,
                  row.options,
                  row.meta,
                  row.ai_config,
                  row.type,
                  row.cell_value_type,
                  row.is_multiple_cell_value,
                  row.db_field_type,
                  row.db_field_name,
                  row.not_null,
                  row.unique,
                  row.is_primary,
                  row.is_computed,
                  row.is_lookup,
                  row.is_conditional_lookup,
                  row.is_pending,
                  row.has_error,
                  row.lookup_linked_field_id,
                  row.lookup_options,
                  row.table_id,
                  row.order,
                  row.version,
                  row.created_time,
                  row.last_modified_time,
                  row.deleted_time,
                  row.created_by,
                  row.last_modified_by,
                ])})`
            )
          )
        : null;

      const viewColumns = sql.join([
        sql.ref('id'),
        sql.ref('name'),
        sql.ref('description'),
        sql.ref('table_id'),
        sql.ref('type'),
        sql.ref('sort'),
        sql.ref('filter'),
        sql.ref('group'),
        sql.ref('options'),
        sql.ref('order'),
        sql.ref('version'),
        sql.ref('column_meta'),
        sql.ref('is_locked'),
        sql.ref('enable_share'),
        sql.ref('share_id'),
        sql.ref('share_meta'),
        sql.ref('created_time'),
        sql.ref('last_modified_time'),
        sql.ref('deleted_time'),
        sql.ref('created_by'),
        sql.ref('last_modified_by'),
      ]);
      const viewValues = viewRows.length
        ? sql.join(
            viewRows.map(
              (row) =>
                sql`(${sql.join([
                  row.id,
                  row.name,
                  row.description,
                  row.table_id,
                  row.type,
                  row.sort,
                  row.filter,
                  row.group,
                  row.options,
                  row.order,
                  row.version,
                  row.column_meta,
                  row.is_locked,
                  row.enable_share,
                  row.share_id,
                  row.share_meta,
                  row.created_time,
                  row.last_modified_time,
                  row.deleted_time,
                  row.created_by,
                  row.last_modified_by,
                ])})`
            )
          )
        : null;

      const fieldInsert = fieldValues
        ? sql`
            , field_insert as (
              insert into ${sql.ref('field')} (${fieldColumns})
              values ${fieldValues}
            )
          `
        : sql``;
      const viewInsert = viewValues
        ? sql`
            , view_insert as (
              insert into ${sql.ref('view')} (${viewColumns})
              values ${viewValues}
            )
          `
        : sql``;

      await sql`
        with table_insert as (
          insert into ${sql.ref('table_meta')} (${tableMetaColumns})
          values ${tableMetaValues}
        )
        ${fieldInsert}
        ${viewInsert}
        select 1
      `.execute(trx);

      return ok(undefined);
    };

    try {
      const persistResult = transaction
        ? await persist(transaction)
        : await this.db.transaction().execute(async (trx) => persist(trx));
      if (persistResult.isErr()) return err(persistResult.error);
    } catch (error) {
      return err(
        domainError.infrastructure({ message: `Failed to insert table: ${describeError(error)}` })
      );
    }

    const tableDbMetaValue = tableDbMeta;
    if (!tableDbMetaValue)
      return err(domainError.validation({ message: 'Missing table db metadata' }));

    const applyDbMetaResult = this.applyDbMeta(tableToPersist, tableDbMetaValue);
    if (applyDbMetaResult.isErr()) return err(applyDbMetaResult.error);

    return ok(tableToPersist);
  }

  @core.TraceSpan()
  async insertMany(
    context: core.IExecutionContext,
    tables: ReadonlyArray<core.Table>
  ): Promise<Result<ReadonlyArray<core.Table>, DomainError>> {
    if (tables.length === 0) return ok([]);

    const now = new Date();
    const actorId = context.actorId.toString();

    const transaction = getPostgresTransaction<V1TeableDatabase>(context, 'meta');
    const persist = async (
      trx: Kysely<V1TeableDatabase>
    ): Promise<Result<ReadonlyMap<string, ITableDbMeta>, DomainError>> => {
      type TableMetaRow = InsertObject<V1TeableDatabase, 'table_meta'>;
      type FieldRow = InsertObject<V1TeableDatabase, 'field'>;
      type ViewRow = InsertObject<V1TeableDatabase, 'view'>;

      const baseIds = [...new Set(tables.map((table) => table.baseId().toString()))];
      const baseOrderById = new Map<string, number>();
      for (const baseId of baseIds) {
        const row = await trx
          .selectFrom('table_meta')
          .select(sql<number>`coalesce(max("order"), 0)`.as('maxOrder'))
          .where('base_id', '=', baseId)
          .executeTakeFirst();
        baseOrderById.set(baseId, Number(row?.maxOrder ?? 0));
      }

      const baseOffsetById = new Map<string, number>();
      const tableMetaRows: TableMetaRow[] = [];
      const fieldRows: FieldRow[] = [];
      const viewRows: ViewRow[] = [];
      const tableDbMetaById = new Map<string, ITableDbMeta>();

      for (const table of tables) {
        const baseId = table.baseId().toString();
        const nextOffset = (baseOffsetById.get(baseId) ?? 0) + 1;
        baseOffsetById.set(baseId, nextOffset);
        const order = (baseOrderById.get(baseId) ?? 0) + nextOffset;

        const existingDbTableNameResult = table.dbTableName().andThen((name) => name.value());
        const dbTableNameResult = existingDbTableNameResult.isOk()
          ? ok(existingDbTableNameResult.value)
          : ok(joinDbTableName(baseId, table.id().toString()));
        if (dbTableNameResult.isErr()) return err(dbTableNameResult.error);
        const dbTableName = dbTableNameResult.value;

        const dtoResult = this.tableMapper.toDTO(table);
        if (dtoResult.isErr()) return err(dtoResult.error);
        const dto = dtoResult.value;

        const fieldRowBuilder = new TableFieldPersistenceBuilder({
          table,
          tableMapper: this.tableMapper,
          now,
          actorId,
          dto,
        });
        const dbFieldMetaResult = fieldRowBuilder.buildDbFieldMeta();
        if (dbFieldMetaResult.isErr()) return err(dbFieldMetaResult.error);
        const tableDbMetaResult = await this.buildTableDbMeta(
          trx,
          dto,
          baseId,
          dbFieldMetaResult.value,
          dbTableName
        );
        const tableDbMeta = tableDbMetaResult;
        const fieldValuesResult = fieldRowBuilder.buildRowsFromDbMeta(tableDbMeta.fields);
        if (fieldValuesResult.isErr()) return err(fieldValuesResult.error);
        const serializedViewQueryById = new Map(
          dto.views.map((view) => [view.id, this.serializeViewQuery(view)] as const)
        );

        tableDbMetaById.set(table.id().toString(), tableDbMeta);
        tableMetaRows.push({
          id: dto.id,
          base_id: baseId,
          name: dto.name,
          description: dto.description ?? null,
          icon: dto.icon ?? null,
          db_table_name: tableDbMeta.dbTableName,
          db_view_name: null,
          version: 1,
          order,
          created_time: now,
          last_modified_time: now,
          deleted_time: null,
          created_by: actorId,
          last_modified_by: actorId,
        });

        fieldRows.push(...(fieldValuesResult.value as FieldRow[]));
        viewRows.push(
          ...dto.views.map((view, index) => ({
            ...(serializedViewQueryById.get(view.id) ?? {
              filter: null,
              sort: null,
              group: null,
            }),
            id: view.id,
            name: view.name,
            description: view.description ?? null,
            table_id: dto.id,
            type: view.type,
            options: view.options === undefined ? null : JSON.stringify(view.options),
            order: view.order ?? index,
            version: 1,
            column_meta: JSON.stringify(view.columnMeta),
            is_locked: view.isLocked ?? null,
            enable_share: view.enableShare ?? null,
            share_id: view.shareId ?? null,
            share_meta: view.shareMeta === undefined ? null : JSON.stringify(view.shareMeta),
            created_time: now,
            last_modified_time: now,
            deleted_time: null,
            created_by: actorId,
            last_modified_by: actorId,
          }))
        );
      }

      if (tableMetaRows.length > 0) {
        for (const rows of chunks(tableMetaRows, META_INSERT_BATCH_SIZE)) {
          await trx.insertInto('table_meta').values(rows).execute();
        }
      }
      if (fieldRows.length > 0) {
        for (const rows of chunks(fieldRows, META_INSERT_BATCH_SIZE)) {
          await trx.insertInto('field').values(rows).execute();
        }
      }
      if (viewRows.length > 0) {
        for (const rows of chunks(viewRows, META_INSERT_BATCH_SIZE)) {
          await trx.insertInto('view').values(rows).execute();
        }
      }

      return ok(tableDbMetaById);
    };

    let tableDbMetaById: ReadonlyMap<string, ITableDbMeta>;
    try {
      const persistResult = transaction
        ? await persist(transaction)
        : await this.db.transaction().execute(async (trx) => persist(trx));
      if (persistResult.isErr()) return err(persistResult.error);
      tableDbMetaById = persistResult.value;
    } catch (error) {
      return err(
        domainError.infrastructure({ message: `Failed to insert tables: ${describeError(error)}` })
      );
    }

    for (const table of tables) {
      const tableDbMeta = tableDbMetaById.get(table.id().toString());
      if (!tableDbMeta)
        return err(domainError.validation({ message: 'Missing table db metadata' }));
      const applyDbMetaResult = this.applyDbMeta(table, tableDbMeta);
      if (applyDbMetaResult.isErr()) return err(applyDbMetaResult.error);
    }

    return ok([...tables]);
  }

  @core.TraceSpan()
  async findOne(
    context: core.IExecutionContext,
    spec: core.ISpecification<core.Table, core.ITableSpecVisitor>,
    options?: core.TableFindOneOptions
  ): Promise<Result<core.Table, DomainError>> {
    const visitor = new TableWhereVisitor(options?.state);
    const acceptResult = spec.accept(visitor);
    if (acceptResult.isErr()) return err(acceptResult.error);

    const whereResult = visitor.where();
    if (whereResult.isErr()) return err(whereResult.error);
    const whereFactory = whereResult.value;
    const specInfo = visitor.describe();

    const activeSpan = context.tracer?.getActiveSpan?.();
    if (activeSpan) {
      const attributes: Record<string, core.SpanAttributeValue> = {
        'teable.table_spec': specInfo.specName ?? spec.constructor?.name ?? 'unknown',
      };
      if (specInfo.tableId) {
        attributes[core.TeableSpanAttributes.TABLE_ID] = specInfo.tableId;
      }
      if (specInfo.viewId) {
        attributes['teable.view_id'] = specInfo.viewId;
      }
      if (specInfo.viewIds) {
        attributes['teable.view_ids'] = specInfo.viewIds.join(',');
      }
      if (specInfo.incomingReferenceToTableId) {
        attributes['teable.incoming_reference_to_table_id'] = specInfo.incomingReferenceToTableId;
      }
      if (specInfo.baseId) {
        attributes['teable.base_id'] = specInfo.baseId;
      }
      if (specInfo.tableIds?.length) {
        attributes['teable.table_ids'] = specInfo.tableIds.join(',');
      }
      if (specInfo.tableName) {
        attributes['teable.table_name'] = specInfo.tableName;
      }
      if (specInfo.nameLike) {
        attributes['teable.table_name_like'] = specInfo.nameLike;
      }
      const fieldWhere = visitor.fieldWhere();
      if (fieldWhere) {
        attributes['teable.table_fields'] = 'primary';
      }
      activeSpan.setAttributes(attributes);
    }

    try {
      const db = resolvePostgresDbOrTx(this.db, context, 'meta');
      if (options?.lock === 'forUpdate') {
        await db
          .selectFrom('table_meta')
          .select('id')
          .where((eb) => whereFactory(eb))
          .forUpdate()
          .executeTakeFirst();
      }
      const effectiveState = options?.state ?? 'active';
      const fieldsLateral = db
        .selectNoFrom((eb) => [
          jsonArrayFrom(
            (() => {
              let query = eb
                .selectFrom('field')
                .select([
                  'id',
                  'name',
                  'description',
                  'type',
                  'options',
                  'meta',
                  'ai_config',
                  'cell_value_type',
                  'is_multiple_cell_value',
                  'not_null',
                  'unique',
                  'is_primary',
                  'is_computed',
                  'is_lookup',
                  'is_conditional_lookup',
                  'has_error',
                  'lookup_linked_field_id',
                  'lookup_options',
                  'db_field_name',
                  'db_field_type',
                ])
                .where(sql<boolean>`${sql.ref('field.table_id')} = ${sql.ref('table_meta.id')}`)
                // Keep the hydrated field array aligned with the existing field list API.
                // Selection range column indexes depend on this fallback order when the
                // view has no explicit columnMeta.order entries.
                .orderBy(sql`${sql.ref('is_primary')} is null`, 'asc')
                .orderBy('is_primary')
                .orderBy('order')
                .orderBy('created_time');
              const fieldWhere = visitor.fieldWhere();
              if (fieldWhere) {
                query = query.where((eb) => fieldWhere(eb));
              }
              if (shouldFilterDeletedChildren(effectiveState)) {
                query = query.where('deleted_time', 'is', null);
                if (effectiveState === 'active') {
                  // Legacy schema operations can leave computed fields pending before their
                  // physical columns exist. Active record paths must not hydrate those fields.
                  query = query.where((eb) =>
                    eb.or([eb('is_pending', 'is', null), eb('is_pending', '=', false)])
                  );
                }
              } else if (effectiveState === 'deleted') {
                query = query.where(
                  sql<boolean>`${sql.ref('field.deleted_time')} = ${sql.ref('table_meta.deleted_time')}`
                );
              }
              return query;
            })()
          ).as('fields'),
        ])
        .as('fields');
      const viewsLateral = db
        .selectNoFrom((eb) => [
          jsonArrayFrom(
            (() => {
              let query = eb
                .selectFrom('view')
                .select([
                  'id',
                  'name',
                  'description',
                  'type',
                  'options',
                  'order',
                  'version',
                  'column_meta',
                  'sort',
                  'filter',
                  'group',
                  'is_locked',
                  'enable_share',
                  'share_id',
                  'share_meta',
                  'created_time',
                  'last_modified_time',
                  'created_by',
                  'last_modified_by',
                ])
                .where(sql<boolean>`${sql.ref('view.table_id')} = ${sql.ref('table_meta.id')}`)
                .orderBy('order');
              if (specInfo.viewId) {
                query = query.where('id', '=', specInfo.viewId);
              } else if (specInfo.viewIds) {
                query =
                  specInfo.viewIds.length > 0
                    ? query.where('id', 'in', specInfo.viewIds)
                    : query.where(sql<boolean>`false`);
              }
              if (shouldFilterDeletedChildren(effectiveState)) {
                query = query.where('deleted_time', 'is', null);
              } else if (effectiveState === 'deleted') {
                query = query.where(
                  sql<boolean>`${sql.ref('view.deleted_time')} = ${sql.ref('table_meta.deleted_time')}`
                );
              }
              return query;
            })()
          ).as('views'),
        ])
        .as('views');
      const baseQuery = db
        .selectFrom('table_meta')
        .leftJoinLateral(fieldsLateral, (join) => join.onTrue())
        .leftJoinLateral(viewsLateral, (join) => join.onTrue())
        .select([
          'table_meta.id',
          'table_meta.name',
          'table_meta.description',
          'table_meta.icon',
          'table_meta.base_id',
          'table_meta.db_table_name',
          'fields.fields',
          'views.views',
          outboundReferenceExistsExpr.as('has_outbound_reference'),
        ])
        .where((eb) => whereFactory(eb));

      const {
        row: tableRow,
        pendingWaitExpiredMs,
        provisionPending,
      } = await this.loadActiveTableRow(
        context,
        spec,
        options,
        () => baseQuery.executeTakeFirst(),
        effectiveState
      );
      if (!tableRow) {
        const specName = specInfo.specName ?? spec.constructor?.name ?? 'unknown';
        const details = formatSpecDetails(specInfo);
        const detailsSuffix = details.length > 0 ? ` ${details}` : '';
        // A table still pending after the full wait budget is stuck (or its
        // schema update is unusually slow) — say so in the error, which read
        // paths already surface to logs, instead of looking genuinely missing.
        // Transactional callers skip the wait; they still need a distinguishable
        // code so computed workers can retry instead of obsolete-planning.
        const provisionSuffix =
          pendingWaitExpiredMs != null
            ? ` (provision_state=pending after ${pendingWaitExpiredMs}ms wait)`
            : provisionPending
              ? ' (provision_state=pending)'
              : '';
        return err(
          domainError.notFound({
            code:
              pendingWaitExpiredMs != null || provisionPending
                ? 'table.provision_pending'
                : 'table.not_found',
            message: `Table not found (${specName})${detailsSuffix}${provisionSuffix}`,
          })
        );
      }

      const tableResult = this.mapTableRow(tableRow);
      if (tableResult.isErr()) return err(tableResult.error);

      return ok(tableResult.value);
    } catch (error) {
      return err(
        domainError.unexpected({ message: `Failed to load table: ${describeError(error)}` })
      );
    }
  }

  /**
   * Load a table row for the default 'active' (ready-only) state, absorbing
   * the short provisioning window of a concurrent schema update.
   *
   * A physical-repair schema update commits provision_state='pending' before
   * its meta transaction and flips back to 'ready' after commit. A read that
   * lands inside that window must wait briefly instead of reporting
   * "Table not found" (T6660); a table that is missing, deleted, or in
   * 'error'/'deleting' state still misses immediately.
   *
   * Skipped for 'forUpdate' lookups: the caller asked for a row lock, and a
   * row loaded after the wait would not carry it. Also skipped inside an
   * active unit-of-work transaction: sleeping there would park the
   * transaction's connection (and any locks it holds) for the whole wait,
   * so transactional callers keep the original fail-fast behavior.
   */
  private async loadActiveTableRow<TRow>(
    context: core.IExecutionContext,
    spec: core.ISpecification<core.Table, core.ITableSpecVisitor>,
    options: core.TableFindOneOptions | undefined,
    loadRow: () => Promise<TRow | undefined>,
    effectiveState: core.TableQueryState
  ): Promise<{
    row: TRow | undefined;
    pendingWaitExpiredMs?: number;
    provisionPending?: boolean;
  }> {
    const firstRow = await loadRow();
    if (firstRow) return { row: firstRow };
    if (effectiveState !== 'active' || options?.lock === 'forUpdate') return { row: undefined };

    const probeWhereFactory = this.activeProvisionProbeWhere(spec);
    if (!probeWhereFactory) return { row: undefined };

    const inTransaction =
      getPostgresTransaction(context, 'meta') != null ||
      getPostgresTransaction(context, 'data') != null;
    if (inTransaction) {
      const probe = await this.probeActiveTableProvisionState(probeWhereFactory);
      return probe === 'pending' ? { row: undefined, provisionPending: true } : { row: undefined };
    }

    const waitMs = provisionReadyWaitMs();
    if (waitMs <= 0) return { row: undefined };

    // Waiting only happens outside transactions (guarded above), so the probe
    // always reads through the pool and sees other transactions' commits.
    const pollMs = Math.max(1, provisionReadyPollMs());
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const probe = await this.probeActiveTableProvisionState(probeWhereFactory);
      // No ready/pending row: genuinely missing, deleted, or terminally broken.
      if (probe === 'missing') return { row: undefined };
      if (probe !== 'pending') {
        // The ready flip landed between the missed load and this probe —
        // reload once instead of reporting a table that now exists as missing.
        return { row: await loadRow() };
      }
      await sleep(pollMs);
      const row = await loadRow();
      if (row) return { row };
    }
    return { row: undefined, pendingWaitExpiredMs: waitMs, provisionPending: true };
  }

  private activeProvisionProbeWhere(
    spec: core.ISpecification<core.Table, core.ITableSpecVisitor>
  ): ITableMetaWhere | undefined {
    const probeVisitor = new TableWhereVisitor('activeAnyProvision');
    const acceptResult = spec.accept(probeVisitor);
    if (acceptResult.isErr()) return undefined;
    const probeWhereResult = probeVisitor.where();
    if (probeWhereResult.isErr()) return undefined;
    return probeWhereResult.value;
  }

  private async probeActiveTableProvisionState(
    probeWhereFactory: ITableMetaWhere
  ): Promise<'pending' | 'ready' | 'missing'> {
    const probe = await this.db
      .selectFrom('table_meta')
      .select('provision_state')
      .where((eb) => probeWhereFactory(eb))
      .executeTakeFirst();
    if (!probe) return 'missing';
    return probe.provision_state === 'pending' ? 'pending' : 'ready';
  }

  @core.TraceSpan()
  async find(
    context: core.IExecutionContext,
    spec: core.ISpecification<core.Table, core.ITableSpecVisitor>,
    options?: core.TableFindOptions
  ): Promise<Result<ReadonlyArray<core.Table>, DomainError>> {
    const visitor = new TableWhereVisitor(options?.state);
    const acceptResult = spec.accept(visitor);
    if (acceptResult.isErr()) return err(acceptResult.error);

    const whereResult = visitor.where();
    if (whereResult.isErr()) return err(whereResult.error);
    const whereFactory = whereResult.value;
    const specInfo = visitor.describe();

    try {
      const db = resolvePostgresDbOrTx(this.db, context, 'meta');
      const effectiveState = options?.state ?? 'active';
      const fieldsLateral = db
        .selectNoFrom((eb) => [
          jsonArrayFrom(
            (() => {
              let query = eb
                .selectFrom('field')
                .select([
                  'id',
                  'name',
                  'description',
                  'type',
                  'options',
                  'meta',
                  'ai_config',
                  'cell_value_type',
                  'is_multiple_cell_value',
                  'not_null',
                  'unique',
                  'is_primary',
                  'is_computed',
                  'is_lookup',
                  'is_conditional_lookup',
                  'has_error',
                  'lookup_linked_field_id',
                  'lookup_options',
                  'db_field_name',
                  'db_field_type',
                ])
                .where(sql<boolean>`${sql.ref('field.table_id')} = ${sql.ref('table_meta.id')}`)
                .orderBy(sql`${sql.ref('is_primary')} is null`, 'asc')
                .orderBy('is_primary')
                .orderBy('order')
                .orderBy('created_time');
              if (shouldFilterDeletedChildren(effectiveState)) {
                query = query.where('deleted_time', 'is', null);
              } else if (effectiveState === 'deleted') {
                query = query.where(
                  sql<boolean>`${sql.ref('field.deleted_time')} = ${sql.ref('table_meta.deleted_time')}`
                );
              }
              return query;
            })()
          ).as('fields'),
        ])
        .as('fields');
      const viewsLateral = db
        .selectNoFrom((eb) => [
          jsonArrayFrom(
            (() => {
              let query = eb
                .selectFrom('view')
                .select([
                  'id',
                  'name',
                  'description',
                  'type',
                  'options',
                  'order',
                  'version',
                  'column_meta',
                  'sort',
                  'filter',
                  'group',
                  'is_locked',
                  'enable_share',
                  'share_id',
                  'share_meta',
                  'created_time',
                  'last_modified_time',
                  'created_by',
                  'last_modified_by',
                ])
                .where(sql<boolean>`${sql.ref('view.table_id')} = ${sql.ref('table_meta.id')}`)
                .orderBy('order');
              if (specInfo.viewId) {
                query = query.where('id', '=', specInfo.viewId);
              } else if (specInfo.viewIds) {
                query =
                  specInfo.viewIds.length > 0
                    ? query.where('id', 'in', specInfo.viewIds)
                    : query.where(sql<boolean>`false`);
              }
              if (shouldFilterDeletedChildren(effectiveState)) {
                query = query.where('deleted_time', 'is', null);
              } else if (effectiveState === 'deleted') {
                query = query.where(
                  sql<boolean>`${sql.ref('view.deleted_time')} = ${sql.ref('table_meta.deleted_time')}`
                );
              }
              return query;
            })()
          ).as('views'),
        ])
        .as('views');
      let baseQuery = db
        .selectFrom('table_meta')
        .leftJoinLateral(fieldsLateral, (join) => join.onTrue())
        .leftJoinLateral(viewsLateral, (join) => join.onTrue())
        .select([
          'table_meta.id',
          'table_meta.name',
          'table_meta.description',
          'table_meta.icon',
          'table_meta.base_id',
          'table_meta.db_table_name',
          'fields.fields',
          'views.views',
          outboundReferenceExistsExpr.as('has_outbound_reference'),
        ])
        .where((eb) => whereFactory(eb));

      const sort = options?.sort;
      if (sort && !sort.isEmpty()) {
        for (const field of sort.fields()) {
          baseQuery = baseQuery.orderBy(
            this.resolveSortColumn(field.key),
            field.direction.toString()
          );
        }
      }

      const pagination = options?.pagination;
      if (pagination) {
        baseQuery = baseQuery.limit(pagination.limit().toNumber());
        baseQuery = baseQuery.offset(pagination.offset().toNumber());
      }

      const rows = await baseQuery.execute();
      const tablesResult = this.sequenceResults(rows.map((row) => this.mapTableRow(row)));
      if (tablesResult.isErr()) return err(tablesResult.error);

      return ok(tablesResult.value);
    } catch (error) {
      return err(
        domainError.unexpected({ message: `Failed to load tables: ${describeError(error)}` })
      );
    }
  }

  @core.TraceSpan()
  async count(
    context: core.IExecutionContext,
    spec: core.ISpecification<core.Table, core.ITableSpecVisitor>,
    options?: Pick<core.TableFindOptions, 'state'>
  ): Promise<Result<number, DomainError>> {
    const visitor = new TableWhereVisitor(options?.state);
    const acceptResult = spec.accept(visitor);
    if (acceptResult.isErr()) return err(acceptResult.error);

    const whereResult = visitor.where();
    if (whereResult.isErr()) return err(whereResult.error);
    const whereFactory = whereResult.value;
    const specInfo = visitor.describe();

    const activeSpan = context.tracer?.getActiveSpan?.();
    if (activeSpan) {
      const attributes: Record<string, core.SpanAttributeValue> = {
        'teable.table_spec': specInfo.specName ?? spec.constructor?.name ?? 'unknown',
      };
      if (specInfo.tableId) {
        attributes[core.TeableSpanAttributes.TABLE_ID] = specInfo.tableId;
      }
      if (specInfo.incomingReferenceToTableId) {
        attributes['teable.incoming_reference_to_table_id'] = specInfo.incomingReferenceToTableId;
      }
      if (specInfo.baseId) {
        attributes['teable.base_id'] = specInfo.baseId;
      }
      if (specInfo.tableIds?.length) {
        attributes['teable.table_ids'] = specInfo.tableIds.join(',');
      }
      if (specInfo.tableName) {
        attributes['teable.table_name'] = specInfo.tableName;
      }
      if (specInfo.nameLike) {
        attributes['teable.table_name_like'] = specInfo.nameLike;
      }
      activeSpan.setAttributes(attributes);
    }

    try {
      const db = resolvePostgresDbOrTx(this.db, context, 'meta');
      const row = await db
        .selectFrom('table_meta')
        .select(db.fn.count('id').as('count'))
        .where((eb) => whereFactory(eb))
        .executeTakeFirst();

      return ok(Number(row?.count ?? 0));
    } catch (error) {
      return err(
        domainError.unexpected({ message: `Failed to count tables: ${describeError(error)}` })
      );
    }
  }

  @core.TraceSpan()
  async updateOne(
    context: core.IExecutionContext,
    table: core.Table,
    mutateSpec: core.ISpecification<core.Table, core.ITableSpecVisitor>
  ): Promise<Result<core.TableUpdatePersistResult | void, DomainError>> {
    // The FOR UPDATE view-version guard in executeUpdateOne only holds until the
    // statement ends unless a transaction is open; without an ambient meta
    // transaction, open one so validate + update + version reload are atomic.
    const ambientTx = getPostgresTransaction<V1TeableDatabase>(context, 'meta');
    if (ambientTx) {
      return this.executeUpdateOne(ambientTx, context, table, mutateSpec);
    }
    try {
      return await this.db.transaction().execute(async (trx) => {
        const result = await this.executeUpdateOne(trx, context, table, mutateSpec);
        if (result.isErr()) throw new TableUpdateRollback(result.error);
        return result;
      });
    } catch (error) {
      if (error instanceof TableUpdateRollback) return err(error.domainError);
      return err(
        domainError.infrastructure({ message: `Failed to update table: ${describeError(error)}` })
      );
    }
  }

  private async executeUpdateOne(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    context: core.IExecutionContext,
    table: core.Table,
    mutateSpec: core.ISpecification<core.Table, core.ITableSpecVisitor>
  ): Promise<Result<core.TableUpdatePersistResult | void, DomainError>> {
    const now = new Date();
    const actorId = context.actorId.toString();
    const tableId = table.id().toString();
    const baseId = table.baseId().toString();
    const whereFactory: ITableMetaWhere = (eb) =>
      eb.and([
        eb.eb('id', '=', tableId),
        eb.eb('base_id', '=', baseId),
        eb.eb('deleted_time', 'is', null),
      ]);

    try {
      const updateVisitor = new TableMetaUpdateVisitor({
        db,
        table,
        tableMapper: this.tableMapper,
        actorId,
        now,
        where: whereFactory,
      });
      const updateAccept = mutateSpec.accept(updateVisitor);
      if (updateAccept.isErr()) return err(updateAccept.error);
      const statementsResult = updateVisitor.where();
      if (statementsResult.isErr()) return err(statementsResult.error);
      if (statementsResult.value.length === 0) return ok(undefined);

      const fieldVersionTouchOrder = updateVisitor.fieldVersionTouchOrder();
      const viewVersionTouchOrder = updateVisitor.viewVersionTouchOrder();
      const viewVersionValidationResult = await this.lockAndValidateViewVersions(
        db,
        table,
        tableId,
        viewVersionTouchOrder
      );
      if (viewVersionValidationResult.isErr()) {
        return err(viewVersionValidationResult.error);
      }

      await executeCompiledQueries(
        db,
        statementsResult.value.map((statement) => statement.compile())
      );
      updateVisitor.applyCreatedViewPersistenceStamps();

      if (fieldVersionTouchOrder.length === 0 && viewVersionTouchOrder.length === 0) {
        return ok(undefined);
      }

      let fieldVersionChanges: ReadonlyArray<core.FieldVersionChange> | undefined;
      if (fieldVersionTouchOrder.length > 0) {
        const fieldVersionsResult = await this.loadFieldVersionsByIds(
          db,
          tableId,
          fieldVersionTouchOrder
        );
        if (fieldVersionsResult.isErr()) {
          return err(fieldVersionsResult.error);
        }
        fieldVersionChanges = this.buildFieldVersionChanges(
          fieldVersionTouchOrder,
          fieldVersionsResult.value
        );
      }

      let viewVersionChanges: ReadonlyArray<core.ViewVersionChange> | undefined;
      if (viewVersionTouchOrder.length > 0) {
        const viewVersionsResult = await this.loadViewVersionsByIds(
          db,
          tableId,
          viewVersionTouchOrder
        );
        if (viewVersionsResult.isErr()) {
          return err(viewVersionsResult.error);
        }
        viewVersionChanges = this.buildViewVersionChanges(
          viewVersionTouchOrder,
          viewVersionsResult.value
        );
      }

      return ok({
        ...(fieldVersionChanges ? { fieldVersionChanges } : {}),
        ...(viewVersionChanges ? { viewVersionChanges } : {}),
      });
    } catch (error) {
      return err(
        domainError.infrastructure({ message: `Failed to update table: ${describeError(error)}` })
      );
    }
  }

  private async lockAndValidateViewVersions(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    table: core.Table,
    tableId: string,
    viewIds: ReadonlyArray<string>
  ): Promise<Result<void, DomainError>> {
    const expectedVersions = new Map<string, number>();
    for (const viewId of [...new Set(viewIds)].sort()) {
      const viewResult = table.getViewById(viewId);
      if (viewResult.isErr()) {
        // A deleted child is absent from the mutated aggregate, so it cannot
        // participate in validation through a rehydrated ViewVersion.
        continue;
      }
      const versionResult = viewResult.value.version();
      // A newly added child has no persisted version yet.
      if (versionResult.isOk()) {
        expectedVersions.set(viewId, versionResult.value.toNumber());
      }
    }

    const versionedViewIds = [...expectedVersions.keys()];
    if (versionedViewIds.length === 0) {
      return ok(undefined);
    }

    const rows = await db
      .selectFrom('view')
      .select(['id', 'version'])
      .where('table_id', '=', tableId)
      .where('deleted_time', 'is', null)
      .where('id', 'in', versionedViewIds)
      .orderBy('id')
      .forUpdate()
      .execute();
    const actualVersions = new Map(rows.map((row) => [row.id, Number(row.version ?? 0)]));

    for (const viewId of versionedViewIds) {
      const expectedVersion = expectedVersions.get(viewId);
      const actualVersion = actualVersions.get(viewId);
      if (actualVersion === undefined) {
        return err(
          domainError.notFound({
            code: 'view.not_found',
            message: `View not found: ${viewId}`,
            details: { tableId, viewId },
          })
        );
      }
      if (actualVersion !== expectedVersion) {
        return err(
          domainError.conflict({
            code: 'view.version_conflict',
            message: `View version conflict: ${viewId}`,
            details: {
              tableId,
              viewId,
              expectedVersion,
              actualVersion,
            },
          })
        );
      }
    }

    return ok(undefined);
  }

  private async loadFieldVersionsByIds(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    tableId: string,
    fieldIds: ReadonlyArray<string>
  ): Promise<Result<ReadonlyMap<string, number>, DomainError>> {
    const uniqueFieldIds = [...new Set(fieldIds)];
    if (uniqueFieldIds.length === 0) {
      return ok(new Map());
    }

    try {
      const rows = await db
        .selectFrom('field')
        .select(['id', 'version'])
        .where('table_id', '=', tableId)
        .where('id', 'in', uniqueFieldIds)
        .execute();

      const versions = new Map(rows.map((row) => [row.id, Number(row.version ?? 0)]));
      for (const fieldId of uniqueFieldIds) {
        if (!versions.has(fieldId)) {
          return err(domainError.notFound({ message: `Field not found: ${fieldId}` }));
        }
      }
      return ok(versions);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load field versions: ${describeError(error)}`,
        })
      );
    }
  }

  private async loadViewVersionsByIds(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    tableId: string,
    viewIds: ReadonlyArray<string>
  ): Promise<Result<ReadonlyMap<string, number>, DomainError>> {
    const uniqueViewIds = [...new Set(viewIds)];
    if (uniqueViewIds.length === 0) {
      return ok(new Map());
    }

    try {
      const rows = await db
        .selectFrom('view')
        .select(['id', 'version'])
        .where('table_id', '=', tableId)
        .where('deleted_time', 'is', null)
        .where('id', 'in', uniqueViewIds)
        .execute();

      const versions = new Map(rows.map((row) => [row.id, Number(row.version ?? 0)]));
      for (const viewId of uniqueViewIds) {
        if (!versions.has(viewId)) {
          return err(domainError.notFound({ message: `View not found: ${viewId}` }));
        }
      }
      return ok(versions);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load view versions: ${describeError(error)}`,
        })
      );
    }
  }

  private buildFieldVersionChanges(
    fieldVersionTouchOrder: ReadonlyArray<string>,
    finalVersionByFieldId: ReadonlyMap<string, number>
  ): ReadonlyArray<core.FieldVersionChange> {
    const countByFieldId = new Map<string, number>();
    for (const fieldId of fieldVersionTouchOrder) {
      countByFieldId.set(fieldId, (countByFieldId.get(fieldId) ?? 0) + 1);
    }

    const indexByFieldId = new Map<string, number>();
    return fieldVersionTouchOrder.map((fieldId) => {
      const totalCount = countByFieldId.get(fieldId) ?? 0;
      const finalVersion = finalVersionByFieldId.get(fieldId) ?? 0;
      const currentIndex = indexByFieldId.get(fieldId) ?? 0;
      indexByFieldId.set(fieldId, currentIndex + 1);

      const oldVersion = Math.max(finalVersion - totalCount + currentIndex, 0);
      return {
        fieldId,
        oldVersion,
        newVersion: oldVersion + 1,
      };
    });
  }

  private buildViewVersionChanges(
    viewVersionTouchOrder: ReadonlyArray<string>,
    finalVersionByViewId: ReadonlyMap<string, number>
  ): ReadonlyArray<core.ViewVersionChange> {
    const countByViewId = new Map<string, number>();
    for (const viewId of viewVersionTouchOrder) {
      countByViewId.set(viewId, (countByViewId.get(viewId) ?? 0) + 1);
    }

    const indexByViewId = new Map<string, number>();
    return viewVersionTouchOrder.map((viewId) => {
      const totalCount = countByViewId.get(viewId) ?? 0;
      const finalVersion = finalVersionByViewId.get(viewId) ?? 0;
      const currentIndex = indexByViewId.get(viewId) ?? 0;
      indexByViewId.set(viewId, currentIndex + 1);

      const oldVersion = Math.max(finalVersion - totalCount + currentIndex, 0);
      return {
        viewId,
        oldVersion,
        newVersion: oldVersion + 1,
      };
    });
  }

  @core.TraceSpan()
  async delete(
    context: core.IExecutionContext,
    table: core.Table,
    options?: core.TableDeleteOptions
  ): Promise<Result<void, DomainError>> {
    const now = new Date();
    const actorId = context.actorId.toString();
    const tableId = table.id().toString();
    const mode = options?.mode ?? 'soft';

    try {
      const db = resolvePostgresDbOrTx(this.db, context, 'meta');
      if (mode === 'permanent') {
        const statements: CompiledQuery[] = [
          sql`
            DELETE FROM "reference"
            WHERE "from_field_id" IN (SELECT "id" FROM "field" WHERE "table_id" = ${tableId})
               OR "to_field_id" IN (SELECT "id" FROM "field" WHERE "table_id" = ${tableId})
          `.compile(db),
        ];

        if (await relationExists(db, 'public.record_trash')) {
          statements.push(
            sql`DELETE FROM "record_trash" WHERE "table_id" = ${tableId}`.compile(db)
          );
        }
        if (await relationExists(db, 'public.table_trash')) {
          statements.push(sql`DELETE FROM "table_trash" WHERE "table_id" = ${tableId}`.compile(db));
        }
        if (await relationExists(db, 'public.trash')) {
          statements.push(
            sql`
              DELETE FROM "trash"
              WHERE "resource_id" = ${tableId} AND "resource_type" = 'table'
            `.compile(db)
          );
        }

        statements.push(
          sql`DELETE FROM "view" WHERE "table_id" = ${tableId}`.compile(db),
          sql`DELETE FROM "field" WHERE "table_id" = ${tableId}`.compile(db),
          sql`DELETE FROM "table_meta" WHERE "id" = ${tableId}`.compile(db)
        );

        await executeCompiledQueries(db, statements);
        return ok(undefined);
      }

      const tableUpdate = await db
        .updateTable('table_meta')
        .set({
          deleted_time: now,
          last_modified_time: now,
          last_modified_by: actorId,
        })
        .where('id', '=', tableId)
        .where('deleted_time', 'is', null)
        .executeTakeFirst();

      const updatedRows = Number(tableUpdate.numUpdatedRows ?? 0);
      if (updatedRows === 0) return err(domainError.notFound({ message: 'Not found' }));

      await db
        .updateTable('field')
        .set({
          deleted_time: now,
          last_modified_time: now,
          last_modified_by: actorId,
        })
        .where('table_id', '=', tableId)
        .where('deleted_time', 'is', null)
        .execute();

      await db
        .updateTable('view')
        .set({
          deleted_time: now,
          last_modified_time: now,
          last_modified_by: actorId,
        })
        .where('table_id', '=', tableId)
        .where('deleted_time', 'is', null)
        .execute();

      // Commit the recycle-bin row with deleted_time. TableTrashed is
      // fire-and-forget, so callers that list trash immediately after DELETE
      // 200 (e2e-lab T4324) otherwise race the projection.
      if (await relationExists(db, 'public.trash')) {
        const trashId = crypto.randomUUID();
        const baseId = table.baseId().toString();
        await sql`
          DELETE FROM "trash"
          WHERE "resource_id" = ${tableId} AND "resource_type" = 'table'
        `.execute(db);
        await sql`
          INSERT INTO "trash" (
            "id",
            "resource_type",
            "resource_id",
            "parent_id",
            "deleted_time",
            "deleted_by"
          )
          VALUES (
            ${trashId},
            'table',
            ${tableId},
            ${baseId},
            ${now},
            ${actorId}
          )
        `.execute(db);
      }

      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({ message: `Failed to delete table: ${describeError(error)}` })
      );
    }
  }

  @core.TraceSpan()
  async restore(
    context: core.IExecutionContext,
    table: core.Table
  ): Promise<Result<void, DomainError>> {
    const now = new Date();
    const actorId = context.actorId.toString();
    const tableId = table.id().toString();

    try {
      const db = resolvePostgresDbOrTx(this.db, context, 'meta');
      // Match the V1 trash contract: a table and the children deleted with it share one timestamp,
      // which acts as the restore batch marker.
      const restoreResult = await sql<{ updatedRows: number }>`
        WITH deleted_table AS MATERIALIZED (
          SELECT "deleted_time"
          FROM "table_meta"
          WHERE "id" = ${tableId} AND "deleted_time" IS NOT NULL
          FOR UPDATE
        ), restored_table AS (
          UPDATE "table_meta"
          SET
            "deleted_time" = NULL,
            "last_modified_time" = ${now},
            "last_modified_by" = ${actorId},
            "provision_state" = ${'ready'}
          WHERE "id" = ${tableId}
            AND "deleted_time" = (SELECT "deleted_time" FROM deleted_table)
          RETURNING "id"
        ), restored_fields AS (
          UPDATE "field"
          SET
            "deleted_time" = NULL,
            "last_modified_time" = ${now},
            "last_modified_by" = ${actorId}
          WHERE "table_id" = ${tableId}
            AND "deleted_time" = (SELECT "deleted_time" FROM deleted_table)
          RETURNING "id"
        ), restored_views AS (
          UPDATE "view"
          SET
            "deleted_time" = NULL,
            "last_modified_time" = ${now},
            "last_modified_by" = ${actorId}
          WHERE "table_id" = ${tableId}
            AND "deleted_time" = (SELECT "deleted_time" FROM deleted_table)
          RETURNING "id"
        )
        SELECT count(*)::integer AS "updatedRows" FROM restored_table
      `.execute(db);

      const updatedRows = Number(restoreResult.rows[0]?.updatedRows ?? 0);
      if (updatedRows === 0) return err(domainError.notFound({ message: 'Not found' }));

      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({ message: `Failed to restore table: ${describeError(error)}` })
      );
    }
  }

  @core.TraceSpan()
  async setProvisionState(
    context: core.IExecutionContext,
    table: core.Table,
    state: core.TableProvisionState,
    operation?: core.TableProvisionOperationOptions
  ): Promise<Result<void, DomainError>> {
    return this.setProvisionStateMany(context, [table], state, operation);
  }

  @core.TraceSpan()
  async setProvisionStateMany(
    context: core.IExecutionContext,
    tables: ReadonlyArray<core.Table>,
    state: core.TableProvisionState,
    operation?: core.TableProvisionOperationOptions
  ): Promise<Result<void, DomainError>> {
    if (!tables.length) {
      return ok(undefined);
    }

    const now = new Date();
    const actorId = context.actorId.toString();
    const tableIds = [...new Set(tables.map((table) => table.id().toString()))];

    try {
      const db = resolvePostgresDbOrTx(this.db, context, 'meta');
      await sql`
        UPDATE "table_meta"
        SET
          "provision_state" = ${state},
          "last_modified_time" = ${now},
          "last_modified_by" = ${actorId}
        WHERE "id" IN (${sql.join(tableIds.map((tableId) => sql`${tableId}`))})
      `.execute(db);

      await this.recordSchemaOperations(db, context, tables, state, operation);

      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to set table provision state: ${describeError(error)}`,
        })
      );
    }
  }

  private async recordSchemaOperations(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    context: core.IExecutionContext,
    tables: ReadonlyArray<core.Table>,
    state: core.TableProvisionState,
    operation?: core.TableProvisionOperationOptions
  ): Promise<void> {
    const now = new Date();
    const actorId = context.actorId.toString();
    const operationType = operation?.operationType ?? 'table.provision';
    const status = operation?.status ?? tableProvisionStateToOperationStatus(state);
    const phase = operation?.phase ?? state;
    const maxAttempts = operation?.maxAttempts ?? 8;
    const nextRunAt = operation?.nextRunAt ?? now;
    const result = operation?.result;
    const payload = operation?.payload;
    const lastError = operation?.lastError ?? null;

    for (const table of tables) {
      const tableId = table.id().toString();
      const baseId = table.baseId().toString();
      const operationId = operation?.operationId ?? context.requestId ?? operationType;
      const idempotencyKey =
        tables.length === 1 && operation?.idempotencyKey
          ? operation.idempotencyKey
          : `${operationId}:table:${tableId}`;
      const attempts = status === 'error' ? 1 : 0;

      await sql`
        INSERT INTO "schema_operation" (
          "id",
          "type",
          "status",
          "phase",
          "resource_type",
          "resource_id",
          "base_id",
          "table_id",
          "idempotency_key",
          "payload",
          "result",
          "attempts",
          "max_attempts",
          "next_run_at",
          "last_error",
          "created_time",
          "created_by",
          "last_modified_time",
          "last_modified_by"
        )
        VALUES (
          ${core.generatePrefixedId('sgo', 16)},
          ${operationType},
          ${status},
          ${phase},
          ${'table'},
          ${tableId},
          ${baseId},
          ${tableId},
          ${idempotencyKey},
          ${jsonbValue(payload)},
          ${jsonbValue(result)},
          ${attempts},
          ${maxAttempts},
          ${nextRunAt},
          ${lastError},
          ${now},
          ${actorId},
          ${now},
          ${actorId}
        )
        ON CONFLICT ("idempotency_key")
        DO UPDATE SET
          "type" = EXCLUDED."type",
          "status" = EXCLUDED."status",
          "phase" = EXCLUDED."phase",
          "resource_type" = EXCLUDED."resource_type",
          "resource_id" = EXCLUDED."resource_id",
          "base_id" = EXCLUDED."base_id",
          "table_id" = EXCLUDED."table_id",
          "payload" = COALESCE(EXCLUDED."payload", "schema_operation"."payload"),
          "result" = COALESCE(EXCLUDED."result", "schema_operation"."result"),
          "attempts" = CASE
            WHEN EXCLUDED."status" = 'error' THEN "schema_operation"."attempts" + 1
            ELSE "schema_operation"."attempts"
          END,
          "max_attempts" = EXCLUDED."max_attempts",
          "next_run_at" = EXCLUDED."next_run_at",
          "last_error" = EXCLUDED."last_error",
          "last_modified_time" = EXCLUDED."last_modified_time",
          "last_modified_by" = EXCLUDED."last_modified_by"
      `.execute(db);
    }
  }

  private mapTableRow(row: {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    base_id: string;
    db_table_name: string | null;
    fields: unknown;
    views: unknown;
    has_outbound_reference?: boolean | null;
  }): Result<core.Table, DomainError> {
    const fieldRows = Array.isArray(row.fields)
      ? (row.fields as Array<{
          id: string;
          name: string;
          description: string | null;
          type: string;
          options: string | null;
          meta: string | null;
          ai_config: string | null;
          cell_value_type: string | null;
          is_multiple_cell_value: boolean | null;
          not_null: boolean | null;
          unique: boolean | null;
          is_primary: boolean | null;
          is_computed: boolean | null;
          is_lookup: boolean | null;
          is_conditional_lookup: boolean | null;
          lookup_linked_field_id: string | null;
          lookup_options: string | null;
          db_field_name: string | null;
          db_field_type: string | null;
          has_error: boolean | null;
        }>)
      : [];

    const viewRows = Array.isArray(row.views)
      ? (row.views as Array<{
          id: string;
          name: string;
          description: string | null;
          type: string;
          options: string | null;
          order: number;
          version: number;
          column_meta: string | null;
          sort: string | null;
          filter: string | null;
          group: string | null;
          is_locked: boolean | null;
          enable_share: boolean | null;
          share_id: string | null;
          share_meta: string | null;
          created_time: Date | string;
          last_modified_time: Date | string | null;
          created_by: string;
          last_modified_by: string | null;
        }>)
      : [];

    const primaryFieldId =
      fieldRows.find((f) => f.is_primary === true)?.id ?? fieldRows[0]?.id ?? '';

    const viewsResult = this.sequenceResults(viewRows.map((v) => this.deserializeViewDto(v)));
    if (viewsResult.isErr()) return err(viewsResult.error);

    const dto: core.ITablePersistenceDTO = {
      id: row.id,
      baseId: row.base_id,
      name: row.name,
      ...(row.description !== null ? { description: row.description } : {}),
      ...(row.icon !== null ? { icon: row.icon } : {}),
      dbTableName: row.db_table_name ?? undefined,
      primaryFieldId,
      fields: fieldRows.map((f) => this.deserializeFieldDto(f)),
      views: [...viewsResult.value],
    };

    const domainResult = this.tableMapper.toDomain(dto);
    if (domainResult.isErr()) return err(domainResult.error);
    const table = domainResult.value;
    setTableComputedDownstreamHint(table, row.has_outbound_reference === true);
    return ok(table);
  }

  private resolveSortColumn(key: core.TableSortKey): 'name' | 'id' | 'created_time' {
    const value = key.toString();
    if (value === 'name') return 'name';
    if (value === 'createdTime') return 'created_time';
    return 'id';
  }

  private deserializeFieldDto(row: {
    id: string;
    name: string;
    description: string | null;
    type: string;
    options: string | null;
    meta: string | null;
    ai_config: string | null;
    cell_value_type: string | null;
    is_multiple_cell_value: boolean | null;
    not_null: boolean | null;
    unique: boolean | null;
    is_computed: boolean | null;
    is_lookup: boolean | null;
    is_conditional_lookup: boolean | null;
    has_error: boolean | null;
    lookup_linked_field_id: string | null;
    lookup_options: string | null;
    db_field_name: string | null;
    db_field_type: string | null;
  }): core.ITableFieldPersistenceDTO {
    const parsed = this.parseOptions(row.options);
    const hasOptions = Object.keys(parsed).length > 0;
    const asOptions = <T>(): T | undefined => (hasOptions ? (parsed as T) : undefined);
    const lookupParsed = this.parseOptions(row.lookup_options);
    const hasLookupOptions = Object.keys(lookupParsed).length > 0;
    const asLookupOptions = <T>(): T | undefined =>
      hasLookupOptions ? (lookupParsed as T) : undefined;
    const resolveLookupOptions = (): core.ILookupOptionsDTO | undefined => {
      if (!row.is_lookup || row.is_conditional_lookup) return undefined;

      // v2 stores lookup options in `lookup_options`, while legacy rows can still keep
      // link/lookup/filter data in `options`. Prefer `lookup_options`, then fallback.
      const source = hasLookupOptions ? lookupParsed : parsed;
      const candidate: core.ILookupOptionsDTO = {
        linkFieldId:
          typeof source.linkFieldId === 'string'
            ? source.linkFieldId
            : row.lookup_linked_field_id || '',
        lookupFieldId: typeof source.lookupFieldId === 'string' ? source.lookupFieldId : '',
        foreignTableId: typeof source.foreignTableId === 'string' ? source.foreignTableId : '',
        ...(source.filter !== undefined
          ? { filter: source.filter as core.ILookupOptionsDTO['filter'] }
          : {}),
        ...(source.sort !== undefined
          ? { sort: source.sort as core.ILookupOptionsDTO['sort'] }
          : {}),
        ...(typeof source.limit === 'number' ? { limit: source.limit } : {}),
      };

      if (core.FieldId.create(candidate.linkFieldId).isErr()) return undefined;
      if (core.FieldId.create(candidate.lookupFieldId).isErr()) return undefined;
      if (core.TableId.create(candidate.foreignTableId).isErr()) return undefined;

      const fallbackFilter = parsed.filter as core.ILookupOptionsDTO['filter'] | undefined;
      const fallbackSort = parsed.sort as core.ILookupOptionsDTO['sort'] | undefined;
      const fallbackLimit = typeof parsed.limit === 'number' ? (parsed.limit as number) : undefined;

      return {
        ...candidate,
        ...(candidate.filter === undefined && fallbackFilter !== undefined
          ? { filter: fallbackFilter }
          : {}),
        ...(candidate.sort === undefined && fallbackSort !== undefined
          ? { sort: fallbackSort }
          : {}),
        ...(candidate.limit === undefined && fallbackLimit !== undefined
          ? { limit: fallbackLimit }
          : {}),
      };
    };
    const buildConditionalLookupOptions = (
      value: Record<string, unknown>
    ): core.IConditionalLookupOptionsDTO | undefined => {
      const foreignTableId =
        typeof value.foreignTableId === 'string' ? value.foreignTableId : undefined;
      const lookupFieldId =
        typeof value.lookupFieldId === 'string' ? value.lookupFieldId : undefined;
      if (!foreignTableId || !lookupFieldId) return undefined;
      const condition =
        value.condition && typeof value.condition === 'object'
          ? (value.condition as core.IConditionalLookupOptionsDTO['condition'])
          : {
              filter: value.filter as core.IConditionalLookupOptionsDTO['condition']['filter'],
              sort: value.sort as { fieldId: string; order: 'asc' | 'desc' } | undefined,
              limit: typeof value.limit === 'number' ? value.limit : undefined,
            };
      return {
        foreignTableId,
        lookupFieldId,
        condition,
      };
    };
    const lookupOptions = resolveLookupOptions();
    const dbFieldName = row.db_field_name ?? undefined;
    const dbFieldType = row.db_field_type ?? undefined;
    const aiConfig = this.parseJsonValue(row.ai_config);
    const baseCommon = {
      id: row.id,
      name: row.name,
      ...(row.description !== null ? { description: row.description } : { description: null }),
      ...(row.ai_config !== null ? { aiConfig } : {}),
      dbFieldName,
      dbFieldType,
      ...(row.not_null ? { notNull: true } : {}),
      ...(row.unique ? { unique: true } : {}),
      ...(row.is_computed ? { isComputed: true } : {}),
      ...(row.has_error ? { hasError: true } : {}),
      ...(row.is_multiple_cell_value !== null
        ? { isMultipleCellValue: row.is_multiple_cell_value }
        : {}),
    };
    const base = {
      ...baseCommon,
      // Trust the is_lookup flag from the database directly, regardless of whether lookupOptions can be parsed
      ...(row.is_lookup ? { isLookup: true } : {}),
      ...(row.is_conditional_lookup && lookupOptions ? { isConditionalLookup: true } : {}),
      ...(lookupOptions ? { lookupOptions } : {}),
    };
    const metaParsed = this.parseOptions(row.meta);
    const hasMeta = Object.keys(metaParsed).length > 0;
    const asMeta = <T>(): T | undefined => (hasMeta ? (metaParsed as T) : undefined);

    if (row.is_conditional_lookup) {
      const conditionalOptions = hasLookupOptions
        ? buildConditionalLookupOptions(lookupParsed)
        : undefined;
      if (conditionalOptions) {
        return {
          ...baseCommon,
          type: 'conditionalLookup',
          options: conditionalOptions,
          innerType: row.type,
          innerOptions: asOptions<unknown>(),
          isLookup: true,
          isConditionalLookup: true,
          ...(row.cell_value_type !== null ? { cellValueType: row.cell_value_type } : {}),
          ...(row.is_multiple_cell_value !== null
            ? { isMultipleCellValue: row.is_multiple_cell_value }
            : {}),
        };
      }
    }

    if (row.type === 'rating') {
      const options = {
        icon: typeof parsed.icon === 'string' ? parsed.icon : 'star',
        color: typeof parsed.color === 'string' ? parsed.color : 'yellowBright',
        max: typeof parsed.max === 'number' ? parsed.max : 5,
      };
      return { ...base, type: 'rating', options };
    }

    if (row.type === 'singleSelect' || row.type === 'select') {
      return {
        ...base,
        type: 'singleSelect',
        options: this.normalizeSelectOptions(parsed),
      };
    }

    if (row.type === 'multipleSelect') {
      return {
        ...base,
        type: 'multipleSelect',
        options: this.normalizeSelectOptions(parsed),
      };
    }

    if (row.type === 'number') {
      return {
        ...base,
        type: 'number',
        options: asOptions<core.INumberFieldOptionsDTO>(),
      };
    }
    if (row.type === 'formula') {
      return {
        ...base,
        type: 'formula',
        options: asOptions<core.IFormulaFieldOptionsDTO>() ?? { expression: '' },
        meta: asMeta<core.IFormulaFieldMetaDTO>(),
        cellValueType: row.cell_value_type ?? undefined,
        isMultipleCellValue: row.is_multiple_cell_value ?? undefined,
      };
    }
    if (row.type === 'rollup') {
      return {
        ...base,
        type: 'rollup',
        options: asOptions<core.IRollupFieldOptionsDTO>() ?? {
          expression: 'countall({values})',
        },
        config: asLookupOptions<core.IRollupFieldConfigDTO>(),
        cellValueType: row.cell_value_type ?? undefined,
        isMultipleCellValue: row.is_multiple_cell_value ?? undefined,
      };
    }
    if (row.type === 'longText') {
      return {
        ...base,
        type: 'longText',
        options: asOptions<core.ILongTextFieldOptionsDTO>(),
      };
    }
    if (row.type === 'checkbox') {
      return {
        ...base,
        type: 'checkbox',
        options: asOptions<core.ICheckboxFieldOptionsDTO>(),
      };
    }
    if (row.type === 'attachment') {
      const options = hasOptions ? {} : undefined;
      return { ...base, type: 'attachment', options };
    }
    if (row.type === 'date') {
      return {
        ...base,
        type: 'date',
        options: asOptions<core.IDateFieldOptionsDTO>(),
      };
    }
    if (row.type === 'createdTime') {
      const meta = asMeta<core.IGeneratedColumnMetaDTO>();
      return {
        ...base,
        type: 'createdTime',
        options: asOptions<core.ICreatedTimeFieldOptionsDTO>(),
        ...(meta ? { meta } : {}),
      };
    }
    if (row.type === 'lastModifiedTime') {
      const meta = asMeta<core.IGeneratedColumnMetaDTO>();
      return {
        ...base,
        type: 'lastModifiedTime',
        options: asOptions<core.ILastModifiedTimeFieldOptionsDTO>(),
        ...(meta ? { meta } : {}),
      };
    }
    if (row.type === 'user') {
      return {
        ...base,
        type: 'user',
        options: asOptions<core.IUserFieldOptionsDTO>(),
      };
    }
    if (row.type === 'createdBy') {
      const meta = asMeta<core.IGeneratedColumnMetaDTO>();
      return {
        ...base,
        type: 'createdBy',
        options: asOptions<core.ICreatedByFieldOptionsDTO>(),
        ...(meta ? { meta } : {}),
      };
    }
    if (row.type === 'lastModifiedBy') {
      const meta = asMeta<core.IGeneratedColumnMetaDTO>();
      return {
        ...base,
        type: 'lastModifiedBy',
        options: asOptions<core.ILastModifiedByFieldOptionsDTO>(),
        ...(meta ? { meta } : {}),
      };
    }
    if (row.type === 'autoNumber') {
      const meta = asMeta<core.IGeneratedColumnMetaDTO>();
      return {
        ...base,
        type: 'autoNumber',
        options: asOptions<core.IAutoNumberFieldOptionsDTO>(),
        ...(meta ? { meta } : {}),
      };
    }
    if (row.type === 'button') {
      return {
        ...base,
        type: 'button',
        options: asOptions<core.IButtonFieldOptionsDTO>(),
      };
    }
    if (row.type === 'link') {
      const options = asOptions<core.ILinkFieldOptionsDTO>() ?? ({} as core.ILinkFieldOptionsDTO);
      const meta = asMeta<core.ILinkFieldMetaDTO>();
      return {
        ...base,
        type: 'link',
        options,
        ...(meta ? { meta } : {}),
      };
    }
    // conditionalRollup: v1 format stores everything in options, need to split into options + config
    if (row.type === 'conditionalRollup') {
      const v1Options = parsed as Record<string, unknown>;
      const options: core.IConditionalRollupFieldOptionsDTO = {
        expression:
          typeof v1Options.expression === 'string' ? v1Options.expression : 'countall({values})',
      };
      if (typeof v1Options.timeZone === 'string') {
        options.timeZone = v1Options.timeZone as core.IConditionalRollupFieldOptionsDTO['timeZone'];
      }
      if (v1Options.formatting) {
        options.formatting =
          v1Options.formatting as core.IConditionalRollupFieldOptionsDTO['formatting'];
      }
      if (v1Options.showAs) {
        options.showAs = v1Options.showAs as core.IConditionalRollupFieldOptionsDTO['showAs'];
      }
      // Build config from v1 format
      const config: core.IConditionalRollupFieldConfigDTO = {
        foreignTableId:
          typeof v1Options.foreignTableId === 'string' ? v1Options.foreignTableId : '',
        lookupFieldId: typeof v1Options.lookupFieldId === 'string' ? v1Options.lookupFieldId : '',
        condition: {
          filter:
            (v1Options.filter as core.IConditionalRollupFieldConfigDTO['condition']['filter']) ??
            null,
          sort: v1Options.sort as { fieldId: string; order: 'asc' | 'desc' } | undefined,
          limit: typeof v1Options.limit === 'number' ? v1Options.limit : undefined,
        },
      };
      return {
        ...base,
        type: 'conditionalRollup',
        options,
        config,
        cellValueType: row.cell_value_type ?? undefined,
        isMultipleCellValue: row.is_multiple_cell_value ?? undefined,
      };
    }
    // conditionalLookup: v1 format stores foreignTableId, lookupFieldId, filter, sort, limit in options
    if (row.type === 'conditionalLookup') {
      const v1Options = parsed as Record<string, unknown>;
      const options = buildConditionalLookupOptions(v1Options);
      if (options) {
        return {
          ...baseCommon,
          type: 'conditionalLookup',
          options,
          ...(row.cell_value_type !== null ? { cellValueType: row.cell_value_type } : {}),
          ...(row.is_multiple_cell_value !== null
            ? { isMultipleCellValue: row.is_multiple_cell_value }
            : {}),
        };
      }
    }
    return {
      ...base,
      type: 'singleLineText',
      options: asOptions<core.ISingleLineTextFieldOptionsDTO>(),
    };
  }

  private parseOptions(raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    if (typeof raw !== 'string') return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }

  private parseJsonValue(raw: unknown): unknown {
    if (raw === null || raw === undefined) return raw;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    }
    return raw;
  }

  private parseViewFilter(raw: string | null): core.RecordFilter | null | undefined {
    if (raw === null || raw === undefined) return undefined;
    const parsed = this.parseJsonValue(raw);
    return this.mapV1FilterToV2(parsed);
  }

  private serializeViewQuery(view: core.ITableViewPersistenceDTO): {
    filter: string | null;
    sort: string | null;
    group: string | null;
  } {
    const query = view.query;
    const filter =
      view.sourceFilter !== undefined
        ? JSON.stringify(view.sourceFilter)
        : query?.filter == null
          ? null
          : JSON.stringify(query.filter);
    const sort =
      query?.sort === undefined && query?.manualSort === undefined
        ? null
        : JSON.stringify({
            ...(query?.sort ? { sortObjs: query.sort } : { sortObjs: [] }),
            ...(query?.manualSort !== undefined ? { manualSort: query.manualSort } : {}),
          });
    const group = query?.group === undefined ? null : JSON.stringify(query.group);

    return { filter, sort, group };
  }

  private parseViewSort(raw: string | null): {
    sort?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
    manualSort?: boolean;
  } {
    if (!raw) return {};
    const parsed = this.parseJsonValue(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const sortObjs = Array.isArray(record.sortObjs) ? record.sortObjs : [];
    const sort = sortObjs
      .map((item) => item as Record<string, unknown>)
      .filter(
        (item): item is { fieldId: string; order: 'asc' | 'desc' } =>
          typeof item.fieldId === 'string' && (item.order === 'asc' || item.order === 'desc')
      )
      .map((item) => ({ fieldId: item.fieldId, order: item.order }));
    const manualSort = typeof record.manualSort === 'boolean' ? record.manualSort : undefined;
    return {
      sort: Array.isArray(record.sortObjs) ? sort : undefined,
      manualSort,
    };
  }

  private parseViewGroup(
    raw: string | null
  ): Array<{ fieldId: string; order: 'asc' | 'desc' }> | undefined {
    if (!raw) return undefined;
    const parsed = this.parseJsonValue(raw);
    if (!Array.isArray(parsed)) return undefined;
    const group = parsed
      .map((item) => item as Record<string, unknown>)
      .filter(
        (item): item is { fieldId: string; order: 'asc' | 'desc' } =>
          typeof item.fieldId === 'string' && (item.order === 'asc' || item.order === 'desc')
      )
      .map((item) => ({ fieldId: item.fieldId, order: item.order }));
    return group;
  }

  private mapV1FilterToV2(filter: unknown): core.RecordFilter | null | undefined {
    if (filter === undefined) return undefined;
    if (filter === null) return null;
    if (this.isV2FilterNode(filter)) return this.normalizeV2FilterNode(filter);
    if (this.isV1FilterGroup(filter)) return this.mapV1FilterGroup(filter);
    if (this.isV1FilterItem(filter)) return this.mapV1FilterItem(filter);
    return undefined;
  }

  private isV2FilterNode(value: unknown): value is core.RecordFilterNode {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) return true;
    if (record.not && typeof record.not === 'object') return true;
    if (typeof record.fieldId === 'string' && typeof record.operator === 'string') return true;
    return false;
  }

  private isV1FilterGroup(
    value: unknown
  ): value is { conjunction: 'and' | 'or'; filterSet: unknown[] } {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return Array.isArray(record.filterSet);
  }

  private isV1FilterItem(
    value: unknown
  ): value is { fieldId: string; operator: string; value?: unknown; isSymbol?: boolean } {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.fieldId === 'string' && typeof record.operator === 'string';
  }

  private mapV1FilterGroup(filter: {
    conjunction: 'and' | 'or';
    filterSet: unknown[];
  }): core.RecordFilterGroup {
    const items = filter.filterSet
      .map((entry) => this.mapV1FilterEntry(entry))
      .filter((entry): entry is core.RecordFilterNode => Boolean(entry));
    return {
      conjunction: filter.conjunction === 'or' ? 'or' : 'and',
      items,
    };
  }

  private mapV1FilterEntry(entry: unknown): core.RecordFilterNode | null {
    if (entry === null || entry === undefined) return null;
    if (this.isV1FilterGroup(entry)) return this.mapV1FilterGroup(entry);
    if (this.isV1FilterItem(entry)) return this.mapV1FilterItem(entry);
    if (this.isV2FilterNode(entry)) return this.normalizeV2FilterNode(entry);
    return null;
  }

  private mapV1FilterItem(filter: {
    fieldId: string;
    operator: string;
    value?: unknown;
    isSymbol?: boolean;
  }): core.RecordFilterNode | null {
    const operator = this.normalizeV1Operator(
      filter.operator,
      filter.isSymbol
    ) as core.RecordFilterOperator;
    const rawValue = 'value' in filter ? filter.value : null;
    const legacyDateRangeCondition = this.mapLegacyDateRangeCondition(
      filter.fieldId,
      operator,
      rawValue
    );
    if (legacyDateRangeCondition) return legacyDateRangeCondition;

    const operatorsExpectingNull: ReadonlySet<core.RecordFilterOperator> = new Set([
      'isEmpty',
      'isNotEmpty',
    ]);
    const operatorsExpectingArray: ReadonlySet<core.RecordFilterOperator> = new Set([
      'isAnyOf',
      'isNoneOf',
      'hasAnyOf',
      'hasAllOf',
      'isNotExactly',
      'hasNoneOf',
      'isExactly',
    ]);

    if (operatorsExpectingNull.has(operator)) {
      return {
        fieldId: filter.fieldId,
        operator,
        value: null,
      };
    }

    if (operatorsExpectingArray.has(operator)) {
      let value = rawValue;
      if (value == null) return null;
      if (!Array.isArray(value) && !core.isRecordFilterFieldReferenceValue(value)) {
        value = [value];
      }
      if (Array.isArray(value) && value.length === 0) return null;

      return {
        fieldId: filter.fieldId,
        operator,
        value: value as core.RecordFilterValue,
      };
    }

    if (rawValue == null) {
      // Preserve is/isNot with null — domain layer handles the conversion
      if (operator === 'is' || operator === 'isNot') {
        return { fieldId: filter.fieldId, operator, value: null };
      }
      return null;
    }

    return {
      fieldId: filter.fieldId,
      operator,
      value: rawValue as core.RecordFilterValue,
    };
  }

  private mapLegacyDateRangeCondition(
    fieldId: string,
    operator: core.RecordFilterOperator,
    value: unknown
  ): core.RecordFilterNode | null {
    if (operator !== 'is' && operator !== 'isWithIn') return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    if (record.mode !== 'dateRange') return null;

    const exactDate = record.exactDate;
    const exactDateEnd = record.exactDateEnd;
    const timeZone = record.timeZone;
    if (
      typeof exactDate !== 'string' ||
      typeof exactDateEnd !== 'string' ||
      typeof timeZone !== 'string'
    ) {
      return null;
    }

    return {
      conjunction: 'and',
      items: [
        {
          fieldId,
          operator: 'isOnOrAfter',
          value: {
            mode: 'exactDate',
            exactDate,
            timeZone,
          } as core.RecordFilterDateValue,
        },
        {
          fieldId,
          operator: 'isOnOrBefore',
          value: {
            mode: 'exactDate',
            exactDate: exactDateEnd,
            timeZone,
          } as core.RecordFilterDateValue,
        },
      ],
    };
  }

  private normalizeV1Operator(operator: string, isSymbol?: boolean): string {
    const mapped = v1SymbolOperatorMap[operator];
    if (mapped) return mapped;
    if (isSymbol) return operator;
    return operator;
  }

  private normalizeV2FilterNode(filter: core.RecordFilterNode): core.RecordFilterNode | null {
    if ('not' in filter) {
      const next = this.normalizeV2FilterNode(filter.not);
      if (!next) return null;
      return { not: next };
    }

    if ('items' in filter) {
      const items = filter.items
        .map((item) => this.normalizeV2FilterNode(item))
        .filter((item): item is core.RecordFilterNode => Boolean(item));
      if (!items.length) return null;
      return { conjunction: filter.conjunction, items };
    }

    const operator = filter.operator as core.RecordFilterOperator;
    const value = filter.value as core.RecordFilterValue;
    const legacyDateRangeCondition = this.mapLegacyDateRangeCondition(
      filter.fieldId,
      operator,
      value
    );
    if (legacyDateRangeCondition) return legacyDateRangeCondition;
    const operatorsExpectingNull: ReadonlySet<core.RecordFilterOperator> = new Set([
      'isEmpty',
      'isNotEmpty',
    ]);
    const operatorsExpectingArray: ReadonlySet<core.RecordFilterOperator> = new Set([
      'isAnyOf',
      'isNoneOf',
      'hasAnyOf',
      'hasAllOf',
      'isNotExactly',
      'hasNoneOf',
      'isExactly',
    ]);

    if (operatorsExpectingNull.has(operator)) {
      if (value !== null) return null;
      return filter;
    }

    if (operatorsExpectingArray.has(operator)) {
      if (value == null) return null;
      if (Array.isArray(value) && value.length === 0) return null;
      return filter;
    }

    if (value == null) {
      if (operator === 'is' || operator === 'isNot') {
        return { fieldId: filter.fieldId, operator, value: null };
      }
      return null;
    }
    return filter;
  }

  private normalizeSelectOptions(raw: Record<string, unknown>): {
    choices: ReadonlyArray<SelectChoiceDto>;
    defaultValue?: string | ReadonlyArray<string>;
    preventAutoNewOptions?: boolean;
  } {
    const normalizeColor = (color: unknown, index: number): string => {
      if (typeof color === 'string' && core.fieldColorValues.includes(color as never)) {
        return color;
      }
      return core.fieldColorValues[index % core.fieldColorValues.length];
    };
    const normalizeDefaultValue = (value: unknown): string | ReadonlyArray<string> | undefined => {
      if (typeof value === 'string') {
        const trimmedValue = value.trim();
        return trimmedValue ? trimmedValue : undefined;
      }
      if (Array.isArray(value)) {
        const values = value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        return values.length > 0 ? values : undefined;
      }
      return undefined;
    };

    if (Array.isArray(raw.options)) {
      const choices = raw.options.map((name, index) => ({
        id: `cho${core.getRandomString(8)}`,
        name: String(name),
        color: normalizeColor(undefined, index),
      }));
      return { choices: deduplicateSelectChoices(choices) };
    }

    const choices = Array.isArray(raw.choices)
      ? raw.choices.map((choice, index) => {
          const item =
            choice && typeof choice === 'object' ? (choice as Record<string, unknown>) : {};
          return {
            id:
              typeof item.id === 'string' && item.id.length > 0
                ? item.id
                : `cho${core.getRandomString(8)}`,
            name: typeof item.name === 'string' ? item.name : String(item.name ?? ''),
            color: normalizeColor(item.color, index),
          };
        })
      : [];
    const defaultValue = normalizeDefaultValue(raw.defaultValue);
    const preventAutoNewOptions =
      typeof raw.preventAutoNewOptions === 'boolean' ? raw.preventAutoNewOptions : undefined;

    return {
      choices: deduplicateSelectChoices(choices),
      ...(defaultValue !== undefined ? { defaultValue: defaultValue as string | string[] } : {}),
      ...(preventAutoNewOptions !== undefined ? { preventAutoNewOptions } : {}),
    };
  }

  private deserializeViewDto(row: {
    id: string;
    name: string;
    description: string | null;
    type: string;
    options: string | null;
    order: number;
    version: number;
    column_meta: string | null;
    sort: string | null;
    filter: string | null;
    group: string | null;
    is_locked: boolean | null;
    enable_share: boolean | null;
    share_id: string | null;
    share_meta: string | null;
    created_time: Date | string;
    last_modified_time: Date | string | null;
    created_by: string;
    last_modified_by: string | null;
  }): Result<core.ITableViewPersistenceDTO, DomainError> {
    const columnMeta = this.parseOptions(
      row.column_meta
    ) as core.ITableViewPersistenceDTO['columnMeta'];

    const filter = this.parseViewFilter(row.filter);
    // Only a legacy-shaped filter (filterSet) needs source preservation; a v2
    // canonical filter round-trips through query.filter and must not be fed to
    // the legacy source-filter schema.
    const rawFilter = row.filter == null ? undefined : this.parseJsonValue(row.filter);
    const sourceFilter =
      rawFilter != null && typeof rawFilter === 'object' && 'filterSet' in rawFilter
        ? rawFilter
        : undefined;
    const sortResult = this.parseViewSort(row.sort);
    const group = this.parseViewGroup(row.group);
    const query: core.ViewQueryDefaultsDTO = {
      ...(filter !== undefined ? { filter } : {}),
      ...(sortResult.sort ? { sort: sortResult.sort } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(sortResult.manualSort !== undefined ? { manualSort: sortResult.manualSort } : {}),
    };
    const options = row.options === null ? undefined : this.parseJsonValue(row.options);
    const shareMeta = row.share_meta === null ? undefined : this.parseJsonValue(row.share_meta);
    const base = {
      id: row.id,
      name: row.name,
      version: Number(row.version),
      order: Number(row.order),
      ...(row.description !== null ? { description: row.description } : {}),
      ...(row.is_locked !== null ? { isLocked: row.is_locked } : {}),
      ...(row.enable_share !== null ? { enableShare: row.enable_share } : {}),
      ...(row.share_id !== null ? { shareId: row.share_id } : {}),
      ...(shareMeta !== undefined
        ? { shareMeta: shareMeta as core.ITableViewPersistenceDTO['shareMeta'] }
        : {}),
      ...(row.created_by != null ? { createdBy: row.created_by } : {}),
      ...(row.created_time != null ? { createdTime: toIsoTimestamp(row.created_time) } : {}),
      ...(row.last_modified_by != null ? { lastModifiedBy: row.last_modified_by } : {}),
      ...(row.last_modified_time != null
        ? { lastModifiedTime: toIsoTimestamp(row.last_modified_time) }
        : {}),
      columnMeta,
      query,
      ...(sourceFilter !== undefined ? { sourceFilter } : {}),
      options,
    };

    if (row.type === 'grid') return ok({ ...base, type: 'grid' });
    if (row.type === 'kanban') return ok({ ...base, type: 'kanban' });
    if (row.type === 'gallery') return ok({ ...base, type: 'gallery' });
    if (row.type === 'calendar') return ok({ ...base, type: 'calendar' });
    if (row.type === 'form') return ok({ ...base, type: 'form' });
    if (row.type === 'plugin') return ok({ ...base, type: 'plugin' });
    return err(domainError.validation({ message: 'Unsupported view type' }));
  }

  private sequenceResults<T>(
    values: ReadonlyArray<Result<T, DomainError>>
  ): Result<ReadonlyArray<T>, DomainError> {
    return values.reduce<Result<ReadonlyArray<T>, DomainError>>(
      (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
      ok([])
    );
  }

  private applyDbMeta(table: core.Table, tableDbMeta: ITableDbMeta): Result<void, DomainError> {
    const dbTableNameResult = core.DbTableName.rehydrate(tableDbMeta.dbTableName);
    if (dbTableNameResult.isErr()) return err(dbTableNameResult.error);

    const setTableNameResult = table.setDbTableName(dbTableNameResult.value);
    if (setTableNameResult.isErr()) return err(setTableNameResult.error);

    const fieldsById = new Map(table.getFields().map((field) => [field.id().toString(), field]));
    const fieldResults = tableDbMeta.fields.map((meta) => {
      const field = fieldsById.get(meta.field.id);
      if (!field)
        return err(
          domainError.validation({ message: `Missing field for db name ${meta.field.id}` })
        );
      return core.DbFieldName.rehydrate(meta.dbFieldName).andThen((dbFieldName) =>
        field.setDbFieldName(dbFieldName)
      );
    });

    return this.sequenceResults(fieldResults).map(() => undefined);
  }

  private async buildTableDbMeta(
    _trx: Kysely<V1TeableDatabase>,
    dto: core.ITablePersistenceDTO,
    baseId: string,
    fields: ReadonlyArray<ITableDbFieldMeta>,
    dbTableNameOverride?: string
  ): Promise<ITableDbMeta> {
    const dbTableName = dbTableNameOverride ?? joinDbTableName(baseId, dto.id);
    return { tableId: dto.id, dbTableName, fields };
  }
}

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

const executeCompiledQueries = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  compiled: ReadonlyArray<CompiledQuery>
): Promise<void> => {
  for (const statement of compiled) {
    await db.executeQuery(statement);
  }
};

const relationExists = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  relationName: string
): Promise<boolean> => {
  const result = await db.executeQuery<{ exists: boolean }>(
    sql`SELECT to_regclass(${relationName}) IS NOT NULL as "exists"`.compile(db)
  );
  return result.rows[0]?.exists === true;
};
