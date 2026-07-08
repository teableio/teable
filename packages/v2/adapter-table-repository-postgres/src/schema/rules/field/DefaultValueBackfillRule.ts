import {
  domainError,
  FieldDefaultValueVisitor,
  type DomainError,
  type Field,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldInsertValueVisitor, FieldSqlLiteralVisitor } from '../../../record/visitors';
import { resolveColumnName } from '../../visitors/PostgresTableSchemaFieldColumn';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import { dataStatement, quoteIdentifier, quoteTableIdentifier } from '../helpers/StatementBuilders';

/**
 * Backfills existing NULL rows with the field default before applying stricter constraints.
 *
 * Adding a column to an existing table produces NULL for old rows. Required fields with a
 * valid default need those rows filled before the NOT NULL rule runs.
 */
export class DefaultValueBackfillRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = false;

  constructor(
    private readonly field: Field,
    parent: ISchemaRule
  ) {
    this.id = `default_backfill:${field.id().toString()}`;
    this.dependencies = [parent.id];
    this.description = `Default-value backfill for "${field.name().toString()}"`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const self = this;

    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const defaultLiteral = yield* self.resolveDefaultLiteral(columnName);
      if (defaultLiteral === undefined) {
        return ok({ valid: true });
      }

      const nullCount = yield* await self.countNullValues(ctx, columnName);
      if (nullCount === 0) {
        return ok({ valid: true });
      }

      const schemaName = ctx.schema ?? 'public';
      return ok({
        valid: false,
        missing: [
          `column "${schemaName}"."${ctx.tableName}"."${columnName}" has ${nullCount} NULL values that can be backfilled from the default value`,
        ],
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const self = this;

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const defaultLiteral = yield* self.resolveDefaultLiteral(columnName);
      if (defaultLiteral === undefined) {
        return ok([]);
      }

      const tableRef = quoteTableIdentifier({ schema: ctx.schema, tableName: ctx.tableName });
      const columnRef = quoteIdentifier(columnName);
      const statement = sql.raw(
        `UPDATE ${tableRef} SET ${columnRef} = ${defaultLiteral} WHERE ${columnRef} IS NULL`
      );

      return ok([dataStatement(statement)]);
    });
  }

  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([]);
  }

  private resolveDefaultLiteral(columnName: string): Result<string | undefined, DomainError> {
    const self = this;

    return safeTry<string | undefined, DomainError>(function* () {
      const defaultValue = yield* self.field.accept(FieldDefaultValueVisitor.create());
      if (defaultValue === undefined) {
        return ok(undefined);
      }

      const insertValue = yield* self.field.accept(
        FieldInsertValueVisitor.create(defaultValue, {
          recordId: '__schema_default_backfill__',
          dbFieldName: columnName,
        })
      );
      const columnValue = insertValue.columnValues[columnName];
      if (columnValue === null || columnValue === undefined) {
        return ok(undefined);
      }

      return self.field.accept(FieldSqlLiteralVisitor.create(columnValue));
    });
  }

  private async countNullValues(
    ctx: SchemaRuleContext,
    columnName: string
  ): Promise<Result<number, DomainError>> {
    try {
      const tableRef = quoteTableIdentifier({ schema: ctx.schema, tableName: ctx.tableName });
      const columnRef = quoteIdentifier(columnName);
      const result = await sql
        .raw<{
          count: number | string | bigint | null;
        }>(`SELECT COUNT(*)::int AS count FROM ${tableRef} WHERE ${columnRef} IS NULL`)
        .execute(ctx.db);

      return ok(Number(result.rows[0]?.count ?? 0));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to check default backfill values: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.validation_failed',
          details: {
            fieldId: this.field.id().toString(),
            fieldName: this.field.name().toString(),
            columnName,
            tableName: ctx.tableName,
          },
        })
      );
    }
  }
}
