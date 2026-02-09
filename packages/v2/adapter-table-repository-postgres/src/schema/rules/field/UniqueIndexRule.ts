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
  createUniqueIndexStatement,
  dropIndexStatement,
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
    private readonly relationshipType?: string
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
    relationshipType?: string
  ): UniqueIndexRule {
    return new UniqueIndexRule(field, columnName, parent, relationshipType);
  }

  private get indexName(): string {
    return `index_${this.columnName}`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const indexName = this.indexName;
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const indexResult = await ctx.introspector.getIndex(ctx.schema, indexName);
      const index = yield* indexResult;

      if (!index) {
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

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };
    return ok([createUniqueIndexStatement(table, this.indexName, this.columnName)]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };
    return ok([dropIndexStatement(table, this.indexName)]);
  }
}
