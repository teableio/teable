import { PostgresUnitOfWork, resolvePostgresDbOrTx } from '@teable/v2-adapter-db-postgres-shared';
import { ActorId } from '@teable/v2-core';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { ok } from 'neverthrow';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Characterization of the actual split UnitOfWork protocol, not a full TableUpdateFlow e2e. */
describe('BYODB data-commit / meta-commit publication window', () => {
  let server: Awaited<ReturnType<PostgreSqlContainer['start']>>;
  let meta: Kysely<unknown>;
  let data: Kysely<unknown>;
  let unit: PostgresUnitOfWork<unknown>;
  beforeAll(async () => {
    server = await new PostgreSqlContainer('postgres:16-alpine').start();
    const metaUrl = server.getConnectionUri();
    meta = new Kysely({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: metaUrl }) }),
    });
    await sql`create database byodb_data`.execute(meta);
    const dataUrl = new URL(metaUrl);
    dataUrl.pathname = '/byodb_data';
    data = new Kysely({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: dataUrl.toString() }) }),
    });
    unit = new PostgresUnitOfWork(
      meta,
      data,
      { pg: { connectionString: metaUrl } },
      { pg: { connectionString: dataUrl.toString() } }
    );
    await sql`create table schema_metadata (id int primary key, state text, column_name text)`.execute(
      meta
    );
    await sql`insert into schema_metadata values (1, 'ready', 'value')`.execute(meta);
  }, 60_000);
  afterAll(async () => {
    await meta?.destroy();
    await data?.destroy();
    await server?.stop();
  });

  for (const [kind, ddl, column, invalidValue, errorCode] of [
    ['rename', 'alter table records rename column value to replacement', 'value', 'old', '42703'],
    ['remove', 'alter table records drop column value', 'value', 'old', '42703'],
    [
      'type conversion',
      'alter table records alter column value type integer using value::integer',
      'value',
      'old',
      '22P02',
    ],
    ['link column removal', 'alter table records drop column linked_id', 'linked_id', '1', '42703'],
  ] as const) {
    it(`characterizes old-schema CRUD after ${kind} commits in data only`, async () => {
      await sql`drop table if exists records`.execute(data);
      await sql`create table records (id int primary key, value text, linked_id int)`.execute(data);
      await sql`insert into records values (1, '1', 1)`.execute(data);
      await sql`update schema_metadata set state = 'ready', column_name = ${column}`.execute(meta);
      // This snapshot models a reader that loaded metadata before the DDL request.
      const old = await sql<{
        state: string;
        column_name: string;
      }>`select * from schema_metadata`.execute(meta);
      const result = await unit.withTransaction(
        { actorId: ActorId.create('system')._unsafeUnwrap() },
        async (metaContext) => {
          await sql`update schema_metadata set state = 'pending', column_name = 'new_schema'`.execute(
            resolvePostgresDbOrTx(meta, metaContext, 'meta')
          );
          const dataResult = await unit.withTransaction(
            metaContext,
            async (dataContext) => {
              await sql.raw(ddl).execute(resolvePostgresDbOrTx(data, dataContext, 'data'));
              return ok(undefined);
            },
            { scope: 'data' }
          );
          if (dataResult.isErr()) return dataResult;
          // Deterministic pause: nested data transaction has committed; outer meta has not.
          const visible = await sql<{ state: string }>`select state from schema_metadata`.execute(
            meta
          );
          expect(visible.rows[0].state).toBe('ready');
          expect(old.rows[0].column_name).toBe(column);
          await expect(
            sql`select * from records where ${sql.id(column)} = ${invalidValue}`.execute(data)
          ).rejects.toMatchObject({ code: errorCode });
          await expect(
            sql`insert into records (id, ${sql.id(column)}) values (2, ${invalidValue})`.execute(
              data
            )
          ).rejects.toMatchObject({ code: errorCode });
          await expect(
            sql`update records set ${sql.id(column)} = ${invalidValue} where id = 1`.execute(data)
          ).rejects.toMatchObject({ code: errorCode });
          await expect(
            sql`delete from records where ${sql.id(column)} = ${invalidValue}`.execute(data)
          ).rejects.toMatchObject({ code: errorCode });
          // The barrier is not a DB-wide CRUD lock: ID-only deletion can still execute.
          await sql`delete from records where id = 1`.execute(data);
          return ok(undefined);
        },
        { scope: 'meta' }
      );
      expect(result.isOk()).toBe(true);
    });
  }
});
