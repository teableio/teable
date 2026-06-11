import { domainError, type DomainError, type Field } from '@teable/v2-core';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

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
  compressSql,
  createUniqueIndexStatement,
  dropIndexStatement,
  quoteIdentifier,
  quoteTableIdentifier,
  type TableIdentifier,
} from '../helpers/StatementBuilders';

/**
 * Schema rule for creating/dropping a unique index on a column.
 * Used for OneOne link relationships to enforce uniqueness.
 * Depends on the column existing first.
 */
export class UniqueIndexRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = false;

  private readonly duplicateValueManualRepairSchema = withManualRepairFormMeta(
    z.object({
      resolution: withManualRepairFieldMeta(z.enum(['clear_duplicate_values']), {
        widget: 'select',
        title: {
          key: 'table:table.integrity.v2.repairMeta.manual.uniqueIndex.resolutionLabel',
          fallback: 'Repair strategy',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.manual.uniqueIndex.resolutionDescription',
          fallback:
            'The one-to-one link column contains duplicate values. Confirm clearing duplicate linked values before creating the unique index.',
        },
        options: {
          clear_duplicate_values: {
            value: 'clear_duplicate_values',
            label: {
              key: 'table:table.integrity.v2.repairMeta.manual.uniqueIndex.option.clearDuplicates',
              fallback: 'Clear duplicate linked values except the first row',
            },
          },
        },
      }).default('clear_duplicate_values'),
    }),
    {
      title: {
        key: 'table:table.integrity.v2.repairMeta.manual.uniqueIndex.title',
        fallback: 'Resolve duplicate one-to-one links',
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.manual.uniqueIndex.description',
        fallback:
          'A one-to-one unique index cannot be created while multiple rows point to the same linked record. This repair keeps the first link and clears later duplicates.',
      },
      submitLabel: {
        key: 'table:table.integrity.v2.repairMeta.manual.apply',
        fallback: 'Apply manual repair',
      },
    }
  );

  /**
   * @param field - The field this index is for
   * @param columnName - The column name to create unique index on
   * @param parent - The parent rule (typically FkColumnRule) this depends on
   * @param relationshipType - The relationship type (for description)
   */
  constructor(
    private readonly field: Field,
    private readonly columnName: string,
    parent: ISchemaRule,
    private readonly relationshipType?: string,
    private readonly targetTable?: TableIdentifier
  ) {
    this.id = `unique_index:${field.id().toString()}:${columnName}`;
    this.dependencies = [parent.id];

    const name = field.name().toString();
    const relationship = relationshipType ? ` (${relationshipType} relationship)` : '';
    this.description = `Unique index on "${name}" (${columnName}) ensures one-to-one relationship${relationship}`;
  }

  /**
   * Creates a UniqueIndexRule for a FK column.
   */
  static forFkColumn(
    field: Field,
    columnName: string,
    parent: ISchemaRule,
    relationshipType?: string,
    targetTable?: TableIdentifier
  ): UniqueIndexRule {
    return new UniqueIndexRule(field, columnName, parent, relationshipType, targetTable);
  }

  private get indexName(): string {
    return `index_${this.columnName}`;
  }

  private getTargetTable(ctx: SchemaRuleContext): TableIdentifier {
    return this.targetTable ?? { schema: ctx.schema, tableName: ctx.tableName };
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const self = this;
    const indexName = this.indexName;
    const targetTable = this.getTargetTable(ctx);
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const indexResult = await ctx.introspector.getIndex(targetTable.schema, indexName);
      const index = yield* indexResult;

      if (!index) {
        const duplicateSummary = yield* await self.countDuplicateValues(ctx, targetTable);

        if (duplicateSummary.duplicateRows > 0) {
          const fieldName = self.field.name().toString();

          return ok({
            valid: false,
            missing: [
              `unique index ${indexName} cannot be created because ${duplicateSummary.duplicateRows} duplicate linked values exist`,
            ],
            missingItems: [
              {
                code: 'unique_index_duplicate_values',
                message: {
                  key: 'table:table.integrity.v2.detail.uniqueIndexDuplicateValues',
                  values: {
                    fieldName,
                    duplicateGroups: duplicateSummary.duplicateGroups,
                    duplicateRows: duplicateSummary.duplicateRows,
                  },
                  fallback: `Field "${fieldName}" has duplicate linked values, so the one-to-one unique index cannot be created.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.uniqueIndexDuplicateValuesDescription',
                  values: {
                    fieldName,
                    duplicateGroups: duplicateSummary.duplicateGroups,
                    duplicateRows: duplicateSummary.duplicateRows,
                  },
                  fallback:
                    'Resolve duplicate linked values first, then rerun repair to create the unique index.',
                },
              },
            ],
          });
        }

        return ok({
          valid: false,
          missing: [`unique index ${indexName}`],
        });
      }

      if (!index.isUnique) {
        return ok({
          valid: false,
          missing: [`unique constraint on index ${indexName} (exists but not unique)`],
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
      (item) => item.code === 'unique_index_duplicate_values'
    );

    if (!duplicateValuesDetected) {
      return ok(undefined);
    }

    const fieldName = this.field.name().toString();
    const duplicateItem = validation.missingItems?.find(
      (item) => item.code === 'unique_index_duplicate_values'
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
    const manualRepairSchemaResult = serializeManualRepairSchema(
      this.duplicateValueManualRepairSchema
    );

    return ok({
      available: true,
      mode: 'manual',
      reason: {
        key: 'table:table.integrity.v2.repairMeta.reason.uniqueIndexDuplicateValues',
        values,
        fallback: `Field "${fieldName}" has duplicate linked values and needs confirmation before creating the unique index.`,
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.description.uniqueIndexDuplicateValues',
        values,
        fallback:
          'Clear duplicate linked values with the selected strategy, then create the one-to-one unique index.',
      },
      manualRepairSchema: manualRepairSchemaResult.isOk()
        ? manualRepairSchemaResult.value
        : undefined,
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table = this.getTargetTable(ctx);
    return ok([createUniqueIndexStatement(table, this.indexName, this.columnName)]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table = this.getTargetTable(ctx);
    return ok([dropIndexStatement(table, this.indexName)]);
  }

  async manualRepair(
    ctx: SchemaRuleContext,
    values: SchemaRuleManualRepairValues | undefined,
    options?: SchemaRuleManualRepairOptions
  ): Promise<Result<void, DomainError>> {
    const resolution =
      typeof values?.resolution === 'string' ? values.resolution : 'clear_duplicate_values';

    if (resolution !== 'clear_duplicate_values') {
      return err(
        domainError.validation({
          message: 'Unsupported manual repair strategy',
          details: { resolution },
        })
      );
    }

    if (options?.dryRun) {
      return ok(undefined);
    }

    const targetTable = this.getTargetTable(ctx);

    try {
      await this.clearDuplicateValues(ctx, targetTable);

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
          message: `Failed to repair duplicate unique index values: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.repair_failed',
          details: {
            fieldId: this.field.id().toString(),
            fieldName: this.field.name().toString(),
            columnName: this.columnName,
            targetTable,
          },
        })
      );
    }
  }

  private async countDuplicateValues(
    ctx: SchemaRuleContext,
    table: TableIdentifier
  ): Promise<Result<{ duplicateGroups: number; duplicateRows: number }, DomainError>> {
    try {
      const tableRef = quoteTableIdentifier(table);
      const columnRef = quoteIdentifier(this.columnName);
      const result = await sql
        .raw<{
          duplicate_groups: number | string | bigint | null;
          duplicate_rows: number | string | bigint | null;
        }>(
          compressSql(`
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
          `)
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
          message: `Failed to check duplicate unique index values: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.validation_failed',
          details: {
            fieldId: this.field.id().toString(),
            fieldName: this.field.name().toString(),
            columnName: this.columnName,
            table,
          },
        })
      );
    }
  }

  private async clearDuplicateValues(
    ctx: SchemaRuleContext,
    table: TableIdentifier
  ): Promise<void> {
    const tableRef = quoteTableIdentifier(table);
    const columnRef = quoteIdentifier(this.columnName);

    await sql
      .raw(
        compressSql(`
          WITH duplicate_rows AS (
            SELECT
              "__id",
              ROW_NUMBER() OVER (PARTITION BY ${columnRef} ORDER BY "__id") AS rn
            FROM ${tableRef}
            WHERE ${columnRef} IS NOT NULL
          )
          UPDATE ${tableRef} AS target_rows
          SET ${columnRef} = NULL
          FROM duplicate_rows AS d
          WHERE target_rows."__id" = d."__id"
            AND d.rn > 1
        `)
      )
      .execute(ctx.db);
  }
}
