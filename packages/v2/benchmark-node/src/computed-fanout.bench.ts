/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Benchmark: Fan-out scenarios for computed field updates
 *
 * Tests scenarios where a single record change in TableA triggers
 * updates in N linked records in TableB.
 *
 * Scenarios:
 * 1. Link title fan-out: Update A.Name → N B.LinkToA titles update
 * 2. Lookup fan-out: Update A.Score → N B.LookupScore values update
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { NoopLogger, v2CoreTokens } from '@teable/v2-core';
import express from 'express';
import { afterAll, beforeAll, bench, describe } from 'vitest';

const generateFieldId = () => `fld${Math.random().toString(36).substring(2, 17).padEnd(15, '0')}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BenchClient = any;

type BenchContext = {
  testContainer: IV2NodeTestContainer;
  client: BenchClient;
  server: Server;
  baseId: string;
};

type FanOutSetup = {
  tableAId: string;
  tableBId: string;
  nameFieldId: string;
  scoreFieldId: string;
  linkToAFieldId: string;
  lookupScoreFieldId: string;
  recordAId: string;
  recordBIds: string[];
};

let ctx: BenchContext | null = null;
const CTX_ERROR = 'Context not initialized';

const setup = async (): Promise<BenchContext> => {
  const testContainer = await createV2NodeTestContainer();
  testContainer.container.registerInstance(v2CoreTokens.logger, new NoopLogger());

  const app = express();
  app.use(
    createV2ExpressRouter({
      createContainer: () => testContainer.container,
    })
  );

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = createV2HttpClient({ baseUrl });

  return {
    testContainer,
    client,
    server,
    baseId: testContainer.baseId.toString(),
  };
};

const createFanOutTables = async (
  context: BenchContext
): Promise<Omit<FanOutSetup, 'recordAId' | 'recordBIds'>> => {
  const nameFieldId = generateFieldId();
  const scoreFieldId = generateFieldId();

  // Create TableA with Name (primary) and Score fields
  const tableAFields: ICreateTableRequestDto['fields'] = [
    { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
    { type: 'number', id: scoreFieldId, name: 'Score' },
  ];

  const tableAResult = await context.client.tables.create({
    baseId: context.baseId,
    name: `TableA_${Date.now()}`,
    fields: tableAFields,
  });

  const tableAId = tableAResult.id;
  const linkToAFieldId = generateFieldId();
  const lookupScoreFieldId = generateFieldId();

  // Create TableB with link to A and lookup of A.Score
  const tableBFields: ICreateTableRequestDto['fields'] = [
    { type: 'singleLineText', name: 'Name', isPrimary: true },
    {
      type: 'link',
      id: linkToAFieldId,
      name: 'LinkToA',
      options: {
        relationship: 'manyOne',
        foreignTableId: tableAId,
        lookupFieldId: nameFieldId, // Link title uses A.Name
      },
    },
    {
      type: 'lookup',
      id: lookupScoreFieldId,
      name: 'LookupScore',
      options: {
        linkFieldId: linkToAFieldId,
        foreignTableId: tableAId,
        lookupFieldId: scoreFieldId, // Lookup A.Score
      },
    },
  ];

  const tableBResult = await context.client.tables.create({
    baseId: context.baseId,
    name: `TableB_${Date.now()}`,
    fields: tableBFields,
  });

  return {
    tableAId,
    tableBId: tableBResult.id,
    nameFieldId,
    scoreFieldId,
    linkToAFieldId,
    lookupScoreFieldId,
  };
};

const createFanOutRecords = async (
  context: BenchContext,
  tables: Omit<FanOutSetup, 'recordAId' | 'recordBIds'>,
  fanOutCount: number
): Promise<{ recordAId: string; recordBIds: string[] }> => {
  // Create a single record in TableA
  const recordAResult = await context.client.tables.createRecord({
    tableId: tables.tableAId,
    record: {
      fields: {
        [tables.nameFieldId]: 'Source Record',
        [tables.scoreFieldId]: 100,
      },
    },
  });

  const recordAId = recordAResult.id;
  const recordBIds: string[] = [];

  // Create N records in TableB, all linked to the same TableA record
  for (let i = 0; i < fanOutCount; i++) {
    const recordBResult = await context.client.tables.createRecord({
      tableId: tables.tableBId,
      record: {
        fields: {
          Name: `Record B ${i}`,
          [tables.linkToAFieldId]: [{ id: recordAId }],
        },
      },
    });

    recordBIds.push(recordBResult.id);
  }

  return { recordAId, recordBIds };
};

beforeAll(async () => {
  ctx = await setup();
});

afterAll(async () => {
  if (ctx) {
    await new Promise<void>((resolve) => ctx!.server.close(() => resolve()));
    await ctx.testContainer.dispose();
  }
});

// Link title updates (A.Name changes)
describe('Fan-out: link title updates (A.Name → N B.LinkToA)', async () => {
  let setup10: FanOutSetup;
  let setup100: FanOutSetup;
  let setup500: FanOutSetup;
  let counter = 0;

  beforeAll(async () => {
    if (!ctx) throw new Error(CTX_ERROR);

    const tables10 = await createFanOutTables(ctx);
    const records10 = await createFanOutRecords(ctx, tables10, 10);
    setup10 = { ...tables10, ...records10 };

    const tables100 = await createFanOutTables(ctx);
    const records100 = await createFanOutRecords(ctx, tables100, 100);
    setup100 = { ...tables100, ...records100 };

    const tables500 = await createFanOutTables(ctx);
    const records500 = await createFanOutRecords(ctx, tables500, 500);
    setup500 = { ...tables500, ...records500 };
  });

  bench('link title fan-out (1 → 10)', async () => {
    if (!ctx) throw new Error(CTX_ERROR);
    counter++;
    await ctx.client.tables.updateRecord({
      tableId: setup10.tableAId,
      recordId: setup10.recordAId,
      record: {
        fields: {
          [setup10.nameFieldId]: `Name ${counter}`,
        },
      },
    });
  });

  bench('link title fan-out (1 → 100)', async () => {
    if (!ctx) throw new Error(CTX_ERROR);
    counter++;
    await ctx.client.tables.updateRecord({
      tableId: setup100.tableAId,
      recordId: setup100.recordAId,
      record: {
        fields: {
          [setup100.nameFieldId]: `Name ${counter}`,
        },
      },
    });
  });

  bench('link title fan-out (1 → 500)', async () => {
    if (!ctx) throw new Error(CTX_ERROR);
    counter++;
    await ctx.client.tables.updateRecord({
      tableId: setup500.tableAId,
      recordId: setup500.recordAId,
      record: {
        fields: {
          [setup500.nameFieldId]: `Name ${counter}`,
        },
      },
    });
  });
});

// Lookup updates (A.Score changes)
describe('Fan-out: lookup updates (A.Score → N B.LookupScore)', async () => {
  let setup10: FanOutSetup;
  let setup100: FanOutSetup;
  let setup500: FanOutSetup;
  let counter = 0;

  beforeAll(async () => {
    if (!ctx) throw new Error(CTX_ERROR);

    const tables10 = await createFanOutTables(ctx);
    const records10 = await createFanOutRecords(ctx, tables10, 10);
    setup10 = { ...tables10, ...records10 };

    const tables100 = await createFanOutTables(ctx);
    const records100 = await createFanOutRecords(ctx, tables100, 100);
    setup100 = { ...tables100, ...records100 };

    const tables500 = await createFanOutTables(ctx);
    const records500 = await createFanOutRecords(ctx, tables500, 500);
    setup500 = { ...tables500, ...records500 };
  });

  bench('lookup fan-out (1 → 10)', async () => {
    if (!ctx) throw new Error(CTX_ERROR);
    counter++;
    await ctx.client.tables.updateRecord({
      tableId: setup10.tableAId,
      recordId: setup10.recordAId,
      record: {
        fields: {
          [setup10.scoreFieldId]: counter * 10,
        },
      },
    });
  });

  bench('lookup fan-out (1 → 100)', async () => {
    if (!ctx) throw new Error(CTX_ERROR);
    counter++;
    await ctx.client.tables.updateRecord({
      tableId: setup100.tableAId,
      recordId: setup100.recordAId,
      record: {
        fields: {
          [setup100.scoreFieldId]: counter * 10,
        },
      },
    });
  });

  bench('lookup fan-out (1 → 500)', async () => {
    if (!ctx) throw new Error(CTX_ERROR);
    counter++;
    await ctx.client.tables.updateRecord({
      tableId: setup500.tableAId,
      recordId: setup500.recordAId,
      record: {
        fields: {
          [setup500.scoreFieldId]: counter * 10,
        },
      },
    });
  });
});

// Large scale test (1000 records)
describe('Fan-out: large scale (1 → 1000)', async () => {
  let setupLink: FanOutSetup;
  let setupLookup: FanOutSetup;
  let counter = 0;

  beforeAll(async () => {
    if (!ctx) throw new Error(CTX_ERROR);

    const tablesLink = await createFanOutTables(ctx);
    const recordsLink = await createFanOutRecords(ctx, tablesLink, 1000);
    setupLink = { ...tablesLink, ...recordsLink };

    const tablesLookup = await createFanOutTables(ctx);
    const recordsLookup = await createFanOutRecords(ctx, tablesLookup, 1000);
    setupLookup = { ...tablesLookup, ...recordsLookup };
  });

  bench('link title fan-out (1 → 1000)', async () => {
    if (!ctx) throw new Error(CTX_ERROR);
    counter++;
    await ctx.client.tables.updateRecord({
      tableId: setupLink.tableAId,
      recordId: setupLink.recordAId,
      record: {
        fields: {
          [setupLink.nameFieldId]: `Name ${counter}`,
        },
      },
    });
  });

  bench('lookup fan-out (1 → 1000)', async () => {
    if (!ctx) throw new Error(CTX_ERROR);
    counter++;
    await ctx.client.tables.updateRecord({
      tableId: setupLookup.tableAId,
      recordId: setupLookup.recordAId,
      record: {
        fields: {
          [setupLookup.scoreFieldId]: counter * 10,
        },
      },
    });
  });
});
