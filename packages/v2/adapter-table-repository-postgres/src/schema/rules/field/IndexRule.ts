import type { DomainError, Field } from '@teable/v2-core';
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
  readonly required = false;

  /**
   * @param field - The field this index is for
   * @param columnName - The column name to index
   * @param parent - The parent rule (typically FkColumnRule) this depends on
   */
  constructor(
    private readonly field: Field,
    private readonly columnName: string,
    parent: ISchemaRule
  ) {
    this.id = `index:${field.id().toString()}:${columnName}`;
    this.dependencies = [parent.id];

    const name = field.name().toString();
    this.description = `Index on column "${name}" (${columnName}) for faster lookup`;
  }

  /**
   * Creates an IndexRule for a FK column.
   */
  static forFkColumn(field: Field, columnName: string, parent: ISchemaRule): IndexRule {
    return new IndexRule(field, columnName, parent);
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
