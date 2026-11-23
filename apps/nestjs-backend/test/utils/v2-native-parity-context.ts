import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
  type ComputedUpdateOutboxConfig,
} from '@teable/v2-adapter-table-repository-postgres';
import { SpyLogger, type IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  BaseId,
  MemoryEventBus,
  v2CoreTokens,
  type AsyncMemoryEventBus,
  type ILogger,
  type ITableRepository,
} from '@teable/v2-core';
import { V2ContainerService } from '../../src/features/v2/v2-container.service';
import { createBase, createSpace, initApp, permanentDeleteSpace } from './init-app';
import { signInPublicHost } from './public-orpc';
import {
  createE2eRequestClient,
  createE2eBaseFixture,
  TEST_USER,
  type SharedTestContext,
} from '../../../../packages/v2/e2e/src/shared/globalTestContext';

/** Observe the production runtime without replacing any command, policy or projection. */
export const createNestTestContext = async (): Promise<SharedTestContext> => {
  const connectionString = process.env.PRISMA_DATABASE_URL;
  if (!connectionString)
    throw new Error('Nest parity requires the backend worker PostgreSQL database');
  const { app, appUrl } = await initApp();
  const cookie = await signInPublicHost(appUrl);
  const userResponse = await fetch(`${appUrl}/api/auth/user/me`, { headers: { cookie } });
  if (!userResponse.ok) throw new Error(`Could not resolve signed-in user: ${userResponse.status}`);
  const user: { id: string; name: string; email: string } = await userResponse.json();
  Object.assign(TEST_USER, { id: user.id, name: user.name, email: user.email });

  const space = await createSpace({ name: 'v2 public HTTP parity' });
  const base = await createBase({ spaceId: space.id, name: 'v2 public HTTP parity' });
  const container = await app.get(V2ContainerService).getContainerForBase(base.id);
  const metaDb = container.resolve<IV2NodeTestContainer['metaDb']>(v2MetaDbTokens.db);
  const dataDb = container.resolve<IV2NodeTestContainer['dataDb']>(v2DataDbTokens.db);
  const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
  const productionEvents = container.resolve<AsyncMemoryEventBus>(v2CoreTokens.eventBus);
  const eventBus = new MemoryEventBus(container);
  const spyLogger = new SpyLogger();
  const productionLogger = container.resolve<ILogger>(v2CoreTokens.logger);
  const restores: Array<() => void> = [];

  // Retain event object identity and actual production dispatch, including failed publishes.
  for (const name of ['publish', 'publishMany', 'recordPublished'] as const) {
    const original = productionEvents[name];
    if (name === 'publish') {
      const publish = productionEvents.publish.bind(productionEvents);
      productionEvents.publish = (context, event) => {
        eventBus.recordPublished([event]);
        return publish(context, event);
      };
    } else if (name === 'publishMany') {
      const publishMany = productionEvents.publishMany.bind(productionEvents);
      productionEvents.publishMany = (context, events) => {
        eventBus.recordPublished(events);
        return publishMany(context, events);
      };
    } else {
      const recordPublished = productionEvents.recordPublished.bind(productionEvents);
      productionEvents.recordPublished = (events) => {
        eventBus.recordPublished(events);
        recordPublished(events);
      };
    }
    restores.push(() => Object.assign(productionEvents, { [name]: original }));
  }
  // PinoLoggerAdapter.child returns the same instance, so already-resolved consumers
  // remain observable and every log still reaches the actual production logger.
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    const original = productionLogger[level];
    productionLogger[level] = (message, context) => {
      spyLogger.capture(level, message, context);
      original.call(productionLogger, message, context);
    };
    restores.push(() => {
      productionLogger[level] = original;
    });
  }

  const worker = container.resolve<ComputedUpdateWorker>(
    v2RecordRepositoryPostgresTokens.computedUpdateWorker
  );
  const { workerLane } = container.resolve<ComputedUpdateOutboxConfig>(
    v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig
  );
  const processOutboxOnce = async () => {
    const result = await worker.runOnce({ workerId: 'nest-public-parity', limit: 100 });
    if (result.isErr()) throw new Error(`Outbox processing failed: ${result.error.message}`);
    return result.value;
  };
  const processOutbox = async () => {
    let processed = 0;
    for (let round = 0; round < 100; round += 1) {
      await productionEvents.settled();
      const count = await processOutboxOnce();
      processed += count;
      const active = await dataDb
        .selectFrom('computed_update_outbox')
        .select(['run_id', 'status'])
        .where('worker_lane', '=', workerLane)
        .where((eb) =>
          eb.or([
            eb('status', '=', 'processing'),
            eb.and([eb('status', '=', 'pending'), eb('next_run_at', '<=', new Date())]),
          ])
        )
        .execute();
      if (count === 0 && active.length === 0) {
        await productionEvents.settled();
        return processed;
      }
      // The app's real worker can own a lease; let it finish before inspecting again.
      await delay(10);
    }
    throw new Error('Nest computed outbox did not quiesce after 100 iterations');
  };
  const drainOutbox = async () => {
    await processOutbox();
  };

  // Existing suites also issue raw fetches. A transparent local gateway attaches
  // the genuine session cookie; Nest receives the original path and input.
  const gateway = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined && !['host', 'connection', 'content-length'].includes(name)) {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
      }
      headers.set('cookie', cookie);
      if (!headers.has('x-window-id')) headers.set('x-window-id', 'e2e-window');
      const upstream = await fetch(`${appUrl}/api/v2${request.url}`, {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
      response.statusCode = upstream.status;
      for (const [name, value] of upstream.headers) {
        if (
          !['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(name)
        ) {
          response.setHeader(name, value);
        }
      }
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          if (!response.write(chunk)) await once(response, 'drain');
        }
      }
      response.end();
    } catch (error) {
      response.statusCode = 502;
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  gateway.keepAliveTimeout = 0;
  const baseUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const testContainer: IV2NodeTestContainer = {
    container,
    tableRepository,
    eventBus,
    baseId: BaseId.create(base.id)._unsafeUnwrap(),
    metaDb,
    dataDb,
    db: metaDb,
    connectionString,
    processOutbox,
    processOutboxOnce,
    spyLogger,
    getComputedPlans: () => spyLogger.getComputedPlans(),
    getLastComputedPlan: () => spyLogger.getLastComputedPlan(),
    clearLogs: () => spyLogger.clear(),
    dispose: async () => {
      try {
        const closed = Promise.withResolvers<void>();
        gateway.close((error) => (error ? closed.reject(error) : closed.resolve()));
        await closed.promise;
        await permanentDeleteSpace(space.id);
      } finally {
        for (const restore of restores.reverse()) restore();
        await app.close();
      }
    },
  };
  return {
    testContainer,
    baseId: base.id,
    spaceId: space.id,
    createBase: (name) => createE2eBaseFixture(baseUrl, space.id, name),
    baseUrl,
    testUser: TEST_USER,
    ...createE2eRequestClient({ baseUrl, baseId: base.id, drainOutbox }),
    drainOutbox,
    clearLogs: () => spyLogger.clear(),
    getLastComputedPlan: () => spyLogger.getLastComputedPlan(),
  };
};
