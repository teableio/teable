import { randomUUID } from 'node:crypto';
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { ActorId } from '@teable/v2-core';
import { TableQueryRemediationTask } from '@teable/v2-table-query-ops';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresTableQueryRemediationTaskRepository } from './repositories';
import { ensureTableQueryOpsSchema, type TableQueryOpsDatabase } from './schema';

const enabled = process.env.TEABLE_V2_RUN_MANAGEMENT_PG_INTEGRATION === '1';
const connectionString = process.env.PRISMA_DATABASE_URL;
if (enabled && !connectionString)
  throw new Error(
    'Management PG acceptance requires PRISMA_DATABASE_URL pointing to a disposable local PostgreSQL database'
  );
const schema = `t7188_${randomUUID().replaceAll('-', '')}`;
const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
const queued = (id: string, tableId: string) =>
  TableQueryRemediationTask.createQueued({
    id,
    tableId,
    baseId: 'bseExample',
    kind: 'create_search_access_path',
    payload: { trigger: 'admin_search_access_path', mode: 'create' },
    now: new Date(),
  })._unsafeUnwrap();

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
    await repository.save(context, running);
    await repository.save(
      context,
      running.succeed({ indexName: 'ready_index' }, new Date())._unsafeUnwrap()
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
    const first = tasks[0].start('worker', new Date())._unsafeUnwrap();
    await repository.save(context, first);
    await repository.save(context, first.fail('Real DDL error', new Date())._unsafeUnwrap());
    expect(
      (await repository.findById(context, first.snapshot().id))._unsafeUnwrap().snapshot()
    ).toMatchObject({ status: 'failed', lastError: 'Real DDL error', attempts: 1 });
  });
});
