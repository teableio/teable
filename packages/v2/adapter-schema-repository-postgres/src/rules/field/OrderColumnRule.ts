import type { DomainError } from '@teable/v2-core';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import { dropColumnStatement, type TableIdentifier } from '../helpers/StatementBuilders';

/**
 * Schema rule for creating/dropping an order column for link fields.
 * Order columns store the display order of linked records.
 */
export class OrderColumnRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = true;

  /**
   * @param fieldId - The field ID this order column is for
   * @param columnName - The order column name
   * @param targetTable - The table where the order column lives
   * @param options - Optional configuration
   */
  constructor(
    private readonly fieldId: string,
    private readonly columnName: string,
    private readonly targetTable: TableIdentifier,
    private readonly options: {
      dependsOnRuleId?: string;
      fieldName?: string;
      targetTableName?: string;
    } = {}
  ) {
    this.id = `order_column:${fieldId}`;
    this.dependencies = this.options.dependsOnRuleId ? [this.options.dependsOnRuleId] : [];

    const name = this.options.fieldName ?? this.fieldId;
    const target = this.options.targetTableName ?? this.targetTable.tableName;
    this.description = `Order column "${this.columnName}" in table "${target}" for link field "${name}" (stores display order)`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const columnName = this.columnName;
    const targetTable = this.targetTable;
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const existsResult = await ctx.introspector.columnExists(
        targetTable.schema,
        targetTable.tableName,
        columnName
      );
      const exists = yield* existsResult;

      return ok({
        valid: exists,
        missing: exists ? [] : [`order column ${columnName}`],
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const columnName = this.columnName;
    const targetTable = this.targetTable;

    const schemaBuilder = targetTable.schema
      ? ctx.db.schema.withSchema(targetTable.schema)
      : ctx.db.schema;

    const statement = schemaBuilder
      .alterTable(targetTable.tableName)
      .addColumn(columnName, 'double precision', (col) => col.ifNotExists());

    return ok([statement]);
  }

  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([dropColumnStatement(this.targetTable, this.columnName)]);
  }
}
