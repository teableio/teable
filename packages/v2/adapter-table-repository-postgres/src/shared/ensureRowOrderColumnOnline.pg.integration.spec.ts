import { randomUUID } from 'node:crypto';
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DynamicDB } from '../record/query-builder';
import {
  ensureRowOrderColumns,
  markTableCreatedInCurrentTransaction,
  rowOrderColumnNameForView,
  rowOrderIndexName,
} from './ensureRowOrderColumnOnline';

const databaseUrl = process.env.TEABLE_V2_TEST_DATABASE_URL;
const isNativePostgres = (() => {
  try {
    return (
      databaseUrl != null && ['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)
    );
  } catch {
    return false;
  }
})();
const describeWithPostgres = isNativePostgres ? describe : describe.skip;
const schema = `t8110_${randomUUID().replaceAll('-', '')}`;
const dataSchema = `${schema}_data`;
const poolOptions = {
  connectionTimeoutMillis: 1_000,
  allowExitOnIdle: true,
} as const;

const qualifiedTable = (tableName: string): string => `${schema}.${tableName}`;

const readRelationId = async (db: Kysely<DynamicDB>, tableName: string): Promise<string> => {
  const result = await sql<{ relationId: string | null }>`
    SELECT to_regclass(${qualifiedTable(tableName)})::oid::text AS "relationId"
  `.execute(db);
  const relationId = result.rows[0]?.relationId;
  if (!relationId) throw new Error(`Missing test relation ${qualifiedTable(tableName)}`);
  return relationId;
};

const readOrders = async (
  db: Kysely<DynamicDB>,
  tableName: string,
  viewId: string,
  schemaName = schema
): Promise<ReadonlyArray<{ id: string; autoNumber: number; orderValue: number }>> => {
  const result = await sql<{ id: string; autoNumber: number; orderValue: number }>`
    SELECT
      id,
      __auto_number AS "autoNumber",
      ${sql.id(rowOrderColumnNameForView(viewId))} AS "orderValue"
    FROM ${sql.id(schemaName, tableName)}
    ORDER BY __auto_number
  `.execute(db);
  return result.rows;
};

const readIndexState = async (
  db: Kysely<DynamicDB>,
  indexName: string,
  schemaName = schema
): Promise<{ isReady: boolean; isValid: boolean } | undefined> => {
  const result = await sql<{ isReady: boolean; isValid: boolean }>`
    SELECT i.indisready AS "isReady", i.indisvalid AS "isValid"
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = idx.relnamespace
    WHERE n.nspname = ${schemaName}
      AND idx.relname = ${indexName}
  `.execute(db);
  return result.rows[0];
};

describeWithPostgres('row-order transaction-local table registry (native PostgreSQL)', () => {
  let singleClientDb: Kysely<DynamicDB>;
  let twoClientDb: Kysely<DynamicDB>;

  beforeAll(async () => {
    singleClientDb = await createV2PostgresDb<DynamicDB>({
      pg: { connectionString: databaseUrl!, pool: { ...poolOptions, max: 1 } },
    });
    await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(singleClientDb);
    twoClientDb = await createV2PostgresDb<DynamicDB>({
      pg: { connectionString: databaseUrl!, pool: { ...poolOptions, max: 2 } },
    });
  });

  afterAll(async () => {
    try {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(dataSchema)} CASCADE`.execute(singleClientDb);
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schema)} CASCADE`.execute(singleClientDb);
    } finally {
      await Promise.all([twoClientDb?.destroy(), singleClientDb?.destroy()].filter(Boolean));
    }
  });
  it('registers unqualified tables in their configured search_path schema', async () => {
    const dataSchema = `${schema}_data`;
    const tableName = 'unqualified_target';
    const viewId = 'viw_native_search_path';
    const indexName = rowOrderIndexName(`${dataSchema}.${tableName}`, viewId);
    await sql`CREATE SCHEMA ${sql.id(dataSchema)}`.execute(singleClientDb);

    await singleClientDb.transaction().execute(async (trx) => {
      await sql`SELECT set_config('search_path', ${`${dataSchema}, public`}, true)`.execute(trx);
      await sql`
        CREATE TABLE ${sql.id(tableName)} (
          id text PRIMARY KEY,
          __auto_number double precision NOT NULL
        )
      `.execute(trx);
      await markTableCreatedInCurrentTransaction(trx, tableName);
      await sql`INSERT INTO ${sql.id(tableName)} (id, __auto_number) VALUES ('row-1', 2)`.execute(
        trx
      );
      await ensureRowOrderColumns(trx, singleClientDb, tableName, [viewId]);
      const orders = await sql`
        SELECT ${sql.id(rowOrderColumnNameForView(viewId))} AS order_value
        FROM ${sql.id(tableName)}
      `.execute(trx);
      expect(orders.rows).toEqual([{ order_value: 2 }]);
      expect(await readIndexState(trx, indexName, dataSchema)).toEqual({
        isReady: true,
        isValid: true,
      });
    });

    const relation = await sql<{ relation_id: string | null }>`
      SELECT to_regclass(${`${dataSchema}.${tableName}`})::oid::text AS relation_id
    `.execute(singleClientDb);
    expect(relation.rows[0]?.relation_id).toBeTruthy();
  });

  it('uses the creating transaction after subtransaction DDL without a second pool checkout', async () => {
    const parent = qualifiedTable('parent');
    const target = qualifiedTable('created_in_tx');
    const viewId = 'viw_native_current_tx';
    const indexName = rowOrderIndexName(target, viewId);

    await sql`CREATE TABLE ${sql.table(parent)} (id text PRIMARY KEY)`.execute(singleClientDb);
    await sql`INSERT INTO ${sql.table(parent)} (id) VALUES ('parent-1'), ('parent-2')`.execute(
      singleClientDb
    );

    await singleClientDb.transaction().execute(async (trx) => {
      await sql`
        CREATE TABLE ${sql.table(target)} (
          id text PRIMARY KEY,
          parent_id text NOT NULL,
          __auto_number double precision NOT NULL
        )
      `.execute(trx);
      await markTableCreatedInCurrentTransaction(trx, target);

      await sql`
        DO $$
        BEGIN
          ALTER TABLE ${sql.table(target)}
          ADD CONSTRAINT ${sql.id('created_in_tx_parent_fk')}
          FOREIGN KEY (parent_id) REFERENCES ${sql.table(parent)} (id);
        EXCEPTION WHEN duplicate_object THEN
          NULL;
        END
        $$
      `.execute(trx);
      await sql`
        INSERT INTO ${sql.table(target)} (id, parent_id, __auto_number)
        VALUES ('row-1', 'parent-1', 10), ('row-2', 'parent-2', 20)
      `.execute(trx);

      await ensureRowOrderColumns(trx, singleClientDb, target, [viewId]);

      expect(await readOrders(trx, 'created_in_tx', viewId)).toEqual([
        { id: 'row-1', autoNumber: 10, orderValue: 10 },
        { id: 'row-2', autoNumber: 20, orderValue: 20 },
      ]);
      expect(await readIndexState(trx, indexName)).toEqual({ isReady: true, isValid: true });
    });

    expect(await readOrders(singleClientDb, 'created_in_tx', viewId)).toHaveLength(2);
  });

  it('does not transfer a rolled-back table registration to a restored relation with the same name', async () => {
    const tableName = 'restored_target';
    const target = qualifiedTable(tableName);
    const viewId = 'viw_native_restored_oid';
    const indexName = rowOrderIndexName(target, viewId);

    await sql`
      CREATE TABLE ${sql.table(target)} (
        id text PRIMARY KEY,
        __auto_number double precision NOT NULL
      )
    `.execute(twoClientDb);
    await sql`
      INSERT INTO ${sql.table(target)} (id, __auto_number)
      VALUES ('row-1', 3), ('row-2', 7)
    `.execute(twoClientDb);
    const committedRelationId = await readRelationId(twoClientDb, tableName);

    await twoClientDb.transaction().execute(async (trx) => {
      await sql`SAVEPOINT registry_probe`.execute(trx);
      await sql`
        ALTER TABLE ${sql.table(target)} RENAME TO ${sql.id('renamed_original')}
      `.execute(trx);
      await sql`
        CREATE TABLE ${sql.table(target)} (
          id text PRIMARY KEY,
          __auto_number double precision NOT NULL
        )
      `.execute(trx);
      await markTableCreatedInCurrentTransaction(trx, target);
      expect(await readRelationId(trx, tableName)).not.toBe(committedRelationId);

      await sql`ROLLBACK TO SAVEPOINT registry_probe`.execute(trx);
      await sql`RELEASE SAVEPOINT registry_probe`.execute(trx);
      expect(await readRelationId(trx, tableName)).toBe(committedRelationId);

      await ensureRowOrderColumns(trx, twoClientDb, target, [viewId]);

      expect(await readOrders(trx, tableName, viewId)).toEqual([
        { id: 'row-1', autoNumber: 3, orderValue: 3 },
        { id: 'row-2', autoNumber: 7, orderValue: 7 },
      ]);
      expect(await readIndexState(trx, indexName)).toBeUndefined();
    });
  });

  it('finds a committed unqualified table through the configured search_path and keeps online DDL', async () => {
    const tableName = 'committed_unqualified_target';
    const viewId = 'viw_native_search_path_committed';
    const indexName = rowOrderIndexName(`${dataSchema}.${tableName}`, viewId);
    const dataDb = singleClientDb.withSchema(dataSchema) as Kysely<DynamicDB>;
    await sql`
      CREATE TABLE ${sql.id(dataSchema, tableName)} (
        id text PRIMARY KEY,
        __auto_number double precision NOT NULL
      )
    `.execute(singleClientDb);
    await sql`
      INSERT INTO ${sql.id(dataSchema, tableName)} (id, __auto_number)
      VALUES ('row-1', 5), ('row-2', 8)
    `.execute(singleClientDb);

    await ensureRowOrderColumns(dataDb, dataDb, tableName, [viewId]);

    expect(await readOrders(dataDb, tableName, viewId, dataSchema)).toEqual([
      { id: 'row-1', autoNumber: 5, orderValue: 5 },
      { id: 'row-2', autoNumber: 8, orderValue: 8 },
    ]);
    expect(await readIndexState(singleClientDb, indexName, dataSchema)).toEqual({
      isReady: true,
      isValid: true,
    });
  });

  it('backfills a committed table online and creates a valid index', async () => {
    const tableName = 'committed_target';
    const target = qualifiedTable(tableName);
    const viewId = 'viw_native_committed';
    const indexName = rowOrderIndexName(target, viewId);

    await sql`
      CREATE TABLE ${sql.table(target)} (
        id text PRIMARY KEY,
        __auto_number double precision NOT NULL
      )
    `.execute(singleClientDb);
    await sql`
      INSERT INTO ${sql.table(target)} (id, __auto_number)
      VALUES ('row-1', 4), ('row-2', 9)
    `.execute(singleClientDb);

    await ensureRowOrderColumns(singleClientDb, singleClientDb, target, [viewId]);

    expect(await readOrders(singleClientDb, tableName, viewId)).toEqual([
      { id: 'row-1', autoNumber: 4, orderValue: 4 },
      { id: 'row-2', autoNumber: 9, orderValue: 9 },
    ]);
    expect(await readIndexState(singleClientDb, indexName)).toEqual({
      isReady: true,
      isValid: true,
    });
  });
});
