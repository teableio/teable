import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { createV2FastifyPlugin } from '@teable/v2-contract-http-fastify';
import { createV2HonoApp } from '@teable/v2-contract-http-hono';
import { NoopLogger, v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { allFieldTypesTemplate, createTextColumns } from '@teable/v2-table-templates';
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
  return `Bench_CreateRecord_${framework}_${scenario}_${Date.now()}_${random}`;
};

type IBenchTarget = {
  name: string;
  client: ReturnType<typeof createV2HttpClient>;
  close: () => Promise<void>;
};

type SeededTable = {
  tableId: string;
  fields: Record<string, unknown>;
};

let servers: IBenchTarget[] = [];
let dispose: (() => Promise<void>) | undefined;
let baseId: string;
let seededTables: Record<string, SeededTable> = {};
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

const buildTextValues = (fieldIds: ReadonlyArray<string>, valuePrefix: string) => {
  return Object.fromEntries(fieldIds.map((fieldId, index) => [fieldId, `${valuePrefix}${index}`]));
};

const seedTextTable = async (target: IBenchTarget, scenario: string, columnCount: number) => {
  if (!baseId) throw new Error('BaseId is missing');

  const response = await target.client.tables.create({
    baseId,
    name: createTableName(target.name, scenario),
    fields: createTextColumns(columnCount),
  });
  if (!response.ok) {
    throw new Error('Create table failed');
  }

  const fieldIds = response.data.table.fields.map((f) => f.id);
  return {
    tableId: response.data.table.id,
    fields: buildTextValues(fieldIds, `v_${scenario}_`),
  };
};

const getTemplateTableInput = (
  input: ReturnType<typeof allFieldTypesTemplate.createInput>,
  tableName: string
) => {
  const table = input.tables.find((t) => t.name === tableName);
  if (!table) throw new Error(`Missing template table: ${tableName}`);
  return table;
};

const getFieldIdByName = (fields: ReadonlyArray<{ name: string }>, name: string): string => {
  const field = fields.find((f) => f.name === name);
  const id = (field as { id?: unknown } | undefined)?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Missing field id for: ${name}`);
  }
  return id;
};

const getSelectChoiceIdByName = (
  fields: ReadonlyArray<{ name: string }>,
  name: string,
  index = 0
): string => {
  const field = fields.find((f) => f.name === name);
  const choices = (field as { options?: { choices?: Array<{ id: string }> } } | undefined)?.options
    ?.choices;
  const choiceId = choices?.[index]?.id;
  if (!choiceId) {
    throw new Error(`Missing select choice id for: ${name}`);
  }
  return choiceId;
};

const seedAllFieldTypesTable = async (target: IBenchTarget): Promise<SeededTable> => {
  if (!baseId) throw new Error('BaseId is missing');

  const input = allFieldTypesTemplate.createInput(baseId, { includeRecords: true });
  const response = await target.client.tables.createTables(input);
  if (!response.ok) {
    throw new Error('Create tables failed');
  }

  const allTypesTableInput = getTemplateTableInput(input, 'All Field Types');
  const companiesTableInput = getTemplateTableInput(input, 'Companies');

  const allTypesTableId = (allTypesTableInput as { tableId?: unknown }).tableId;
  if (typeof allTypesTableId !== 'string' || allTypesTableId.length === 0) {
    throw new Error('Missing all-types tableId');
  }

  const companyRecordId = (companiesTableInput as { records?: Array<{ id?: string }> }).records?.[0]
    ?.id;

  const allTypesFields = allTypesTableInput.fields as ReadonlyArray<{ name: string }>;
  const fields: Record<string, unknown> = {
    [getFieldIdByName(allTypesFields, 'Name')]: 'bench@example.com',
    [getFieldIdByName(allTypesFields, 'Description')]: 'Benchmark record',
    [getFieldIdByName(allTypesFields, 'Amount')]: 42,
    [getFieldIdByName(allTypesFields, 'Priority')]: 3,
    [getFieldIdByName(allTypesFields, 'Done')]: true,
    [getFieldIdByName(allTypesFields, 'Due Date')]: '2025-02-20T00:00:00.000Z',
    [getFieldIdByName(allTypesFields, 'Status')]: getSelectChoiceIdByName(allTypesFields, 'Status'),
    [getFieldIdByName(allTypesFields, 'Tags')]: [
      getSelectChoiceIdByName(allTypesFields, 'Tags', 0),
      getSelectChoiceIdByName(allTypesFields, 'Tags', 2),
    ],
  };

  if (companyRecordId) {
    fields[getFieldIdByName(allTypesFields, 'Company')] = { id: companyRecordId };
  }

  return { tableId: allTypesTableId, fields };
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

  seededTables = {
    columns3: await seedTextTable(expressTarget, 'columns3', 3),
    columns10: await seedTextTable(expressTarget, 'columns10', 10),
    columns100: await seedTextTable(expressTarget, 'columns100', 100),
    allTypes: await seedAllFieldTypesTable(expressTarget),
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

const runCreateRecord = async (target: IBenchTarget, scenario: string) => {
  const seeded = seededTables[scenario];
  if (!seeded) {
    throw new Error(`Missing seeded table for scenario ${scenario}`);
  }

  const response = await target.client.tables.createRecord({
    tableId: seeded.tableId,
    fields: seeded.fields,
  });
  if (!response.ok) {
    throw new Error('Create record failed');
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

const benchCreateRecord = (
  framework: (typeof frameworks)[number],
  label: string,
  scenario: string
) => {
  bench(
    `${framework}: create record: ${label}`,
    async () => {
      await ensureSetup();
      await runCreateRecord(getTarget(framework), scenario);
    },
    benchOptions
  );
};

describe('CreateRecord benchmarks: 3 columns', () => {
  for (const framework of frameworks) {
    benchCreateRecord(framework, '3 columns', 'columns3');
  }
});

describe('CreateRecord benchmarks: 10 columns', () => {
  for (const framework of frameworks) {
    benchCreateRecord(framework, '10 columns', 'columns10');
  }
});

describe('CreateRecord benchmarks: 100 columns', () => {
  for (const framework of frameworks) {
    benchCreateRecord(framework, '100 columns', 'columns100');
  }
});

describe('CreateRecord benchmarks: all field types template', () => {
  for (const framework of frameworks) {
    benchCreateRecord(framework, 'all field types', 'allTypes');
  }
});
