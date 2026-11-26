import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldKeyType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { axios, tableActorColumnsVoSchema, type ITableFullVo } from '@teable/openapi';
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import {
  v2CoreTokens,
  type IExecutionContext,
  type SchemaOperationRunnerService,
  ActorId,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { CrossSpaceLinkConversionRecoveryService } from '../src/features/table-lifecycle/cross-space-link-conversion-recovery.service';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { V2SchemaOperationRunnerService } from '../src/features/v2/v2-schema-operation-runner.service';
import {
  DataDbRuntimeCacheService,
  V2_CONTAINER_CACHE_NAMESPACE,
} from '../src/global/data-db-runtime-cache.service';
import { ShareDbService } from '../src/share-db/share-db.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import {
  createRecords,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';

const actorColumns = [
  '__created_by_actor_type',
  '__created_by_actor_id',
  '__last_modified_by_actor_type',
  '__last_modified_by_actor_id',
];

describe('Table actor enable API (real PostgreSQL)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  const runnerPrototype = V2SchemaOperationRunnerService.prototype as unknown as {
    drainRunnableOperations(): Promise<void>;
    claimRunnableOperation(runner: SchemaOperationRunnerService, now: Date): Promise<unknown>;
  };
  const originalDrain = runnerPrototype.drainRunnableOperations;
  const originalClaim = runnerPrototype.claimRunnableOperation;
  let manualWorker: V2SchemaOperationRunnerService | undefined;
  let restoreBackgroundWorker: (() => void) | undefined;
  const baseId = globalThis.testConfig.baseId;
  const statusPath = () => `/base/${baseId}/table/${table.id}/actor-columns`;
  const enablePath = () => `${statusPath()}/enable`;

  beforeAll(async () => {
    // Other Nest apps in this serial worker share the database and can retain timers.
    // Guard claims too: a drain already in flight must not claim this fixture's later rows.
    const claims = vi.spyOn(runnerPrototype, 'claimRunnableOperation').mockImplementation(function (
      this: V2SchemaOperationRunnerService,
      runner,
      now
    ) {
      return this === manualWorker
        ? originalClaim.call(this, runner, now)
        : Promise.resolve(undefined);
    });
    const drains = vi
      .spyOn(runnerPrototype, 'drainRunnableOperations')
      .mockResolvedValue(undefined);
    restoreBackgroundWorker = () => {
      drains.mockRestore();
      claims.mockRestore();
    };
    vi.stubEnv('V2_SCHEMA_OPERATION_RUNNER_ENABLED', 'false');
    app = (await initApp()).app;
  });
  beforeEach(async () => {
    table = await createTable(baseId, {
      name: 'Actor opt-in legacy fixture',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
    });
    const prisma = app.get(PrismaService);
    await prisma.tableMeta.update({ where: { id: table.id }, data: { actorStorageVersion: 0 } });
    const container = await app.get(V2ContainerService).getContainerForBase(baseId);
    const data = container.resolve<Kysely<V1TeableDatabase>>(v2DataDbTokens.db);
    for (const name of actorColumns) {
      await sql`ALTER TABLE ${sql.table(table.dbTableName)} DROP COLUMN IF EXISTS ${sql.id(name)} CASCADE`.execute(
        data
      );
    }
  });
  afterEach(async () => {
    await permanentDeleteTable(baseId, table.id);
    await app.get(PrismaService).schemaOperation.deleteMany({
      where: { tableId: table.id, type: 'table.actor_columns.enable' },
    });
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      restoreBackgroundWorker?.();
      vi.unstubAllEnvs();
    }
  });

  it('requires actual login for status and enable despite TableController anonymous compatibility', async () => {
    const origin = await app.getUrl();
    for (const [path, method] of [
      [statusPath(), 'GET'],
      [enablePath(), 'POST'],
    ] as const) {
      const response = await fetch(`${origin}/api${path}`, {
        method,
        headers: new Headers([['content-type', 'application/json']]),
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(response.status).toBe(401);
    }
  });

  it('does not grant status or enable to an authenticated principal without table permission', async () => {
    const outsider = await createNewUserAxios({
      email: `actor-outsider-${Date.now()}@example.com`,
      password: 'app-platform-test-actor-123',
    });
    for (const request of [
      () => outsider.get(statusPath()),
      () => outsider.post(enablePath(), {}),
    ]) {
      await expect(request()).rejects.toMatchObject({ status: 403, code: 'restricted_resource' });
    }
    expect((await axios.get(statusPath())).data.state).toBe('disabled');
  });

  it('rejects any nonempty enable body using the frozen strict schema', async () => {
    for (const body of [{ actorStorageVersion: 1 }, { connectionId: 'forged' }, { force: true }]) {
      await expect(axios.post(enablePath(), body)).rejects.toMatchObject({ status: 400 });
    }
    expect((await axios.get(statusPath())).data.state).toBe('disabled');
  });

  it('keeps disabled native CRUD and null actor output, then enqueues HTTP200 without hiding the table', async () => {
    const title = table.fields[0].id;
    const created = await createRecords(table.id, {
      records: [{ fields: { [title]: 'before enable' } }],
    });
    const record = created.records[0];
    await updateRecord(table.id, record.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [title]: 'still native' } },
    });
    const records = await getRecords(table.id);
    expect(records.records.find((item) => item.id === record.id)).toMatchObject({
      createdByActorType: null,
      createdByActorId: null,
      lastModifiedByActorType: null,
      lastModifiedByActorId: null,
    });
    const disabled = await axios.get(statusPath());
    expect(tableActorColumnsVoSchema.parse(disabled.data)).toMatchObject({
      actorStorageVersion: 0,
      state: 'disabled',
    });
    const accepted = await axios.post(enablePath(), {});
    expect(accepted.status).toBe(200);
    expect(tableActorColumnsVoSchema.parse(accepted.data)).toMatchObject({
      actorStorageVersion: 0,
      state: 'pending',
      operation: { status: 'pending' },
    });
    const prisma = app.get(PrismaService);
    expect(await prisma.tableMeta.findUnique({ where: { id: table.id } })).toMatchObject({
      actorStorageVersion: 0,
      provisionState: 'ready',
    });
    expect((await getRecords(table.id)).records.some((item) => item.id === record.id)).toBe(true);
  });

  it('reuses one actual persisted operation for concurrent pending and running duplicates', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => axios.post(enablePath(), {}))
    );
    const ids = new Set(results.map((result) => result.data.operation.id));
    expect(ids.size).toBe(1);
    const operationId = results[0].data.operation.id;
    const prisma = app.get(PrismaService);
    await prisma.schemaOperation.update({
      where: { id: operationId },
      data: { status: 'running', lockedBy: 'api-duplicate-owner', lockedAt: new Date() },
    });
    const repeated = await axios.post(enablePath(), {});
    expect(repeated.data.operation).toMatchObject({ id: operationId, status: 'running' });
    expect(await prisma.schemaOperation.findUnique({ where: { id: operationId } })).toMatchObject({
      lockedBy: 'api-duplicate-owner',
    });
  });

  it('same POST retries error and dead without manufacturing another operation or leaking driver text', async () => {
    const first = await axios.post(enablePath(), {});
    const id = first.data.operation.id;
    const prisma = app.get(PrismaService);
    for (const status of ['error', 'dead']) {
      // This assertion owns the retry transition, not an independently running worker's claim.
      const backoffUntil = new Date(Date.now() + 24 * 60 * 60 * 1_000);
      await prisma.schemaOperation.update({
        where: { id },
        data: {
          status,
          lastError: 'postgres://private:secret@db SQL ALTER TABLE',
          attempts: 8,
          nextRunAt: backoffUntil,
          lockedBy: null,
          lockedAt: null,
        },
      });
      const failed = await axios.get(statusPath());
      expect(failed.data.state).toBe('error');
      expect(JSON.stringify(failed.data)).not.toContain('postgres://');
      expect(JSON.stringify(failed.data)).not.toContain('ALTER TABLE');
      const retried = await axios.post(enablePath(), {});
      expect(retried.data.operation).toMatchObject({
        id,
        status: 'pending',
        attempts: 0,
        lastError: null,
      });
      expect(new Date(retried.data.operation.nextRunAt).getTime()).toBeLessThan(
        backoffUntil.getTime()
      );
      expect(new Date(retried.data.operation.nextRunAt).getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  const claimAcceptedOperation = async (operationId: string, workerId: string) => {
    const prisma = app.get(PrismaService);
    const operation = await prisma.schemaOperation.findUniqueOrThrow({ where: { id: operationId } });
    expect(operation.status).toBe('pending');
    expect(operation.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());

    // Only this fixture is due at the claim clock, even if other suites left pending work.
    const now = new Date(0);
    await prisma.schemaOperation.update({ where: { id: operationId }, data: { nextRunAt: now } });
    const container = await app.get(V2ContainerService).getContainerForBase(baseId);
    const runner = container.resolve<SchemaOperationRunnerService>(
      v2CoreTokens.schemaOperationRunnerService
    );
    const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const claimed = (await runner.claimNext(context, { workerId, now }))._unsafeUnwrap();
    if (claimed.status !== 'claimed') throw new Error('Enable should be immediately claimable');
    expect(claimed.operation.id).toBe(operationId);
    return { runner, context, operation: claimed.operation };
  };

  it('real registered worker completes capability and repeated POST returns ready', async () => {
    const accepted = await axios.post(enablePath(), {});
    const { runner, context, operation } = await claimAcceptedOperation(
      accepted.data.operation.id,
      'api-enable-consumer'
    );
    expect((await runner.runOperation(context, operation))._unsafeUnwrap().status).toBe(
      'completed'
    );
    expect((await axios.get(statusPath())).data).toMatchObject({
      actorStorageVersion: 1,
      state: 'ready',
      operation: { status: 'ready' },
    });
    expect((await axios.post(enablePath(), {})).data).toMatchObject({
      actorStorageVersion: 1,
      state: 'ready',
      operation: { id: accepted.data.operation.id },
    });
  });

  it('ready GET retries failed metadata OT delivery without rerunning DDL or changing ready operation', async () => {
    const accepted = await axios.post(enablePath(), {});
    const { runner, context, operation } = await claimAcceptedOperation(
      accepted.data.operation.id,
      'api-notification-consumer'
    );
    const publish = vi
      .spyOn(app.get(ShareDbService), 'publishOpsMap')
      .mockRejectedValueOnce(new Error('Injected metadata transport failure'));
    try {
      expect((await runner.runOperation(context, operation))._unsafeUnwrap().status).toBe(
        'completed'
      );
      const prisma = app.get(PrismaService);
      expect(
        await prisma.schemaOperation.findUnique({ where: { id: accepted.data.operation.id } })
      ).toMatchObject({ status: 'ready', result: { notificationDelivered: false } });
      expect((await axios.get(statusPath())).data).toMatchObject({
        actorStorageVersion: 1,
        state: 'ready',
      });
      expect(
        await prisma.schemaOperation.findUnique({ where: { id: accepted.data.operation.id } })
      ).toMatchObject({ status: 'ready', result: { notificationDelivered: true } });
      expect(publish).toHaveBeenCalledTimes(2);
    } finally {
      publish.mockRestore();
    }
  });

  it('continues accepted enable after storage cutover retires the bootstrapped claim container', async () => {
    const accepted = await axios.post(enablePath(), {});
    const containers = app.get(V2ContainerService);
    const worker = new V2SchemaOperationRunnerService(
      containers,
      new ConfigService({
        V2_SCHEMA_OPERATION_RUNNER_ENABLED: true,
      }),
      app.get(CrossSpaceLinkConversionRecoveryService)
    );
    // Suppress only the timer, not claim/run/storage: drive one real drain deterministically.
    const lifecycle = worker as unknown as {
      schedule(delayMs: number): void;
      drainRunnableOperations(): Promise<void>;
    };
    const scheduling = vi.spyOn(lifecycle, 'schedule').mockImplementation(() => undefined);
    manualWorker = worker;
    try {
      await worker.onApplicationBootstrap();
      await app.get(DataDbRuntimeCacheService).deleteByNamespace(V2_CONTAINER_CACHE_NAMESPACE);
      await originalDrain.call(worker);
      expect((await axios.get(statusPath())).data).toMatchObject({
        actorStorageVersion: 1,
        state: 'ready',
        operation: { id: accepted.data.operation.id, status: 'ready' },
      });
    } finally {
      manualWorker = undefined;
      worker.onModuleDestroy();
      scheduling.mockRestore();
    }
  });
});
