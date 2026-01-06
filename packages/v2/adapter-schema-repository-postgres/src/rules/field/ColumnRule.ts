import {
  checkFieldNotNullValidationEnabled,
  checkFieldUniqueValidationEnabled,
  type DomainError,
  type Field,
} from '@teable/v2-core';
import type { ColumnDefinitionBuilder } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  resolveColumnName,
  resolveColumnType,
} from '../../visitors/PostgresTableSchemaFieldColumn';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import { dropColumnStatement, type TableIdentifier } from '../helpers/StatementBuilders';

/**
 * Builds column constraints (NOT NULL, UNIQUE) based on field configuration.
 */
const buildColumnConstraints = (
  field: Field
): ((col: ColumnDefinitionBuilder) => ColumnDefinitionBuilder) | undefined => {
  const fieldType = field.type().toString();
  const isComputed = field.computed().toBoolean();
  const notNullEnabled = checkFieldNotNullValidationEnabled(fieldType, { isComputed });
  const uniqueEnabled = checkFieldUniqueValidationEnabled(fieldType, { isComputed });
  const notNull = notNullEnabled && field.notNull().toBoolean();
  const unique = uniqueEnabled && field.unique().toBoolean();

  if (!notNull && !unique) return undefined;
  return (col) => {
    let next = col;
    if (notNull) next = next.notNull();
    if (unique) next = next.unique();
    return next;
  };
};

/**
 * Schema rule for creating/dropping a physical column for a field.
 * This is the fundamental rule that most other rules depend on.
 */
export class ColumnRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;

  constructor(
    fieldId: string,
    private readonly fieldName: string,
    private readonly dataType: string,
    private readonly constraints: { notNull?: boolean; unique?: boolean } = {}
  ) {
    this.id = `column:${fieldId}`;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const constraintParts: string[] = [];
    if (this.constraints.notNull) constraintParts.push('NOT NULL');
    if (this.constraints.unique) constraintParts.push('UNIQUE');

    const constraintStr = constraintParts.length > 0 ? `, ${constraintParts.join(', ')}` : '';
    return `Physical column "${this.fieldName}" (${this.dataType}${constraintStr})`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const field = ctx.field;

    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const columnName = yield* resolveColumnName(field);
      const schemaName = ctx.schema ?? 'public';

      // Get column details
      const columnInfoResult = await ctx.introspector.getColumn(
        ctx.schema,
        ctx.tableName,
        columnName
      );
      const columnInfo = yield* columnInfoResult;

      const missing: string[] = [];

      // Check if column exists
      if (!columnInfo) {
        missing.push(`column "${schemaName}"."${ctx.tableName}"."${columnName}" not found`);
        return ok({ valid: false, missing });
      }

      // Check NOT NULL constraint
      const fieldType = field.type().toString();
      const isComputed = field.computed().toBoolean();
      const notNullEnabled = checkFieldNotNullValidationEnabled(fieldType, { isComputed });
      const expectNotNull = notNullEnabled && field.notNull().toBoolean();

      if (expectNotNull && columnInfo.isNullable) {
        missing.push(
          `column "${schemaName}"."${ctx.tableName}"."${columnName}" should be NOT NULL but allows NULL`
        );
      }

      // Check UNIQUE constraint (via unique index or constraint)
      const uniqueEnabled = checkFieldUniqueValidationEnabled(fieldType, { isComputed });
      const expectUnique = uniqueEnabled && field.unique().toBoolean();

      if (expectUnique) {
        // Check for unique index on this column
        const uniqueIndexName = `${ctx.tableName}_${columnName}_unique`;
        const uniqueIndexResult = await ctx.introspector.indexExists(ctx.schema, uniqueIndexName);
        const hasUniqueIndex = yield* uniqueIndexResult;

        if (!hasUniqueIndex) {
          // Also check for constraint with same pattern
          const constraintResult = await ctx.introspector.constraintExists(
            ctx.schema,
            ctx.tableName,
            uniqueIndexName
          );
          const hasConstraint = yield* constraintResult;

          if (!hasConstraint) {
            missing.push(
              `column "${schemaName}"."${ctx.tableName}"."${columnName}" should have UNIQUE constraint`
            );
          }
        }
      }

      return ok({
        valid: missing.length === 0,
        missing,
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const dataType = yield* resolveColumnType(ctx.field);
      const constraints = buildColumnConstraints(ctx.field);

      const schemaBuilder = ctx.schema ? ctx.db.schema.withSchema(ctx.schema) : ctx.db.schema;

      const statement = constraints
        ? schemaBuilder
            .alterTable(ctx.tableName)
            .addColumn(columnName, dataType, (col) => constraints(col).ifNotExists())
        : schemaBuilder
            .alterTable(ctx.tableName)
            .addColumn(columnName, dataType, (col) => col.ifNotExists());

      return ok([statement]);
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
