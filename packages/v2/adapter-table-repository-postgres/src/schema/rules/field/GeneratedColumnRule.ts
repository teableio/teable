import type { DomainError, Field } from '@teable/v2-core';
import { sql } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolveColumnName } from '../../visitors/PostgresTableSchemaFieldColumn';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import {
  addGeneratedColumnStatement,
  dropColumnStatement,
  type TableIdentifier,
} from '../helpers/StatementBuilders';

/**
 * Schema rule for creating/dropping a GENERATED ALWAYS AS column.
 * Used for CreatedTime, LastModifiedTime (when tracking all), CreatedBy, LastModifiedBy, AutoNumber.
 *
 * Generated columns are automatically computed from a source column.
 */
export class GeneratedColumnRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;

  /**
   * @param field - The field this generated column is for
   * @param sourceColumn - The source column to generate from (e.g., '__created_time')
   * @param columnType - The PostgreSQL column type (e.g., 'timestamptz', 'text', 'double precision')
   */
  constructor(
    private readonly field: Field,
    private readonly sourceColumn: string,
    private readonly columnType: string
  ) {
    this.id = `generated_column:${field.id().toString()}`;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.field.name().toString();
    return `Generated column "${name}" computed from ${this.sourceColumn} (${this.columnType})`;
  }

  /**
   * Creates a GeneratedColumnRule for CreatedTime.
   */
  static forCreatedTime(field: Field): GeneratedColumnRule {
    return new GeneratedColumnRule(field, '__created_time', 'timestamptz');
  }

  /**
   * Creates a GeneratedColumnRule for LastModifiedTime (when tracking all).
   */
  static forLastModifiedTime(field: Field): GeneratedColumnRule {
    return new GeneratedColumnRule(field, '__last_modified_time', 'timestamptz');
  }

  /**
   * Creates a GeneratedColumnRule for CreatedBy.
   */
  static forCreatedBy(field: Field): GeneratedColumnRule {
    return new GeneratedColumnRule(field, '__created_by', 'text');
  }

  /**
   * Creates a GeneratedColumnRule for LastModifiedBy (when tracking all).
   */
  static forLastModifiedBy(field: Field): GeneratedColumnRule {
    return new GeneratedColumnRule(field, '__last_modified_by', 'text');
  }

  /**
   * Creates a GeneratedColumnRule for AutoNumber.
   */
  static forAutoNumber(field: Field): GeneratedColumnRule {
    return new GeneratedColumnRule(field, '__auto_number', 'double precision');
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const columnResult = await ctx.introspector.getColumn(ctx.schema, ctx.tableName, columnName);
      const column = yield* columnResult;

      if (!column) {
        return ok({
          valid: false,
          missing: [`generated column ${columnName}`],
        });
      }

      if (!column.isGenerated) {
        return ok({
          valid: false,
          missing: [`column ${columnName} exists but is not a GENERATED column`],
        });
      }

      return ok({ valid: true });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const sourceColumn = this.sourceColumn;
    const columnType = this.columnType;

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const definition = sql`${sql.raw(columnType)} generated always as (${sql.ref(sourceColumn)}) stored`;
      const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };
      // If the column exists but is not generated, Postgres can't "ALTER" it into a generated column.
      // Drop+recreate is safe because generated columns are always derived from source columns.
      const dropExisting = dropColumnStatement(table, columnName);
      const statement = addGeneratedColumnStatement(table, columnName, definition);

      return ok([dropExisting, statement]);
    });
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };
      return ok([dropColumnStatement(table, columnName)]);
    });
  }
}
