import { createV2PostgresPgliteDb } from '@teable/v2-adapter-db-postgres-pglite';
import { ensureV1MetaSchema } from '@teable/v2-adapter-repository-postgres';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql } from 'kysely';
import { expect, it } from 'vitest';

it('installs the computed dead-letter recovery guard in PGlite', async () => {
  const db = await createV2PostgresPgliteDb<V1TeableDatabase>({
    pg: { connectionString: 'memory://' },
  });

  try {
    await ensureV1MetaSchema(db);
    await sql`
      INSERT INTO computed_update_dead_letter
        (id, base_id, seed_table_id, change_type, status, next_run_at, plan_hash, dirty_stats,
         run_id, failed_at, created_at, updated_at)
      VALUES
        ('guarded-archive', 'base', 'table', 'update', 'dead', now(), 'plan',
         '{"rerunInputs":{"version":1}}'::jsonb, 'run', now(), now(), now())
    `.execute(db);

    await expect(
      sql`DELETE FROM computed_update_dead_letter WHERE id = 'guarded-archive'`.execute(db)
    ).rejects.toMatchObject({ code: '23514' });

    await sql`SELECT computed_outbox_discard(ARRAY['guarded-archive']::text[])`.execute(db);
    expect(
      await db
        .selectFrom('computed_update_dead_letter')
        .select('id')
        .where('id', '=', 'guarded-archive')
        .execute()
    ).toEqual([]);
  } finally {
    await db.destroy();
  }
});
