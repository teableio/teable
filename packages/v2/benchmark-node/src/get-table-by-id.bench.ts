import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { createV2FastifyPlugin } from '@teable/v2-contract-http-fastify';
import { createV2HonoApp } from '@teable/v2-contract-http-hono';
import { NoopLogger, v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import {
  createAllBaseFields,
  createSimpleFields,
  createTextColumns,
} from '@teable/v2-table-templates';
import express from 'express';
import fastify from 'fastify';
import { afterAll, beforeAll, bench, describe } from 'vitest';

const benchOptions = {
  iterations: 0,
  warmupIterations: 0,
  time: 5000,
  warmupTime: 1000,
  throws: true,
};

const createTableName = (framework: string, scenario: string): string => {
  const random = Math.random().toString(36).slice(2, 8);
  return `Bench_Get_${framework}_${scenario}_${Date.now()}_${random}`;
};

type IBenchTarget = {
  name: string;
  client: ReturnType<typeof createV2HttpClient>;
  close: () => Promise<void>;
};

let servers: IBenchTarget[] = [];
let dispose: (() => Promise<void>) | undefined;
let baseId: string;
let tableIds: Record<string, string> = {};
let setupPromise: Promise<void> | undefined;

const setupExpress = async (container: DependencyContainer): Promise<IBenchTarget> => {
  const app = express();
  app.use(
    createV2ExpressRouter({
      createContainer: () => container,
    })
  );

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = createV2HttpClient({ baseUrl });

  return {
    name: 'express',
    client,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

const setupFastify = async (container: DependencyContainer): Promise<IBenchTarget> => {
  const app = fastify();
  await app.register(
    createV2FastifyPlugin({
      createContainer: () => container,
    })
  );
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = createV2HttpClient({ baseUrl });

  return {
    name: 'fastify',
    client,
    close: async () => {
      await app.close();
    },
  };
};

const setupHono = async (container: DependencyContainer): Promise<IBenchTarget> => {
  const app = createV2HonoApp({
    createContainer: () => container,
  });
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = createV2HttpClient({ baseUrl });

  return {
    name: 'hono',
    client,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

const createTable = async (
  target: IBenchTarget,
  scenario: string,
  fields: ICreateTableRequestDto['fields']
): Promise<string> => {
  if (!baseId) throw new Error('BaseId is missing');

  const input = {
    baseId,
    name: createTableName(target.name, scenario),
    fields,
  };

  const response = await target.client.tables.create(input);
  if (!response.ok) {
    throw new Error('Create table failed');
  }

  return response.data.table.id;
};

const setup = async () => {
  const testContainer = await createV2NodeTestContainer();
  testContainer.container.registerInstance(v2CoreTokens.logger, new NoopLogger());
  dispose = testContainer.dispose;
  baseId = testContainer.baseId.toString();

  const expressTarget = await setupExpress(testContainer.container);
  const fastifyTarget = await setupFastify(testContainer.container);
  const honoTarget = await setupHono(testContainer.container);

  servers = [expressTarget, fastifyTarget, honoTarget];

  tableIds = {
    simple: await createTable(expressTarget, 'simple', createSimpleFields()),
    base: await createTable(expressTarget, 'base', createAllBaseFields()),
    columns200: await createTable(expressTarget, '200', createTextColumns(200)),
    columns1000: await createTable(expressTarget, '1000', createTextColumns(1000)),
  };
};

const ensureSetup = async () => {
  if (!setupPromise) {
    setupPromise = setup();
  }
  await setupPromise;
};

beforeAll(async () => {
  await ensureSetup();
});

afterAll(async () => {
  for (const server of servers) {
    await server.close();
  }
  if (dispose) await dispose();
});

const runGetTableById = async (target: IBenchTarget, scenario: string) => {
  if (!baseId) throw new Error('BaseId is missing');
  const tableId = tableIds[scenario];
  if (!tableId) {
    throw new Error(`Missing table for scenario ${scenario}`);
  }

  const response = await target.client.tables.getById({ baseId, tableId });
  if (!response.ok) {
    throw new Error('Get table failed');
  }
};

const frameworks = ['express', 'fastify', 'hono'] as const;

const getTarget = (name: string): IBenchTarget => {
  const target = servers.find((server) => server.name === name);
  if (!target) {
    throw new Error(`${name} server is not initialized`);
  }
  return target;
};

const benchGetTable = (framework: (typeof frameworks)[number], label: string, scenario: string) => {
  bench(
    `${framework}: get table by id: ${label}`,
    async () => {
      await ensureSetup();
      await runGetTableById(getTarget(framework), scenario);
    },
    benchOptions
  );
};

describe('GetTableById benchmarks: 3 columns', () => {
  for (const framework of frameworks) {
    benchGetTable(framework, '3 columns', 'simple');
  }
});

describe('GetTableById benchmarks: all base fields', () => {
  for (const framework of frameworks) {
    benchGetTable(framework, 'all base fields', 'base');
  }
});

describe('GetTableById benchmarks: 200 columns', () => {
  for (const framework of frameworks) {
    benchGetTable(framework, '200 columns', 'columns200');
  }
});

describe('GetTableById benchmarks: 1000 columns', () => {
  for (const framework of frameworks) {
    benchGetTable(framework, '1000 columns', 'columns1000');
  }
});
