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
  readonly required: boolean;

  /**
   * @param fieldId - The field ID this FK is for
   * @param columnName - The local column name that holds the FK
   * @param targetTable - The target table identifier
   * @param options - Optional configuration
   */
  constructor(
    private readonly fieldId: string,
    private readonly columnName: string,
    private readonly targetTable: TableIdentifier,
    private readonly options: {
      targetColumn?: string;
      onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
      required?: boolean;
      columnRuleId?: string;
      fieldName?: string;
      targetTableName?: string;
    } = {}
  ) {
    this.id = `fk:${fieldId}:${columnName}`;
    this.dependencies = [this.options.columnRuleId ?? `column:${fieldId}`];
    this.required = this.options.required ?? true;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.options.fieldName ?? this.columnName;
    const target = this.options.targetTableName ?? this.targetTable.tableName;
    const onDelete = this.options.onDelete ?? 'CASCADE';
    return `Foreign key constraint on "${name}" → ${target}.${this.targetColumnValue} (ON DELETE ${onDelete})`;
  }

  private get targetColumnValue(): string {
    return this.options.targetColumn ?? '__id';
  }

  private get onDeleteValue(): 'CASCADE' | 'SET NULL' | 'RESTRICT' {
    return this.options.onDelete ?? 'CASCADE';
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
        this.targetColumnValue,
        this.onDeleteValue
      ),
    ]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };
    return ok([dropConstraintStatement(table, this.constraintName)]);
  }
}
