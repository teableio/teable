import {
  TableByIdSpec,
  TableId,
  Table,
  domainError,
  type DomainError,
  type IExecutionContext,
  type IRecordSearchAccessPath,
  type ITableRepository,
  type ITableSearchIndex,
} from '@teable/v2-core';
import {
  buildTableSearchAccessPathDefinition,
  resolveTableSearchAccessPath,
  type TableSearchAccessPathDefinition,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, type Result } from 'neverthrow';
import {
  getTablePhysicalName,
  makePhysicalTableSql,
  quoteIdentifier,
  toInfrastructureError,
} from './helpers';
import { renderGeneratedSearchTextProjectionSql } from './searchDocumentProjection';
import { buildSearchDocumentDefinitionMarker, buildSearchDocumentExpression } from './searchVector';
import {
  toRecordSearchAccessPathFromConfig,
  type SearchAccessPathConfigRow,
} from './searchVectorStatus';
import type { UnknownPostgresDatabase } from './types';

type InspectedConfigRow = SearchAccessPathConfigRow & {
  readonly indexName: string;
  readonly definitionKey: string;
  readonly configVersion: string;
};

export class PostgresTableSearchAccessPathMetadataPublisher {
  constructor(
    private readonly metaDb: Kysely<UnknownPostgresDatabase>,
    private readonly dataDb: Kysely<UnknownPostgresDatabase>,
    private readonly tableRepository: ITableRepository
  ) {}

  async refresh(
    context: IExecutionContext,
    tableId: string
  ): Promise<Result<IRecordSearchAccessPath | undefined, DomainError>> {
    try {
      const relation = await sql<{ relation_name: string | null }>`
        SELECT to_regclass('public.table_query_search_vector_config')::text AS relation_name
      `.execute(this.metaDb);
      const hasConfigRelation = Boolean(relation.rows[0]?.relation_name);

      const before = await sql<{ version: number; db_table_name: string }>`
        SELECT version, db_table_name FROM table_meta WHERE id = ${tableId} AND deleted_time IS NULL
      `.execute(this.metaDb);
      const expected = before.rows[0];
      if (!expected) return err(domainError.notFound({ message: 'Table not found' }));
      const result = hasConfigRelation
        ? await sql<InspectedConfigRow>`
        SELECT
          generated_column_name AS "generatedColumnName",
          index_name AS "indexName",
          candidate_key AS "definitionKey",
          xmin::text AS "configVersion",
          semantics,
          access_path AS "accessPath",
          provider,
          language_config AS "languageConfig",
          field_ids AS "fieldIds",
          search_scope AS "searchScope",
          status
        FROM table_query_search_vector_config
        WHERE table_id = ${tableId}
          AND status IN ('ready', 'stale', 'rebuild_pending')
        ORDER BY (status = 'ready') DESC, (provider = 'pg_bigm') DESC,
          last_modified_time DESC NULLS LAST, created_time DESC NULLS LAST, id DESC
      `.execute(this.metaDb)
        : { rows: [] };

      const id = TableId.create(tableId);
      if (id.isErr()) return err(id.error);
      const table = await this.tableRepository.findOne(context, TableByIdSpec.create(id.value));
      if (table.isErr()) return err(table.error);
      const dbTableName = table.value.dbTableName().andThen((name) => name.value());
      if (dbTableName.isErr()) return err(dbTableName.error);
      if (dbTableName.value !== expected.db_table_name) {
        return err(
          domainError.conflict({
            message: 'Table physical identity changed during search metadata refresh',
          })
        );
      }
      const physical = getTablePhysicalName(table.value);
      if (physical.isErr()) return err(physical.error);

      const inspected = await this.resolveConfiguredAccessPaths(
        result.rows,
        table.value,
        physical.value
      );
      if (inspected.isErr()) return err(inspected.error);
      const snapshot = inspected.value;
      const published = await this.metaDb.transaction().execute(async (transaction) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext('teable.table_query_ops.search_vector'), hashtext(${tableId}))`.execute(
          transaction
        );
        // Match field/routing writers: lock table metadata before config rows.
        // Inspection stays outside this transaction; both snapshots are checked again.
        const locked = await sql<{ id: string }>`
          SELECT id FROM table_meta
          WHERE id = ${tableId} AND version = ${expected.version}
            AND db_table_name = ${expected.db_table_name} AND deleted_time IS NULL
          FOR UPDATE
        `.execute(transaction);
        if (!locked.rows.length)
          return err(
            domainError.conflict({
              message: 'Table changed during search metadata refresh; retry refresh',
            })
          );
        if (hasConfigRelation) {
          const configs = await sql<{ definitionKey: string; configVersion: string }>`
            SELECT candidate_key AS "definitionKey", xmin::text AS "configVersion"
            FROM table_query_search_vector_config
            WHERE table_id = ${tableId} AND status IN ('ready', 'stale', 'rebuild_pending')
            FOR UPDATE
          `.execute(transaction);
          const expectedVersions = new Map(
            result.rows.map((row) => [row.definitionKey, row.configVersion])
          );
          if (
            configs.rows.length !== expectedVersions.size ||
            configs.rows.some(
              (row) => expectedVersions.get(row.definitionKey) !== row.configVersion
            )
          ) {
            return err(
              domainError.conflict({
                message: 'Search configuration changed during metadata refresh; retry refresh',
              })
            );
          }
        } else {
          const currentRelation = await sql<{ relation_name: string | null }>`
            SELECT to_regclass('public.table_query_search_vector_config')::text AS relation_name
          `.execute(transaction);
          if (currentRelation.rows[0]?.relation_name) {
            return err(
              domainError.conflict({
                message: 'Search configuration appeared during metadata refresh; retry refresh',
              })
            );
          }
        }
        await sql`
          UPDATE table_meta
          SET search_index = ${snapshot ? JSON.stringify(snapshot) : null}::jsonb,
              version = version + 1, last_modified_time = now()
          WHERE id = ${tableId}
        `.execute(transaction);
        return ok(undefined);
      });
      if (published.isErr()) return err(published.error);
      return table.value
        .dbTableName()
        .andThen((dbTableName) =>
          Table.rehydrate({
            id: table.value.id(),
            baseId: table.value.baseId(),
            name: table.value.name(),
            fields: table.value.getFields(),
            views: table.value.views(),
            primaryFieldId: table.value.primaryFieldId(),
            dbTableName,
            searchIndex: snapshot,
          })
        )
        .map(resolveTableSearchAccessPath);
    } catch (error) {
      return err(
        toInfrastructureError(error, 'Failed to refresh table search access path metadata')
      );
    }
  }

  private async resolveConfiguredAccessPaths(
    rows: readonly InspectedConfigRow[],
    table: Table,
    physical: { schema: string; tableName: string }
  ): Promise<Result<ITableSearchIndex | undefined, DomainError>> {
    let fallback: ITableSearchIndex | undefined;
    const dbTableName = table.dbTableName().andThen((name) => name.value());
    if (dbTableName.isErr()) return err(dbTableName.error);
    let contractFieldIds: ReadonlySet<string> | undefined;
    for (const row of rows) {
      const configured = toRecordSearchAccessPathFromConfig(row);
      // Lexical documents are not compatible with ordinary substring search.
      if (configured?.kind !== 'generated_text') continue;
      contractFieldIds ??= new Set(configured.coveredFieldIds.map((fieldId) => fieldId.toString()));
      const candidateFieldIds = configured.coveredFieldIds
        .map((fieldId) => fieldId.toString())
        .filter((fieldId) => contractFieldIds?.has(fieldId));
      if (!candidateFieldIds.length) continue;
      const definition = buildTableSearchAccessPathDefinition(table, {
        semantics: 'substring',
        provider: configured.provider,
        fieldIds: candidateFieldIds,
      });
      if (definition.isErr()) return err(definition.error);
      const compatible = definition.value.fields;
      const snapshot: ITableSearchIndex = {
        version: 1,
        dbTableName: dbTableName.value,
        generatedColumnName: row.generatedColumnName,
        indexName: row.indexName,
        provider: configured.provider,
        searchScope: configured.searchScope,
        definitionKey: row.definitionKey,
        indexUsable: false,
        fields: compatible.map(({ fieldId, fieldDbName, textProjection }) => ({
          fieldId,
          fieldDbName,
          textProjection,
        })),
      };
      fallback ??= snapshot;
      if (!compatible.length) continue;

      const indexed = await this.resolveIndexedAccessPath(
        physical,
        row.indexName,
        configured,
        compatible
      );
      if (indexed)
        return ok({
          ...snapshot,
          indexUsable: true,
          fields: indexed.map(({ fieldId, fieldDbName, textProjection }) => ({
            fieldId,
            fieldDbName,
            textProjection,
          })),
        });
    }
    return ok(fallback);
  }

  private async resolveIndexedAccessPath(
    physical: { schema: string; tableName: string },
    indexName: string,
    configured: Extract<IRecordSearchAccessPath, { kind: 'generated_text' }>,
    compatible: TableSearchAccessPathDefinition['fields']
  ): Promise<TableSearchAccessPathDefinition['fields'] | undefined> {
    const inventory = await sql<{
      generation_expression: string;
      definition_marker: string | null;
      operator_class_schema: string;
    }>`
      SELECT pg_get_expr(definition.adbin, definition.adrelid) AS generation_expression,
      col_description(relation.oid, document.attnum) AS definition_marker,
      operator_namespace.nspname AS operator_class_schema
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_attribute document ON document.attrelid = relation.oid
      JOIN pg_attrdef definition ON definition.adrelid = relation.oid
        AND definition.adnum = document.attnum
      JOIN pg_index idx ON idx.indrelid = relation.oid
      JOIN pg_class index_relation ON index_relation.oid = idx.indexrelid
      JOIN pg_am method ON method.oid = index_relation.relam
      JOIN pg_opclass operator_class ON operator_class.oid = idx.indclass[0]
      JOIN pg_namespace operator_namespace ON operator_namespace.oid = operator_class.opcnamespace
      JOIN pg_depend operator_dependency ON operator_dependency.classid = 'pg_opclass'::regclass
        AND operator_dependency.objid = operator_class.oid
        AND operator_dependency.refclassid = 'pg_extension'::regclass
      JOIN pg_extension extension ON extension.oid = operator_dependency.refobjid
      WHERE namespace.nspname = ${physical.schema}
        AND relation.relname = ${physical.tableName}
        AND document.attname = ${configured.generatedColumnName}
        AND NOT document.attisdropped AND document.attgenerated = 's'
        AND document.atttypid = 'text'::regtype
        AND index_relation.relname = ${indexName}
        AND idx.indisvalid AND idx.indisready AND idx.indislive
        AND idx.indpred IS NULL AND idx.indexprs IS NULL
        AND idx.indnkeyatts = 1 AND idx.indkey[0] = document.attnum
        AND method.amname = 'gin'
        AND operator_class.opcname = ${configured.provider === 'pg_bigm' ? 'gin_bigm_ops' : 'gin_trgm_ops'}
        AND extension.extname = ${configured.provider}
      LIMIT 1
    `.execute(this.dataDb);
    const catalog = inventory.rows[0];
    if (!catalog) return undefined;
    // Existing documents may have only a self-dependency in pg_depend.
    // Validate their definition instead of rejecting a still-compatible index.
    let indexedFields = compatible;
    const marker = buildSearchDocumentDefinitionMarker(
      buildSearchDocumentExpression(compatible, true),
      {
        provider: configured.provider,
        operatorClass: configured.provider === 'pg_bigm' ? 'gin_bigm_ops' : 'gin_trgm_ops',
        operatorClassSchema: catalog.operator_class_schema,
      }
    );
    if (catalog.definition_marker !== marker) {
      // On schema drift, ask Postgres to render the current per-field
      // projections, then retain only expressions the stored document still
      // contains. This management-only EXPLAIN never executes user rows.
      const projections = indexedFields.map(
        (field) =>
          `coalesce(${renderGeneratedSearchTextProjectionSql(quoteIdentifier(field.fieldDbName), field.textProjection)}, '')`
      );
      const explained = await sql<{
        'QUERY PLAN': { Plan: { Output?: string[]; Plans?: { Output?: string[] }[] } }[];
      }>`
        EXPLAIN (VERBOSE, FORMAT JSON)
        SELECT ${sql.raw(projections.join(', '))}
        FROM ${sql.raw(makePhysicalTableSql(physical.schema, physical.tableName))}
        LIMIT 0
      `.execute(this.dataDb);
      const plan = explained.rows[0]?.['QUERY PLAN']?.[0]?.Plan;
      const expressions = plan?.Plans?.[0]?.Output ?? plan?.Output ?? [];
      indexedFields = indexedFields.filter((_, index) => {
        const expression = expressions[index];
        return expression != null && catalog.generation_expression.includes(expression);
      });
      if (!indexedFields.length) return undefined;
    }
    return indexedFields;
  }
}
