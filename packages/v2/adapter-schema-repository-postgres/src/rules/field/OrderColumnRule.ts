import type { DomainError, Field } from '@teable/v2-core';
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
   * @param field - The field this order column is for
   * @param columnName - The order column name
   * @param targetTable - The table where the order column lives
   * @param parent - The parent rule this depends on (e.g., FkColumnRule)
   */
  constructor(
    private readonly field: Field,
    private readonly columnName: string,
    private readonly targetTable: TableIdentifier,
    parent: ISchemaRule
  ) {
    this.id = `order_column:${field.id().toString()}`;
    this.dependencies = [parent.id];

    const name = field.name().toString();
    this.description = `Order column "${this.columnName}" in table "${targetTable.tableName}" for link field "${name}" (stores display order)`;
  }

  /**
   * Creates an OrderColumnRule for a link field.
   */
  static forField(
    field: Field,
    columnName: string,
    targetTable: TableIdentifier,
    parent: ISchemaRule
  ): OrderColumnRule {
    return new OrderColumnRule(field, columnName, targetTable, parent);
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
