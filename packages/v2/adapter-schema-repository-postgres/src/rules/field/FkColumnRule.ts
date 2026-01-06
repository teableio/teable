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
 * Schema rule for creating/dropping a foreign key column (text column for FK value).
 * This is different from ColumnRule - it's specifically for the FK column that holds
 * the reference to another table's __id.
 */
export class FkColumnRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;

  /**
   * @param fieldId - The field ID this FK column is for
   * @param columnName - The FK column name
   * @param options - Optional configuration
   */
  constructor(
    private readonly fieldId: string,
    private readonly columnName: string,
    private readonly options: {
      targetTable?: TableIdentifier;
      fieldName?: string;
      referencedTableName?: string;
    } = {}
  ) {
    this.id = `fk_column:${fieldId}`;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.options.fieldName ?? this.columnName;
    const refTable = this.options.referencedTableName;
    const refInfo = refTable ? ` → ${refTable}.__id` : '';
    return `Foreign key column "${name}" stores reference to linked record${refInfo}`;
  }

  private get targetTable(): TableIdentifier | undefined {
    return this.options.targetTable;
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
