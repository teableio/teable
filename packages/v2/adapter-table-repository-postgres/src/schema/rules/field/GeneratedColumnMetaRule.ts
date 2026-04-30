import type { DomainError, Field } from '@teable/v2-core';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  resolveColumnName,
  resolveColumnType,
} from '../../visitors/PostgresTableSchemaFieldColumn';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleRepairHint,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import { dropColumnStatement, type TableIdentifier } from '../helpers/StatementBuilders';
import type { GeneratedColumnRule } from './GeneratedColumnRule';

/**
 * Validates that a field configured as a stored column is not persisted
 * as a PostgreSQL generated column.
 */
export class GeneratedColumnMetaRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = true;

  constructor(
    private readonly field: Field,
    private readonly generatedColumnRule: GeneratedColumnRule,
    parent: ISchemaRule
  ) {
    this.id = `generated_meta:${field.id().toString()}`;
    this.dependencies = [parent.id];
    this.description = `Generated column state for "${field.name().toString()}" matches field meta`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const schemaName = ctx.schema ?? 'public';
      const columnResult = await ctx.introspector.getColumn(ctx.schema, ctx.tableName, columnName);
      const column = yield* columnResult;

      if (!column) {
        return ok({
          valid: false,
          missing: [
            `cannot verify generated-column metadata: column "${schemaName}"."${ctx.tableName}"."${columnName}" not found`,
          ],
        });
      }

      if (column.isGenerated) {
        return ok({
          valid: false,
          extra: [
            `column "${schemaName}"."${ctx.tableName}"."${columnName}" is a generated column but field meta.persistedAsGeneratedColumn is false`,
          ],
        });
      }

      return ok({ valid: true });
    });
  }

  getRepairHint(
    _ctx: SchemaRuleContext,
    _validation: SchemaRuleValidationResult
  ): Result<SchemaRuleRepairHint | undefined, DomainError> {
    return ok({
      available: true,
      mode: 'auto',
      reason: {
        fallback: `Automatic repair will convert "${this.field.name().toString()}" back to a normal stored column.`,
      },
      description: {
        fallback:
          'This repair drops the current generated column and recreates a plain stored column to match field metadata. The old generated display values in that physical column are discarded, so the recreated column starts empty until another process repopulates it.',
      },
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const dataType = yield* resolveColumnType(ctx.field);
      const schemaBuilder = ctx.schema ? ctx.db.schema.withSchema(ctx.schema) : ctx.db.schema;
      const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };

      return ok([
        dropColumnStatement(table, columnName),
        schemaBuilder
          .alterTable(ctx.tableName)
          .addColumn(columnName, dataType, (column) => column.ifNotExists()),
      ]);
    });
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generatedColumnRule.up(ctx);
  }
}
