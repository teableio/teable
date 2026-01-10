import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-pg';
import { registerV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { registerV2PostgresJsDb } from '@teable/v2-adapter-db-postgres-postgresjs';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2HonoApp } from '@teable/v2-contract-http-hono';
import { NoopLogger, v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { createSimpleFields, createTextColumns } from '@teable/v2-table-templates';
import { afterAll, beforeAll, bench, describe } from 'vitest';

const benchOptions = {
  iterations: 0,
  warmupIterations: 0,
  time: 5000,
  warmupTime: 1000,
  throws: true,
};

const createTableName = (adapterName: string, scenario: string): string => {
  const random = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-6);
  const suffix = `_${time}_${random}`;
  const prefixBase = `b_${adapterName}_${scenario}`;
  const maxPrefixLength = 40 - suffix.length;
  const prefix =
    maxPrefixLength > 0 ? prefixBase.slice(0, maxPrefixLength) : prefixBase.slice(0, 1);
  return `${prefix}${suffix}`;
};

type IBenchTarget = {
  name: string;
  baseId: string;
  tableIds: Record<string, string>;
  client: ReturnType<typeof createV2HttpClient>;
  close: () => Promise<void>;
  dispose: () => Promise<void>;
};

type IDbAdapter = {
  name: string;
  registerDb: (
    container: DependencyContainer,
    config: IV2PostgresDbConfig
  ) => Promise<DependencyContainer | void>;
};

const adapters: IDbAdapter[] = [
  { name: 'pg', registerDb: registerV2PostgresDb },
  { name: 'postgresjs', registerDb: registerV2PostgresJsDb },
];

const simpleScenario = 'simple';
const columns200Scenario = 'columns200';

let targets: IBenchTarget[] = [];
let setupPromise: Promise<void> | undefined;

const setupTarget = async (adapter: IDbAdapter): Promise<IBenchTarget> => {
  const testContainer = await createV2NodeTestContainer({
    registerDb: adapter.registerDb,
  });
  testContainer.container.registerInstance(v2CoreTokens.logger, new NoopLogger());

  const app = createV2HonoApp({
    createContainer: () => testContainer.container,
  });
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = createV2HttpClient({ baseUrl });
  const baseId = testContainer.baseId.toString();

  const tableIds: Record<string, string> = {};
  const createSeedTable = async (scenario: string, fields: ICreateTableRequestDto['fields']) => {
    const response = await client.tables.create({
      baseId,
      name: createTableName(adapter.name, scenario),
      fields,
    });
    if (!response.ok) {
      throw new Error('Seed table creation failed');
    }
    tableIds[scenario] = response.data.table.id;
  };

  await createSeedTable(simpleScenario, createSimpleFields());
  await createSeedTable(columns200Scenario, createTextColumns(200));

  return {
    name: adapter.name,
    baseId,
    tableIds,
    client,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    dispose: testContainer.dispose,
  };
};

const setup = async () => {
  targets = await Promise.all(adapters.map((adapter) => setupTarget(adapter)));
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
  for (const target of targets) {
    await target.close();
    await target.dispose();
  }
});

const runCreateTable = async (
  target: IBenchTarget,
  scenario: string,
  fieldsFactory: () => ICreateTableRequestDto['fields']
) => {
  const response = await target.client.tables.create({
    baseId: target.baseId,
    name: createTableName(target.name, scenario),
    fields: fieldsFactory(),
  });

  if (!response.ok) {
    throw new Error('Create table failed');
  }
};

const runGetTableById = async (target: IBenchTarget, scenario: string) => {
  const tableId = target.tableIds[scenario];
  if (!tableId) {
    throw new Error(`Missing table for scenario ${scenario}`);
  }

  const response = await target.client.tables.getById({
    baseId: target.baseId,
    tableId,
  });

  if (!response.ok) {
    throw new Error('Get table failed');
  }
};

const getTarget = (name: string): IBenchTarget => {
  const target = targets.find((item) => item.name === name);
  if (!target) {
    throw new Error(`${name} target is not initialized`);
  }
  return target;
};

const simpleFieldsFactory = () => createSimpleFields();
const fields200Factory = () => createTextColumns(200);

describe('DB adapter benchmarks (Hono): create table (3 columns)', () => {
  for (const adapter of adapters) {
    bench(
      `hono + ${adapter.name}: create table (3 columns)`,
      async () => {
        await ensureSetup();
        await runCreateTable(getTarget(adapter.name), simpleScenario, simpleFieldsFactory);
      },
      benchOptions
    );
  }
});

describe('DB adapter benchmarks (Hono): create table (200 columns)', () => {
  for (const adapter of adapters) {
    bench(
      `hono + ${adapter.name}: create table (200 columns)`,
      async () => {
        await ensureSetup();
        await runCreateTable(getTarget(adapter.name), columns200Scenario, fields200Factory);
      },
      benchOptions
    );
  }
});

describe('DB adapter benchmarks (Hono): get table by id (3 columns)', () => {
  for (const adapter of adapters) {
    bench(
      `hono + ${adapter.name}: get table by id (3 columns)`,
      async () => {
        await ensureSetup();
        await runGetTableById(getTarget(adapter.name), simpleScenario);
      },
      benchOptions
    );
  }
});

describe('DB adapter benchmarks (Hono): get table by id (200 columns)', () => {
  for (const adapter of adapters) {
    bench(
      `hono + ${adapter.name}: get table by id (200 columns)`,
      async () => {
        await ensureSetup();
        await runGetTableById(getTarget(adapter.name), columns200Scenario);
      },
      benchOptions
    );
  }
});
