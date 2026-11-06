import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { DATA_DB_MIGRATION_TABLE, DataDbMigrationService } from './data-db-migration.service';

const databaseUrl = process.env.PRISMA_DATABASE_URL;
if (process.env.UNIT_POSTGRES_REQUIRED === '1' && !databaseUrl) {
  throw new Error(
    'PRISMA_DATABASE_URL is required under UNIT_POSTGRES_REQUIRED=1 for the undo-capture upgrade postgres test'
  );
}
const describeWithPostgres = databaseUrl ? describe : describe.skip;

const undoCaptureMigrationIds = [
  '20260421000000_init_data_db_baseline',
  '20261101000000_add_undo_capture_old_tuple',
  '20261104000000_gate_inactive_undo_capture',
];

// Each case owns a throwaway schema so the real migration SQL runs through the real
// migration service without touching the shared public capture function.
const withUndoCaptureSchema = async (run: (client: Client, schema: string) => Promise<void>) => {
  const client = new Client({ connectionString: databaseUrl });
  const schema = `undo_gate_${crypto.randomUUID().replace(/-/g, '')}`;
  const legacySchema = `${schema}_legacy`;
  const migrations = undoCaptureMigrationIds.map((id) => {
    const sql = readFileSync(
      new URL(
        `../../../../../packages/db-data-prisma/prisma/migrations/${id}/migration.sql`,
        import.meta.url
      ),
      'utf8'
    );
    // The compatibility block is database-wide. Point it at an owned empty schema so
    // a capture function left in public by another test cannot be rewritten here.
    return {
      id,
      sql:
        id === undoCaptureMigrationIds[2]
          ? sql
              .replaceAll("'public'", `'${legacySchema}'`)
              .replaceAll(
                'public.__teable_capture_undo_row()',
                `${legacySchema}.__teable_capture_undo_row()`
              )
          : sql,
    };
  });

  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${legacySchema}"`);
    await expect(
      new DataDbMigrationService(migrations).migrate(databaseUrl!, schema)
    ).resolves.toEqual(migrations.map(({ id }) => id));
    await client.query(`SET search_path TO "${schema}"`);
    await run(client, schema);
  } finally {
    try {
      await client.query(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE; DROP SCHEMA IF EXISTS "${legacySchema}" CASCADE`
      );
    } finally {
      await client.end();
    }
  }
};

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

  it('leaves absent and empty batch ids unlogged even when the row cannot be serialized', async () => {
    await withUndoCaptureSchema(async (client) => {
      // json keeps the escape sequence verbatim while to_jsonb - which the capture
      // function calls - rejects it. Any serialization before the batch-id gate fails,
      // so an inactive path that stays writable proves the gate runs first.
      const unserializablePayload = String.raw`{"sentinel":"\u0000"}`;
      await client.query(`
        CREATE TABLE "records" (
          "__id" TEXT PRIMARY KEY,
          "value" TEXT,
          "payload" JSON
        );
        CREATE FUNCTION "seed_unserializable_payload"() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          NEW."payload" := '${unserializablePayload}'::json;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER "seed_unserializable_payload"
        BEFORE INSERT OR UPDATE ON "records"
        FOR EACH ROW EXECUTE FUNCTION "seed_unserializable_payload"();
        CREATE TRIGGER "__teable_undo_capture"
        AFTER INSERT OR UPDATE OR DELETE ON "records"
        FOR EACH ROW EXECUTE FUNCTION "__teable_capture_undo_row"();
      `);

      const mutate = async (recordId: string) => {
        await client.query(`INSERT INTO "records" ("__id", "value") VALUES ($1, 'created')`, [
          recordId,
        ]);
        await client.query(`UPDATE "records" SET "value" = 'updated' WHERE "__id" = $1`, [
          recordId,
        ]);
        await client.query(`INSERT INTO "records" ("__id", "value") VALUES ($1, 'discarded')`, [
          `${recordId}-dropped`,
        ]);
        await client.query(`DELETE FROM "records" WHERE "__id" = $1`, [`${recordId}-dropped`]);
      };

      // No setting at all, then an explicitly empty one: both are inactive.
      await mutate('absent-batch');
      await client.query("SELECT set_config('teable.undo_batch_id', '', false)");
      await mutate('empty-batch');

      expect(
        (await client.query(`SELECT count(*)::int AS "count" FROM "__undo_log"`)).rows
      ).toEqual([{ count: 0 }]);
      expect(
        (
          await client.query(
            `SELECT "__id", "value", "payload"::text AS "payload" FROM "records" ORDER BY "__id"`
          )
        ).rows
      ).toEqual([
        { __id: 'absent-batch', value: 'updated', payload: unserializablePayload },
        { __id: 'empty-batch', value: 'updated', payload: unserializablePayload },
      ]);
    });
  }, 30_000);

  it('captures full row snapshots and the physical old tuple for an active batch', async () => {
    await withUndoCaptureSchema(async (client) => {
      await client.query(`
        CREATE TABLE "records" (
          "__id" TEXT PRIMARY KEY,
          "value" TEXT,
          "payload" JSON
        );
        CREATE TRIGGER "__teable_undo_capture"
        AFTER INSERT OR UPDATE OR DELETE ON "records"
        FOR EACH ROW EXECUTE FUNCTION "__teable_capture_undo_row"();
      `);

      const readRecord = async (recordId: string) => {
        const { rows } = await client.query(
          `SELECT to_jsonb(record) AS "row",
                  jsonb_build_object(
                    'xmin', record.xmin::text,
                    'ctid', record.ctid::text,
                    'relationOid', record.tableoid::text,
                    'relationFilenode', pg_relation_filenode(record.tableoid)::text
                  ) AS "tuple"
           FROM "records" AS record WHERE "__id" = $1`,
          [recordId]
        );
        return rows[0] as { row: Record<string, unknown>; tuple: Record<string, string> };
      };

      await client.query("SELECT set_config('teable.undo_batch_id', 'active-batch', false)");
      await client.query(
        `INSERT INTO "records" ("__id", "value", "payload") VALUES ('target', 'before', $1::json)`,
        [JSON.stringify({ list: [1, 2, 3], nested: { flag: true } })]
      );
      const seeded = await readRecord('target');
      expect(seeded.tuple).toEqual({
        xmin: expect.any(String),
        ctid: expect.any(String),
        relationOid: expect.any(String),
        relationFilenode: expect.any(String),
      });
      await client.query(`UPDATE "records" SET "value" = 'after' WHERE "__id" = 'target'`);
      const predecessorOfDelete = await readRecord('target');
      await client.query(`DELETE FROM "records" WHERE "__id" = 'target'`);

      expect(
        (
          await client.query(`
            SELECT "operation", "old_row", "new_row",
                   "old_row" IS NULL AS "oldRowIsSqlNull",
                   "new_row" IS NULL AS "newRowIsSqlNull",
                   "old_tuple" IS NULL AS "tupleIsSqlNull",
                   "old_tuple"
            FROM "__undo_log" WHERE "batch_id" = 'active-batch' ORDER BY "id"
          `)
        ).rows
      ).toEqual([
        {
          operation: 'INSERT',
          old_row: null,
          oldRowIsSqlNull: true,
          new_row: seeded.row,
          newRowIsSqlNull: false,
          old_tuple: null,
          tupleIsSqlNull: true,
        },
        {
          operation: 'UPDATE',
          old_row: seeded.row,
          oldRowIsSqlNull: false,
          new_row: { ...seeded.row, value: 'after' },
          newRowIsSqlNull: false,
          old_tuple: seeded.tuple,
          tupleIsSqlNull: false,
        },
        {
          operation: 'DELETE',
          old_row: predecessorOfDelete.row,
          oldRowIsSqlNull: false,
          new_row: null,
          newRowIsSqlNull: true,
          old_tuple: predecessorOfDelete.tuple,
          tupleIsSqlNull: false,
        },
      ]);
      expect((await client.query(`SELECT count(*)::int AS "count" FROM "records"`)).rows).toEqual([
        { count: 0 },
      ]);
    });
  }, 30_000);

  it('keeps the batch id connection- and transaction-scoped across commit, rollback and a new connection', async () => {
    await withUndoCaptureSchema(async (client, schema) => {
      await client.query(`
        CREATE TABLE "records" (
          "__id" TEXT PRIMARY KEY,
          "value" TEXT
        );
        CREATE TRIGGER "__teable_undo_capture"
        AFTER INSERT OR UPDATE OR DELETE ON "records"
        FOR EACH ROW EXECUTE FUNCTION "__teable_capture_undo_row"();
      `);

      const logRows = async () =>
        (
          await client.query(
            `SELECT "batch_id", "operation", "record_id" FROM "__undo_log" ORDER BY "id"`
          )
        ).rows as { batch_id: string; operation: string; record_id: string }[];
      const currentBatchId = async (target: Client) =>
        (await target.query(`SELECT current_setting('teable.undo_batch_id', true) AS "value"`))
          .rows[0].value ?? '';
      const storedValue = async (recordId: string) =>
        (await client.query(`SELECT "value" FROM "records" WHERE "__id" = $1`, [recordId])).rows;

      // A transaction-local batch id expires at COMMIT.
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('teable.undo_batch_id', 'tx-commit', true)");
        await client.query(`INSERT INTO "records" ("__id", "value") VALUES ('committed', 'v1')`);
      } finally {
        await client.query('COMMIT');
      }
      const committedLog = await logRows();
      expect(committedLog).toEqual([
        { batch_id: 'tx-commit', operation: 'INSERT', record_id: 'committed' },
      ]);
      expect(await currentBatchId(client)).toBe('');

      await client.query(`UPDATE "records" SET "value" = 'v2' WHERE "__id" = 'committed'`);
      expect(await storedValue('committed')).toEqual([{ value: 'v2' }]);
      expect(await logRows()).toEqual(committedLog);

      // A transaction-local batch id also expires at ROLLBACK, leaving row and log intact.
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('teable.undo_batch_id', 'tx-rollback', true)");
        await client.query(
          `UPDATE "records" SET "value" = 'rolled-back' WHERE "__id" = 'committed'`
        );
        expect(await logRows()).toEqual([
          ...committedLog,
          { batch_id: 'tx-rollback', operation: 'UPDATE', record_id: 'committed' },
        ]);
      } finally {
        await client.query('ROLLBACK');
      }
      expect(await storedValue('committed')).toEqual([{ value: 'v2' }]);
      expect(await logRows()).toEqual(committedLog);
      expect(await currentBatchId(client)).toBe('');

      // A session-level batch id stays on this client only: a new connection to the same
      // schema captures nothing, while this client still does.
      await client.query("SELECT set_config('teable.undo_batch_id', 'session-batch', false)");
      await client.query(
        `INSERT INTO "records" ("__id", "value") VALUES ('session-captured', 'v1')`
      );
      const sessionLog = await logRows();
      expect(sessionLog).toEqual([
        ...committedLog,
        { batch_id: 'session-batch', operation: 'INSERT', record_id: 'session-captured' },
      ]);

      const other = new Client({ connectionString: databaseUrl });
      await other.connect();
      try {
        await other.query(`SET search_path TO "${schema}"`);
        expect(await currentBatchId(other)).toBe('');
        await other.query(
          `UPDATE "records" SET "value" = 'from-other-connection' WHERE "__id" = 'session-captured'`
        );
        expect(await logRows()).toEqual(sessionLog);
      } finally {
        await other.end();
      }

      await client.query(
        `UPDATE "records" SET "value" = 'from-owner' WHERE "__id" = 'session-captured'`
      );
      expect(await logRows()).toEqual([
        ...sessionLog,
        { batch_id: 'session-batch', operation: 'UPDATE', record_id: 'session-captured' },
      ]);
    });
  }, 30_000);

  it.each(['caller schema', 'qualified schema'])(
    'upgrades a referenced legacy function without changing its log destination: %s',
    async (logDestination) => {
      const client = new Client({ connectionString: databaseUrl });
      const suffix = crypto.randomUUID().replace(/-/g, '');
      const legacySchema = `undo_legacy_${suffix}`;
      const internalSchema = `undo_internal_${suffix}`;
      const loadMigration = (id: string) =>
        readFileSync(
          new URL(
            `../../../../../packages/db-data-prisma/prisma/migrations/${id}/migration.sql`,
            import.meta.url
          ),
          'utf8'
        );
      await client.connect();
      try {
        for (const schema of [legacySchema, internalSchema]) {
          await new DataDbMigrationService(
            undoCaptureMigrationIds.slice(0, 2).map((id) => ({ id, sql: loadMigration(id) }))
          ).migrate(databaseUrl!, schema);
        }
        if (logDestination === 'qualified schema') {
          await client.query(`SET search_path TO "${legacySchema}"`);
          await client.query(
            loadMigration(undoCaptureMigrationIds[1]).replace(
              'INSERT INTO "__undo_log"',
              `INSERT INTO "${legacySchema}"."__undo_log"`
            )
          );
        }
        await client.query(`SET search_path TO "${internalSchema}"`);
        await client.query(
          `CREATE TABLE records (__id text PRIMARY KEY, value text, payload json)`
        );
        await client.query(`INSERT INTO records VALUES ('target', 'before', $1::json)`, [
          String.raw`{"sentinel":"\u0000"}`,
        ]);
        await client.query(
          `CREATE TRIGGER "__teable_undo_capture" AFTER INSERT OR UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION "${legacySchema}"."__teable_capture_undo_row"()`
        );
        const functionOid = (
          await client.query(
            `SELECT tgfoid FROM pg_trigger WHERE tgrelid = 'records'::regclass AND tgname = '__teable_undo_capture'`
          )
        ).rows[0].tgfoid;
        // Remap only the fixed public namespace into an owned schema for test isolation.
        const upgrade = loadMigration(undoCaptureMigrationIds[2])
          .replaceAll("'public'", `'${legacySchema}'`)
          .replaceAll(
            'public.__teable_capture_undo_row()',
            `${legacySchema}.__teable_capture_undo_row()`
          );
        const migrationService = new DataDbMigrationService(
          undoCaptureMigrationIds.map((id) => ({
            id,
            sql: id === undoCaptureMigrationIds[2] ? upgrade : loadMigration(id),
          }))
        );
        await expect(migrationService.migrate(databaseUrl!, internalSchema)).resolves.toEqual([
          undoCaptureMigrationIds[2],
        ]);
        await expect(migrationService.migrate(databaseUrl!, internalSchema)).resolves.toEqual([]);
        expect(
          (
            await client.query(
              `SELECT tgfoid FROM pg_trigger WHERE tgrelid = 'records'::regclass AND tgname = '__teable_undo_capture'`
            )
          ).rows[0].tgfoid
        ).toBe(functionOid);
        await client.query(`UPDATE records SET value = 'inactive' WHERE __id = 'target'`);
        expect((await client.query(`SELECT value, payload::text FROM records`)).rows).toEqual([
          { value: 'inactive', payload: String.raw`{"sentinel":"\u0000"}` },
        ]);
        await client.query(
          `UPDATE records SET payload = '{"safe":true}'::json WHERE __id = 'target'`
        );
        await client.query(`SELECT set_config('teable.undo_batch_id', 'legacy-active', false)`);
        await client.query(`UPDATE records SET value = 'active' WHERE __id = 'target'`);
        const destination = logDestination === 'caller schema' ? internalSchema : legacySchema;
        const other = logDestination === 'caller schema' ? legacySchema : internalSchema;
        expect(
          (
            await client.query(
              `SELECT operation, old_row, new_row, old_tuple IS NOT NULL AS has_tuple FROM "${destination}".__undo_log`
            )
          ).rows
        ).toEqual([
          {
            operation: 'UPDATE',
            old_row: { __id: 'target', value: 'inactive', payload: { safe: true } },
            new_row: { __id: 'target', value: 'active', payload: { safe: true } },
            has_tuple: true,
          },
        ]);
        expect(
          (await client.query(`SELECT count(*)::int AS count FROM "${other}".__undo_log`)).rows
        ).toEqual([{ count: 0 }]);
      } finally {
        await client.query(
          `DROP SCHEMA IF EXISTS "${internalSchema}" CASCADE; DROP SCHEMA IF EXISTS "${legacySchema}" CASCADE`
        );
        await client.end();
      }
    },
    30_000
  );

  it('preserves SQL literals and operators while retaining the original migration checksum on reentry', async () => {
    const client = new Client({ connectionString: databaseUrl });
    const schema = `literal_migration_${crypto.randomUUID().replace(/-/g, '')}`;
    const migration = {
      id: 'literal_transport',
      sql: String.raw`
        CREATE TABLE literal_values AS
        SELECT '?'::text AS question, '??'::text AS pair,
               E'\\?'::text AS escaped_question,
               '{"key":true}'::jsonb ? 'key' AS has_key;
      `,
    };
    const service = new DataDbMigrationService([migration]);
    await client.connect();
    try {
      await expect(service.migrate(databaseUrl!, schema)).resolves.toEqual([migration.id]);
      expect((await client.query(`SELECT * FROM "${schema}".literal_values`)).rows).toEqual([
        { question: '?', pair: '??', escaped_question: '\\?', has_key: true },
      ]);
      const ledgerSql = `SELECT id, checksum, applied_at FROM "${schema}"."${DATA_DB_MIGRATION_TABLE}"`;
      const ledgerBefore = (await client.query(ledgerSql)).rows;
      expect(ledgerBefore).toEqual([
        {
          id: migration.id,
          checksum: createHash('sha256').update(migration.sql).digest('hex'),
          applied_at: expect.any(Date),
        },
      ]);
      await expect(service.migrate(databaseUrl!, schema)).resolves.toEqual([]);
      expect((await client.query(ledgerSql)).rows).toEqual(ledgerBefore);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  }, 30_000);

  it.each(['unrecognized', 'ambiguous'])(
    'leaves an %s legacy function and its migration ledger intact, then permits a repaired retry',
    async (definitionKind) => {
      const client = new Client({ connectionString: databaseUrl });
      const suffix = crypto.randomUUID().replace(/-/g, '');
      const legacySchema = `undo_unknown_${suffix}`;
      const internalSchema = `undo_retry_${suffix}`;
      const migrations = undoCaptureMigrationIds.map((id) => ({
        id,
        sql: readFileSync(
          new URL(
            `../../../../../packages/db-data-prisma/prisma/migrations/${id}/migration.sql`,
            import.meta.url
          ),
          'utf8'
        ),
      }));
      migrations[2].sql = migrations[2].sql.replaceAll("'public'", `'${legacySchema}'`);
      const service = new DataDbMigrationService(migrations);
      await client.connect();
      try {
        for (const schema of [legacySchema, internalSchema]) {
          await new DataDbMigrationService(migrations.slice(0, 2)).migrate(databaseUrl!, schema);
        }
        await client.query(`SET search_path TO "${legacySchema}"`);
        const assignment = "batch_id := current_setting('teable.undo_batch_id', true);";
        await client.query(
          migrations[1].sql.replace(
            assignment,
            definitionKind === 'ambiguous'
              ? `${assignment}\n${assignment}`
              : "batch_id := 'custom-batch';"
          )
        );
        await client.query(`SET search_path TO "${internalSchema}"`);
        await client.query(`
        CREATE TABLE records (__id text PRIMARY KEY, value text);
        INSERT INTO records VALUES ('target', 'before');
        CREATE TRIGGER "__teable_undo_capture" AFTER INSERT OR UPDATE OR DELETE ON records
          FOR EACH ROW EXECUTE FUNCTION "${legacySchema}"."__teable_capture_undo_row"();
      `);
        const definitionSql = `SELECT pg_get_functiondef('"${legacySchema}"."__teable_capture_undo_row"()'::regprocedure) AS definition`;
        const definitionBefore = (await client.query(definitionSql)).rows;
        const ledgerSql = `SELECT id, checksum, applied_at FROM "${internalSchema}"."${DATA_DB_MIGRATION_TABLE}" ORDER BY id`;
        const ledgerBefore = (await client.query(ledgerSql)).rows;
        await expect(service.migrate(databaseUrl!, internalSchema)).rejects.toThrow(
          'Unrecognized public undo capture function; refusing to move its batch gate'
        );
        expect((await client.query(definitionSql)).rows).toEqual(definitionBefore);
        expect((await client.query(ledgerSql)).rows).toEqual(ledgerBefore);
        expect((await client.query(`SELECT * FROM records`)).rows).toEqual([
          { __id: 'target', value: 'before' },
        ]);

        // A recognized legacy definition can be retried without faking a completed migration.
        await client.query(`SET search_path TO "${legacySchema}"`);
        await client.query(migrations[1].sql);
        await expect(service.migrate(databaseUrl!, internalSchema)).resolves.toEqual([
          migrations[2].id,
        ]);
        await expect(service.migrate(databaseUrl!, internalSchema)).resolves.toEqual([]);
        await client.query(`SET search_path TO "${internalSchema}"`);
        await client.query(`UPDATE records SET value = 'after' WHERE __id = 'target'`);
        expect((await client.query(`SELECT * FROM records`)).rows).toEqual([
          { __id: 'target', value: 'after' },
        ]);
        expect((await client.query(`SELECT count(*)::int AS count FROM __undo_log`)).rows).toEqual([
          { count: 0 },
        ]);
      } finally {
        await client.query(
          `DROP SCHEMA IF EXISTS "${internalSchema}" CASCADE; DROP SCHEMA IF EXISTS "${legacySchema}" CASCADE`
        );
        await client.end();
      }
    },
    30_000
  );

  it('upgrades the main database function without rewriting table triggers', async () => {
    const client = new Client({ connectionString: databaseUrl });
    const schema = `undo_main_${crypto.randomUUID().replace(/-/g, '')}`;
    await client.connect();
    try {
      await new DataDbMigrationService(
        undoCaptureMigrationIds.slice(0, 2).map((id) => ({
          id,
          sql: readFileSync(
            new URL(
              `../../../../../packages/db-data-prisma/prisma/migrations/${id}/migration.sql`,
              import.meta.url
            ),
            'utf8'
          ),
        }))
      ).migrate(databaseUrl!, schema);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(`CREATE TABLE records (__id text PRIMARY KEY, value text, payload json)`);
      await client.query(`INSERT INTO records VALUES ('target', 'before', $1::json)`, [
        String.raw`{"sentinel":"\u0000"}`,
      ]);
      await client.query(
        `CREATE TRIGGER "__teable_undo_capture" AFTER INSERT OR UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION "__teable_capture_undo_row"()`
      );
      const mainSql = readFileSync(
        new URL(
          '../../../../../packages/db-main-prisma/prisma/postgres/migrations/20261104000000_gate_inactive_undo_capture/migration.sql',
          import.meta.url
        ),
        'utf8'
      );
      // The production public target is isolated into this case's own schema.
      await client.query(mainSql.replaceAll('"public".', `"${schema}".`));
      await client.query(`UPDATE records SET value = 'after' WHERE __id = 'target'`);
      expect((await client.query(`SELECT value FROM records`)).rows).toEqual([{ value: 'after' }]);
      expect((await client.query(`SELECT count(*)::int AS count FROM __undo_log`)).rows).toEqual([
        { count: 0 },
      ]);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  }, 30_000);
});
