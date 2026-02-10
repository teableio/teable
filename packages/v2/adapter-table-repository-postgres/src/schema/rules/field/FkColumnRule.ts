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
 * Schema rule for creating/dropping a foreign key column (text column for FK value).
 * This is different from ColumnExistsRule - it's specifically for the FK column that holds
 * the reference to another table's __id.
 */
export class FkColumnRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = false;

  /**
   * @param field - The field this FK column is for
   * @param columnName - The FK column name
   * @param referencedTableName - The name of the table being referenced
   * @param targetTable - Optional target table (if different from context table)
   */
  constructor(
    private readonly field: Field,
    private readonly columnName: string,
    private readonly referencedTableName: string,
    private readonly targetTable?: TableIdentifier
  ) {
    this.id = `fk_column:${field.id().toString()}`;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.field.name().toString();
    return `Foreign key column "${name}" (${this.columnName}) → ${this.referencedTableName}.__id`;
  }

  /**
   * Creates a FkColumnRule for a link field.
   */
  static forField(
    field: Field,
    columnName: string,
    referencedTableName: string,
    targetTable?: TableIdentifier
  ): FkColumnRule {
    return new FkColumnRule(field, columnName, referencedTableName, targetTable);
  }

  private getTargetTable(ctx: SchemaRuleContext): TableIdentifier {
    return this.targetTable ?? { schema: ctx.schema, tableName: ctx.tableName };
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const columnName = this.columnName;
    const target = this.getTargetTable(ctx);
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const existsResult = await ctx.introspector.columnExists(
        target.schema,
        target.tableName,
        columnName
      );
      const exists = yield* existsResult;

      return ok({
        valid: exists,
        missing: exists ? [] : [`fk column ${columnName}`],
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const target = this.getTargetTable(ctx);
    const columnName = this.columnName;

    const schemaBuilder = target.schema ? ctx.db.schema.withSchema(target.schema) : ctx.db.schema;

    const statement = schemaBuilder
      .alterTable(target.tableName)
      .addColumn(columnName, 'text', (col) => col.ifNotExists());

    return ok([statement]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const target = this.getTargetTable(ctx);
    return ok([dropColumnStatement(target, this.columnName)]);
  }
}
