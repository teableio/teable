import { ActorId, type IRecordSearchAccessPath } from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import {
  PostgresTableSearchAccessPathResolver,
  PostgresTableSearchVectorStatusReader,
  toRecordSearchAccessPathFromConfig,
} from './searchVectorStatus';
import type { UnknownPostgresDatabase } from './types';

const coveredFieldIdStrings = (accessPath: IRecordSearchAccessPath | undefined): string[] =>
  accessPath && accessPath.kind !== 'default'
    ? accessPath.coveredFieldIds.map((id) => id.toString())
    : [];

describe('toRecordSearchAccessPathFromConfig', () => {
  it('converts a ready config row into a generated tsvector access path', () => {
    const fieldId = `fld${'a'.repeat(16)}`;

    const accessPath = toRecordSearchAccessPathFromConfig({
      generatedColumnName: '__tqops_search_vector',
      languageConfig: 'simple',
      fieldIds: JSON.stringify([fieldId]),
      searchScope: 'all_fields',
      status: 'ready',
    });

    expect(accessPath).toMatchObject({
      kind: 'generated_tsvector',
      generatedColumnName: '__tqops_search_vector',
      languageConfig: 'simple',
      searchScope: 'all_fields',
    });
    expect(coveredFieldIdStrings(accessPath)).toEqual([fieldId]);
  });

  it('converts a ready substring config into a generated text access path', () => {
    const fieldId = `fld${'b'.repeat(16)}`;
    const accessPath = toRecordSearchAccessPathFromConfig({
      generatedColumnName: '__tqops_search_document',
      semantics: 'substring',
      accessPath: 'generated_text',
      provider: 'pg_bigm',
      fieldIds: [fieldId],
      searchScope: 'all_fields',
      status: 'ready',
    });

    expect(accessPath).toMatchObject({
      kind: 'generated_text',
      generatedColumnName: '__tqops_search_document',
      provider: 'pg_bigm',
      searchScope: 'all_fields',
    });
    expect(coveredFieldIdStrings(accessPath)).toEqual([fieldId]);
  });

  it('does not create an access path when covered fields are missing or invalid', () => {
    expect(
      toRecordSearchAccessPathFromConfig({
        generatedColumnName: '__tqops_search_vector',
        languageConfig: 'simple',
        fieldIds: JSON.stringify(['not-a-field']),
        searchScope: 'all_fields',
        status: 'ready',
      })
    ).toBeUndefined();
  });

  it('does not convert a pending config into a usable access path', () => {
    expect(
      toRecordSearchAccessPathFromConfig({
        generatedColumnName: '__tqops_search_vector',
        languageConfig: 'simple',
        fieldIds: JSON.stringify([`fld${'a'.repeat(16)}`]),
        searchScope: 'all_fields',
        status: 'rebuild_pending',
      })
    ).toBeUndefined();
  });
});

describe('search config selection SQL', () => {
  const tableId = `tbl${'a'.repeat(16)}`;
  const context = { actorId: ActorId.create('system')._unsafeUnwrap() };

  const createDatabase = async () => {
    const driver = new DummyDriver();
    const connection = await driver.acquireConnection();
    vi.spyOn(driver, 'acquireConnection').mockResolvedValue(connection);
    const executeQuery = vi.spyOn(connection, 'executeQuery').mockResolvedValueOnce({
      rows: [{ relation_name: 'table_query_search_vector_config' }],
    });
    const db = new Kysely<UnknownPostgresDatabase>({
      dialect: {
        createDriver: () => driver,
        createAdapter: () => new PostgresAdapter(),
        createQueryCompiler: () => new PostgresQueryCompiler(),
        createIntrospector: (database) => new PostgresIntrospector(database),
      },
    });
    return { db, executeQuery };
  };

  it('filters out newer stale or pending configs before selecting a ready runtime path', async () => {
    const { db, executeQuery } = await createDatabase();
    executeQuery.mockResolvedValueOnce({
      rows: [
        {
          generatedColumnName: '__tqops_search_document',
          semantics: 'substring',
          accessPath: 'generated_text',
          provider: 'pg_trgm',
          fieldIds: [`fld${'a'.repeat(16)}`],
          searchScope: 'selected_fields',
          status: 'ready',
        },
      ],
    });
    try {
      const result = await new PostgresTableSearchAccessPathResolver(db).resolve(context, tableId);
      expect(result._unsafeUnwrap()).toMatchObject({ kind: 'generated_text' });
      const query = executeQuery.mock.calls[1][0];
      expect(query.sql.replace(/\s+/g, ' ').trim()).toContain(
        "WHERE table_id = $1 AND status = 'ready' ORDER BY last_modified_time DESC NULLS LAST, created_time DESC NULLS LAST, id DESC LIMIT 1"
      );
      expect(query.parameters).toEqual([tableId]);
    } finally {
      await db.destroy();
    }
  });

  it('returns no runtime path when no ready config exists', async () => {
    const { db, executeQuery } = await createDatabase();
    executeQuery.mockResolvedValueOnce({ rows: [] });
    try {
      const result = await new PostgresTableSearchAccessPathResolver(db).resolve(context, tableId);
      expect(result._unsafeUnwrap()).toBeUndefined();
    } finally {
      await db.destroy();
    }
  });

  it('keeps reporting the latest pending configuration in the administration status', async () => {
    const { db, executeQuery } = await createDatabase();
    executeQuery.mockResolvedValueOnce({
      rows: [{ status: 'rebuild_pending', field_ids: [] }],
    });
    try {
      const result = await new PostgresTableSearchVectorStatusReader(db).read(context, tableId);
      expect(result._unsafeUnwrap()).toMatchObject({ state: 'rebuild_pending', configured: true });
      expect(executeQuery.mock.calls[1][0].sql).toContain(
        "AND status IN ('ready', 'rebuild_pending', 'stale')"
      );
    } finally {
      await db.destroy();
    }
  });
});
