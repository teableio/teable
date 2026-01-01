import {
  AbstractFieldVisitor,
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type Field,
  type FormulaField,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type LookupField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
  type DomainError,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolveColumnName } from './PostgresTableSchemaFieldColumn';
import type { TableSchemaStatementBuilder } from './PostgresTableSchemaFieldCreateVisitor';

type PostgresTableSchemaFieldDeleteVisitorParams = {
  db: Kysely<V1TeableDatabase>;
  schema: string | null;
  tableName: string;
  tableId: string;
};

type TableIdentifier = {
  schema: string | null;
  tableName: string;
};

const buildTableIdentifier = (target: TableIdentifier) => {
  if (!target.schema) return sql.ref(target.tableName);
  return sql`${sql.ref(target.schema)}.${sql.ref(target.tableName)}`;
};

const dropColumnStatement = (
  target: TableIdentifier,
  columnName: string
): TableSchemaStatementBuilder =>
  sql`alter table ${buildTableIdentifier(target)} drop column if exists ${sql.ref(columnName)} cascade`;

const dropTableStatement = (target: TableIdentifier): TableSchemaStatementBuilder =>
  sql`drop table if exists ${buildTableIdentifier(target)} cascade`;

const dropIndexStatement = (
  target: TableIdentifier,
  indexName: string
): TableSchemaStatementBuilder => {
  if (!target.schema) {
    return sql`drop index if exists ${sql.ref(indexName)}`;
  }
  return sql`drop index if exists ${sql.ref(target.schema)}.${sql.ref(indexName)}`;
};

const deleteReferenceStatement = (
  db: Kysely<V1TeableDatabase>,
  fieldId: string
): TableSchemaStatementBuilder =>
  db
    .deleteFrom('reference')
    .where((eb) =>
      eb.or([eb.eb('to_field_id', '=', fieldId), eb.eb('from_field_id', '=', fieldId)])
    );

// Owns field-level column deletion and reference cleanup for schema updates.
export class PostgresTableSchemaFieldDeleteVisitor extends AbstractFieldVisitor<
  ReadonlyArray<TableSchemaStatementBuilder>
> {
  constructor(private readonly params: PostgresTableSchemaFieldDeleteVisitorParams) {
    super();
  }

  static forSchemaUpdate(params: {
    db: Kysely<V1TeableDatabase>;
    schema: string | null;
    tableName: string;
    tableId: string;
  }): PostgresTableSchemaFieldDeleteVisitor {
    return new PostgresTableSchemaFieldDeleteVisitor(params);
  }

  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitLongTextField(
    field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitNumberField(
    field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitRatingField(
    field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitFormulaField(
    field: FormulaField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitRollupField(
    field: RollupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitCheckboxField(
    field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitAttachmentField(
    field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitDateField(
    field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitCreatedTimeField(
    field: CreatedTimeField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitUserField(
    field: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitCreatedByField(
    field: CreatedByField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitAutoNumberField(
    field: AutoNumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitButtonField(
    field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.dropStandardField(field);
  }

  visitLinkField(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const valueColumnName = yield* resolveColumnName(field);
      const statements: TableSchemaStatementBuilder[] = [
        dropColumnStatement(visitor.currentTable(), valueColumnName),
      ];

      const relationship = field.relationship().toString();
      const fkHostTable = yield* visitor.resolveFkHostTable(field);

      if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
        // DROP TABLE CASCADE will automatically drop indexes, no need to drop them explicitly
        statements.push(dropTableStatement(fkHostTable));
      } else {
        const keyName =
          relationship === 'oneMany'
            ? yield* field.selfKeyNameString()
            : yield* field.foreignKeyNameString();

        // Drop index first (before dropping the column)
        // Index is on fkHostTable, not currentTable
        const indexName = `index_${keyName}`;
        statements.push(dropIndexStatement(fkHostTable, indexName));

        // Then drop the column and order column from fkHostTable
        statements.push(...visitor.dropColumns(fkHostTable, [keyName]));
        const orderColumnName = yield* field.orderColumnName();
        statements.push(...visitor.dropColumns(fkHostTable, [orderColumnName]));
      }

      statements.push(deleteReferenceStatement(visitor.params.db, field.id().toString()));
      return ok(statements);
    });
  }

  override visitLookupField(
    field: LookupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Lookup fields are standard computed fields, drop like formula/rollup
    return this.dropStandardField(field);
  }

  private dropStandardField(
    field: Field
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(field);
      const statements: TableSchemaStatementBuilder[] = [
        dropColumnStatement(visitor.currentTable(), columnName),
        deleteReferenceStatement(visitor.params.db, field.id().toString()),
      ];
      return ok(statements);
    });
  }

  private dropColumns(
    target: TableIdentifier,
    columns: ReadonlyArray<string>
  ): ReadonlyArray<TableSchemaStatementBuilder> {
    return columns.map((column) => dropColumnStatement(target, column));
  }

  private resolveFkHostTable(
    field: LinkField
  ): Result<{ schema: string | null; tableName: string }, DomainError> {
    return field.fkHostTableName().split({ defaultSchema: this.params.schema });
  }

  private currentTable(): TableIdentifier {
    return { schema: this.params.schema, tableName: this.params.tableName };
  }
}
