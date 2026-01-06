import type { DomainError } from '@teable/v2-core';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import {
  createIndexStatement,
  dropIndexStatement,
  type TableIdentifier,
} from '../helpers/StatementBuilders';

/**
 * Schema rule for creating/dropping an index on a column.
 * Depends on the column existing first.
 */
export class IndexRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required: boolean;

  /**
   * @param fieldId - The field ID this index is for
   * @param columnName - The column name to index
   * @param options - Optional configuration
   */
  constructor(
    private readonly fieldId: string,
    private readonly columnName: string,
    options: {
      required?: boolean;
      columnRuleId?: string;
      fieldName?: string;
    } = {}
  ) {
    this.id = `index:${fieldId}:${columnName}`;
    this.dependencies = [options.columnRuleId ?? `column:${fieldId}`];
    this.required = options.required ?? false;

    const name = options.fieldName ?? columnName;
    this.description = `Index on column "${name}" for faster lookup${this.required ? '' : ' (optional)'}`;
  }

  private get indexName(): string {
    return `index_${this.columnName}`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const indexName = this.indexName;
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const existsResult = await ctx.introspector.indexExists(ctx.schema, indexName);
      const exists = yield* existsResult;

      return ok({
        valid: exists,
        missing: exists ? [] : [`index ${indexName}`],
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };
    return ok([createIndexStatement(table, this.indexName, this.columnName)]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };
    return ok([dropIndexStatement(table, this.indexName)]);
  }
}
