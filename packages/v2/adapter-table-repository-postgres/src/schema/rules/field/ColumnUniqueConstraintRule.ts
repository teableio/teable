import type { DomainError, Field } from '@teable/v2-core';
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
  dropConstraintStatement,
  dropIndexStatement,
  type TableIdentifier,
} from '../helpers/StatementBuilders';

/**
 * Schema rule for adding/removing UNIQUE constraint on a column.
 * Depends on the column existing first (ColumnExistsRule).
 *
 * This creates a unique index (not a constraint) for better performance
 * and to match PostgreSQL best practices.
 *
 * This rule should be created via ColumnExistsRule.createUniqueRule()
 * to ensure proper dependency wiring.
 */
export class ColumnUniqueConstraintRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = false;

  constructor(
    private readonly field: Field,
    parent: ISchemaRule
  ) {
    this.id = `column_unique:${field.id().toString()}`;
    this.dependencies = [parent.id];
    this.description = `UNIQUE constraint on "${field.name().toString()}"`;
  }

  private getIndexName(tableName: string, columnName: string): string {
    return `${tableName}_${columnName}_unique`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const self = this;

    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const schemaName = ctx.schema ?? 'public';
      const indexName = self.getIndexName(ctx.tableName, columnName);
      const fieldName = self.field.name().toString();

      // Check for unique index
      const indexResult = await ctx.introspector.getIndex(ctx.schema, indexName);
      const index = yield* indexResult;

      if (!index) {
        // Also check for constraint with same pattern
        const constraintResult = await ctx.introspector.constraintExists(
          ctx.schema,
          ctx.tableName,
          indexName
        );
        const hasConstraint = yield* constraintResult;

        if (!hasConstraint) {
          return ok({
            valid: false,
            missing: [
              `column "${schemaName}"."${ctx.tableName}"."${columnName}" should have UNIQUE constraint`,
            ],
            missingItems: [
              {
                code: 'column_unique_missing',
                message: {
                  key: 'table:table.integrity.v2.detail.columnUniqueMissing',
                  values: {
                    fieldName,
                  },
                  fallback: `Field "${fieldName}" should be unique.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.columnUniqueMissingDescription',
                  values: {
                    fieldName,
                  },
                  fallback:
                    'A unique index is missing, so duplicate values can be written for this field.',
                },
              },
            ],
          });
        }
      } else if (!index.isUnique) {
        return ok({
          valid: false,
          missing: [`index "${indexName}" exists but is not unique`],
          missingItems: [
            {
              code: 'column_unique_not_unique',
              message: {
                key: 'table:table.integrity.v2.detail.columnUniqueIndexMismatch',
                values: {
                  fieldName,
                },
                fallback: `Field "${fieldName}" is indexed, but the index is not unique.`,
              },
              description: {
                key: 'table:table.integrity.v2.detail.columnUniqueIndexMismatchDescription',
                values: {
                  fieldName,
                },
                fallback:
                  'This field expects uniqueness, but the current database index still allows duplicates.',
              },
            },
          ],
        });
      }

      return ok({ valid: true });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const self = this;

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const indexName = self.getIndexName(ctx.tableName, columnName);

      const schemaBuilder = ctx.schema ? ctx.db.schema.withSchema(ctx.schema) : ctx.db.schema;

      // Create unique index
      const statement = schemaBuilder
        .createIndex(indexName)
        .on(ctx.tableName)
        .column(columnName)
        .unique()
        .ifNotExists();

      return ok([statement]);
    });
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const self = this;

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const uniqueName = self.getIndexName(ctx.tableName, columnName);
      const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };

      // Same-type field updates currently add UNIQUE via ALTER TABLE ... ADD CONSTRAINT,
      // while field creation uses CREATE UNIQUE INDEX. Delete must tolerate both forms.
      return ok([
        dropConstraintStatement(table, uniqueName),
        dropIndexStatement(table, uniqueName),
      ]);
    });
  }
}
