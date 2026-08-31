import { type DomainError, type Field } from '@teable/v2-core';
import { sql } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { PostgresSchemaIntrospector } from '../context/PostgresSchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import {
  compressSql,
  quoteIdentifier,
  quoteLiteral,
  quoteTableIdentifier,
  resolveTableIdentifierFromMeta,
  type TableIdentifier,
} from '../helpers/StatementBuilders';

/**
 * dbFieldTypes whose physical columns the condition WHERE builder compares
 * bare (index-sargable). Must stay in sync with
 * SARGABLE_FIELD_REFERENCE_CAST_BY_DB_TYPE in TableRecordConditionWhereVisitor:
 * an index on any other column type would never be used because the generated
 * SQL wraps those columns in to_jsonb().
 */
const INDEXABLE_MATCH_DB_FIELD_TYPES = ['TEXT', 'REAL', 'BOOLEAN'] as const;

type MatchFieldMetaRow = {
  db_field_name: string | null;
  db_field_type: string | null;
  is_computed: boolean | null;
};

/**
 * Schema rule that indexes the foreign-table match column of a conditional
 * lookup/rollup field-reference filter (e.g. `{wooid} is {field: order_id}`).
 *
 * The condition is evaluated once per dirty host row, so without an index on
 * the match column every backfill batch and dirty propagation degrades to
 * per-row seq scans of the foreign table and dead-letters on
 * statement_timeout once the foreign table grows (T6821/T6826). Link fields
 * get this for free via their __fk_* IndexRule; field-value matching had no
 * equivalent.
 *
 * The foreign table location and the match column's physical name live on the
 * meta plane. Resolve them through metaDb at execute time, then emit data-only
 * CREATE INDEX SQL. Compiling table_meta/field into a data-scope statement
 * fails BYODB table.update (T6902).
 */
export class ConditionalMatchIndexRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = false;

  constructor(
    private readonly field: Field,
    private readonly matchFieldId: string,
    private readonly foreignTableId: string,
    private readonly resolvedForeignTable?: TableIdentifier
  ) {
    this.id = `cond_match_index:${field.id().toString()}:${matchFieldId}`;
    const name = field.name().toString();
    this.description = `Index on the foreign match column (${matchFieldId}) used by the condition of "${name}"`;
  }

  static forMatchColumn(
    field: Field,
    matchFieldId: string,
    foreignTableId: string,
    resolvedForeignTable?: TableIdentifier
  ): ConditionalMatchIndexRule {
    return new ConditionalMatchIndexRule(field, matchFieldId, foreignTableId, resolvedForeignTable);
  }

  /**
   * Keyed by the match field id (not this field's id): every conditional
   * field matching on the same foreign column shares one physical index, and
   * `IF NOT EXISTS` makes concurrent creations idempotent.
   */
  private get indexName(): string {
    return `index_cond_${this.matchFieldId}`;
  }

  private async resolveMatchFieldMeta(
    ctx: SchemaRuleContext
  ): Promise<Result<MatchFieldMetaRow | undefined, DomainError>> {
    const metaIntrospector = new PostgresSchemaIntrospector(ctx.metaDb);
    const fieldTableExists = await metaIntrospector.tableExists('public', 'field');
    if (fieldTableExists.isErr()) return ok(undefined);
    if (!fieldTableExists.value) return ok(undefined);

    try {
      const result = await sql<MatchFieldMetaRow>`
        SELECT db_field_name, db_field_type, is_computed
        FROM field
        WHERE id = ${this.matchFieldId}
          AND deleted_time IS NULL
        LIMIT 1
      `.execute(ctx.metaDb);
      return ok(result.rows[0]);
    } catch {
      return ok(undefined);
    }
  }

  private async resolveForeignTable(
    ctx: SchemaRuleContext
  ): Promise<Result<TableIdentifier | undefined, DomainError>> {
    if (this.resolvedForeignTable) {
      return ok(this.resolvedForeignTable);
    }

    const metaIntrospector = new PostgresSchemaIntrospector(ctx.metaDb);
    const tableMetaExists = await metaIntrospector.tableExists('public', 'table_meta');
    if (tableMetaExists.isErr()) return ok(undefined);
    if (!tableMetaExists.value) return ok(undefined);

    try {
      const result = await sql<{ db_table_name: string | null }>`
        SELECT db_table_name
        FROM table_meta
        WHERE id = ${this.foreignTableId}
          AND deleted_time IS NULL
        LIMIT 1
      `.execute(ctx.metaDb);

      const dbTableName = result.rows[0]?.db_table_name;
      if (!dbTableName) return ok(undefined);

      const separatorIndex = dbTableName.indexOf('.');
      if (separatorIndex < 0) {
        return ok({ schema: 'public', tableName: dbTableName });
      }
      return ok({
        schema: dbTableName.slice(0, separatorIndex),
        tableName: dbTableName.slice(separatorIndex + 1),
      });
    } catch {
      return ok(undefined);
    }
  }

  private isIndexableMatchField(meta: MatchFieldMetaRow | undefined): meta is MatchFieldMetaRow & {
    db_field_name: string;
  } {
    if (!meta?.db_field_name || !meta.db_field_type) return false;
    if (meta.is_computed === true) return false;
    return (INDEXABLE_MATCH_DB_FIELD_TYPES as ReadonlyArray<string>).includes(
      meta.db_field_type.trim().toUpperCase()
    );
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const rule = this;
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const matchFieldMeta = yield* await rule.resolveMatchFieldMeta(ctx);
      if (!rule.isIndexableMatchField(matchFieldMeta)) {
        // Deleted, drift-prone, or non-scalar match column: no index expected.
        return ok({ valid: true });
      }

      const foreignTable = yield* await rule.resolveForeignTable(ctx);
      if (!foreignTable) {
        return ok({ valid: true });
      }

      const columnExists = yield* await ctx.introspector.columnExists(
        foreignTable.schema,
        foreignTable.tableName,
        matchFieldMeta.db_field_name
      );
      if (!columnExists) {
        // The physical column is another rule's concern; nothing to index yet.
        return ok({ valid: true });
      }

      const index = yield* await ctx.introspector.getIndex(foreignTable.schema, rule.indexName);
      if (!index) {
        return ok({
          valid: false,
          missing: [`index ${rule.indexName} on foreign match column`],
        });
      }

      return ok({ valid: true });
    });
  }

  up(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const previewSql = compressSql(`select ${quoteLiteral(`create index ${this.indexName}`)}`);
    const matchFieldId = this.matchFieldId;
    const foreignTableId = this.foreignTableId;
    const resolvedForeignTable = this.resolvedForeignTable;
    const indexName = this.indexName;
    const isIndexableMatchField = this.isIndexableMatchField.bind(this);

    return ok([
      {
        scope: 'data',
        compile: (executorProvider) => sql.raw(previewSql).compile(executorProvider),
        execute: async ({ dataDb, metaDb }) => {
          const fieldTableExists = await sql<{ exists: boolean }>`
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name = 'field'
            ) AS exists
          `.execute(metaDb);
          if (!fieldTableExists.rows[0]?.exists) {
            return;
          }

          const fieldResult = await sql<MatchFieldMetaRow>`
            SELECT db_field_name, db_field_type, is_computed
            FROM field
            WHERE id = ${matchFieldId}
              AND deleted_time IS NULL
            LIMIT 1
          `.execute(metaDb);
          const matchField = fieldResult.rows[0];
          if (!isIndexableMatchField(matchField)) {
            return;
          }

          const foreignTable =
            resolvedForeignTable ?? (await resolveTableIdentifierFromMeta(metaDb, foreignTableId));
          if (!foreignTable) {
            return;
          }

          const schema = foreignTable.schema ?? 'public';
          const columnExists = await sql<{ exists: boolean }>`
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = ${schema}
                AND table_name = ${foreignTable.tableName}
                AND column_name = ${matchField.db_field_name}
            ) AS exists
          `.execute(dataDb);
          if (!columnExists.rows[0]?.exists) {
            return;
          }

          await sql
            .raw(
              compressSql(`
                create index if not exists ${quoteIdentifier(indexName)}
                on ${quoteTableIdentifier({ schema, tableName: foreignTable.tableName })}
                (${quoteIdentifier(matchField.db_field_name)})
              `)
            )
            .execute(dataDb);
        },
      },
    ]);
  }

  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // The index is keyed by the foreign match column and may be shared by
    // other conditional fields matching on it, so field deletion keeps it
    // (mirrors how shared physical artifacts are conservatively retained).
    return ok([]);
  }
}
