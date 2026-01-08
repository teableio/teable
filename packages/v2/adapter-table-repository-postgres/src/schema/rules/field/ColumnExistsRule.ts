import {
  checkFieldNotNullValidationEnabled,
  checkFieldUniqueValidationEnabled,
  type DomainError,
  type Field,
} from '@teable/v2-core';
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
import { ColumnUniqueConstraintRule } from './ColumnUniqueConstraintRule';
import { NotNullConstraintRule } from './NotNullConstraintRule';

/**
 * Schema rule for creating/dropping a physical column for a field.
 * This is the fundamental rule that most other rules depend on.
 *
 * This rule ONLY checks column existence - NOT NULL and UNIQUE constraints
 * are handled by separate child rules created via createNotNullRule/createUniqueRule.
 */
export class ColumnExistsRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;

  constructor(private readonly field: Field) {
    this.id = `column:${field.id().toString()}`;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const fieldName = this.field.name().toString();
    const dataTypeResult = resolveColumnType(this.field);
    const dataType = dataTypeResult.isOk() ? String(dataTypeResult.value) : 'text';
    return `Physical column "${fieldName}" (${dataType})`;
  }

  /**
   * Check if this field should have a NOT NULL constraint.
   */
  shouldHaveNotNull(): boolean {
    const fieldType = this.field.type().toString();
    const isComputed = this.field.computed().toBoolean();
    const notNullEnabled = checkFieldNotNullValidationEnabled(fieldType, { isComputed });
    return notNullEnabled && this.field.notNull().toBoolean();
  }

  /**
   * Check if this field should have a UNIQUE constraint.
   */
  shouldHaveUnique(): boolean {
    const fieldType = this.field.type().toString();
    const isComputed = this.field.computed().toBoolean();
    const uniqueEnabled = checkFieldUniqueValidationEnabled(fieldType, { isComputed });
    return uniqueEnabled && this.field.unique().toBoolean();
  }

  /**
   * Create a NOT NULL constraint rule that depends on this column rule.
   */
  createNotNullRule(): NotNullConstraintRule {
    return new NotNullConstraintRule(this.field, this);
  }

  /**
   * Create a UNIQUE constraint rule that depends on this column rule.
   */
  createUniqueRule(): ColumnUniqueConstraintRule {
    return new ColumnUniqueConstraintRule(this.field, this);
  }

  /**
   * Create all rules for this column (column + constraints based on field config).
   */
  static createRulesFromField(field: Field): ISchemaRule[] {
    const columnRule = new ColumnExistsRule(field);
    const rules: ISchemaRule[] = [columnRule];

    if (columnRule.shouldHaveNotNull()) {
      rules.push(columnRule.createNotNullRule());
    }

    if (columnRule.shouldHaveUnique()) {
      rules.push(columnRule.createUniqueRule());
    }

    return rules;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const schemaName = ctx.schema ?? 'public';

      // Check if column exists
      const existsResult = await ctx.introspector.columnExists(
        ctx.schema,
        ctx.tableName,
        columnName
      );
      const exists = yield* existsResult;

      if (!exists) {
        return ok({
          valid: false,
          missing: [`column "${schemaName}"."${ctx.tableName}"."${columnName}" not found`],
        });
      }

      return ok({ valid: true });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const dataType = yield* resolveColumnType(ctx.field);

      const schemaBuilder = ctx.schema ? ctx.db.schema.withSchema(ctx.schema) : ctx.db.schema;

      // Create column without constraints - constraints are added by separate rules
      const statement = schemaBuilder
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
