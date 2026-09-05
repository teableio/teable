import { ActorId, BaseId, FieldName, Table, TableName } from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { PostgresTableSearchVectorSchemaMaintenanceScheduler } from './searchVectorMaintenance';
import type { UnknownPostgresDatabase } from './types';

describe('search vector schema invalidation', () => {
  it('invalidates every ready config even when the latest candidate is stale', async () => {
    const driver = new DummyDriver();
    const connection = await driver.acquireConnection();
    vi.spyOn(driver, 'acquireConnection').mockResolvedValue(connection);
    const executeQuery = vi
      .spyOn(connection, 'executeQuery')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'latest-stale-config' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-maintenance-task' }] })
      .mockResolvedValueOnce({ rows: [] });
    const db = new Kysely<UnknownPostgresDatabase>({
      dialect: {
        createDriver: () => driver,
        createAdapter: () => new PostgresAdapter(),
        createQueryCompiler: () => new PostgresQueryCompiler(),
        createIntrospector: (database) => new PostgresIntrospector(database),
      },
    });
    const builder = Table.builder()
      .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Schema invalidation')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    try {
      const result = await new PostgresTableSearchVectorSchemaMaintenanceScheduler(db).schedule(
        { actorId: ActorId.create('system')._unsafeUnwrap() },
        { table, reason: 'field_updated' }
      );
      expect(result._unsafeUnwrap()).toMatchObject({ status: 'coalesced' });
      const invalidation = executeQuery.mock.calls[2][0];
      expect(invalidation.sql.replace(/\s+/g, ' ').trim()).toContain(
        "WHERE table_id = $2 AND (status IN ('ready', 'rebuild_pending') OR id = $3)"
      );
      expect(invalidation.parameters).toEqual([
        'field_updated',
        table.id().toString(),
        'latest-stale-config',
      ]);
      expect(invalidation.sql).not.toContain('LIMIT');
    } finally {
      await db.destroy();
    }
  });
});
