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
  createForeignKeyConstraintStatement,
  dropConstraintStatement,
  type TableIdentifier,
} from '../helpers/StatementBuilders';

/**
 * Schema rule for creating/dropping a foreign key constraint.
 * Depends on both the local column and the target table existing.
 */
export class ForeignKeyRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = false;

  /**
   * @param field - The field this FK is for
   * @param columnName - The local column name that holds the FK
   * @param targetTable - The target table identifier
   * @param parent - The parent rule (typically FkColumnRule) this depends on
   * @param targetTableName - Display name of the target table (for description)
   * @param onDelete - ON DELETE action (default: CASCADE)
   */
  constructor(
    private readonly field: Field,
    private readonly columnName: string,
    private readonly targetTable: TableIdentifier,
    parent: ISchemaRule,
    private readonly targetTableName: string,
    private readonly onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' = 'CASCADE'
  ) {
    this.id = `fk:${field.id().toString()}:${columnName}`;
    this.dependencies = [parent.id];
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.field.name().toString();
    return `Foreign key constraint on "${name}" (${this.columnName}) → ${this.targetTableName}.__id (ON DELETE ${this.onDelete})`;
  }

  /**
   * Creates a ForeignKeyRule for a link field.
   */
  static forField(
    field: Field,
    columnName: string,
    targetTable: TableIdentifier,
    parent: ISchemaRule,
    targetTableName: string,
    onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' = 'CASCADE'
  ): ForeignKeyRule {
    return new ForeignKeyRule(field, columnName, targetTable, parent, targetTableName, onDelete);
  }

  private get constraintName(): string {
    return `fk_${this.columnName}`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const constraintName = this.constraintName;
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const existsResult = await ctx.introspector.foreignKeyExists(
        ctx.schema,
        ctx.tableName,
        constraintName
      );
      const exists = yield* existsResult;

      return ok({
        valid: exists,
        missing: exists ? [] : [`foreign key constraint ${constraintName}`],
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const sourceTable: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };
    return ok([
      createForeignKeyConstraintStatement(
        sourceTable,
        this.constraintName,
        this.columnName,
        this.targetTable,
        '__id',
        this.onDelete
      ),
    ]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };
    return ok([dropConstraintStatement(table, this.constraintName)]);
  }
}
