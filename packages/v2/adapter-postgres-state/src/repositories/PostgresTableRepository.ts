import type {
  ITableMapper,
  ITableFieldPersistenceDTO,
  ITableRepository,
  ITablePersistenceDTO,
  IExecutionContext,
  ITableViewPersistenceDTO,
  ISpecification,
  Table,
} from '@teable/v2-core';
import { getRandomString } from '@teable/v2-core';
import { v2PostgresDbTokens } from '@teable/v2-db-postgres';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ITableDbFieldMeta, ITableDbMeta } from '../db/tableDbMeta';
import { v2PostgresStateTokens } from '../di/tokens';
import {
  baseRecordColumnNames,
  convertNameToValidCharacter,
  joinDbTableName,
  splitDbTableName,
} from '../naming';
import { TableWhereVisitor } from './visitors/TableWhereVisitor';

@injectable()
export class PostgresTableRepository implements ITableRepository {
  constructor(
    @inject(v2PostgresDbTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2PostgresStateTokens.tableMapper)
    private readonly tableMapper: ITableMapper
  ) {}

  async save(context: IExecutionContext, table: Table): Promise<Result<void, string>> {
    const dtoResult = this.tableMapper.toDTO(table);
    if (dtoResult.isErr()) return err(dtoResult.error);
    const dto = dtoResult.value;

    const now = new Date();
    const actorId = context.actorId.toString();
    const baseId = dto.baseId;

    try {
      await this.db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('table_meta')
          .select(['id', 'order', 'db_table_name'])
          .where('id', '=', dto.id)
          .executeTakeFirst();

        const order: number =
          existing?.order ??
          (await trx
            .selectFrom('table_meta')
            .select(({ fn }) => fn.max('order').as('max_order'))
            .where('base_id', '=', baseId)
            .executeTakeFirst()
            .then((row) => Number(row?.max_order ?? 0) + 1));

        const tableDbMeta = await this.buildTableDbMeta(
          trx,
          dto,
          baseId,
          existing?.db_table_name ?? null
        );

        await trx
          .insertInto('table_meta')
          .values({
            id: dto.id,
            base_id: baseId,
            name: dto.name,
            description: null,
            icon: null,
            db_table_name: tableDbMeta.dbTableName,
            db_view_name: null,
            version: 1,
            order,
            created_time: now,
            last_modified_time: now,
            deleted_time: null,
            created_by: actorId,
            last_modified_by: actorId,
          })
          .onConflict((oc) =>
            oc.column('id').doUpdateSet({
              name: dto.name,
              last_modified_time: now,
              last_modified_by: actorId,
            })
          )
          .execute();

        await trx.deleteFrom('field').where('table_id', '=', dto.id).execute();
        if (tableDbMeta.fields.length > 0) {
          await trx
            .insertInto('field')
            .values(
              tableDbMeta.fields.map((f, i) => ({
                id: f.field.id,
                name: f.field.name,
                description: null,
                options: this.serializeFieldOptions(f.field),
                meta: null,
                ai_config: null,
                type: f.field.type,
                cell_value_type: this.getCellValueType(f.field.type),
                is_multiple_cell_value: null,
                db_field_type: this.getDbFieldType(f.field.type),
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
              }))
            )
            .execute();
        }

        await trx.deleteFrom('view').where('table_id', '=', dto.id).execute();
        if (dto.views.length > 0) {
          await trx
            .insertInto('view')
            .values(
              dto.views.map((v, i) => ({
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
              }))
            )
            .execute();
        }
      });
    } catch (error) {
      return err(`Failed to save table: ${describeError(error)}`);
    }

    return ok(undefined);
  }

  async findOne(_: IExecutionContext, spec: ISpecification<Table>): Promise<Result<Table, string>> {
    const visitor = new TableWhereVisitor();
    const acceptResult = spec.accept(visitor);
    if (acceptResult.isErr()) return err(acceptResult.error);

    const whereResult = visitor.where();
    if (whereResult.isErr()) return err(whereResult.error);
    const whereFactory = whereResult.value;

    try {
      const baseQuery = this.db
        .selectFrom('table_meta')
        .select(['id', 'name', 'base_id'])
        .where((eb) => whereFactory(eb));

      const tableRow = await baseQuery.executeTakeFirst();
      if (!tableRow) return err('Not found');

      const fieldRows = await this.db
        .selectFrom('field')
        .select(['id', 'name', 'type', 'options', 'is_primary'])
        .where('table_id', '=', tableRow.id)
        .where('deleted_time', 'is', null)
        .orderBy('order')
        .execute();

      const viewRows = await this.db
        .selectFrom('view')
        .select(['id', 'name', 'type'])
        .where('table_id', '=', tableRow.id)
        .where('deleted_time', 'is', null)
        .orderBy('order')
        .execute();

      const primaryFieldId =
        fieldRows.find((f) => f.is_primary === true)?.id ?? fieldRows[0]?.id ?? '';

      const viewsResult = this.sequenceResults(viewRows.map((v) => this.deserializeViewDto(v)));
      if (viewsResult.isErr()) return err(viewsResult.error);

      const dto: ITablePersistenceDTO = {
        id: tableRow.id,
        baseId: tableRow.base_id,
        name: tableRow.name,
        primaryFieldId,
        fields: fieldRows.map((f) => this.deserializeFieldDto(f)),
        views: [...viewsResult.value],
      };

      const domainResult = this.tableMapper.toDomain(dto);
      if (domainResult.isErr()) return err(domainResult.error);

      return ok(domainResult.value);
    } catch (error) {
      return err(`Failed to load table: ${describeError(error)}`);
    }
  }

  private serializeFieldOptions(field: ITableFieldPersistenceDTO): string | null {
    switch (field.type) {
      case 'rating':
        return JSON.stringify({ max: field.max });
      case 'singleSelect':
        return JSON.stringify({ options: field.options });
      default:
        return null;
    }
  }

  private deserializeFieldDto(row: {
    id: string;
    name: string;
    type: string;
    options: string | null;
  }): ITableFieldPersistenceDTO {
    if (row.type === 'rating') {
      const parsed = row.options ? (JSON.parse(row.options) as { max?: number }) : {};
      return { id: row.id, name: row.name, type: 'rating', max: parsed.max ?? 5 };
    }

    if (row.type === 'singleSelect' || row.type === 'select') {
      const parsed = row.options
        ? (JSON.parse(row.options) as { options?: ReadonlyArray<string> })
        : {};
      return { id: row.id, name: row.name, type: 'singleSelect', options: parsed.options ?? [] };
    }

    if (row.type === 'number') return { id: row.id, name: row.name, type: 'number' };
    return { id: row.id, name: row.name, type: 'singleLineText' };
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

  private getCellValueType(type: string): string {
    switch (type) {
      case 'number':
      case 'rating':
        return 'number';
      default:
        return 'string';
    }
  }

  private getDbFieldType(type: string): string {
    switch (type) {
      case 'number':
        return 'numeric';
      case 'rating':
        return 'integer';
      default:
        return 'text';
    }
  }

  private async buildTableDbMeta(
    trx: Kysely<V1TeableDatabase>,
    dto: ITablePersistenceDTO,
    baseId: string,
    existingDbTableName: string | null
  ): Promise<ITableDbMeta> {
    const dbTableName = await this.resolveDbTableName(trx, baseId, dto.name, existingDbTableName);
    const fields = await this.buildDbFieldMeta(trx, dto, dbTableName);
    return { tableId: dto.id, dbTableName, fields };
  }

  private async resolveDbTableName(
    trx: Kysely<V1TeableDatabase>,
    baseId: string,
    tableName: string,
    existingDbTableName: string | null
  ): Promise<string> {
    if (existingDbTableName) return existingDbTableName;

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

  private async buildDbFieldMeta(
    trx: Kysely<V1TeableDatabase>,
    dto: ITablePersistenceDTO,
    dbTableName: string
  ): Promise<ReadonlyArray<ITableDbFieldMeta>> {
    const existingFields = await trx
      .selectFrom('field')
      .select(['id', 'db_field_name'])
      .where('table_id', '=', dto.id)
      .execute();

    const existingById = new Map(existingFields.map((f) => [f.id, f.db_field_name]));
    const reservedNames = await this.loadReservedColumnNames(trx, dbTableName);
    for (const name of existingById.values()) {
      reservedNames.add(name);
    }

    return dto.fields.map((field) => {
      const existingName = existingById.get(field.id);
      if (existingName) {
        return { field, dbFieldName: existingName };
      }

      const baseName = convertNameToValidCharacter(field.name, 40);
      const dbFieldName = this.ensureUniqueDbFieldName(baseName, reservedNames);
      reservedNames.add(dbFieldName);
      return { field, dbFieldName };
    });
  }

  private ensureUniqueDbFieldName(baseName: string, reservedNames: Set<string>): string {
    if (!reservedNames.has(baseName)) return baseName;

    let candidate = baseName;
    let attempts = 0;
    while (reservedNames.has(candidate)) {
      candidate = `${baseName}${Date.now()}`;
      attempts += 1;
      if (attempts > 5 && reservedNames.has(candidate)) {
        candidate = `${baseName}${Date.now()}${getRandomString(4)}`;
      }
    }

    return candidate;
  }

  private async loadReservedColumnNames(
    trx: Kysely<V1TeableDatabase>,
    dbTableName: string
  ): Promise<Set<string>> {
    const { schema, table } = splitDbTableName(dbTableName);
    const columnsResult = await sql<{ name: string }>`
      select column_name as name
      from information_schema.columns
      where table_schema = ${schema}
        and table_name = ${table}
    `.execute(trx);

    const reserved = new Set(baseRecordColumnNames);
    for (const column of columnsResult.rows) {
      reserved.add(column.name);
    }
    return reserved;
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
