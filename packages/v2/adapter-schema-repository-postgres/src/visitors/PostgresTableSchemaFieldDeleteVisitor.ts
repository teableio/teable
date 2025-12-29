import {
  type AttachmentField,
  type ButtonField,
  type CheckboxField,
  type DateField,
  type Field,
  type FormulaField,
  type IFieldVisitor,
  type LinkField,
  type LongTextField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
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
export class PostgresTableSchemaFieldDeleteVisitor
  implements IFieldVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
{
  constructor(private readonly params: PostgresTableSchemaFieldDeleteVisitorParams) {}

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
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitLongTextField(
    field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitNumberField(field: NumberField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitRatingField(field: RatingField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitFormulaField(
    field: FormulaField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitRollupField(field: RollupField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitCheckboxField(
    field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitAttachmentField(
    field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitDateField(field: DateField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitUserField(field: UserField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitButtonField(field: ButtonField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    return this.dropStandardField(field);
  }

  visitLinkField(field: LinkField): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const visitor = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, string>(function* () {
      const valueColumnName = yield* resolveColumnName(field);
      const statements: TableSchemaStatementBuilder[] = [
        dropColumnStatement(visitor.currentTable(), valueColumnName),
      ];

      const relationship = field.relationship().toString();
      const fkHostTable = yield* visitor.resolveFkHostTable(field);

      if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
        statements.push(dropTableStatement(fkHostTable));
      } else {
        const keyName =
          relationship === 'oneMany'
            ? yield* field.selfKeyNameString()
            : yield* field.foreignKeyNameString();
        statements.push(...visitor.dropColumns(fkHostTable, [keyName]));
        const orderColumnName = yield* field.orderColumnName();
        statements.push(...visitor.dropColumns(fkHostTable, [orderColumnName]));
      }

      statements.push(deleteReferenceStatement(visitor.params.db, field.id().toString()));
      return ok(statements);
    });
  }

  private dropStandardField(
    field: Field
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, string> {
    const visitor = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, string>(function* () {
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
  ): Result<{ schema: string | null; tableName: string }, string> {
    return field.fkHostTableName().split({ defaultSchema: this.params.schema });
  }

  private currentTable(): TableIdentifier {
    return { schema: this.params.schema, tableName: this.params.tableName };
  }
}
