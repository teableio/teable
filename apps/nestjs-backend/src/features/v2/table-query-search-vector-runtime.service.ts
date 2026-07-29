import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { FieldId, type IRecordSearchAccessPath } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

type UnknownRow = Record<string, unknown>;

export type SearchVectorConfigRow = {
  readonly generatedColumnName: string;
  readonly semantics?: string;
  readonly accessPath?: string;
  readonly provider?: string;
  readonly languageConfig?: string | null;
  readonly fieldIds: unknown;
  readonly searchScope: string;
  readonly status: string;
};

export type TableQuerySearchVectorRuntimeMode = 'off' | 'auto';

export const tableQuerySearchVectorRuntimeEnv = 'V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME';
export const tableQuerySearchAccessPathRuntimeEnv = 'V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME';

export const resolveTableQuerySearchVectorRuntimeMode = (
  value: unknown
): TableQuerySearchVectorRuntimeMode => {
  if (typeof value === 'boolean') {
    return value ? 'auto' : 'off';
  }

  if (typeof value !== 'string') {
    return 'off';
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled', 'auto'].includes(normalized)) {
    return 'auto';
  }

  return 'off';
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
  row: SearchVectorConfigRow | undefined
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

export const hasSearchValueForSearchVectorRuntime = (search: unknown): boolean => {
  if (!Array.isArray(search)) {
    return false;
  }

  const [value] = search;
  return typeof value === 'string' && value.trim().length > 0;
};

@Injectable()
export class TableQuerySearchVectorRuntimeService {
  constructor(private readonly configService: ConfigService) {}

  async resolveForRecordSearch(input: {
    readonly container: DependencyContainer;
    readonly tableId: string;
    readonly search: unknown;
  }): Promise<IRecordSearchAccessPath | undefined> {
    if (!hasSearchValueForSearchVectorRuntime(input.search) || this.mode() !== 'auto') {
      return undefined;
    }

    try {
      const row = await this.readReadyConfig(input.container, input.tableId);
      return toRecordSearchAccessPathFromConfig(row);
    } catch {
      return undefined;
    }
  }

  private mode(): TableQuerySearchVectorRuntimeMode {
    return resolveTableQuerySearchVectorRuntimeMode(
      this.configService.get(tableQuerySearchAccessPathRuntimeEnv) ??
        this.configService.get(tableQuerySearchVectorRuntimeEnv)
    );
  }

  private async readReadyConfig(
    container: DependencyContainer,
    tableId: string
  ): Promise<SearchVectorConfigRow | undefined> {
    if (!container.isRegistered(v2MetaDbTokens.db)) {
      return undefined;
    }

    const metaDb = container.resolve<Kysely<UnknownRow>>(v2MetaDbTokens.db);
    const result = await sql<SearchVectorConfigRow>`
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
    `.execute(metaDb);

    return result.rows[0];
  }
}
