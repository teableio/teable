import { domainError, type DomainError, type Field } from '@teable/v2-core';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { resolveColumnName } from '../../visitors/PostgresTableSchemaFieldColumn';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleI18nValue,
  SchemaRuleManualRepairOptions,
  SchemaRuleManualRepairValues,
  SchemaRuleRepairHint,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import {
  serializeManualRepairSchema,
  withManualRepairFieldMeta,
  withManualRepairFormMeta,
} from '../core/ManualRepairSchema';
import {
  dataStatement,
  dropConstraintStatement,
  dropIndexStatement,
  quoteIdentifier,
  quoteTableIdentifier,
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

  private readonly textDuplicateManualRepairSchema = withManualRepairFormMeta(
    z.object({
      resolution: withManualRepairFieldMeta(z.enum(['append_record_id_to_duplicates']), {
        widget: 'select',
        title: {
          key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.resolutionLabel',
          fallback: 'Repair strategy',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.resolutionDescription',
          fallback:
            'The field is marked unique, but duplicate values already exist. Confirm how to make the duplicate rows unique before creating the unique index.',
        },
        options: {
          append_record_id_to_duplicates: {
            value: 'append_record_id_to_duplicates',
            label: {
              key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.option.appendRecordId',
              fallback: 'Append record ID to duplicate values',
            },
            description: {
              key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.option.appendRecordIdDescription',
              fallback:
                'Keeps the first row unchanged and appends the record ID to the duplicate rows so every value becomes unique.',
            },
          },
        },
      }).default('append_record_id_to_duplicates'),
    }),
    {
      title: {
        key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.title',
        fallback: 'Resolve duplicate values',
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.description',
        fallback:
          'A unique index cannot be created while duplicate values exist. This repair changes duplicate values first, then creates the unique index.',
      },
      submitLabel: {
        key: 'table:table.integrity.v2.repairMeta.manual.apply',
        fallback: 'Apply manual repair',
      },
    }
  );

  private readonly nullableDuplicateManualRepairSchema = withManualRepairFormMeta(
    z.object({
      resolution: withManualRepairFieldMeta(z.enum(['clear_duplicate_values']), {
        widget: 'select',
        title: {
          key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.resolutionLabel',
          fallback: 'Repair strategy',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.resolutionDescription',
          fallback:
            'The field is marked unique, but duplicate values already exist. Confirm how to make the duplicate rows unique before creating the unique index.',
        },
        options: {
          clear_duplicate_values: {
            value: 'clear_duplicate_values',
            label: {
              key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.option.clearDuplicates',
              fallback: 'Clear duplicate values except the first row',
            },
            description: {
              key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.option.clearDuplicatesDescription',
              fallback:
                'Keeps the first row unchanged and clears duplicate rows. PostgreSQL unique indexes allow multiple empty values.',
            },
          },
        },
      }).default('clear_duplicate_values'),
    }),
    {
      title: {
        key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.title',
        fallback: 'Resolve duplicate values',
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.manual.columnUnique.description',
        fallback:
          'A unique index cannot be created while duplicate values exist. This repair changes duplicate values first, then creates the unique index.',
      },
      submitLabel: {
        key: 'table:table.integrity.v2.repairMeta.manual.apply',
        fallback: 'Apply manual repair',
      },
    }
  );

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
      const duplicateSummary = yield* await self.countDuplicateValues(ctx, columnName);

      // Check for unique index
      const indexResult = await ctx.introspector.getIndex(ctx.schema, indexName);
      const index = yield* indexResult;

      if (!index) {
        if (duplicateSummary.duplicateRows > 0) {
          return ok({
            valid: false,
            missing: [
              `column "${schemaName}"."${ctx.tableName}"."${columnName}" has duplicate values and cannot have UNIQUE constraint yet`,
            ],
            missingItems: [
              {
                code: 'column_unique_duplicate_values',
                message: {
                  key: 'table:table.integrity.v2.detail.columnUniqueDuplicateValues',
                  values: {
                    fieldName,
                    duplicateGroups: duplicateSummary.duplicateGroups,
                    duplicateRows: duplicateSummary.duplicateRows,
                  },
                  fallback: `Field "${fieldName}" has duplicate values, so a unique index cannot be created.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.columnUniqueDuplicateValuesDescription',
                  values: {
                    fieldName,
                    duplicateGroups: duplicateSummary.duplicateGroups,
                    duplicateRows: duplicateSummary.duplicateRows,
                  },
                  fallback:
                    'Resolve the duplicate values first, then rerun repair to create the unique index.',
                },
              },
            ],
          });
        }

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

  getRepairHint(
    _ctx: SchemaRuleContext,
    validation: SchemaRuleValidationResult
  ): Result<SchemaRuleRepairHint | undefined, DomainError> {
    const duplicateValuesDetected = validation.missingItems?.some(
      (item) => item.code === 'column_unique_duplicate_values'
    );

    if (!duplicateValuesDetected) {
      return ok(undefined);
    }

    const fieldName = this.field.name().toString();
    const duplicateItem = validation.missingItems?.find(
      (item) => item.code === 'column_unique_duplicate_values'
    );
    const values: Readonly<Record<string, SchemaRuleI18nValue>> = {
      fieldName,
      duplicateGroups:
        typeof duplicateItem?.message.values?.duplicateGroups === 'number'
          ? duplicateItem.message.values.duplicateGroups
          : 0,
      duplicateRows:
        typeof duplicateItem?.message.values?.duplicateRows === 'number'
          ? duplicateItem.message.values.duplicateRows
          : 0,
    };

    const schema =
      this.isTextLikeField() || !this.field.notNull().toBoolean()
        ? this.isTextLikeField()
          ? this.textDuplicateManualRepairSchema
          : this.nullableDuplicateManualRepairSchema
        : undefined;

    if (!schema) {
      return ok({
        available: false,
        mode: 'manual',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.columnUniqueDuplicateValues',
          values,
          fallback: `Field "${fieldName}" has duplicate values and cannot be repaired automatically.`,
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.description.columnUniqueDuplicateValuesUnavailable',
          values,
          fallback:
            'This non-text required field needs the duplicate values to be resolved in Base design before a unique index can be created.',
        },
      });
    }

    const manualRepairSchemaResult = serializeManualRepairSchema(schema);

    return ok({
      available: true,
      mode: 'manual',
      reason: {
        key: 'table:table.integrity.v2.repairMeta.reason.columnUniqueDuplicateValues',
        values,
        fallback: `Field "${fieldName}" has duplicate values and needs confirmation before creating the unique index.`,
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.description.columnUniqueDuplicateValues',
        values,
        fallback:
          'Resolve duplicate values with the selected strategy, then create the unique index.',
      },
      manualRepairSchema: manualRepairSchemaResult.isOk()
        ? manualRepairSchemaResult.value
        : undefined,
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

      return ok([dataStatement(statement)]);
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

  async manualRepair(
    ctx: SchemaRuleContext,
    values: SchemaRuleManualRepairValues | undefined,
    options?: SchemaRuleManualRepairOptions
  ): Promise<Result<void, DomainError>> {
    const defaultResolution = this.isTextLikeField()
      ? 'append_record_id_to_duplicates'
      : 'clear_duplicate_values';
    const resolution =
      typeof values?.resolution === 'string' ? values.resolution : defaultResolution;

    if (
      resolution !== 'append_record_id_to_duplicates' &&
      resolution !== 'clear_duplicate_values'
    ) {
      return err(
        domainError.validation({
          message: 'Unsupported manual repair strategy',
          details: { resolution },
        })
      );
    }

    if (resolution === 'append_record_id_to_duplicates' && !this.isTextLikeField()) {
      return err(
        domainError.validation({
          message: 'Appending record ID is only supported for text fields',
          details: { fieldId: this.field.id().toString(), fieldType: this.field.type().toString() },
        })
      );
    }

    if (resolution === 'clear_duplicate_values' && this.field.notNull().toBoolean()) {
      return err(
        domainError.validation({
          message: 'Cannot clear duplicate values for a required field',
          details: { fieldId: this.field.id().toString() },
        })
      );
    }

    if (options?.dryRun) {
      return ok(undefined);
    }

    const columnNameResult = resolveColumnName(ctx.field);
    if (columnNameResult.isErr()) {
      return err(columnNameResult.error);
    }

    const columnName = columnNameResult.value;

    try {
      await this.rewriteDuplicateValues(ctx, columnName, resolution);

      const statementsResult = this.up(ctx);
      if (statementsResult.isErr()) {
        return err(statementsResult.error);
      }

      for (const statement of statementsResult.value) {
        await ctx.db.executeQuery(statement.compile(ctx.db));
      }

      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to repair duplicate unique values: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.repair_failed',
          details: {
            fieldId: this.field.id().toString(),
            fieldName: this.field.name().toString(),
            resolution,
          },
        })
      );
    }
  }

  private async countDuplicateValues(
    ctx: SchemaRuleContext,
    columnName: string
  ): Promise<Result<{ duplicateGroups: number; duplicateRows: number }, DomainError>> {
    try {
      const tableRef = quoteTableIdentifier({ schema: ctx.schema, tableName: ctx.tableName });
      const columnRef = quoteIdentifier(columnName);
      const result = await sql
        .raw<{
          duplicate_groups: number | string | bigint | null;
          duplicate_rows: number | string | bigint | null;
        }>(
          `
        WITH duplicate_values AS (
          SELECT ${columnRef}, COUNT(*)::int AS row_count
          FROM ${tableRef}
          WHERE ${columnRef} IS NOT NULL
          GROUP BY ${columnRef}
          HAVING COUNT(*) > 1
        )
        SELECT
          COALESCE(COUNT(*), 0)::int AS duplicate_groups,
          COALESCE(SUM(row_count - 1), 0)::int AS duplicate_rows
        FROM duplicate_values
      `
        )
        .execute(ctx.db);

      const row = result.rows[0];
      return ok({
        duplicateGroups: Number(row?.duplicate_groups ?? 0),
        duplicateRows: Number(row?.duplicate_rows ?? 0),
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to check duplicate unique values: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.validation_failed',
          details: {
            fieldId: this.field.id().toString(),
            fieldName: this.field.name().toString(),
          },
        })
      );
    }
  }

  private async rewriteDuplicateValues(
    ctx: SchemaRuleContext,
    columnName: string,
    resolution: 'append_record_id_to_duplicates' | 'clear_duplicate_values'
  ): Promise<void> {
    const tableRef = quoteTableIdentifier({ schema: ctx.schema, tableName: ctx.tableName });
    const columnRef = quoteIdentifier(columnName);
    const assignment =
      resolution === 'append_record_id_to_duplicates'
        ? `${columnRef} = t.${columnRef}::text || ' (' || t."__id" || ')'`
        : `${columnRef} = NULL`;

    await sql
      .raw(
        `
      WITH duplicate_rows AS (
        SELECT
          "__id",
          ROW_NUMBER() OVER (PARTITION BY ${columnRef} ORDER BY "__id") AS rn
        FROM ${tableRef}
        WHERE ${columnRef} IS NOT NULL
      )
      UPDATE ${tableRef} AS t
      SET ${assignment}
      FROM duplicate_rows AS d
      WHERE t."__id" = d."__id"
        AND d.rn > 1
    `
      )
      .execute(ctx.db);
  }

  private isTextLikeField(): boolean {
    const fieldType = this.field.type().toString();
    return fieldType === 'singleLineText' || fieldType === 'longText';
  }
}
