import { randomUUID } from 'node:crypto';
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  BaseId,
  FieldName,
  Table,
  TableId,
  TableName,
  ViewName,
  type DomainError,
} from '@teable/v2-core';
import {
  TableQueryRemediationTask,
  type ExecutablePhase1RemediationKind,
  type TableQueryOpsTaskWorkerScope,
} from '@teable/v2-table-query-ops';
import { sql, type Kysely } from 'kysely';
import type { Result } from 'neverthrow';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresTableQueryRemediationTaskRepository } from './repositories';
import { ensureTableQueryOpsSchema, type TableQueryOpsDatabase } from './schema';
import { PostgresTableSearchVectorSchemaMaintenanceScheduler } from './searchVectorMaintenance';
import type { UnknownPostgresDatabase } from './types';

const enabled = process.env.TEABLE_V2_RUN_MANAGEMENT_PG_INTEGRATION === '1';
const connectionString = process.env.PRISMA_DATABASE_URL;
if (enabled && !connectionString)
  throw new Error(
    'Management PG acceptance requires PRISMA_DATABASE_URL pointing to a disposable local PostgreSQL database'
  );
const schema = `t7188_${randomUUID().replaceAll('-', '')}`;
const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
const queued = (
  id: string,
  tableId: string,
  payload: unknown = {
    trigger: 'admin_search_access_path',
    executionMode: 'manual',
    mode: 'create',
  },
  kind: Parameters<
    typeof TableQueryRemediationTask.createQueued
  >[0]['kind'] = 'create_search_access_path'
) =>
  TableQueryRemediationTask.createQueued({
    id,
    tableId,
    baseId: 'bseExample',
    kind,
    payload,
    now: new Date(),
  })._unsafeUnwrap();

const unwrapTaskResult = <T>(result: Result<T, DomainError>): T => {
  if (result.isErr()) throw new Error(JSON.stringify(result.error));
  return result.value;
};

(enabled ? describe : describe.skip)('management durable task concurrency', () => {
  let admin: Kysely<TableQueryOpsDatabase>;
  let db: Kysely<TableQueryOpsDatabase>;
  let repository: PostgresTableQueryRemediationTaskRepository;
  beforeAll(async () => {
    admin = await createV2PostgresDb<TableQueryOpsDatabase>({
      pg: { connectionString: connectionString!, pool: { max: 1 } },
    });
    await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(admin);
    const url = new URL(connectionString!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    db = await createV2PostgresDb<TableQueryOpsDatabase>({
      pg: { connectionString: url.toString(), pool: { max: 6 } },
    });
    await ensureTableQueryOpsSchema(db);
    repository = new PostgresTableQueryRemediationTaskRepository(db);
  });
  beforeEach(async () => {
    await db.deleteFrom('table_query_remediation_task').execute();
    await db.deleteFrom('table_query_search_vector_config').execute();
  });
  afterAll(async () => {
    await db?.destroy();
    if (admin) {
      await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(admin);
      await admin.destroy();
    }
  });

  it('returns one durable task for concurrent duplicate submissions and preserves completed result', async () => {
    const task = queued('tqt_duplicate', 'tblExample');
    const results = await Promise.all(
      Array.from({ length: 4 }, () => repository.save(context, task))
    );
    expect(results.map((result) => result._unsafeUnwrap().snapshot().id)).toEqual(
      Array(4).fill('tqt_duplicate')
    );
    expect(await db.selectFrom('table_query_remediation_task').select('id').execute()).toEqual([
      { id: 'tqt_duplicate' },
    ]);
    const running = task.start('worker', new Date())._unsafeUnwrap();
    unwrapTaskResult(await repository.save(context, running));
    unwrapTaskResult(
      await repository.save(
        context,
        running.succeed({ indexName: 'ready_index' }, new Date())._unsafeUnwrap()
      )
    );
    const duplicate = (await repository.save(context, task))._unsafeUnwrap().snapshot();
    expect(duplicate.status).toBe('succeeded');
    expect(duplicate.result).toEqual({ indexName: 'ready_index' });
  });

  it('rejects competing same-table submissions atomically across connections', async () => {
    const results = await Promise.all([
      repository.save(context, queued('tqt_first', 'tblSame')),
      repository.save(context, queued('tqt_second', 'tblSame')),
    ]);
    expect(results.filter((result) => result.isOk())).toHaveLength(1);
    expect(
      results.filter((result) => result.isErr()).map((result) => result._unsafeUnwrapErr().code)
    ).toEqual(['table_query_ops.table_task_conflict']);
  });

  it('bounds global execution and prevents same-table maintenance overlap', async () => {
    await repository.save(context, queued('tqt_a', 'tblA'));
    await repository.saveIfAbsent(context, queued('tqt_a_maintenance', 'tblA'));
    await repository.save(context, queued('tqt_b', 'tblB'));
    await repository.save(context, queued('tqt_c', 'tblC'));
    const claims = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        repository.claimNextAccepted(context, {
          workerId: `worker-${i}`,
          scope: 'all',
          now: new Date(),
          allowedKinds: [],
          allowManualIndexExecution: false,
          allowPolicyIndexExecution: false,
        })
      )
    );
    const tasks = claims
      .map((result) => result._unsafeUnwrap())
      .filter((task) => task !== undefined);
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map((task) => task.snapshot().tableId)).size).toBe(2);
    const first = tasks[0].start(tasks[0].snapshot().lockedBy!, new Date())._unsafeUnwrap();
    expect(first.snapshot().lockedAt).toEqual(tasks[0].snapshot().lockedAt);
    unwrapTaskResult(await repository.save(context, first));
    unwrapTaskResult(
      await repository.save(context, first.fail('Real DDL error', new Date())._unsafeUnwrap())
    );
    expect(
      (await repository.findById(context, first.snapshot().id))._unsafeUnwrap().snapshot()
    ).toMatchObject({ status: 'failed', lastError: 'Real DDL error', attempts: 1 });
  });

  const claim = (
    workerId: string,
    now = new Date(),
    scope: TableQueryOpsTaskWorkerScope = 'all',
    allowedKinds: ReadonlyArray<ExecutablePhase1RemediationKind> = []
  ) =>
    repository.claimNextAccepted(context, {
      workerId,
      now,
      scope,
      allowedKinds,
      allowManualIndexExecution: false,
      allowPolicyIndexExecution: false,
    });

  it('claims only explicitly marked modern search tasks in the manual scope', async () => {
    await repository.save(
      context,
      queued('tqt_historical', 'tblHistorical', { trigger: 'admin_search_access_path' })
    );
    await repository.save(
      context,
      queued('tqt_schema', 'tblSchema', { trigger: 'schema_change', executionMode: 'manual' })
    );
    await repository.save(
      context,
      queued(
        'tqt_index',
        'tblIndex',
        { trigger: 'admin_index', executionMode: 'manual' },
        'create_filter_index'
      )
    );
    await repository.save(
      context,
      queued(
        'tqt_legacy',
        'tblLegacy',
        { trigger: 'admin_search_access_path', executionMode: 'manual' },
        'create_search_vector'
      )
    );
    await repository.save(context, queued('tqt_manual', 'tblManual'));
    expect(
      (await claim('manual', new Date(), 'manual_search'))._unsafeUnwrap()?.snapshot().id
    ).toBe('tqt_manual');
    expect((await claim('manual-2', new Date(), 'manual_search'))._unsafeUnwrap()).toBeUndefined();
    expect((await claim('general'))._unsafeUnwrap()?.snapshot().id).not.toBe('tqt_manual');
  });

  it('claims write-triggered search maintenance work in the search maintenance scope', async () => {
    const kinds = [
      'create_search_access_path',
      'rebuild_search_access_path',
      'drop_search_access_path',
    ] as const;
    await repository.save(
      context,
      queued(
        'tqt_schema_rebuild',
        'tblMaintenanceSchema',
        { trigger: 'schema_change' },
        'rebuild_search_access_path'
      )
    );
    await repository.save(
      context,
      queued(
        'tqt_reclaim_drop',
        'tblMaintenanceReclaim',
        { trigger: 'reclaim' },
        'drop_search_access_path'
      )
    );
    const claimed = await Promise.all([
      claim('maintenance', new Date(), 'search_maintenance', kinds),
      claim('maintenance-2', new Date(), 'search_maintenance', kinds),
    ]);
    expect(claimed.map((result) => result._unsafeUnwrap()?.snapshot().id).sort()).toEqual([
      'tqt_reclaim_drop',
      'tqt_schema_rebuild',
    ]);
  });

  it('leaves admin search and index work to their own scopes', async () => {
    const kinds = [
      'create_search_access_path',
      'rebuild_search_access_path',
      'drop_search_access_path',
    ] as const;
    await repository.save(context, queued('tqt_admin_search', 'tblAdminSearch'));
    await repository.save(
      context,
      queued(
        'tqt_admin_index',
        'tblAdminIndex',
        { trigger: 'admin_index', executionMode: 'manual' },
        'create_filter_index'
      )
    );
    expect(
      (await claim('maintenance', new Date(), 'search_maintenance', kinds))._unsafeUnwrap()
    ).toBeUndefined();
    expect(
      (await claim('manual', new Date(), 'manual_search', kinds))._unsafeUnwrap()?.snapshot().id
    ).toBe('tqt_admin_search');
  });

  it('preserves cancelled history and rejects a delayed unreserved start', async () => {
    const task = queued('tqt_cancel', 'tblCancel');
    await repository.save(context, task);
    const staleStart = task.start('delayed', new Date())._unsafeUnwrap();
    expect(
      (
        await repository.cancelQueued(context, {
          taskId: task.snapshot().id,
          tableId: 'tblWrong',
          now: new Date(),
        })
      ).isErr()
    ).toBe(true);
    const cancelled = unwrapTaskResult(
      await repository.cancelQueued(context, {
        taskId: task.snapshot().id,
        tableId: 'tblCancel',
        now: new Date(),
      })
    ).snapshot();
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      attempts: 0,
      payload: task.snapshot().payload,
    });
    expect((await repository.save(context, staleStart)).isErr()).toBe(true);
    expect((await claim('worker'))._unsafeUnwrap()).toBeUndefined();
    expect((await repository.save(context, task))._unsafeUnwrap().snapshot().status).toBe(
      'cancelled'
    );
    expect((await repository.save(context, queued('tqt_replacement', 'tblCancel'))).isOk()).toBe(
      true
    );
  });

  it('serializes cancellation against a claim without cancelling a live reservation', async () => {
    await repository.save(context, queued('tqt_race', 'tblRace'));
    const [claimed, cancelled] = await Promise.all([
      claim('racing-worker'),
      repository.cancelQueued(context, { taskId: 'tqt_race', tableId: 'tblRace', now: new Date() }),
    ]);
    const task = claimed._unsafeUnwrap();
    expect(Boolean(task)).toBe(cancelled.isErr());
    expect((await repository.findById(context, 'tqt_race'))._unsafeUnwrap().snapshot().status).toBe(
      task ? 'queued' : 'cancelled'
    );
    if (task) {
      const running = unwrapTaskResult(
        await repository.save(context, task.start('racing-worker', new Date())._unsafeUnwrap())
      );
      expect(
        (
          await repository.cancelQueued(context, {
            taskId: 'tqt_race',
            tableId: 'tblRace',
            now: new Date(),
          })
        ).isErr()
      ).toBe(true);
      expect(running.snapshot().status).toBe('running');
    }
  });

  it('rejects stale reservation starts and completions after reclaim', async () => {
    const now = new Date();
    await repository.save(context, queued('tqt_reclaim', 'tblReclaim'));
    const stale = (await claim('old-worker', now))._unsafeUnwrap()!;
    const staleRunning = stale.start('old-worker', now)._unsafeUnwrap();
    const later = new Date(now.getTime() + 60_001);
    const reclaimed = (await claim('new-worker', later))._unsafeUnwrap()!;
    expect((await repository.save(context, staleRunning)).isErr()).toBe(true);
    expect(
      (
        await repository.save(context, staleRunning.fail('old failure', later)._unsafeUnwrap())
      ).isErr()
    ).toBe(true);
    const running = unwrapTaskResult(
      await repository.save(context, reclaimed.start('new-worker', later)._unsafeUnwrap())
    );
    const failed = unwrapTaskResult(
      await repository.save(context, running.fail('real DDL failure', later)._unsafeUnwrap())
    );
    expect(failed.snapshot()).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'real DDL failure',
      lockedAt: undefined,
    });
    const cancelled = unwrapTaskResult(
      await repository.cancelQueued(context, {
        taskId: 'tqt_reclaim',
        tableId: 'tblReclaim',
        now: later,
      })
    );
    expect(cancelled.snapshot()).toMatchObject({
      status: 'cancelled',
      attempts: 1,
      lastError: 'real DDL failure',
    });
    expect(
      (
        await repository.save(context, running.succeed({ stale: true }, later)._unsafeUnwrap())
      ).isErr()
    ).toBe(true);
  });

  it('counts failed reservations against both global and same-table capacity', async () => {
    const now = new Date();
    await repository.save(context, queued('tqt_failed', 'tblFailed'));
    const first = (await claim('worker', now))._unsafeUnwrap()!;
    const failed = (
      await repository.save(
        context,
        first.start('worker', now)._unsafeUnwrap().fail('routing failed', now)._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    expect(failed.snapshot().status).toBe('failed');
    expect((await claim('retry', now))._unsafeUnwrap()?.snapshot().id).toBe('tqt_failed');
    await repository.saveIfAbsent(context, queued('tqt_same', 'tblFailed'));
    expect((await repository.save(context, queued('tqt_competing', 'tblFailed'))).isErr()).toBe(
      true
    );
    await repository.save(context, queued('tqt_other', 'tblOther'));
    await repository.save(context, queued('tqt_third', 'tblThird'));
    expect(['tblOther', 'tblThird']).toContain(
      (await claim('other', now))._unsafeUnwrap()?.snapshot().tableId
    );
    expect((await claim('third', now))._unsafeUnwrap()).toBeUndefined();
  });

  it('does not cancel ordinary index suggestions or terminal tasks', async () => {
    await repository.save(
      context,
      queued('tqt_ordinary', 'tblOrdinary', { trigger: 'admin_index' }, 'create_search_index')
    );
    expect(
      (
        await repository.cancelQueued(context, {
          taskId: 'tqt_ordinary',
          tableId: 'tblOrdinary',
          now: new Date(),
        })
      ).isErr()
    ).toBe(true);
    const task = queued('tqt_complete', 'tblComplete');
    await repository.save(context, task);
    const running = (
      await repository.save(context, task.start('direct-worker', new Date())._unsafeUnwrap())
    )._unsafeUnwrap();
    await repository.save(
      context,
      running.succeed({ indexName: 'ready' }, new Date())._unsafeUnwrap()
    );
    expect(
      (
        await repository.cancelQueued(context, {
          taskId: 'tqt_complete',
          tableId: 'tblComplete',
          now: new Date(),
        })
      ).isErr()
    ).toBe(true);
  });

  it('never coalesces a schema change into a live reservation or cancelled history', async () => {
    const tableId = `tbl${'S'.repeat(16)}`;
    const baseId = `bse${'S'.repeat(16)}`;
    const builder = Table.builder()
      .withId(TableId.create(tableId)._unsafeUnwrap())
      .withBaseId(BaseId.create(baseId)._unsafeUnwrap())
      .withName(TableName.create('Schema maintenance fixture')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
    const table = builder.build()._unsafeUnwrap();
    await sql`INSERT INTO table_query_search_vector_config
      (id, base_id, table_id, candidate_key, generated_column_name, index_name, field_ids, field_db_names, status)
      VALUES ('config', ${baseId}, ${tableId}, 'candidate', 'search_document', 'search_index', '[]'::jsonb, '[]'::jsonb, 'ready')`.execute(
      db
    );
    const scheduler = new PostgresTableSearchVectorSchemaMaintenanceScheduler(
      db as unknown as Kysely<UnknownPostgresDatabase>
    );
    const first = (
      await scheduler.schedule(context, { table, reason: 'field_created' })
    )._unsafeUnwrap()!;
    const reserved = (
      await repository.claimNextAccepted(context, {
        workerId: 'schema-worker',
        scope: 'all',
        now: new Date(),
        allowedKinds: ['rebuild_search_access_path'],
        allowManualIndexExecution: false,
        allowPolicyIndexExecution: false,
      })
    )._unsafeUnwrap()!;
    expect(reserved.snapshot().id).toBe(first.taskId);
    const next = (
      await scheduler.schedule(context, { table, reason: 'field_updated' })
    )._unsafeUnwrap()!;
    expect(next).toMatchObject({ status: 'queued' });
    expect(next.taskId).not.toBe(first.taskId);
    expect(
      (await repository.findById(context, first.taskId))._unsafeUnwrap().snapshot().payload
    ).toEqual({ trigger: 'schema_change', reason: 'field_created' });
    expect(
      (
        await repository.cancelQueued(context, { taskId: first.taskId, tableId, now: new Date() })
      ).isErr()
    ).toBe(true);
    const cancelled = unwrapTaskResult(
      await repository.cancelQueued(context, { taskId: next.taskId, tableId, now: new Date() })
    );
    expect(cancelled.snapshot().status).toBe('cancelled');
    const replacement = (
      await scheduler.schedule(context, { table, reason: 'field_deleted' })
    )._unsafeUnwrap()!;
    expect(replacement.status).toBe('queued');
    expect(replacement.taskId).not.toBe(next.taskId);
    expect(
      (await repository.findById(context, next.taskId))._unsafeUnwrap().snapshot()
    ).toMatchObject({
      status: 'cancelled',
      payload: { trigger: 'schema_change', reason: 'field_updated' },
    });
  });
});
