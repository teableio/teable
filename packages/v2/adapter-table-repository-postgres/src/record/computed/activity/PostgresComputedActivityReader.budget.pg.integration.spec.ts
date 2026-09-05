import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { FieldId, NoopLogger, ok, TableId } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DynamicDB } from '../../query-builder';
import { ComputedActivityProjector } from './ComputedActivityProjector';
import { PostgresComputedActivityReader } from './PostgresComputedActivityReader';

// Opt-in real Postgres coverage; ordinary unit/PGlite runs never start Docker.
const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const BASE_ID = `bse${'a'.repeat(16)}`;
const SPACE_ID = `spc${'e'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;

describePg('PostgresComputedActivityReader statement cancellation (Postgres)', () => {
  let container: Awaited<ReturnType<PostgreSqlContainer['start']>> | undefined;
  let db: Kysely<V1TeableDatabase>;
  let holder: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    ).start();
    const config = { pg: { connectionString: container.getConnectionUri(), pool: { max: 1 } } };
    db = await createV2PostgresDb<V1TeableDatabase>(config);
    holder = await createV2PostgresDb<V1TeableDatabase>(config);
    await db.schema
      .createTable('computed_field_activity')
      .addColumn('field_id', 'text', (column) => column.primaryKey())
      .addColumn('table_id', 'text', (column) => column.notNull())
      .addColumn('base_id', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('active_task_count', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('processing_task_count', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('generation', 'bigint', (column) => column.notNull().defaultTo(0))
      .addColumn('estimated_complexity', 'bigint', (column) => column.notNull().defaultTo(0))
      .addColumn('estimated_dirty_records', 'bigint', (column) => column.notNull().defaultTo(0))
      .addColumn('has_all_target_records', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('queued_at', 'timestamptz')
      .addColumn('started_at', 'timestamptz')
      .addColumn('last_completed_at', 'timestamptz')
      .addColumn('last_duration_ms', 'integer')
      .addColumn('last_error', 'jsonb')
      .addColumn('extensions', 'jsonb')
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .execute();

    await db.schema
      .createTable('computed_table_activity')
      .addColumn('table_id', 'text', (column) => column.primaryKey())
      .addColumn('base_id', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('calculating_field_count', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('queued_field_count', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('estimated_complexity', 'bigint', (column) => column.notNull().defaultTo(0))
      .addColumn('recent_completions', 'jsonb', (column) =>
        column.notNull().defaultTo(sql`'[]'::jsonb`)
      )
      .addColumn('generation', 'bigint', (column) => column.notNull().defaultTo(0))
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
      .execute();

    await db.schema
      .createTable('computed_task_field_ref')
      .addColumn('task_id', 'text', (column) => column.notNull())
      .addColumn('field_id', 'text', (column) => column.notNull())
      .addColumn('table_id', 'text', (column) => column.notNull())
      .addColumn('base_id', 'text', (column) => column.notNull())
      .addColumn('was_processing', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('created_at', 'timestamptz', (column) => column.notNull())
      .addPrimaryKeyConstraint('computed_task_field_ref_pkey', ['task_id', 'field_id'])
      .execute();

    await db.schema
      .createTable('computed_update_outbox')
      .addColumn('id', 'text', (column) => column.primaryKey())
      .addColumn('status', 'text', (column) => column.notNull().defaultTo('pending'))
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable('computed_update_pause_scope')
      .addColumn('id', 'text', (column) => column.primaryKey())
      .addColumn('scope_type', 'text', (column) => column.notNull())
      .addColumn('scope_id', 'text', (column) => column.notNull())
      .addColumn('paused_at', 'timestamptz', (column) => column.notNull())
      .addColumn('paused_by', 'text')
      .addColumn('resume_at', 'timestamptz')
      .addColumn('reason', 'text')
      .addColumn('write_policy', 'text', (column) => column.notNull().defaultTo('allow_bounded'))
      .execute();

    await db.schema
      .createTable('base')
      .addColumn('id', 'text', (column) => column.primaryKey())
      .addColumn('space_id', 'text', (column) => column.notNull())
      .execute();

    await db
      .insertInto('base' as never)
      .values({ id: BASE_ID, space_id: SPACE_ID } as never)
      .execute();

    await sql`create table budget_lock (id integer primary key, value integer not null)`.execute(
      db
    );
    await sql`insert into budget_lock values (1, 0)`.execute(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await holder?.destroy();
    await container?.stop();
  });

  it.each(['sleep', 'row lock'] as const)(
    'cancels a %s inside the budget, rolls back repair and reuses the connection',
    async (mode) => {
      const projector = new ComputedActivityProjector(db, new NoopLogger());
      projector.configureAsyncProjection({ enabled: false });
      const reader = new PostgresComputedActivityReader(db, projector);
      await sql`truncate computed_field_activity, computed_table_activity, computed_task_field_ref, computed_update_outbox`.execute(
        db
      );
      await sql`insert into computed_update_outbox (id) values ('budget-reference')`.execute(db);
      const enqueued = await projector.onTaskEnqueued({
        taskId: 'budget-reference',
        baseId: BASE_ID,
        targets: [
          {
            fieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
            tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
          },
        ],
        metrics: { estimatedComplexity: 2, estimatedDirtyRecords: 1, hasAllTargetRecords: false },
      });
      expect(enqueued.isOk()).toBe(true);
      await sql`delete from computed_task_field_ref`.execute(db);
      const pidBefore = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db))
        .rows[0]!.pid;
      let releaseLock: (() => void) | undefined;
      let held: Promise<void> | undefined;
      if (mode === 'row lock') {
        let locked!: () => void;
        const acquired = new Promise<void>((resolve) => {
          locked = resolve;
        });
        const release = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        held = holder.transaction().execute(async (trx) => {
          await sql`select * from budget_lock where id = 1 for update`.execute(trx);
          locked();
          await release;
        });
        await acquired;
      }
      let cancellationCode: unknown;
      const repair = vi
        .spyOn(projector, 'reconcileTable')
        .mockImplementationOnce(async (_params, context) => {
          const trx = getPostgresTransaction<DynamicDB>(context)!;
          await sql`update computed_field_activity set estimated_dirty_records = 9999 where field_id = ${FIELD_ID}`.execute(
            trx
          );
          try {
            if (mode === 'sleep') await sql`select pg_sleep(10)`.execute(trx);
            else await sql`update budget_lock set value = 1 where id = 1`.execute(trx);
          } catch (error) {
            cancellationCode = (error as { code?: string }).code;
            throw error;
          }
          return ok(null);
        });
      try {
        const started = performance.now();
        const result = await reader.getByTableId(undefined, TABLE_ID, BASE_ID, { budgetMs: 250 });
        expect(result.isErr()).toBe(true);
        // SQLSTATE 57014 proves the server canceled the in-flight statement;
        // an application-only deadline check after pg_sleep would take 10s.
        expect(cancellationCode).toBe('57014');
        expect(performance.now() - started).toBeLessThan(2000);
        const restored = await sql<{ pid: number; timeout: string; dirty: string }>`
          select pg_backend_pid() as pid, current_setting('statement_timeout') as timeout,
            estimated_dirty_records::text as dirty from computed_field_activity where field_id = ${FIELD_ID}
        `.execute(db);
        expect(restored.rows[0]).toEqual({ pid: pidBefore, timeout: '0', dirty: '1' });
        repair.mockRestore();
        const next = await new PostgresComputedActivityReader(db, projector).getByTableId(
          undefined,
          TABLE_ID,
          BASE_ID,
          { budgetMs: 5000 }
        );
        expect(next.isOk()).toBe(true);
        expect(next._unsafeUnwrap().reconciliationPerformed).toBe(true);
      } finally {
        repair.mockRestore();
        releaseLock?.();
        await held;
      }
    }
  );
});
