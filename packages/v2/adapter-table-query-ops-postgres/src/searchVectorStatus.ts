import { decodeTableSearchIndex } from '@teable/v2-adapter-db-postgres-shared';
import { FieldId, type IExecutionContext } from '@teable/v2-core';
import {
  type TableSearchVectorStatus,
  type TableSearchVectorStatusReader,
  type TableSearchVectorStatusState,
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
  readonly table_name: string | null;
  readonly search_index: unknown;
};

const knownStates = new Set<TableSearchVectorStatusState>(['ready', 'rebuild_pending', 'stale']);

const parseState = (value: string): TableSearchVectorStatusState =>
  knownStates.has(value as TableSearchVectorStatusState)
    ? (value as TableSearchVectorStatusState)
    : 'unknown';

const disabledStatus = (tableId: string): TableSearchVectorStatus => ({
  tableId,
  state: 'disabled',
  configured: false,
  serving: false,
  coveredFieldIds: [],
  coveredFieldCount: 0,
});

/** A published snapshot serves reads only while it is usable and bound to this physical table. */
export const isServingSearchSnapshot = (
  searchIndex: unknown,
  tableName: string | null
): boolean => {
  const snapshot = decodeTableSearchIndex(searchIndex);
  return Boolean(
    snapshot &&
    snapshot.dbTableName === tableName &&
    ((snapshot.document?.ready && snapshot.document.fields.length) ||
      (snapshot.residual?.ready && snapshot.residual.fields.length))
  );
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

export class PostgresTableSearchVectorStatusReader implements TableSearchVectorStatusReader {
  constructor(private readonly metaDb: Kysely<UnknownPostgresDatabase>) {}

  async read(_context: IExecutionContext, tableId: string) {
    try {
      const relation = await sql<{ relation_name: string | null }>`
        SELECT to_regclass('public.table_query_search_vector_config')::text AS relation_name
      `.execute(this.metaDb);
      if (!relation.rows[0]?.relation_name) return ok(disabledStatus(tableId));

      const result = await sql<SearchVectorStatusRow>`
        SELECT config.status, config.semantics, config.access_path, config.provider,
               config.language_config, config.field_ids,
               table_meta.db_table_name AS table_name,
               table_meta.search_index AS search_index
        FROM table_query_search_vector_config AS config
        LEFT JOIN table_meta ON table_meta.id = config.table_id
        WHERE config.table_id = ${tableId}
          AND config.status IN ('ready', 'rebuild_pending', 'stale')
        -- A rebuild marks the previous row stale inside the same transaction, so both carry the
        -- same last_modified_time and a re-used older row would win on created_time alone.
        ORDER BY (config.status = 'ready') DESC, config.last_modified_time DESC NULLS LAST,
                 config.created_time DESC
        LIMIT 1
      `.execute(this.metaDb);
      const row = result.rows[0];
      if (!row) return ok(disabledStatus(tableId));

      const state = parseState(row.status);
      const serving = isServingSearchSnapshot(row.search_index, row.table_name);
      const snapshot = decodeTableSearchIndex(row.search_index);
      // While a snapshot serves, its fields are the coverage reads actually use.
      const coveredFieldIds = (
        snapshot
          ? [
              ...(snapshot.document?.ready ? snapshot.document.fields : []),
              ...(snapshot.residual?.ready ? snapshot.residual.fields : []),
            ].map((field) => field.fieldId)
          : row.semantics === 'substring'
            ? []
            : parseFieldIds(row.field_ids).map((fieldId) => fieldId.toString())
      ).map(String);
      const searchScope = snapshot?.searchScope;
      return ok({
        tableId,
        state:
          snapshot &&
          ((snapshot.document && !snapshot.document.ready) ||
            (snapshot.residual && !snapshot.residual.ready))
            ? 'stale'
            : state,
        documentFieldIds: snapshot?.document?.ready
          ? snapshot.document.fields.map((field) => field.fieldId)
          : [],
        residualFieldIds: snapshot?.residual?.ready
          ? snapshot.residual.fields.map((field) => field.fieldId)
          : [],
        configured: true,
        serving,
        coveredFieldIds,
        configuredFieldIds: parseFieldIds(row.field_ids).map((id) => id.toString()),
        ...(searchScope ? { searchScope } : {}),
        ...(row.language_config ? { languageConfig: row.language_config } : {}),
        semantics: row.semantics === 'substring' ? 'substring' : 'lexical',
        provider: snapshot?.document?.ready
          ? snapshot.document.provider
          : snapshot?.residual?.ready
            ? snapshot.residual.provider
            : row.provider === 'pg_bigm' || row.provider === 'pg_trgm'
              ? row.provider
              : 'tsvector',
        accessPath: row.access_path === 'generated_text' ? 'generated_text' : 'generated_tsvector',
        coveredFieldCount: coveredFieldIds.length,
      } satisfies TableSearchVectorStatus);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to read table search vector status'));
    }
  }
}
