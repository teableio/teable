import { AbstractSpecFilterVisitor, domainError } from '@teable/v2-core';
import type {
  TableAddFieldSpec,
  TableAddSelectOptionsSpec,
  TableDuplicateFieldSpec,
  TableRemoveFieldSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIdsSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  TableUpdateViewColumnMetaSpec,
  ITableSpecVisitor,
  DomainError,
  TableRenameSpec,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { FieldValueDuplicateVisitor } from './FieldValueDuplicateVisitor';
import type { TableSchemaStatementBuilder } from './PostgresTableSchemaFieldCreateVisitor';
import { PostgresTableSchemaFieldCreateVisitor } from './PostgresTableSchemaFieldCreateVisitor';
import { PostgresTableSchemaFieldDeleteVisitor } from './PostgresTableSchemaFieldDeleteVisitor';

type TableSchemaUpdateVisitorParams = {
  db: Kysely<V1TeableDatabase>;
  schema: string | null;
  tableName: string;
  tableId: string;
};

export class TableSchemaUpdateVisitor
  extends AbstractSpecFilterVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
  implements ITableSpecVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
{
  constructor(private readonly params: TableSchemaUpdateVisitorParams) {
    super();
  }
  visitTableRename(
    _spec: TableRenameSpec
  ): Result<readonly TableSchemaStatementBuilder[], DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableAddField(
    spec: TableAddFieldSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const fieldVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate(this.params);
    const addCond = this.addCond.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const statements = yield* spec.field().accept(fieldVisitor);
      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitTableRemoveField(
    spec: TableRemoveFieldSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const fieldVisitor = PostgresTableSchemaFieldDeleteVisitor.forSchemaUpdate(this.params);
    const addCond = this.addCond.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const statements = yield* spec.field().accept(fieldVisitor);
      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitTableUpdateViewColumnMeta(
    _: TableUpdateViewColumnMetaSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableAddSelectOptions(
    _spec: TableAddSelectOptionsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableDuplicateField(
    spec: TableDuplicateFieldSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const fieldVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate(this.params);
    const addCond = this.addCond.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      // 1. Create the new column schema (like addField)
      const schemaStatements = yield* spec.newField().accept(fieldVisitor);

      // 2. If includeRecordValues, add value duplication statements
      if (spec.includeRecordValues()) {
        const sourceField = spec.sourceField();
        const newField = spec.newField();

        const sourceDbFieldName = yield* sourceField.dbFieldName().andThen((name) => name.value());
        const targetDbFieldName = yield* newField.dbFieldName().andThen((name) => name.value());

        const valueVisitor = FieldValueDuplicateVisitor.create(visitor.params.db, {
          schema: visitor.params.schema,
          tableName: visitor.params.tableName,
          sourceDbFieldName,
          targetDbFieldName,
          newField,
        });
        const valueStatements = yield* sourceField.accept(valueVisitor);
        const valueDuplicationStatements = valueStatements.map((query) => ({
          compile: () => query,
        }));

        const allStatements = [...schemaStatements, ...valueDuplicationStatements];
        yield* addCond(allStatements);
        return ok(allStatements);
      }

      yield* addCond(schemaStatements);
      return ok(schemaStatements);
    });
  }

  visitTableByBaseId(
    _: TableByBaseIdSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return err(
      domainError.validation({
        message: 'TableByBaseIdSpec is not supported for table schema updates',
      })
    );
  }

  visitTableById(
    _: TableByIdSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return err(
      domainError.validation({ message: 'TableByIdSpec is not supported for table schema updates' })
    );
  }

  visitTableByIds(
    _: TableByIdsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return err(
      domainError.validation({
        message: 'TableByIdsSpec is not supported for table schema updates',
      })
    );
  }

  visitTableByName(
    _: TableByNameSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableByNameLike(
    _: TableByNameLikeSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return err(
      domainError.validation({
        message: 'TableByNameLikeSpec is not supported for table schema updates',
      })
    );
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
