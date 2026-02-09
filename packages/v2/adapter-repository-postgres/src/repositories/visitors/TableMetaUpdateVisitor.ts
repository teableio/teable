import {
  AbstractSpecFilterVisitor,
  TableAddFieldSpec,
  TableAddSelectOptionsSpec,
  TableDuplicateFieldSpec,
  TableRemoveFieldSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIdsSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  TableRenameSpec,
  TableUpdateViewColumnMetaSpec,
  type ITableMapper,
  type ITableSpecVisitor,
  type Table,
  domainError,
  type DomainError,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type {
  InsertQueryBuilder,
  InsertResult,
  Kysely,
  UpdateQueryBuilder,
  UpdateResult,
} from 'kysely';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableFieldPersistenceBuilder } from '../TableFieldPersistenceBuilder';
import type { ITableMetaWhere } from './TableWhereVisitor';

export type TableUpdateBuilder =
  | UpdateQueryBuilder<V1TeableDatabase, 'table_meta', 'table_meta', UpdateResult>
  | UpdateQueryBuilder<V1TeableDatabase, 'view', 'view', UpdateResult>
  | UpdateQueryBuilder<V1TeableDatabase, 'field', 'field', UpdateResult>
  | InsertQueryBuilder<V1TeableDatabase, 'field', InsertResult>;

type TableMetaUpdateVisitorParams = {
  db: Kysely<V1TeableDatabase>;
  table: Table;
  tableMapper: ITableMapper;
  actorId: string;
  now: Date;
  where: ITableMetaWhere;
};

type TableMetaUpdate = {
  name?: string;
};

export class TableMetaUpdateVisitor
  extends AbstractSpecFilterVisitor<ReadonlyArray<TableUpdateBuilder>>
  implements ITableSpecVisitor<ReadonlyArray<TableUpdateBuilder>>
{
  private readonly fieldRowBuilder: TableFieldPersistenceBuilder;

  constructor(private readonly params: TableMetaUpdateVisitorParams) {
    super();
    this.fieldRowBuilder = new TableFieldPersistenceBuilder({
      table: params.table,
      tableMapper: params.tableMapper,
      now: params.now,
      actorId: params.actorId,
    });
  }

  visitTableByBaseId(_: TableByBaseIdSpec): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return err(
      domainError.validation({ message: 'TableByBaseIdSpec is not supported for table updates' })
    );
  }

  visitTableAddField(
    spec: TableAddFieldSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const fieldRowResult = this.fieldRowBuilder.buildRowForField(spec.field());
    if (fieldRowResult.isErr()) return err(fieldRowResult.error);

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db.insertInto('field').values(fieldRowResult.value),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableAddSelectOptions(
    spec: TableAddSelectOptionsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const fieldResult = this.params.table.getField((field) => field.id().equals(spec.fieldId()));
    if (fieldResult.isErr()) return err(fieldResult.error);
    const rowResult = this.fieldRowBuilder.buildRowForField(fieldResult.value);
    if (rowResult.isErr()) return err(rowResult.error);

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          options: rowResult.value.options,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', spec.fieldId().toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableDuplicateField(
    spec: TableDuplicateFieldSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    // For duplicate field, we insert the new field row just like addField
    const fieldRowResult = this.fieldRowBuilder.buildRowForField(spec.newField());
    if (fieldRowResult.isErr()) return err(fieldRowResult.error);

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db.insertInto('field').values(fieldRowResult.value),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableRemoveField(
    spec: TableRemoveFieldSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const fieldId = spec.field().id().toString();
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          deleted_time: this.params.now,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', fieldId)
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateViewColumnMeta(
    spec: TableUpdateViewColumnMetaSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const updates = spec.updates();
    const statements: ReadonlyArray<TableUpdateBuilder> = updates.map((update) =>
      this.params.db
        .updateTable('view')
        .set({
          column_meta: JSON.stringify(update.columnMeta.toDto()),
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', update.viewId.toString())
        .where('deleted_time', 'is', null)
    );

    return this.addCond(statements).map(() => statements);
  }

  visitTableRename(spec: TableRenameSpec): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.buildTableMetaUpdate({ name: spec.nextName().toString() }),
    ];
    return this.addCond(statements).map(() => statements);
  }

  visitTableById(_: TableByIdSpec): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return err(
      domainError.validation({ message: 'TableByIdSpec is not supported for table updates' })
    );
  }

  visitTableByIds(_: TableByIdsSpec): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return err(
      domainError.validation({ message: 'TableByIdsSpec is not supported for table updates' })
    );
  }

  visitTableByName(spec: TableByNameSpec): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.buildTableMetaUpdate({ name: spec.tableName().toString() }),
    ];
    return this.addCond(statements).map(() => statements);
  }

  visitTableByNameLike(
    _: TableByNameLikeSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return err(
      domainError.validation({ message: 'TableByNameLikeSpec is not supported for table updates' })
    );
  }

  clone(): this {
    return new TableMetaUpdateVisitor(this.params) as this;
  }

  and(
    left: ReadonlyArray<TableUpdateBuilder>,
    right: ReadonlyArray<TableUpdateBuilder>
  ): ReadonlyArray<TableUpdateBuilder> {
    return [...left, ...right];
  }

  or(
    left: ReadonlyArray<TableUpdateBuilder>,
    right: ReadonlyArray<TableUpdateBuilder>
  ): ReadonlyArray<TableUpdateBuilder> {
    return [...left, ...right];
  }

  not(inner: ReadonlyArray<TableUpdateBuilder>): ReadonlyArray<TableUpdateBuilder> {
    return [...inner];
  }

  private buildTableMetaUpdate(
    updates: Partial<TableMetaUpdate>
  ): UpdateQueryBuilder<V1TeableDatabase, 'table_meta', 'table_meta', UpdateResult> {
    const { db, now, actorId, where } = this.params;

    return db
      .updateTable('table_meta')
      .set({
        ...updates,
        last_modified_time: now,
        last_modified_by: actorId,
      })
      .where((eb) => where(eb));
  }
}
