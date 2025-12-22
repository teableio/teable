import type {
  ITableMapper,
  ITableFieldPersistenceDTO,
  ITableRepository,
  ITablePersistenceDTO,
  IExecutionContext,
  IFindOptions,
  ITableViewPersistenceDTO,
  ISpecification,
  Table,
  TableSortKey,
  ISingleLineTextFieldOptionsDTO,
  ILongTextFieldOptionsDTO,
  INumberFieldOptionsDTO,
  ICheckboxFieldOptionsDTO,
  IDateFieldOptionsDTO,
  IUserFieldOptionsDTO,
  IButtonFieldOptionsDTO,
} from '@teable/v2-core';
import {
  DbFieldName,
  DbTableName,
  fieldColorValues,
  getRandomString,
  TraceSpan,
} from '@teable/v2-core';
import {
  getPostgresTransaction,
  resolvePostgresDb,
  v2PostgresDbTokens,
} from '@teable/v2-db-postgres';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ITableDbFieldMeta, ITableDbMeta } from '../db/tableDbMeta';
import { v2PostgresStateTokens } from '../di/tokens';
import { baseRecordColumnNames, convertNameToValidCharacter, joinDbTableName } from '../naming';
import {
  FieldStorageTypeVisitor,
  type IFieldStorageType,
} from './visitors/FieldStorageTypeVisitor';
import { TableWhereVisitor } from './visitors/TableWhereVisitor';

@injectable()
export class PostgresTableRepository implements ITableRepository {
  constructor(
    @inject(v2PostgresDbTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2PostgresStateTokens.tableMapper)
    private readonly tableMapper: ITableMapper
  ) {}

  @TraceSpan()
  async insert(context: IExecutionContext, table: Table): Promise<Result<Table, string>> {
    const dtoResult = this.tableMapper.toDTO(table);
    if (dtoResult.isErr()) return err(dtoResult.error);
    const dto = dtoResult.value;
    const fieldStorageTypeResult = this.buildFieldStorageTypeById(table);
    if (fieldStorageTypeResult.isErr()) return err(fieldStorageTypeResult.error);
    const fieldStorageTypeById = fieldStorageTypeResult.value;

    const now = new Date();
    const actorId = context.actorId.toString();
    const baseId = dto.baseId;

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
      tableDbMeta = await this.buildTableDbMeta(trx, dto, baseId);
      const tableDbMetaValue = tableDbMeta;
      if (!tableDbMetaValue) return err('Missing table db metadata');
      const fieldValuesResult = this.sequenceResults(
        tableDbMetaValue.fields.map((f, i) => {
          const storageType = fieldStorageTypeById.get(f.field.id);
          if (!storageType) return err(`Missing storage type for field ${f.field.id}`);
          return ok({
            id: f.field.id,
            name: f.field.name,
            description: null,
            options: this.serializeFieldOptions(f.field),
            meta: null,
            ai_config: null,
            type: f.field.type,
            cell_value_type: storageType.cellValueType,
            is_multiple_cell_value: null,
            db_field_type: storageType.dbFieldType,
            db_field_name: f.dbFieldName,
            not_null: null,
            unique: null,
            is_primary: f.field.id === dto.primaryFieldId ? true : null,
            is_computed: null,
            is_lookup: null,
            is_conditional_lookup: null,
            is_pending: null,
            has_error: null,
            lookup_linked_field_id: null,
            lookup_options: null,
            table_id: dto.id,
            order: i + 1,
            version: 1,
            created_time: now,
            last_modified_time: now,
            deleted_time: null,
            created_by: actorId,
            last_modified_by: actorId,
          });
        })
      );
      if (fieldValuesResult.isErr()) return err(fieldValuesResult.error);

      const fieldRows = fieldValuesResult.value;
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
        column_meta: '{}',
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

  @TraceSpan()
  async findOne(
    context: IExecutionContext,
    spec: ISpecification<Table>
  ): Promise<Result<Table, string>> {
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
              .select(['id', 'name', 'type', 'options', 'is_primary', 'db_field_name'])
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
              .select(['id', 'name', 'type'])
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

  @TraceSpan()
  async find(
    context: IExecutionContext,
    spec: ISpecification<Table>,
    options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, string>> {
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
              .select(['id', 'name', 'type', 'options', 'is_primary', 'db_field_name'])
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
              .select(['id', 'name', 'type'])
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

  private mapTableRow(row: {
    id: string;
    name: string;
    base_id: string;
    db_table_name: string | null;
    fields: unknown;
    views: unknown;
  }): Result<Table, string> {
    const fieldRows = Array.isArray(row.fields)
      ? (row.fields as Array<{
          id: string;
          name: string;
          type: string;
          options: string | null;
          is_primary: boolean | null;
          db_field_name: string | null;
        }>)
      : [];

    const viewRows = Array.isArray(row.views)
      ? (row.views as Array<{ id: string; name: string; type: string }>)
      : [];

    const primaryFieldId =
      fieldRows.find((f) => f.is_primary === true)?.id ?? fieldRows[0]?.id ?? '';

    const viewsResult = this.sequenceResults(viewRows.map((v) => this.deserializeViewDto(v)));
    if (viewsResult.isErr()) return err(viewsResult.error);

    const dto: ITablePersistenceDTO = {
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

  private resolveSortColumn(key: TableSortKey): 'name' | 'id' {
    return key.toString() === 'name' ? 'name' : 'id';
  }

  private serializeFieldOptions(field: ITableFieldPersistenceDTO): string | null {
    if (field.options === undefined) return null;
    return JSON.stringify(field.options);
  }

  private deserializeFieldDto(row: {
    id: string;
    name: string;
    type: string;
    options: string | null;
    db_field_name: string | null;
  }): ITableFieldPersistenceDTO {
    const parsed = this.parseOptions(row.options);
    const hasOptions = Object.keys(parsed).length > 0;
    const asOptions = <T>(): T | undefined => (hasOptions ? (parsed as T) : undefined);
    const dbFieldName = row.db_field_name ?? undefined;

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
        options: asOptions<INumberFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    if (row.type === 'longText') {
      return {
        id: row.id,
        name: row.name,
        type: 'longText',
        options: asOptions<ILongTextFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    if (row.type === 'checkbox') {
      return {
        id: row.id,
        name: row.name,
        type: 'checkbox',
        options: asOptions<ICheckboxFieldOptionsDTO>(),
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
        options: asOptions<IDateFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    if (row.type === 'user') {
      return {
        id: row.id,
        name: row.name,
        type: 'user',
        options: asOptions<IUserFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    if (row.type === 'button') {
      return {
        id: row.id,
        name: row.name,
        type: 'button',
        options: asOptions<IButtonFieldOptionsDTO>(),
        dbFieldName,
      };
    }
    return {
      id: row.id,
      name: row.name,
      type: 'singleLineText',
      options: asOptions<ISingleLineTextFieldOptionsDTO>(),
      dbFieldName,
    };
  }

  private parseOptions(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
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
        id: `cho${getRandomString(8)}`,
        name: String(name),
        color: fieldColorValues[index % fieldColorValues.length],
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
  }): Result<ITableViewPersistenceDTO, string> {
    if (row.type === 'grid') return ok({ id: row.id, name: row.name, type: 'grid' });
    if (row.type === 'kanban') return ok({ id: row.id, name: row.name, type: 'kanban' });
    if (row.type === 'gallery') return ok({ id: row.id, name: row.name, type: 'gallery' });
    if (row.type === 'calendar') return ok({ id: row.id, name: row.name, type: 'calendar' });
    if (row.type === 'form') return ok({ id: row.id, name: row.name, type: 'form' });
    if (row.type === 'plugin') return ok({ id: row.id, name: row.name, type: 'plugin' });
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

  private applyDbMeta(table: Table, tableDbMeta: ITableDbMeta): Result<void, string> {
    const dbTableNameResult = DbTableName.rehydrate(tableDbMeta.dbTableName);
    if (dbTableNameResult.isErr()) return err(dbTableNameResult.error);

    const setTableNameResult = table.setDbTableName(dbTableNameResult.value);
    if (setTableNameResult.isErr()) return err(setTableNameResult.error);

    const fieldsById = new Map(table.fields().map((field) => [field.id().toString(), field]));
    const fieldResults = tableDbMeta.fields.map((meta) => {
      const field = fieldsById.get(meta.field.id);
      if (!field) return err(`Missing field for db name ${meta.field.id}`);
      return DbFieldName.rehydrate(meta.dbFieldName).andThen((dbFieldName) =>
        field.setDbFieldName(dbFieldName)
      );
    });

    return this.sequenceResults(fieldResults).map(() => undefined);
  }

  private buildFieldStorageTypeById(
    table: Table
  ): Result<ReadonlyMap<string, IFieldStorageType>, string> {
    const visitor = new FieldStorageTypeVisitor();
    const applyResult = visitor.apply(table);
    if (applyResult.isErr()) return err(applyResult.error);
    return ok(visitor.typesById());
  }

  private async buildTableDbMeta(
    trx: Kysely<V1TeableDatabase>,
    dto: ITablePersistenceDTO,
    baseId: string
  ): Promise<ITableDbMeta> {
    const dbTableName = await this.resolveDbTableName(trx, baseId, dto.name);
    const fields = this.buildDbFieldMeta(dto);
    return { tableId: dto.id, dbTableName, fields };
  }

  private async resolveDbTableName(
    trx: Kysely<V1TeableDatabase>,
    baseId: string,
    tableName: string
  ): Promise<string> {
    const validName = convertNameToValidCharacter(tableName, 40);
    let dbTableName = joinDbTableName(baseId, validName);

    const conflict = await trx
      .selectFrom('table_meta')
      .select(['id'])
      .where('db_table_name', '=', dbTableName)
      .executeTakeFirst();

    if (conflict) {
      dbTableName = `${dbTableName}${getRandomString(10)}`;
    }

    return dbTableName;
  }

  private buildDbFieldMeta(dto: ITablePersistenceDTO): ReadonlyArray<ITableDbFieldMeta> {
    const reservedNames = new Set(baseRecordColumnNames);

    return dto.fields.map((field) => {
      const baseName = convertNameToValidCharacter(field.name, 40);
      const dbFieldName = this.ensureUniqueDbFieldName(baseName, reservedNames);
      reservedNames.add(dbFieldName);
      return { field, dbFieldName };
    });
  }

  private ensureUniqueDbFieldName(baseName: string, reservedNames: Set<string>): string {
    if (!reservedNames.has(baseName)) return baseName;

    let suffix = 2;
    let candidate = `${baseName}_${suffix}`;
    while (reservedNames.has(candidate)) {
      suffix += 1;
      candidate = `${baseName}_${suffix}`;
    }

    return candidate;
  }
}

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
