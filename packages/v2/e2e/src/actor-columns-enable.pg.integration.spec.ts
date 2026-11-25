import { createHash } from 'node:crypto';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorColumnsEnableHandler,
  ActorId,
  CreateTableCommand,
  SchemaOperationRunnerService,
  domainError,
  err,
  v2CoreTokens,
  type ActorColumnsTarget,
  type CreateTableResult,
  type ICommandBus,
  type IExecutionContext,
  type ISchemaOperationRepository,
  type ITableSchemaCoordination,
  type ITableSchemaRepository,
  type IUnitOfWork,
  type SchemaOperationRecord,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const actorColumns = [
  '__created_by_actor_type',
  '__created_by_actor_id',
  '__last_modified_by_actor_type',
  '__last_modified_by_actor_id',
];
const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };

describe('actor enable real PostgreSQL consumer', () => {
  let test: IV2NodeTestContainer;
  let operations: ISchemaOperationRepository;
  let coordination: ITableSchemaCoordination;
  let schema: ITableSchemaRepository;
  let unitOfWork: IUnitOfWork;
  let routeKey: string;

  beforeAll(async () => {
    // No memory/PGlite lease: this suite exercises pg_stat_activity + pg_locks fencing.
    test = await createV2NodeTestContainer();
    operations = test.container.resolve(v2CoreTokens.schemaOperationRepository);
    coordination = test.container.resolve(v2CoreTokens.tableSchemaCoordination);
    schema = test.container.resolve(v2CoreTokens.tableSchemaRepository);
    unitOfWork = test.container.resolve(v2CoreTokens.unitOfWork);
    routeKey = createHash('sha256').update(test.connectionString).digest('hex');
  }, 120_000);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await test?.dispose();
  });

  const createLegacy = async () => {
    const commands = test.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const command = CreateTableCommand.create({
      baseId: test.baseId.toString(),
      name: 'Legacy actor enable',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    })._unsafeUnwrap();
    const created = (
      await commands.execute<CreateTableCommand, CreateTableResult>(context, command)
    )._unsafeUnwrap();
    const tableId = created.table.id().toString();
    const physical = created.table
      .dbTableName()
      .andThen((name) => name.value())
      ._unsafeUnwrap();
    await sql`UPDATE table_meta SET actor_storage_version = 0 WHERE id = ${tableId}`.execute(
      test.metaDb
    );
    for (const column of actorColumns) {
      await sql`ALTER TABLE ${sql.table(physical)} DROP COLUMN ${sql.id(column)} CASCADE`.execute(
        test.dataDb
      );
    }
    const target = (
      await operations.getActorColumnsTarget!(context, test.baseId.toString(), tableId, routeKey)
    )._unsafeUnwrap();
    return { tableId, physical, target };
  };

  const runner = (work = unitOfWork, notify?: () => Promise<void>) =>
    new SchemaOperationRunnerService(operations, [
      new ActorColumnsEnableHandler(
        operations,
        test.tableRepository,
        schema,
        coordination,
        work,
        routeKey,
        notify
      ),
    ]);
  const claim = async (worker: string) => {
    const claimed = (await runner().claimNext(context, { workerId: worker }))._unsafeUnwrap();
    if (claimed.status !== 'claimed')
      throw new Error('Expected an immediately eligible enable operation');
    return claimed.operation;
  };
  const capability = async (tableId: string) =>
    await test.metaDb
      .selectFrom('table_meta')
      .select(['actor_storage_version', 'provision_state', 'version'])
      .where('id', '=', tableId)
      .executeTakeFirstOrThrow();
  const enable = async (target: ActorColumnsTarget) => {
    const operation = (await operations.enqueueActorColumns!(context, target))._unsafeUnwrap();
    const result = (
      await runner().runOperation(context, await claim(`worker:${operation.id}`))
    )._unsafeUnwrap();
    return { operation, result };
  };

  it('keeps legacy native rows available and unknown, then enables without provision pending', async () => {
    const fixture = await createLegacy();
    const recordId = 'recLegacyActorEnable01';
    await sql`INSERT INTO ${sql.table(fixture.physical)} (__id, __version, __created_time, __created_by)
      VALUES (${recordId}, 1, now(), 'system')`.execute(test.dataDb);
    await sql`UPDATE ${sql.table(fixture.physical)} SET __version = 2 WHERE __id = ${recordId}`.execute(
      test.dataDb
    );
    expect(await capability(fixture.tableId)).toMatchObject({
      actor_storage_version: 0,
      provision_state: 'ready',
    });
    const { result } = await enable(fixture.target);
    expect(result.status).toBe('completed');
    expect(await capability(fixture.tableId)).toMatchObject({
      actor_storage_version: 1,
      provision_state: 'ready',
      version: fixture.target.tableVersion + 1,
    });
    const row = (
      await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(fixture.physical)}
      WHERE __id = ${recordId}`.execute(test.dataDb)
    ).rows[0];
    expect(row.__version).toBe(2);
    for (const column of actorColumns) expect(row[column]).toBeNull();
  });

  it('deduplicates simultaneous pending/running enqueue without resetting its claim', async () => {
    const { target } = await createLegacy();
    const queued = await Promise.all(
      Array.from({ length: 8 }, () => operations.enqueueActorColumns!(context, target))
    );
    expect(new Set(queued.map((result) => result._unsafeUnwrap().id)).size).toBe(1);
    const owned = await claim('running-owner');
    const repeated = (await operations.enqueueActorColumns!(context, target))._unsafeUnwrap();
    expect(repeated).toMatchObject({
      id: owned.id,
      status: 'running',
      lockedBy: owned.lockedBy,
      lockedAt: owned.lockedAt,
    });
    expect((await runner().runOperation(context, owned))._unsafeUnwrap().status).toBe('completed');
  });

  it('rejects wrong-shaped text storage and retries the same persisted operation after repair', async () => {
    const { target, physical, tableId } = await createLegacy();
    await sql`ALTER TABLE ${sql.table(physical)} ADD COLUMN __created_by_actor_type integer`.execute(
      test.dataDb
    );
    const first = await enable(target);
    expect(first.result.status).toBe('failed');
    expect(await capability(tableId)).toMatchObject({
      actor_storage_version: 0,
      provision_state: 'ready',
    });
    await sql`ALTER TABLE ${sql.table(physical)} DROP COLUMN __created_by_actor_type`.execute(
      test.dataDb
    );
    const retried = await enable(target);
    expect(retried.operation.id).toBe(first.operation.id);
    expect(retried.result.status).toBe('completed');
  });

  it('rejects a business-field reserved name even when its physical storage is nullable text', async () => {
    const { target, tableId, physical } = await createLegacy();
    const field = await test.metaDb
      .selectFrom('field')
      .select(['id', 'db_field_name'])
      .where('table_id', '=', tableId)
      .executeTakeFirstOrThrow();
    await sql`ALTER TABLE ${sql.table(physical)} RENAME COLUMN ${sql.id(field.db_field_name)} TO __created_by_actor_type`.execute(
      test.dataDb
    );
    await test.metaDb
      .updateTable('field')
      .set({ db_field_name: '__created_by_actor_type' })
      .where('id', '=', field.id)
      .execute();
    const resolved = await operations.getActorColumnsTarget!(
      context,
      target.baseId,
      tableId,
      routeKey
    );
    expect(resolved.isErr() && resolved.error.code).toBe('actor_columns.business_collision');
    // A collision invalidates the stale target: enqueue fails closed instead of queuing
    // DDL that could hide or rewrite the business field's reserved name.
    const enqueued = await operations.enqueueActorColumns!(context, target);
    expect(enqueued.isErr() && enqueued.error.code).toBe('actor_columns.fence_lost');
    expect(await capability(tableId)).toMatchObject({
      actor_storage_version: 0,
      provision_state: 'ready',
    });
    expect(
      await test.metaDb
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', field.id)
        .executeTakeFirstOrThrow()
    ).toEqual({ db_field_name: '__created_by_actor_type' });
  });

  it('keeps capability zero on metadata publication failure and re-verifies committed DDL on retry', async () => {
    const { target, tableId } = await createLegacy();
    const publish = operations.completeActorColumns!;
    vi.spyOn(operations, 'completeActorColumns').mockImplementationOnce(async () =>
      err(
        domainError.infrastructure({
          code: 'actor_columns.publish_failed',
          message: 'Injected metadata publication failure',
        })
      )
    );
    const first = await enable(target);
    expect(first.result.status).toBe('failed');
    expect(await capability(tableId)).toMatchObject({ actor_storage_version: 0 });
    expect(operations.completeActorColumns).not.toBe(publish);
    vi.restoreAllMocks();
    const next = await enable(target);
    expect(next.operation.id).toBe(first.operation.id);
    expect(next.result.status).toBe('completed');
  });

  it('does not infer successful enable from an unknown data commit acknowledgement', async () => {
    const { target, tableId } = await createLegacy();
    const unknownCommit: IUnitOfWork = {
      withTransaction: async (ctx, work, options) => {
        const committed = await unitOfWork.withTransaction(ctx, work, options);
        return options?.scope === 'data' && committed.isOk()
          ? err(domainError.infrastructure({ message: 'Injected lost COMMIT acknowledgement' }))
          : committed;
      },
    };
    const queued = (await operations.enqueueActorColumns!(context, target))._unsafeUnwrap();
    const first = (
      await runner(unknownCommit).runOperation(context, await claim('unknown-commit'))
    )._unsafeUnwrap();
    expect(first.status).toBe('failed');
    expect(await capability(tableId)).toMatchObject({ actor_storage_version: 0 });
    const retry = await enable(target);
    expect(retry.operation.id).toBe(queued.id);
    expect(retry.result.status).toBe('completed');
  });

  it('does not publish after its real holding backend dies while the data transaction is open', async () => {
    const { target, tableId } = await createLegacy();
    let backendPid: number | undefined;
    const acquire = coordination.acquire.bind(coordination);
    vi.spyOn(coordination, 'acquire').mockImplementation(async (...args) => {
      const result = await acquire(...args);
      if (result.isOk()) backendPid = result.value.fence?.backendPid;
      return result;
    });
    const ensure = schema.ensureActorColumns.bind(schema);
    vi.spyOn(schema, 'ensureActorColumns').mockImplementationOnce(async (ctx, table) => {
      const result = await ensure(ctx, table);
      if (!backendPid) throw new Error('Missing real lease backend proof');
      await sql`SELECT pg_terminate_backend(${backendPid})`.execute(test.metaDb);
      return result;
    });
    const first = await enable(target);
    expect(first.result.status).toBe('failed');
    expect(await capability(tableId)).toMatchObject({
      actor_storage_version: 0,
      provision_state: 'ready',
    });
    vi.restoreAllMocks();
    const next = await enable(target);
    expect(next.operation.id).toBe(first.operation.id);
    expect(next.result.status).toBe('completed');
  });

  it('rejects released, foreign-table and terminated-backend lease proofs', async () => {
    for (const failure of ['released', 'foreign-table', 'terminated'] as const) {
      const { target, tableId } = await createLegacy();
      await operations.enqueueActorColumns!(context, target);
      const owned = await claim(`fence:${failure}`);
      const lease = (
        await coordination.acquire(
          context,
          [failure === 'foreign-table' ? `${tableId}other` : tableId],
          'exclusive'
        )
      )._unsafeUnwrap();
      try {
        if (!lease.fence) throw new Error('Real PostgreSQL lease must carry a fence');
        if (failure === 'released') await lease.release();
        if (failure === 'terminated')
          await sql`SELECT pg_terminate_backend(${lease.fence.backendPid})`.execute(test.metaDb);
        const result = await operations.completeActorColumns!(context, {
          operation: owned,
          target,
          leaseFence: lease.fence,
        });
        expect(result.isErr()).toBe(true);
        expect(await capability(tableId)).toMatchObject({ actor_storage_version: 0 });
        await operations.failActorColumns!(context, owned, { status: 'dead', phase: 'error' });
      } finally {
        await lease.release();
      }
    }
  });

  it('fences both publication and failure settlement against a newer operation claim', async () => {
    const { target, tableId } = await createLegacy();
    await operations.enqueueActorColumns!(context, target);
    const stale = await claim('old-worker');
    const current = (
      await operations.claimNextRunnable!(context, {
        lockedBy: 'new-worker',
        now: new Date(Date.now() + 1000),
        staleRunningBefore: new Date(Date.now() + 1000),
        types: ['table.actor_columns.enable'],
      })
    )._unsafeUnwrap()!;
    const lease = (await coordination.acquire(context, [tableId], 'exclusive'))._unsafeUnwrap();
    try {
      const result = await operations.completeActorColumns!(context, {
        operation: stale,
        target,
        leaseFence: lease.fence!,
      });
      expect(result.isErr()).toBe(true);
      expect(
        (
          await operations.failActorColumns!(context, stale, { status: 'dead', phase: 'error' })
        ).isErr()
      ).toBe(true);
      expect(await capability(tableId)).toMatchObject({ actor_storage_version: 0 });
    } finally {
      await lease.release();
    }
    expect((await runner().runOperation(context, current))._unsafeUnwrap().status).toBe(
      'completed'
    );
  });

  it('rejects frozen route/version mismatch before DDL and during publication', async () => {
    const { target, tableId } = await createLegacy();
    await operations.enqueueActorColumns!(context, target);
    const owned = await claim('route-worker');
    await sql`UPDATE table_meta SET version = version + 1 WHERE id = ${tableId}`.execute(
      test.metaDb
    );
    const result = (await runner().runOperation(context, owned))._unsafeUnwrap();
    expect(result.status).toBe('failed');
    expect(await capability(tableId)).toMatchObject({ actor_storage_version: 0 });
    const fresh = (
      await operations.getActorColumnsTarget!(context, target.baseId, tableId, routeKey)
    )._unsafeUnwrap();
    await operations.enqueueActorColumns!(context, fresh);
    const next = await claim('route-at-publish');
    const originalBase = await test.metaDb
      .selectFrom('base')
      .select('space_id')
      .where('id', '=', target.baseId)
      .executeTakeFirstOrThrow();
    const lease = (await coordination.acquire(context, [tableId], 'exclusive'))._unsafeUnwrap();
    try {
      await sql`UPDATE base SET space_id = ${'spcRouteChanged'} WHERE id = ${target.baseId}`.execute(
        test.metaDb
      );
      expect(
        (
          await operations.completeActorColumns!(context, {
            operation: next,
            target: fresh,
            leaseFence: lease.fence!,
          })
        ).isErr()
      ).toBe(true);
      expect(await capability(tableId)).toMatchObject({ actor_storage_version: 0 });
      await operations.failActorColumns!(context, next, { status: 'dead', phase: 'error' });
    } finally {
      await sql`UPDATE base SET space_id = ${originalBase.space_id}
        WHERE id = ${target.baseId}`.execute(test.metaDb);
      await lease.release();
    }
  });

  it('keeps ready operation authoritative if post-commit metadata notification throws', async () => {
    const { target, tableId } = await createLegacy();
    await operations.enqueueActorColumns!(context, target);
    const owned: SchemaOperationRecord = await claim('notification-failure');
    const result = (
      await runner(unitOfWork, async () => {
        throw new Error('Injected publishOpsMap failure');
      }).runOperation(context, owned)
    )._unsafeUnwrap();
    expect(result.status).toBe('completed');
    expect(await capability(tableId)).toMatchObject({ actor_storage_version: 1 });
    const stored = await test.metaDb
      .selectFrom('schema_operation')
      .select(['status', 'result'])
      .where('id', '=', owned.id)
      .executeTakeFirstOrThrow();
    expect(stored.status).toBe('ready');
    expect(stored.result).toMatchObject({ notificationDelivered: false });
    expect(
      (
        await operations.markActorColumnsNotified!(context, {
          ...owned,
          status: 'ready',
          result: stored.result,
        })
      ).isOk()
    ).toBe(true);
    const acknowledged = await test.metaDb
      .selectFrom('schema_operation')
      .select('result')
      .where('id', '=', owned.id)
      .executeTakeFirstOrThrow();
    expect(acknowledged.result).toMatchObject({ notificationDelivered: true });
  });
});
