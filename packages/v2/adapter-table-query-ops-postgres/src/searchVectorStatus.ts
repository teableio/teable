import { FieldId, type IExecutionContext, type IRecordSearchAccessPath } from '@teable/v2-core';
import type {
  TableSearchAccessPathResolver,
  TableSearchVectorStatus,
  TableSearchVectorStatusReader,
  TableSearchVectorStatusState,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';

import { toInfrastructureError } from './helpers';
import type { UnknownPostgresDatabase } from './types';

type SearchVectorStatusRow = {
  readonly status: string;
  readonly semantics: string;
  readonly access_path: string;
  readonly provider: string;
  readonly language_config: string | null;
  readonly field_ids: unknown;
};

const knownStates = new Set<TableSearchVectorStatusState>(['ready', 'rebuild_pending', 'stale']);

const parseState = (value: string): TableSearchVectorStatusState =>
  knownStates.has(value as TableSearchVectorStatusState)
    ? (value as TableSearchVectorStatusState)
    : 'unknown';

const fieldCount = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const disabledStatus = (tableId: string): TableSearchVectorStatus => ({
  tableId,
  state: 'disabled',
  configured: false,
  coveredFieldCount: 0,
});

export type SearchAccessPathConfigRow = {
  readonly generatedColumnName: string;
  readonly semantics?: string;
  readonly accessPath?: string;
  readonly provider?: string;
  readonly languageConfig?: string | null;
  readonly fieldIds: unknown;
  readonly searchScope: string;
  readonly status: string;
};

const parseFieldIds = (raw: unknown): readonly FieldId[] => {
  const parsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return undefined;
          }
        })()
      : raw;

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((value) => {
    const fieldIdResult = FieldId.create(value);
    return fieldIdResult.isOk() ? [fieldIdResult.value] : [];
  });
};

export const toRecordSearchAccessPathFromConfig = (
  row: SearchAccessPathConfigRow | undefined
): IRecordSearchAccessPath | undefined => {
  if (!row) {
    return undefined;
  }

  if (row.status !== 'ready') {
    return undefined;
  }

  const searchScope =
    row.searchScope === 'all_fields' || row.searchScope === 'selected_fields'
      ? row.searchScope
      : undefined;
  const coveredFieldIds = parseFieldIds(row.fieldIds);
  if (!row.generatedColumnName || !searchScope || coveredFieldIds.length === 0) {
    return undefined;
  }

  if (
    row.semantics === 'substring' &&
    row.accessPath === 'generated_text' &&
    (row.provider === 'pg_trgm' || row.provider === 'pg_bigm')
  ) {
    return {
      kind: 'generated_text',
      generatedColumnName: row.generatedColumnName,
      provider: row.provider,
      searchScope,
      coveredFieldIds,
    };
  }

  if (!row.languageConfig) return undefined;

  return {
    kind: 'generated_tsvector',
    generatedColumnName: row.generatedColumnName,
    languageConfig: row.languageConfig,
    searchScope,
    coveredFieldIds,
  };
};

export class PostgresTableSearchAccessPathResolver implements TableSearchAccessPathResolver {
  constructor(private readonly metaDb: Kysely<UnknownPostgresDatabase>) {}

  async resolve(_context: IExecutionContext, tableId: string) {
    try {
      const relation = await sql<{ relation_name: string | null }>`
        SELECT to_regclass('public.table_query_search_vector_config')::text AS relation_name
      `.execute(this.metaDb);
      if (!relation.rows[0]?.relation_name) return ok(undefined);

      const result = await sql<SearchAccessPathConfigRow>`
        SELECT
          generated_column_name AS "generatedColumnName",
          semantics,
          access_path AS "accessPath",
          provider,
          language_config AS "languageConfig",
          field_ids AS "fieldIds",
          search_scope AS "searchScope",
          status
        FROM table_query_search_vector_config
        WHERE table_id = ${tableId}
          AND status IN ('ready', 'rebuild_pending', 'stale')
        ORDER BY last_modified_time DESC NULLS LAST, created_time DESC NULLS LAST
        LIMIT 1
      `.execute(this.metaDb);

      return ok(toRecordSearchAccessPathFromConfig(result.rows[0]));
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to resolve table search access path'));
    }
  }
}

export class PostgresTableSearchVectorStatusReader implements TableSearchVectorStatusReader {
  constructor(private readonly metaDb: Kysely<UnknownPostgresDatabase>) {}

  async read(_context: IExecutionContext, tableId: string) {
    try {
      const relation = await sql<{ relation_name: string | null }>`
        SELECT to_regclass('public.table_query_search_vector_config')::text AS relation_name
      `.execute(this.metaDb);
      if (!relation.rows[0]?.relation_name) return ok(disabledStatus(tableId));

      const result = await sql<SearchVectorStatusRow>`
        SELECT status, semantics, access_path, provider, language_config, field_ids
        FROM table_query_search_vector_config
        WHERE table_id = ${tableId}
          AND status IN ('ready', 'rebuild_pending', 'stale')
        ORDER BY last_modified_time DESC NULLS LAST, created_time DESC
        LIMIT 1
      `.execute(this.metaDb);
      const row = result.rows[0];
      if (!row) return ok(disabledStatus(tableId));

      const state = parseState(row.status);
      return ok({
        tableId,
        state,
        configured: true,
        ...(row.language_config ? { languageConfig: row.language_config } : {}),
        semantics: row.semantics === 'substring' ? 'substring' : 'lexical',
        provider:
          row.provider === 'pg_bigm' || row.provider === 'pg_trgm' ? row.provider : 'tsvector',
        accessPath: row.access_path === 'generated_text' ? 'generated_text' : 'generated_tsvector',
        coveredFieldCount: fieldCount(row.field_ids),
      } satisfies TableSearchVectorStatus);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to read table search vector status'));
    }
  }
}
