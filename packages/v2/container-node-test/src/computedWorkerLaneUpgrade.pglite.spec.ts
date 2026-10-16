import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createV2PostgresPgliteDb } from '@teable/v2-adapter-db-postgres-pglite';
import { ensureV1MetaSchema } from '@teable/v2-adapter-repository-postgres';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

describe('persisted PGlite computed worker lane upgrade', () => {
  it('preserves historical work as production across repeated schema initialization', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teable-worker-lane-'));
    const config = { pg: { connectionString: join(directory, 'database') } };
    let db = await createV2PostgresPgliteDb<V1TeableDatabase>(config);

    try {
      await ensureV1MetaSchema(db);
      // Recreate the pre-lane schema while retaining its four-column pending unique index.
      await sql`ALTER TABLE computed_update_outbox DROP COLUMN worker_lane`.execute(db);
      await sql`ALTER TABLE computed_update_dead_letter DROP COLUMN worker_lane`.execute(db);
      await sql`
        INSERT INTO computed_update_outbox
          (id, base_id, seed_table_id, change_type, status, plan_hash, run_id, seed_record_ids)
        VALUES
          ('historical-pending', 'base', 'table', 'update', 'pending', 'plan', 'run', '["record"]')
      `.execute(db);
      await sql`
        INSERT INTO computed_update_dead_letter
          (id, base_id, seed_table_id, change_type, status, plan_hash, run_id,
           next_run_at, failed_at, created_at, updated_at, last_error)
        VALUES
          ('historical-failed', 'base', 'table', 'update', 'dead', 'plan', 'run',
           now(), now(), now(), now(), 'historical failure')
      `.execute(db);
      const historicalPending = await db.selectFrom('computed_update_outbox').selectAll().execute();
      const historicalFailed = await db
        .selectFrom('computed_update_dead_letter')
        .selectAll()
        .execute();

      await db.destroy();
      db = await createV2PostgresPgliteDb<V1TeableDatabase>(config);

      for (let initialization = 0; initialization < 2; initialization++) {
        await ensureV1MetaSchema(db);
        expect(
          await db
            .selectFrom('computed_update_outbox')
            .selectAll()
            .where('worker_lane', '=', 'production')
            .execute()
        ).toEqual(historicalPending.map((row) => ({ ...row, worker_lane: 'production' })));
        expect(
          await db
            .selectFrom('computed_update_dead_letter')
            .selectAll()
            .where('worker_lane', '=', 'production')
            .execute()
        ).toEqual(historicalFailed.map((row) => ({ ...row, worker_lane: 'production' })));
      }

      for (const table of ['computed_update_outbox', 'computed_update_dead_letter'] as const) {
        await expect(
          sql`UPDATE ${sql.table(table)} SET worker_lane = NULL`.execute(db)
        ).rejects.toMatchObject({ code: '23502' });
        await sql`
          UPDATE ${sql.table(table)} SET worker_lane = DEFAULT
        `.execute(db);
        expect(await db.selectFrom(table).select('worker_lane').execute()).toEqual([
          { worker_lane: 'production' },
        ]);
      }

      // A different lane must not bypass the existing pending deduplication fence.
      await expect(
        sql`
          INSERT INTO computed_update_outbox
            (id, base_id, seed_table_id, change_type, status, plan_hash, run_id, worker_lane)
          VALUES
            ('staging-duplicate', 'base', 'table', 'update', 'pending', 'plan', 'run', 'staging')
        `.execute(db)
      ).rejects.toMatchObject({ code: '23505' });
    } finally {
      await db.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
