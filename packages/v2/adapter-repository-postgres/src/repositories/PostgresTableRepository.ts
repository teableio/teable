import * as core from '@teable/v2-core';
import { domainError, isDomainError, type DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql, type CompiledQuery, type Transaction } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ITableDbFieldMeta, ITableDbMeta } from '../db/tableDbMeta';
import { v2PostgresStateTokens } from '../di/tokens';
import { joinDbTableName } from '../naming';
import { TableFieldPersistenceBuilder, type TableFieldRow } from './TableFieldPersistenceBuilder';
import { TableMetaUpdateVisitor } from './visitors/TableMetaUpdateVisitor';
import { ITableMetaWhere, TableWhereVisitor } from './visitors/TableWhereVisitor';

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

    let tableDbMeta: ITableDbMeta | undefined;
    const transaction = getPostgresTransaction<V1TeableDatabase>(context);
    const persist = async (trx: Kysely<V1TeableDatabase>): Promise<Result<void, DomainError>> => {
      const order = sql<number>`
        (
          select coalesce(max("order"), 0) + 1
          from table_meta
          where base_id = ${baseId}
        )
      `;
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
        id: v.id,
        name: v.name,
        description: null,
        table_id: dto.id,
        type: v.type,
        sort: null,
        filter: null,
        group: null,
        options: null,
        order: i + 1,
        version: 1,
        column_meta: JSON.stringify(v.columnMeta),
        is_locked: null,
        enable_share: null,
        share_id: null,
        share_meta: null,
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
        null,
        null,
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

    const applyDbMetaResult = this.applyDbMeta(table, tableDbMetaValue);
    if (applyDbMetaResult.isErr()) return err(applyDbMetaResult.error);

    return ok(table);
  }

  @core.TraceSpan()
  async findOne(
    context: core.IExecutionContext,
    spec: core.ISpecification<core.Table, core.ITableSpecVisitor>
  ): Promise<Result<core.Table, DomainError>> {
    const visitor = new TableWhereVisitor();
    const acceptResult = spec.accept(visitor);
    if (acceptResult.isErr()) return err(acceptResult.error);

    const whereResult = visitor.where();
    if (whereResult.isErr()) return err(whereResult.error);
    const whereFactory = whereResult.value;

    try {
      const db = resolvePostgresDb(this.db, context);
      const fieldsLateral = db
        .selectNoFrom((eb) => [
          jsonArrayFrom(
            eb
              .selectFrom('field')
              .select([
                'id',
                'name',
                'type',
                'options',
                'meta',
                'cell_value_type',
                'is_multiple_cell_value',
                'not_null',
                'unique',
                'is_primary',
                'is_computed',
                'is_lookup',
                'is_conditional_lookup',
                'lookup_linked_field_id',
                'lookup_options',
                'db_field_name',
              ])
              .where(sql<boolean>`${sql.ref('field.table_id')} = ${sql.ref('table_meta.id')}`)
              .where('deleted_time', 'is', null)
              .orderBy('order')
          ).as('fields'),
        ])
        .as('fields');
      const viewsLateral = db
        .selectNoFrom((eb) => [
          jsonArrayFrom(
            eb
              .selectFrom('view')
              .select(['id', 'name', 'type', 'column_meta'])
              .where(sql<boolean>`${sql.ref('view.table_id')} = ${sql.ref('table_meta.id')}`)
              .where('deleted_time', 'is', null)
              .orderBy('order')
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
          'table_meta.base_id',
          'table_meta.db_table_name',
          'fields.fields',
          'views.views',
        ])
        .where((eb) => whereFactory(eb));

      const tableRow = await baseQuery.executeTakeFirst();
      if (!tableRow) return err(domainError.notFound({ message: 'Not found' }));

      const tableResult = this.mapTableRow(tableRow);
      if (tableResult.isErr()) return err(tableResult.error);

      return ok(tableResult.value);
    } catch (error) {
      return err(
        domainError.unexpected({ message: `Failed to load table: ${describeError(error)}` })
      );
    }
  }

  @core.TraceSpan()
  async find(
    context: core.IExecutionContext,
    spec: core.ISpecification<core.Table, core.ITableSpecVisitor>,
    options?: core.IFindOptions<core.TableSortKey>
  ): Promise<Result<ReadonlyArray<core.Table>, DomainError>> {
    const visitor = new TableWhereVisitor();
    const acceptResult = spec.accept(visitor);
    if (acceptResult.isErr()) return err(acceptResult.error);

    const whereResult = visitor.where();
    if (whereResult.isErr()) return err(whereResult.error);
    const whereFactory = whereResult.value;

    try {
      const db = resolvePostgresDb(this.db, context);
      const fieldsLateral = db
        .selectNoFrom((eb) => [
          jsonArrayFrom(
            eb
              .selectFrom('field')
              .select([
                'id',
                'name',
                'type',
                'options',
                'meta',
                'cell_value_type',
                'is_multiple_cell_value',
                'not_null',
                'unique',
                'is_primary',
                'is_computed',
                'is_lookup',
                'is_conditional_lookup',
                'lookup_linked_field_id',
                'lookup_options',
                'db_field_name',
              ])
              .where(sql<boolean>`${sql.ref('field.table_id')} = ${sql.ref('table_meta.id')}`)
              .where('deleted_time', 'is', null)
              .orderBy('order')
          ).as('fields'),
        ])
        .as('fields');
      const viewsLateral = db
        .selectNoFrom((eb) => [
          jsonArrayFrom(
            eb
              .selectFrom('view')
              .select(['id', 'name', 'type', 'column_meta'])
              .where(sql<boolean>`${sql.ref('view.table_id')} = ${sql.ref('table_meta.id')}`)
              .where('deleted_time', 'is', null)
              .orderBy('order')
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
          'table_meta.base_id',
          'table_meta.db_table_name',
          'fields.fields',
          'views.views',
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
  async updateOne(
    context: core.IExecutionContext,
    table: core.Table,
    mutateSpec: core.ISpecification<core.Table, core.ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
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

    const db = resolvePostgresDb(this.db, context);
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

      await executeCompiledQueries(
        db,
        statementsResult.value.map((statement) => statement.compile())
      );

      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({ message: `Failed to update table: ${describeError(error)}` })
      );
    }
  }

  @core.TraceSpan()
  async delete(
    context: core.IExecutionContext,
    table: core.Table
  ): Promise<Result<void, DomainError>> {
    const now = new Date();
    const actorId = context.actorId.toString();
    const tableId = table.id().toString();

    try {
      const db = resolvePostgresDb(this.db, context);
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

      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({ message: `Failed to delete table: ${describeError(error)}` })
      );
    }
  }

  private mapTableRow(row: {
    id: string;
    name: string;
    base_id: string;
    db_table_name: string | null;
    fields: unknown;
    views: unknown;
  }): Result<core.Table, DomainError> {
    const fieldRows = Array.isArray(row.fields)
      ? (row.fields as Array<{
          id: string;
          name: string;
          type: string;
          options: string | null;
          meta: string | null;
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
        }>)
      : [];

    const viewRows = Array.isArray(row.views)
      ? (row.views as Array<{ id: string; name: string; type: string; column_meta: string }>)
      : [];

    const primaryFieldId =
      fieldRows.find((f) => f.is_primary === true)?.id ?? fieldRows[0]?.id ?? '';

    const viewsResult = this.sequenceResults(viewRows.map((v) => this.deserializeViewDto(v)));
    if (viewsResult.isErr()) return err(viewsResult.error);

    const dto: core.ITablePersistenceDTO = {
      id: row.id,
      baseId: row.base_id,
      name: row.name,
      dbTableName: row.db_table_name ?? undefined,
      primaryFieldId,
      fields: fieldRows.map((f) => this.deserializeFieldDto(f)),
      views: [...viewsResult.value],
    };

    const domainResult = this.tableMapper.toDomain(dto);
    if (domainResult.isErr()) return err(domainResult.error);

    return ok(domainResult.value);
  }

  private resolveSortColumn(key: core.TableSortKey): 'name' | 'id' {
    return key.toString() === 'name' ? 'name' : 'id';
  }

  private deserializeFieldDto(row: {
    id: string;
    name: string;
    type: string;
    options: string | null;
    meta: string | null;
    cell_value_type: string | null;
    is_multiple_cell_value: boolean | null;
    not_null: boolean | null;
    unique: boolean | null;
    is_computed: boolean | null;
    is_lookup: boolean | null;
    is_conditional_lookup: boolean | null;
    lookup_linked_field_id: string | null;
    lookup_options: string | null;
    db_field_name: string | null;
  }): core.ITableFieldPersistenceDTO {
    const parsed = this.parseOptions(row.options);
    const hasOptions = Object.keys(parsed).length > 0;
    const asOptions = <T>(): T | undefined => (hasOptions ? (parsed as T) : undefined);
    const lookupParsed = this.parseOptions(row.lookup_options);
    const hasLookupOptions = Object.keys(lookupParsed).length > 0;
    const asLookupOptions = <T>(): T | undefined =>
      hasLookupOptions ? (lookupParsed as T) : undefined;
    const resolveLookupOptions = (): core.ILookupOptionsDTO | undefined => {
      if (!row.is_lookup || !hasLookupOptions) return undefined;
      const candidate = asLookupOptions<core.ILookupOptionsDTO>();
      if (!candidate) return undefined;
      if (core.FieldId.create(candidate.linkFieldId).isErr()) return undefined;
      if (core.FieldId.create(candidate.lookupFieldId).isErr()) return undefined;
      if (core.TableId.create(candidate.foreignTableId).isErr()) return undefined;
      return candidate;
    };
    const lookupOptions = resolveLookupOptions();
    const dbFieldName = row.db_field_name ?? undefined;
    const base = {
      id: row.id,
      name: row.name,
      dbFieldName,
      ...(row.not_null ? { notNull: true } : {}),
      ...(row.unique ? { unique: true } : {}),
      ...(row.is_computed ? { isComputed: true } : {}),
      ...(lookupOptions ? { isLookup: true } : {}),
      ...(row.is_conditional_lookup && lookupOptions ? { isConditionalLookup: true } : {}),
      ...(lookupOptions ? { lookupOptions } : {}),
    };
    const metaParsed = this.parseOptions(row.meta);
    const hasMeta = Object.keys(metaParsed).length > 0;
    const asMeta = <T>(): T | undefined => (hasMeta ? (metaParsed as T) : undefined);

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
      return {
        ...base,
        type: 'createdTime',
        options: asOptions<core.ICreatedTimeFieldOptionsDTO>(),
      };
    }
    if (row.type === 'lastModifiedTime') {
      return {
        ...base,
        type: 'lastModifiedTime',
        options: asOptions<core.ILastModifiedTimeFieldOptionsDTO>(),
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
      return {
        ...base,
        type: 'createdBy',
        options: asOptions<core.ICreatedByFieldOptionsDTO>(),
      };
    }
    if (row.type === 'lastModifiedBy') {
      return {
        ...base,
        type: 'lastModifiedBy',
        options: asOptions<core.ILastModifiedByFieldOptionsDTO>(),
      };
    }
    if (row.type === 'autoNumber') {
      return {
        ...base,
        type: 'autoNumber',
        options: asOptions<core.IAutoNumberFieldOptionsDTO>(),
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
          filter: v1Options.filter as core.IConditionalRollupFieldConfigDTO['condition']['filter'],
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
      const options: core.IConditionalLookupOptionsDTO = {
        foreignTableId:
          typeof v1Options.foreignTableId === 'string' ? v1Options.foreignTableId : '',
        lookupFieldId: typeof v1Options.lookupFieldId === 'string' ? v1Options.lookupFieldId : '',
        condition: {
          filter: v1Options.filter as core.IConditionalLookupOptionsDTO['condition']['filter'],
          sort: v1Options.sort as { fieldId: string; order: 'asc' | 'desc' } | undefined,
          limit: typeof v1Options.limit === 'number' ? v1Options.limit : undefined,
        },
      };
      return {
        ...base,
        type: 'conditionalLookup',
        options,
        innerType: row.cell_value_type ?? undefined,
      };
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

  private normalizeSelectOptions(raw: Record<string, unknown>): {
    choices: ReadonlyArray<{ id: string; name: string; color: string }>;
    defaultValue?: string | ReadonlyArray<string>;
    preventAutoNewOptions?: boolean;
  } {
    if (Array.isArray(raw.options)) {
      const choices = raw.options.map((name, index) => ({
        id: `cho${core.getRandomString(8)}`,
        name: String(name),
        color: core.fieldColorValues[index % core.fieldColorValues.length],
      }));
      return { choices };
    }

    const choices = Array.isArray(raw.choices) ? raw.choices : [];
    const defaultValue = raw.defaultValue;
    const preventAutoNewOptions =
      typeof raw.preventAutoNewOptions === 'boolean' ? raw.preventAutoNewOptions : undefined;

    return {
      choices: choices as ReadonlyArray<{ id: string; name: string; color: string }>,
      ...(defaultValue !== undefined ? { defaultValue: defaultValue as string | string[] } : {}),
      ...(preventAutoNewOptions !== undefined ? { preventAutoNewOptions } : {}),
    };
  }

  private deserializeViewDto(row: {
    id: string;
    name: string;
    type: string;
    column_meta: string | null;
  }): Result<core.ITableViewPersistenceDTO, DomainError> {
    const columnMeta = this.parseOptions(
      row.column_meta
    ) as core.ITableViewPersistenceDTO['columnMeta'];

    if (row.type === 'grid') return ok({ id: row.id, name: row.name, type: 'grid', columnMeta });
    if (row.type === 'kanban')
      return ok({ id: row.id, name: row.name, type: 'kanban', columnMeta });
    if (row.type === 'gallery')
      return ok({ id: row.id, name: row.name, type: 'gallery', columnMeta });
    if (row.type === 'calendar')
      return ok({ id: row.id, name: row.name, type: 'calendar', columnMeta });
    if (row.type === 'form') return ok({ id: row.id, name: row.name, type: 'form', columnMeta });
    if (row.type === 'plugin')
      return ok({ id: row.id, name: row.name, type: 'plugin', columnMeta });
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

type PostgresTransactionContext<DB> = {
  kind: 'unitOfWorkTransaction';
  db: Transaction<DB>;
};

const getPostgresTransaction = <DB>(context: core.IExecutionContext): Transaction<DB> | null => {
  const transaction = context.transaction as Partial<PostgresTransactionContext<DB>> | undefined;
  if (transaction?.kind === 'unitOfWorkTransaction' && transaction.db) {
    return transaction.db as Transaction<DB>;
  }
  return null;
};

const resolvePostgresDb = <DB>(
  db: Kysely<DB>,
  context: core.IExecutionContext
): Kysely<DB> | Transaction<DB> => {
  return getPostgresTransaction<DB>(context) ?? db;
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

const executeCompiledQueries = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  compiled: ReadonlyArray<CompiledQuery>
): Promise<void> => {
  for (const statement of compiled) {
    await db.executeQuery(statement);
  }
};
