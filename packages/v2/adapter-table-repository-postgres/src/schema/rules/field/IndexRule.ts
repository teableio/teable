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
  dropConstraintStatement,
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
    parent: ISchemaRule,
    private readonly targetTable?: TableIdentifier
  ) {
    this.id = `index:${field.id().toString()}:${columnName}`;
    this.dependencies = [parent.id];

    const name = field.name().toString();
    this.description = `Index on column "${name}" (${columnName}) for faster lookup`;
  }

  /**
   * Creates an IndexRule for a FK column.
   */
  static forFkColumn(
    field: Field,
    columnName: string,
    parent: ISchemaRule,
    targetTable?: TableIdentifier
  ): IndexRule {
    return new IndexRule(field, columnName, parent, targetTable);
  }

  private get indexName(): string {
    return `index_${this.columnName}`;
  }

  private getTargetTable(ctx: SchemaRuleContext): TableIdentifier {
    return this.targetTable ?? { schema: ctx.schema, tableName: ctx.tableName };
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const indexName = this.indexName;
    const targetTable = this.getTargetTable(ctx);
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const indexResult = await ctx.introspector.getIndex(targetTable.schema, indexName);
      const index = yield* indexResult;

      if (!index) {
        return ok({
          valid: false,
          missing: [`index ${indexName}`],
        });
      }

      if (index.isUnique) {
        return ok({
          valid: false,
          missing: [`non-unique index ${indexName}`],
          extra: [`unique constraint or index ${indexName}`],
        });
      }

      return ok({ valid: true });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table = this.getTargetTable(ctx);
    return ok([
      dropConstraintStatement(table, this.indexName),
      dropIndexStatement(table, this.indexName),
      createIndexStatement(table, this.indexName, this.columnName),
    ]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table = this.getTargetTable(ctx);
    return ok([dropIndexStatement(table, this.indexName)]);
  }
}
