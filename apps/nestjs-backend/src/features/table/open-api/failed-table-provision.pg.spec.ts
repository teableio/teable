import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { container } from '@teable/v2-di';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupFailedTableProvision, listFailedTableProvisions } from './failed-table-provision';

// Run only against an explicitly supplied disposable local PostgreSQL test container.
const port = process.env.PROVISION_TEST_PG_PORT;
const baseId = 'bseProvisionTest0001';
const tableId = 'tblProvisionTest0001';
const suite = port ? describe : describe.skip;
suite('failed import cleanup on PostgreSQL', () => {
  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: new Pool({
        host: '127.0.0.1',
        port: Number(port),
        user: 'postgres',
        password: 'test',
        database: 'postgres',
        options: '-c search_path=provision_cleanup_meta,public',
      }),
    }),
  });
  const c = container.createChildContainer();
  c.registerInstance(v2MetaDbTokens.db, db);
  c.registerInstance(v2DataDbTokens.db, db);
  beforeAll(async () => {
    await sql`drop schema if exists provision_cleanup_meta cascade`.execute(db);
    await sql`create schema provision_cleanup_meta`.execute(db);
    await sql`create schema if not exists ${sql.id(baseId)}`.execute(db);
    await sql`create table table_meta (id text primary key, base_id text, name text, "order" float,
      provision_state text, db_table_name text, deleted_time timestamptz)`.execute(db);
    await sql`create table schema_operation (id text primary key, base_id text, table_id text,
      resource_id text, type text, status text, payload jsonb, last_error text, created_time timestamptz default now())`.execute(
      db
    );
    await sql`create table field (id text primary key, table_id text, type text, options text, deleted_time timestamptz)`.execute(
      db
    );
    await sql`create table view (id text primary key, table_id text, deleted_time timestamptz)`.execute(
      db
    );
    await sql`create table reference (id text primary key, from_field_id text, to_field_id text)`.execute(
      db
    );
    await sql`create table base_node (id text primary key, base_id text, resource_id text, parent_id text)`.execute(
      db
    );
  });
  beforeEach(async () => {
    await sql`drop table if exists ${sql.id(baseId, 'records')} cascade`.execute(db);
    await sql`truncate table_meta, schema_operation, field, view, reference, base_node`.execute(db);
    await sql`insert into table_meta values (${tableId}, ${baseId}, 'Failed import', 1, 'pending', ${baseId + '.records'}, null)`.execute(
      db
    );
    await sql`insert into schema_operation (id, base_id, table_id, resource_id, type, status, payload)
      values ('op', ${baseId}, ${tableId}, ${tableId}, 'table.import', 'dead', '{}'::jsonb)`.execute(
      db
    );
  });
  afterAll(async () => {
    await db.destroy();
  });

  it('lists terminal failures even with no view or physical table, and cleans twice', async () => {
    expect(await listFailedTableProvisions(c, baseId)).toMatchObject([
      { id: tableId, operationId: 'op' },
    ]);
    expect(await cleanupFailedTableProvision(c, baseId, tableId)).toBe(true);
    expect(await cleanupFailedTableProvision(c, baseId, tableId)).toBe(false);
    expect(await listFailedTableProvisions(c, baseId)).toEqual([]);
  });
  it('reports only one deletion when cleanup requests race', async () => {
    await sql`create table ${sql.id(baseId, 'records')} (id int)`.execute(db);
    const results = await Promise.all([
      cleanupFailedTableProvision(c, baseId, tableId),
      cleanupFailedTableProvision(c, baseId, tableId),
    ]);
    expect(results.filter(Boolean)).toEqual([true]);
    expect(results.filter((deleted) => !deleted)).toEqual([false]);
  });
  it('returns only the failed projection despite large unrelated operation history', async () => {
    await sql`insert into schema_operation (id, base_id, table_id, resource_id, type, status, payload)
      select 'other-' || n, ${baseId}, 'other', 'other', 'table.update', 'ready',
        jsonb_build_object('diagnostics', repeat('x', 4096))
      from generate_series(1, 2000) as n`.execute(db);
    const resultSizes: number[] = [];
    const inspectedDb = db.withPlugin({
      transformQuery: ({ node }) => node,
      transformResult: async ({ result }) => {
        resultSizes.push(result.rows.length);
        return result;
      },
    });
    const inspectedContainer = container.createChildContainer();
    inspectedContainer.registerInstance(v2MetaDbTokens.db, inspectedDb);
    expect(await listFailedTableProvisions(inspectedContainer, baseId)).toMatchObject([
      { id: tableId, operationId: 'op' },
    ]);
    // The adapter receives one projected failure, not 2,001 hydrated ledger rows.
    expect(resultSizes).toEqual([1]);
  });
  it('classifies batch targets and rejects newer success or an older active operation in SQL', async () => {
    await sql`update schema_operation set table_id = null, resource_id = ${baseId},
      payload = jsonb_build_object('tableIds', jsonb_build_array(${tableId}::text, 'other'))`.execute(
      db
    );
    expect(await listFailedTableProvisions(c, baseId)).toHaveLength(1);
    await sql`insert into schema_operation (id, base_id, table_id, resource_id, type, status, payload, created_time)
      values ('older-active', ${baseId}, null, ${baseId}, 'table.import', 'error',
      jsonb_build_object('tableId', ${tableId}::text), now() - interval '1 day')`.execute(db);
    expect(await listFailedTableProvisions(c, baseId)).toEqual([]);
    await sql`delete from schema_operation where id = 'older-active'`.execute(db);
    await sql`insert into schema_operation (id, base_id, table_id, resource_id, type, status, payload, created_time)
      values ('newer-success', ${baseId}, ${tableId}, ${tableId}, 'table.update', 'ready',
      '{}'::jsonb, now() + interval '1 day')`.execute(db);
    expect(await listFailedTableProvisions(c, baseId)).toEqual([]);
  });
  it('drops an empty isolated table and rejects a table containing records', async () => {
    await sql`create table ${sql.id(baseId, 'records')} (id int)`.execute(db);
    await sql`insert into ${sql.id(baseId, 'records')} values (1)`.execute(db);
    await expect(cleanupFailedTableProvision(c, baseId, tableId)).rejects.toThrow(
      'contains records'
    );
    await sql`delete from ${sql.id(baseId, 'records')}`.execute(db);
    await cleanupFailedTableProvision(c, baseId, tableId);
    const exists = await sql<{
      name: string | null;
    }>`select to_regclass(${`"${baseId}".records`})::text as name`.execute(db);
    expect(exists.rows[0].name).toBeNull();
  });
  it('rejects partial link metadata, incoming relations and active retries', async () => {
    await sql`insert into field values ('link', ${tableId}, 'link', '{}', null)`.execute(db);
    await expect(cleanupFailedTableProvision(c, baseId, tableId)).rejects.toThrow('link resources');
    await sql`delete from field`.execute(db);
    await sql`insert into field values ('link', 'other', 'link', ${JSON.stringify({ foreignTableId: tableId })}, null)`.execute(
      db
    );
    await expect(cleanupFailedTableProvision(c, baseId, tableId)).rejects.toThrow(
      'Other tables reference'
    );
    await sql`delete from field`.execute(db);
    await sql`update schema_operation set status = 'running'`.execute(db);
    expect(await listFailedTableProvisions(c, baseId)).toEqual([]);
    await expect(cleanupFailedTableProvision(c, baseId, tableId)).rejects.toThrow(
      'terminal failed import'
    );
  });
  it('resumes after data DROP committed but metadata cleanup rolled back', async () => {
    await sql`create table ${sql.id(baseId, 'records')} (id int)`.execute(db);
    await sql`create function reject_cleanup() returns trigger language plpgsql as $$ begin raise exception 'injected meta failure'; end $$`.execute(
      db
    );
    await sql`create trigger reject_cleanup before update on table_meta for each row execute function reject_cleanup()`.execute(
      db
    );
    await expect(cleanupFailedTableProvision(c, baseId, tableId)).rejects.toThrow(
      'injected meta failure'
    );
    await sql`drop trigger reject_cleanup on table_meta`.execute(db);
    await cleanupFailedTableProvision(c, baseId, tableId);
    expect(await listFailedTableProvisions(c, baseId)).toEqual([]);
  });
});
