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
  return `Bench_${framework}_${scenario}_${Date.now()}_${random}`;
};

const createSimpleFields = (): ICreateTableRequestDto['fields'] => [
  { type: 'singleLineText', name: 'Name' },
  { type: 'number', name: 'Amount', options: { defaultValue: 1 } },
  { type: 'checkbox', name: 'Done', options: { defaultValue: false } },
];

const createAllBaseFields = (): ICreateTableRequestDto['fields'] => [
  { type: 'singleLineText', name: 'Name' },
  { type: 'longText', name: 'Description', options: { defaultValue: 'Notes' } },
  { type: 'number', name: 'Amount', options: { defaultValue: 10 } },
  { type: 'rating', name: 'Priority', max: 5, options: { icon: 'star', color: 'yellowBright' } },
  { type: 'singleSelect', name: 'Status', options: ['Todo', 'Done'] },
  { type: 'multipleSelect', name: 'Tags', options: ['Frontend', 'Backend'] },
  { type: 'checkbox', name: 'Done', options: { defaultValue: true } },
  { type: 'attachment', name: 'Files' },
  { type: 'date', name: 'Due Date' },
  { type: 'user', name: 'Owner', options: { isMultiple: false } },
  { type: 'button', name: 'Action', options: { label: 'Run' } },
];

const createTextColumns = (count: number): ICreateTableRequestDto['fields'] =>
  Array.from({ length: count }, (_, index) => ({
    type: 'singleLineText',
    name: `Column ${index + 1}`,
  }));

type IBenchTarget = {
  name: string;
  client: ReturnType<typeof createV2HttpClient>;
  close: () => Promise<void>;
};

describe('CreateTable benchmarks', () => {
  let servers: IBenchTarget[] = [];
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
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

  const setup = async () => {
    const testContainer = await createV2NodeTestContainer();
    testContainer.container.registerInstance(v2CoreTokens.logger, new NoopLogger());
    dispose = testContainer.dispose;
    baseId = testContainer.baseId.toString();

    const expressTarget = await setupExpress(testContainer.container);
    const fastifyTarget = await setupFastify(testContainer.container);
    const honoTarget = await setupHono(testContainer.container);

    servers = [expressTarget, fastifyTarget, honoTarget];
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

  const runCreateTable = async (
    target: IBenchTarget,
    label: string,
    fields: ICreateTableRequestDto['fields']
  ) => {
    if (!baseId) throw new Error('BaseId is missing');

    const input = {
      baseId,
      name: createTableName(target.name, label),
      fields,
    };

    try {
      const response = await target.client.tables.create(input);
      if (!response.ok) {
        throw new Error('Create table failed');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create table failed';
      throw new Error(message);
    }
  };

  const simpleFields = createSimpleFields();
  const baseFields = createAllBaseFields();
  const fields200 = createTextColumns(200);
  const fields1000 = createTextColumns(1000);

  const expressFramework = 'express';
  const fastifyFramework = 'fastify';
  const honoFramework = 'hono';
  const simpleScenario = 'simple';
  const baseScenario = 'base';
  const columns200Scenario = '200';
  const columns1000Scenario = '1000';
  const simpleLabel = '3 columns';
  const baseLabel = 'all base fields';
  const columns200Label = '200 columns';
  const columns1000Label = '1000 columns';

  const getTarget = (name: string): IBenchTarget => {
    const target = servers.find((server) => server.name === name);
    if (!target) {
      throw new Error(`${name} server is not initialized`);
    }
    return target;
  };

  const benchCreateTable = (
    framework: string,
    label: string,
    scenario: string,
    fields: ICreateTableRequestDto['fields']
  ) => {
    bench(
      `${framework}: create table: ${label}`,
      async () => {
        await ensureSetup();
        await runCreateTable(getTarget(framework), scenario, fields);
      },
      benchOptions
    );
  };

  benchCreateTable(expressFramework, simpleLabel, simpleScenario, simpleFields);
  benchCreateTable(expressFramework, baseLabel, baseScenario, baseFields);
  benchCreateTable(expressFramework, columns200Label, columns200Scenario, fields200);
  benchCreateTable(expressFramework, columns1000Label, columns1000Scenario, fields1000);

  benchCreateTable(fastifyFramework, simpleLabel, simpleScenario, simpleFields);
  benchCreateTable(fastifyFramework, baseLabel, baseScenario, baseFields);
  benchCreateTable(fastifyFramework, columns200Label, columns200Scenario, fields200);
  benchCreateTable(fastifyFramework, columns1000Label, columns1000Scenario, fields1000);

  benchCreateTable(honoFramework, simpleLabel, simpleScenario, simpleFields);
  benchCreateTable(honoFramework, baseLabel, baseScenario, baseFields);
  benchCreateTable(honoFramework, columns200Label, columns200Scenario, fields200);
  benchCreateTable(honoFramework, columns1000Label, columns1000Scenario, fields1000);
});
