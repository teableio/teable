import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { DataDbMigrationService } from './data-db-migration.service';

const databaseUrl = process.env.PRISMA_DATABASE_URL;
if (process.env.UNIT_POSTGRES_REQUIRED === '1' && !databaseUrl) {
  throw new Error(
    'PRISMA_DATABASE_URL is required under UNIT_POSTGRES_REQUIRED=1 for the undo-capture upgrade postgres test'
  );
}
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('undo-capture old tuple migration (postgres)', () => {
  it('upgrades the legacy function without backfilling rows or mixing physical evidence into business data', async () => {
    const client = new Client({ connectionString: databaseUrl });
    const schema = `undo_upgrade_${crypto.randomUUID().replace(/-/g, '')}`;
    const [baseline, upgrade] = [
      '20260421000000_init_data_db_baseline',
      '20261101000000_add_undo_capture_old_tuple',
    ].map((id) => ({
      id,
      sql: readFileSync(
        new URL(
          `../../../../../packages/db-data-prisma/prisma/migrations/${id}/migration.sql`,
          import.meta.url
        ),
        'utf8'
      ),
    }));
    await client.connect();
    try {
      // Reuse the actual pre-upgrade table/function, not a current-runtime fixture.
      await expect(
        new DataDbMigrationService([baseline]).migrate(databaseUrl!, schema)
      ).resolves.toEqual([baseline.id]);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(`
        CREATE TABLE "records" (
          "__id" TEXT PRIMARY KEY,
          "value" TEXT,
          "relationOid" TEXT,
          "relationFilenode" TEXT,
          "old_tuple" JSONB
        );
        CREATE TRIGGER "__teable_undo_capture"
        AFTER INSERT OR UPDATE OR DELETE ON "records"
        FOR EACH ROW EXECUTE FUNCTION "__teable_capture_undo_row"();
      `);
      // xmin/ctid are reserved system-column names in PostgreSQL. The other tuple
      // keys and old_tuple are legal business columns and must remain untouched.
      const original = {
        __id: 'existing',
        value: 'original',
        relationOid: 'business-oid',
        relationFilenode: 'business-filenode',
        old_tuple: { xmin: 'business-xmin', ctid: 'business-ctid' },
      };
      await client.query("SELECT set_config('teable.undo_batch_id', 'legacy', false)");
      await client.query(
        `INSERT INTO "records" ("__id", "value", "relationOid", "relationFilenode", "old_tuple")
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          original.__id,
          original.value,
          original.relationOid,
          original.relationFilenode,
          JSON.stringify(original.old_tuple),
        ]
      );
      await client.query(
        `UPDATE "records" SET "value" = 'legacy-updated' WHERE "__id" = 'existing'`
      );
      const legacy = await client.query(
        `SELECT to_jsonb(log) AS row FROM "__undo_log" AS log ORDER BY "id"`
      );
      expect(legacy.rows).toHaveLength(2);
      expect(legacy.rows.every(({ row }) => !('old_tuple' in row))).toBe(true);
      expect(legacy.rows[1].row.old_row).toEqual(original);

      await expect(
        new DataDbMigrationService([baseline, upgrade]).migrate(databaseUrl!, schema)
      ).resolves.toEqual([upgrade.id]);
      const upgradedLegacy = await client.query(`
        SELECT to_jsonb(log) - 'old_tuple' AS row,
               "old_tuple" IS NULL AS "tupleIsSqlNull"
        FROM "__undo_log" AS log ORDER BY "id"
      `);
      expect(upgradedLegacy.rows).toEqual(
        legacy.rows.map(({ row }) => ({ row, tupleIsSqlNull: true }))
      );

      const readRecord = () =>
        client.query(`
          SELECT to_jsonb(record) AS row,
                 jsonb_build_object(
                   'xmin', record.xmin::text,
                   'ctid', record.ctid::text,
                   'relationOid', record.tableoid::text,
                   'relationFilenode', pg_relation_filenode(record.tableoid)::text
                 ) AS tuple
          FROM "records" AS record WHERE "__id" = 'existing'
        `);
      const predecessor = (await readRecord()).rows[0];
      expect(predecessor.tuple).toEqual({
        xmin: expect.any(String),
        ctid: expect.any(String),
        relationOid: expect.any(String),
        relationFilenode: expect.any(String),
      });
      await client.query("SELECT set_config('teable.undo_batch_id', 'updated', false)");
      await client.query(`UPDATE "records" SET "value" = 'updated' WHERE "__id" = 'existing'`);
      const updated = await client.query(`
        SELECT "operation", "old_row", "new_row", "old_tuple"
        FROM "__undo_log" WHERE "batch_id" = 'updated'
      `);
      expect(updated.rows).toEqual([
        {
          operation: 'UPDATE',
          old_row: predecessor.row,
          new_row: { ...predecessor.row, value: 'updated' },
          old_tuple: predecessor.tuple,
        },
      ]);

      const beforeRollback = await readRecord();
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('teable.undo_batch_id', 'rolled-back', true)");
        await client.query(
          `UPDATE "records" SET "value" = 'rolled-back' WHERE "__id" = 'existing'`
        );
        const pending = await client.query(`
          SELECT "old_row", "old_tuple" FROM "__undo_log" WHERE "batch_id" = 'rolled-back'
        `);
        expect(pending.rows).toEqual([
          { old_row: beforeRollback.rows[0].row, old_tuple: beforeRollback.rows[0].tuple },
        ]);
      } finally {
        await client.query('ROLLBACK');
      }
      expect((await readRecord()).rows).toEqual(beforeRollback.rows);
      expect(
        (await client.query(`SELECT "id" FROM "__undo_log" WHERE "batch_id" = 'rolled-back'`)).rows
      ).toEqual([]);

      await client.query("SELECT set_config('teable.undo_batch_id', 'inserted', false)");
      await client.query(`INSERT INTO "records" ("__id") VALUES ('inserted')`);
      const inserted = await client.query(`
        SELECT "operation", "old_row" IS NULL AS "oldRowIsSqlNull",
               "old_tuple" IS NULL AS "tupleIsSqlNull", "new_row"
        FROM "__undo_log" WHERE "batch_id" = 'inserted'
      `);
      expect(inserted.rows).toEqual([
        {
          operation: 'INSERT',
          oldRowIsSqlNull: true,
          tupleIsSqlNull: true,
          new_row: {
            __id: 'inserted',
            value: null,
            relationOid: null,
            relationFilenode: null,
            old_tuple: null,
          },
        },
      ]);
    } finally {
      try {
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await client.end();
      }
    }
  }, 30_000);
});
