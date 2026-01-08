import type { DomainError, Field } from '@teable/v2-core';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolveColumnName } from '../../visitors/PostgresTableSchemaFieldColumn';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import { dropColumnStatement, type TableIdentifier } from '../helpers/StatementBuilders';

/**
 * Schema rule for creating/dropping a JSONB column for link field values.
 * Link fields store their display values as JSONB.
 */
export class LinkValueColumnRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;

  constructor(
    private readonly field: Field,
    private readonly relationshipType: 'oneWay' | 'twoWay'
  ) {
    this.id = `link_value_column:${field.id().toString()}`;
    const fieldName = field.name().toString();
    this.description = `JSONB column "${fieldName}" stores linked record IDs and display values (${relationshipType} link)`;
  }

  /**
   * Creates a LinkValueColumnRule for a link field.
   */
  static forField(field: Field, relationshipType: 'oneWay' | 'twoWay'): LinkValueColumnRule {
    return new LinkValueColumnRule(field, relationshipType);
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const schemaName = ctx.schema ?? 'public';
      const existsResult = await ctx.introspector.columnExists(
        ctx.schema,
        ctx.tableName,
        columnName
      );
      const exists = yield* existsResult;

      return ok({
        valid: exists,
        missing: exists
          ? []
          : [`link value column "${schemaName}"."${ctx.tableName}"."${columnName}" not found`],
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);

      const schemaBuilder = ctx.schema ? ctx.db.schema.withSchema(ctx.schema) : ctx.db.schema;

      const statement = schemaBuilder
        .alterTable(ctx.tableName)
        .addColumn(columnName, 'jsonb', (col) => col.ifNotExists());

      return ok([statement]);
    });
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(ctx.field);
      const table: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };
      return ok([dropColumnStatement(table, columnName)]);
    });
  }
}
