import {
  AbstractSpecFilterVisitor,
  TableAddFieldSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  TableUpdateViewColumnMetaSpec,
  type ITableSpecVisitor,
} from '@teable/v2-core';
import type { Kysely } from 'kysely';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  PostgresTableFieldCreateVisitor,
  type TableSchemaStatementBuilder,
} from './PostgresTableFieldCreateVisitor';

type TableSchemaUpdateVisitorParams = {
  db: Kysely<unknown>;
  schema: string | null;
  tableName: string;
};

export class TableSchemaUpdateVisitor
  extends AbstractSpecFilterVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
  implements ITableSpecVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
{
  constructor(private readonly params: TableSchemaUpdateVisitorParams) {
    super();
  }

  visitTableAddField(
    spec: TableAddFieldSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const fieldVisitor = PostgresTableFieldCreateVisitor.forSchemaUpdate(this.params);
    const statementsResult = spec.field().accept(fieldVisitor);
    if (statementsResult.isErr()) return err(statementsResult.error);
    const statements = statementsResult.value;
    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateViewColumnMeta(
    _: TableUpdateViewColumnMetaSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableByBaseId(
    _: TableByBaseIdSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return err('TableByBaseIdSpec is not supported for table schema updates');
  }

  visitTableById(_: TableByIdSpec): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return err('TableByIdSpec is not supported for table schema updates');
  }

  visitTableByName(_: TableByNameSpec): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableByNameLike(
    _: TableByNameLikeSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return err('TableByNameLikeSpec is not supported for table schema updates');
  }

  clone(): this {
    return new TableSchemaUpdateVisitor(this.params) as this;
  }

  and(
    left: ReadonlyArray<TableSchemaStatementBuilder>,
    right: ReadonlyArray<TableSchemaStatementBuilder>
  ): ReadonlyArray<TableSchemaStatementBuilder> {
    return [...left, ...right];
  }

  or(
    left: ReadonlyArray<TableSchemaStatementBuilder>,
    right: ReadonlyArray<TableSchemaStatementBuilder>
  ): ReadonlyArray<TableSchemaStatementBuilder> {
    return [...left, ...right];
  }

  not(
    inner: ReadonlyArray<TableSchemaStatementBuilder>
  ): ReadonlyArray<TableSchemaStatementBuilder> {
    return [...inner];
  }
}
