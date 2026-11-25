import { randomUUID } from 'node:crypto';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { ensureV1MetaSchema } from './schema';

const databaseUrl = process.env.TEABLE_V2_TEST_DATABASE_URL ?? process.env.PRISMA_DATABASE_URL;

it('upgrades an earlier bootstrap schema without losing metadata or durable messages', async () => {
  const postgres = databaseUrl
    ? undefined
    : await new PostgreSqlContainer('postgres:16-alpine').start();
  const connectionString = databaseUrl ?? postgres!.getConnectionUri();
  const schema = `meta_upgrade_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new Kysely<V1TeableDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, options: `-c search_path=${schema}` }),
    }),
  });
  try {
    await ensureV1MetaSchema(db);
    await sql`INSERT INTO table_meta (id, base_id, name, db_table_name, version, "order", created_by)
      VALUES ('tbl_keep', 'bse_keep', 'Keep', 'keep.records', 1, 0, 'system')`.execute(db);
    await sql`INSERT INTO domain_event_outbox (id, base_id, message_name, schema_version, payload,
      payload_bytes, catalog_generation, required_consumers)
      VALUES ('msg_keep', 'bse_keep', 'record.updated', 1, '{}'::jsonb, 2, 1, '[]'::jsonb)`.execute(
      db
    );
    await sql`ALTER TABLE table_meta DROP COLUMN actor_storage_version`.execute(db);
    await sql`ALTER TABLE domain_event_outbox DROP COLUMN attribution`.execute(db);

    await ensureV1MetaSchema(db);
    const table = await sql<{
      actorVersion: number;
    }>`SELECT actor_storage_version AS "actorVersion" FROM table_meta WHERE id = 'tbl_keep'`.execute(
      db
    );
    expect(table.rows).toEqual([{ actorVersion: 0 }]);
    const event = await sql<{
      attribution: unknown;
    }>`SELECT attribution FROM domain_event_outbox WHERE id = 'msg_keep'`.execute(db);
    expect(event.rows).toEqual([{ attribution: null }]);
    await ensureV1MetaSchema(db);
    expect(
      (
        await sql<{
          count: string;
        }>`SELECT count(*)::text AS count FROM domain_event_outbox WHERE id = 'msg_keep'`.execute(
          db
        )
      ).rows[0].count
    ).toBe('1');
  } finally {
    await db.destroy();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await postgres?.stop();
  }
});
