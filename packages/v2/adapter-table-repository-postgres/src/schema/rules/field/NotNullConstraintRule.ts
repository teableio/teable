import { domainError, type DomainError, type Field } from '@teable/v2-core';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolveColumnName } from '../../visitors/PostgresTableSchemaFieldColumn';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleRepairHint,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import { dataStatement, quoteIdentifier, quoteTableIdentifier } from '../helpers/StatementBuilders';

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
    const self = this;

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
        const nullCount = yield* await self.countNullValues(ctx, columnName);
        const fieldName = self.field.name().toString();

        if (nullCount > 0) {
          return ok({
            valid: false,
            missing: [
              `column "${schemaName}"."${ctx.tableName}"."${columnName}" has ${nullCount} NULL values and cannot be made NOT NULL yet`,
            ],
            missingItems: [
              {
                code: 'not_null_existing_nulls',
                message: {
                  key: 'table:table.integrity.v2.detail.notNullExistingNulls',
                  values: {
                    fieldName,
                    count: nullCount,
                  },
                  fallback: `Field "${fieldName}" has ${nullCount} empty rows, so NOT NULL cannot be restored automatically.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.notNullExistingNullsDescription',
                  values: {
                    fieldName,
                    count: nullCount,
                  },
                  fallback:
                    'Fill or clear those rows in Base design first, then rerun repair to restore the NOT NULL constraint.',
                },
              },
            ],
          });
        }

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

  getRepairHint(
    _ctx: SchemaRuleContext,
    validation: SchemaRuleValidationResult
  ): Result<SchemaRuleRepairHint | undefined, DomainError> {
    const hasExistingNulls = validation.missingItems?.some(
      (item) => item.code === 'not_null_existing_nulls'
    );

    if (!hasExistingNulls) {
      return ok(undefined);
    }

    const fieldName = this.field.name().toString();
    const nullItem = validation.missingItems?.find(
      (item) => item.code === 'not_null_existing_nulls'
    );
    const count =
      typeof nullItem?.message.values?.count === 'number' ? nullItem.message.values.count : 0;

    return ok({
      available: false,
      mode: 'auto',
      reason: {
        key: 'table:table.integrity.v2.repairMeta.reason.notNullExistingNulls',
        values: {
          fieldName,
          count,
        },
        fallback: `Automatic repair is unavailable because "${fieldName}" still has empty values.`,
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.description.notNullExistingNulls',
        values: {
          fieldName,
          count,
        },
        fallback:
          'This required-field constraint needs a user data decision. Fill the empty rows or relax the required setting, then rerun repair.',
      },
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

      return ok([dataStatement(statement)]);
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

      return ok([dataStatement(statement)]);
    });
  }

  private async countNullValues(
    ctx: SchemaRuleContext,
    columnName: string
  ): Promise<Result<number, DomainError>> {
    try {
      const tableRef = quoteTableIdentifier({ schema: ctx.schema, tableName: ctx.tableName });
      const columnRef = quoteIdentifier(columnName);
      const result = await sql
        .raw<{
          count: number | string | bigint | null;
        }>(`SELECT COUNT(*)::int AS count FROM ${tableRef} WHERE ${columnRef} IS NULL`)
        .execute(ctx.db);

      return ok(Number(result.rows[0]?.count ?? 0));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to check NOT NULL values: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.validation_failed',
          details: {
            fieldId: this.field.id().toString(),
            fieldName: this.field.name().toString(),
            columnName,
            tableName: ctx.tableName,
          },
        })
      );
    }
  }
}
