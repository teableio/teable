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

/**
 * Schema rule for adding/removing NOT NULL constraint on a column.
 * Depends on the column existing first (ColumnExistsRule).
 *
 * This rule should be created via ColumnExistsRule.createNotNullRule()
 * to ensure proper dependency wiring.
 */
export class NotNullConstraintRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = false;

  constructor(
    private readonly field: Field,
    parent: ISchemaRule
  ) {
    this.id = `not_null:${field.id().toString()}`;
    this.dependencies = [parent.id];
    this.description = `NOT NULL constraint on "${field.name().toString()}"`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const schemaName = ctx.schema ?? 'public';

      // Get column info to check nullability
      const columnInfoResult = await ctx.introspector.getColumn(
        ctx.schema,
        ctx.tableName,
        columnName
      );
      const columnInfo = yield* columnInfoResult;

      // If column doesn't exist, this rule is invalid (dependency failed)
      if (!columnInfo) {
        return ok({
          valid: false,
          missing: [
            `cannot check NOT NULL: column "${schemaName}"."${ctx.tableName}"."${columnName}" not found`,
          ],
        });
      }

      // Check if NOT NULL is set
      if (columnInfo.isNullable) {
        return ok({
          valid: false,
          missing: [
            `column "${schemaName}"."${ctx.tableName}"."${columnName}" should be NOT NULL but allows NULL`,
          ],
        });
      }

      return ok({ valid: true });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const schemaName = ctx.schema ?? 'public';

      // ALTER TABLE schema.table ALTER COLUMN column SET NOT NULL
      const statement = sql.raw(
        `ALTER TABLE "${schemaName}"."${ctx.tableName}" ALTER COLUMN "${columnName}" SET NOT NULL`
      );

      return ok([statement]);
    });
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const schemaName = ctx.schema ?? 'public';

      // ALTER TABLE schema.table ALTER COLUMN column DROP NOT NULL
      const statement = sql.raw(
        `ALTER TABLE "${schemaName}"."${ctx.tableName}" ALTER COLUMN "${columnName}" DROP NOT NULL`
      );

      return ok([statement]);
    });
  }
}
