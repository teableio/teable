import * as core from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql, type CompiledQuery, type Transaction } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ITableDbFieldMeta, ITableDbMeta } from '../db/tableDbMeta';
import { v2PostgresStateTokens } from '../di/tokens';
import { convertNameToValidCharacter, joinDbTableName } from '../naming';
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
  ): Promise<Result<core.Table, string>> {
    const now = new Date();
    const actorId = context.actorId.toString();
    const baseId = table.baseId().toString();

    let tableDbMeta: ITableDbMeta | undefined;
    const transaction = getPostgresTransaction<V1TeableDatabase>(context);
    const persist = async (trx: Kysely<V1TeableDatabase>): Promise<Result<void, string>> => {
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
        : await this.resolveDbTableName(
            trx,
            baseId,
            convertNameToValidCharacter(table.name().toString(), 40)
          );
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
      if (!tableDbMetaValue) return err('Missing table db metadata');
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
      return err(`Failed to insert table: ${describeError(error)}`);
    }

    const tableDbMetaValue = tableDbMeta;
    if (!tableDbMetaValue) return err('Missing table db metadata');

    const applyDbMetaResult = this.applyDbMeta(table, tableDbMetaValue);
    if (applyDbMetaResult.isErr()) return err(applyDbMetaResult.error);

    return ok(table);
  }

  @core.TraceSpan()
  async findOne(
    context: core.IExecutionContext,
    spec: core.ISpecification<core.Table, core.ITableSpecVisitor>
  ): Promise<Result<core.Table, string>> {
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
                'is_primary',
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
      if (!tableRow) return err('Not found');

      const tableResult = this.mapTableRow(tableRow);
      if (tableResult.isErr()) return err(tableResult.error);

      return ok(tableResult.value);
    } catch (error) {
      return err(`Failed to load table: ${describeError(error)}`);
    }
  }

  @core.TraceSpan()
  async find(
    context: core.IExecutionContext,
    spec: core.ISpecification<core.Table, core.ITableSpecVisitor>,
    options?: core.IFindOptions<core.TableSortKey>
  ): Promise<Result<ReadonlyArray<core.Table>, string>> {
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
                'is_primary',
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
      return err(`Failed to load tables: ${describeError(error)}`);
    }
  }

  @core.TraceSpan()
  async updateOne(
    context: core.IExecutionContext,
    table: core.Table,
    mutateSpec: core.ISpecification<core.Table, core.ITableSpecVisitor>
  ): Promise<Result<void, string>> {
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

      const batch = combineCompiledQueriesAsSql(
        statementsResult.value.map((statement) => statement.compile())
      );
      await batch.execute(db);

      return ok(undefined);
    } catch (error) {
      return err(`Failed to update table: ${describeError(error)}`);
    }
  }

  @core.TraceSpan()
  async delete(context: core.IExecutionContext, table: core.Table): Promise<Result<void, string>> {
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
      if (updatedRows === 0) return err('Not found');

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
      return err(`Failed to delete table: ${describeError(error)}`);
    }
  }

  private mapTableRow(row: {
    id: string;
    name: string;
    base_id: string;
    db_table_name: string | null;
    fields: unknown;
    views: unknown;
  }): Result<core.Table, string> {
    const fieldRows = Array.isArray(row.fields)
      ? (row.fields as Array<{
          id: string;
          name: string;
          type: string;
          options: string | null;
          meta: string | null;
          cell_value_type: string | null;
          is_multiple_cell_value: boolean | null;
          is_primary: boolean | null;
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
    lookup_linked_field_id: string | null;
    lookup_options: string | null;
    db_field_name: string | null;
  }): core.ITableFieldPersistenceDTO {
    const parsed = this.parseOptions(row.options);
    const hasOptions = Object.keys(parsed).length > 0;
    const asOptions = <T>(): T | undefined => (hasOptions ? (parsed as T) : undefined);
    const dbFieldName = row.db_field_name ?? undefined;
    const metaParsed = this.parseOptions(row.meta);
    const hasMeta = Object.keys(metaParsed).length > 0;
    const asMeta = <T>(): T | undefined => (hasMeta ? (metaParsed as T) : undefined);
    const lookupParsed = this.parseOptions(row.lookup_options);
    const hasLookupOptions = Object.keys(lookupParsed).length > 0;
    const asLookupOptions = <T>(): T | undefined =>
      hasLookupOptions ? (lookupParsed as T) : undefined;

    if (row.type === 'rating') {
      const options = {
        icon: typeof parsed.icon === 'string' ? parsed.icon : 'star',
        color: typeof parsed.color === 'string' ? parsed.color : 'yellowBright',
        max: typeof parsed.max === 'number' ? parsed.max : 5,
      };
      return { id: row.id, name: row.name, type: 'rating', options, dbFieldName };
    }

    if (row.type === 'singleSelect' || row.type === 'select') {
      return {
        id: row.id,
        name: row.name,
        type: 'singleSelect',
        options: this.normalizeSelectOptions(parsed),
        dbFieldName,
      };
    }

    if (row.type === 'multipleSelect') {
      return {
        id: row.id,
        name: row.name,
        type: 'multipleSelect',
        options: this.normalizeSelectOptions(parsed),
        dbFieldName,
      };
    }

    if (row.type === 'number') {
      return {
        id: row.id,
        name: row.name,
        type: 'number',
        options: asOptions<core.INumberFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    if (row.type === 'formula') {
      return {
        id: row.id,
        name: row.name,
        type: 'formula',
        options: asOptions<core.IFormulaFieldOptionsDTO>() ?? { expression: '' },
        meta: asMeta<core.IFormulaFieldMetaDTO>(),
        cellValueType: row.cell_value_type ?? undefined,
        isMultipleCellValue: row.is_multiple_cell_value ?? undefined,
        dbFieldName,
      };
    }
    if (row.type === 'rollup') {
      return {
        id: row.id,
        name: row.name,
        type: 'rollup',
        options: asOptions<core.IRollupFieldOptionsDTO>() ?? {
          expression: 'countall({values})',
        },
        config: asLookupOptions<core.IRollupFieldConfigDTO>(),
        cellValueType: row.cell_value_type ?? undefined,
        isMultipleCellValue: row.is_multiple_cell_value ?? undefined,
        dbFieldName,
      };
    }
    if (row.type === 'longText') {
      return {
        id: row.id,
        name: row.name,
        type: 'longText',
        options: asOptions<core.ILongTextFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    if (row.type === 'checkbox') {
      return {
        id: row.id,
        name: row.name,
        type: 'checkbox',
        options: asOptions<core.ICheckboxFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    if (row.type === 'attachment') {
      const options = hasOptions ? {} : undefined;
      return { id: row.id, name: row.name, type: 'attachment', options, dbFieldName };
    }
    if (row.type === 'date') {
      return {
        id: row.id,
        name: row.name,
        type: 'date',
        options: asOptions<core.IDateFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    if (row.type === 'user') {
      return {
        id: row.id,
        name: row.name,
        type: 'user',
        options: asOptions<core.IUserFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    if (row.type === 'button') {
      return {
        id: row.id,
        name: row.name,
        type: 'button',
        options: asOptions<core.IButtonFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    if (row.type === 'link') {
      const options = asOptions<core.ILinkFieldOptionsDTO>() ?? ({} as core.ILinkFieldOptionsDTO);
      const meta = asMeta<core.ILinkFieldMetaDTO>();
      return {
        id: row.id,
        name: row.name,
        type: 'link',
        options,
        ...(meta ? { meta } : {}),
        dbFieldName,
      };
    }
    return {
      id: row.id,
      name: row.name,
      type: 'singleLineText',
      options: asOptions<core.ISingleLineTextFieldOptionsDTO>(),
      dbFieldName,
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
  }): Result<core.ITableViewPersistenceDTO, string> {
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
    return err('Unsupported view type');
  }

  private sequenceResults<T>(
    values: ReadonlyArray<Result<T, string>>
  ): Result<ReadonlyArray<T>, string> {
    return values.reduce<Result<ReadonlyArray<T>, string>>(
      (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
      ok([])
    );
  }

  private applyDbMeta(table: core.Table, tableDbMeta: ITableDbMeta): Result<void, string> {
    const dbTableNameResult = core.DbTableName.rehydrate(tableDbMeta.dbTableName);
    if (dbTableNameResult.isErr()) return err(dbTableNameResult.error);

    const setTableNameResult = table.setDbTableName(dbTableNameResult.value);
    if (setTableNameResult.isErr()) return err(setTableNameResult.error);

    const fieldsById = new Map(table.fields().map((field) => [field.id().toString(), field]));
    const fieldResults = tableDbMeta.fields.map((meta) => {
      const field = fieldsById.get(meta.field.id);
      if (!field) return err(`Missing field for db name ${meta.field.id}`);
      return core.DbFieldName.rehydrate(meta.dbFieldName).andThen((dbFieldName) =>
        field.setDbFieldName(dbFieldName)
      );
    });

    return this.sequenceResults(fieldResults).map(() => undefined);
  }

  private async resolveDbTableName(
    trx: Kysely<V1TeableDatabase>,
    baseId: string,
    baseName: string
  ): Promise<Result<string, string>> {
    const exists = async (candidate: string): Promise<boolean> => {
      const existing = await trx
        .selectFrom('table_meta')
        .select(['id'])
        .where('base_id', '=', baseId)
        .where('db_table_name', '=', candidate)
        .where('deleted_time', 'is', null)
        .executeTakeFirst();
      return Boolean(existing);
    };

    const initial = joinDbTableName(baseId, baseName);
    if (!(await exists(initial))) return ok(initial);

    const maxLength = 40;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const suffix = `_${core.getRandomString(6)}`;
      const trimmedBase = baseName.substring(0, Math.max(0, maxLength - suffix.length));
      const candidate = joinDbTableName(baseId, `${trimmedBase}${suffix}`);
      if (!(await exists(candidate))) return ok(candidate);
    }

    return err('DbTableName already exists');
  }

  private async buildTableDbMeta(
    _trx: Kysely<V1TeableDatabase>,
    dto: core.ITablePersistenceDTO,
    baseId: string,
    fields: ReadonlyArray<ITableDbFieldMeta>,
    dbTableNameOverride?: string
  ): Promise<ITableDbMeta> {
    const dbTableName =
      dbTableNameOverride ?? joinDbTableName(baseId, convertNameToValidCharacter(dto.name, 40));
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

const combineCompiledQueriesAsSql = (
  compiled: ReadonlyArray<CompiledQuery>
): ReturnType<typeof sql> => {
  const statements = compiled.map(compileWithLiterals);
  return sql.join(statements, sql.raw(';\n'));
};

const compileWithLiterals = (compiled: CompiledQuery): ReturnType<typeof sql> => {
  const parts: Array<ReturnType<typeof sql>> = [];
  const parameters = compiled.parameters;
  let lastIndex = 0;
  const placeholder = /\$(\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = placeholder.exec(compiled.sql)) !== null) {
    const before = compiled.sql.slice(lastIndex, match.index);
    if (before) parts.push(sql.raw(before));
    const parameterIndex = Number(match[1]) - 1;
    const value = parameters[parameterIndex] ?? null;
    parts.push(sql.lit(value));
    lastIndex = match.index + match[0].length;
  }

  const tail = compiled.sql.slice(lastIndex);
  if (tail) parts.push(sql.raw(tail));
  if (parts.length === 0) return sql.raw(compiled.sql);

  return sql.join(parts, sql.raw(''));
};
