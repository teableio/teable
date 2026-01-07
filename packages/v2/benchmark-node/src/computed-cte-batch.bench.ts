/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Benchmark: CTE Batch Execution for same-table formula chains
 *
 * This benchmark measures the performance of formula chains:
 * - 5-level chain: base_value → level_0 → level_1 → level_2 → level_3 → level_4
 * - 10-level chain: longer dependency chain
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

const CONTEXT_NOT_INITIALIZED_ERROR = 'Context not initialized';

const generateFieldId = () => `fld${Math.random().toString(36).substring(2, 17).padEnd(15, '0')}`;

const buildFormulaChainFields = (
  chainLength: number
): { fields: ICreateTableRequestDto['fields']; baseValueFieldId: string } => {
  const baseValueFieldId = generateFieldId();
  const fields: ICreateTableRequestDto['fields'] = [
    { type: 'number', id: baseValueFieldId, name: 'base_value' },
  ];

  let prevFieldId = baseValueFieldId;

  for (let i = 0; i < chainLength; i++) {
    const fieldId = generateFieldId();
    const operation = i % 2 === 0 ? '+' : '*';
    const operand = (i % 5) + 1;

    fields.push({
      type: 'formula',
      id: fieldId,
      name: `level_${i}`,
      options: {
        expression: `{${prevFieldId}} ${operation} ${operand}`,
      },
    });

    prevFieldId = fieldId;
  }

  return { fields, baseValueFieldId };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BenchClient = any;

type BenchContext = {
  testContainer: IV2NodeTestContainer;
  client: BenchClient;
  server: Server;
  baseId: string;
};

let ctx: BenchContext | null = null;

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

const createFormulaChainTable = async (
  context: BenchContext,
  chainLength: number
): Promise<{ tableId: string; baseValueFieldId: string }> => {
  const { fields, baseValueFieldId } = buildFormulaChainFields(chainLength);

  const result = await context.client.tables.create({
    baseId: context.baseId,
    name: `FormulaChain_${chainLength}_${Date.now()}`,
    fields,
  });

  return { tableId: result.id, baseValueFieldId };
};

const createRecords = async (
  context: BenchContext,
  tableId: string,
  baseValueFieldId: string,
  count: number
): Promise<string[]> => {
  const recordIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const result = await context.client.tables.createRecord({
      tableId,
      record: {
        fields: {
          [baseValueFieldId]: i + 1,
        },
      },
    });

    recordIds.push(result.id);
  }

  return recordIds;
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

describe('Formula chain (5 levels) - single record', async () => {
  let tableId: string;
  let recordId: string;
  let baseValueFieldId: string;
  let counter = 0;

  beforeAll(async () => {
    if (!ctx) throw new Error(CONTEXT_NOT_INITIALIZED_ERROR);

    const table = await createFormulaChainTable(ctx, 5);
    tableId = table.tableId;
    baseValueFieldId = table.baseValueFieldId;

    const records = await createRecords(ctx, tableId, baseValueFieldId, 1);
    recordId = records[0];
  });

  bench('update triggers 5-level formula chain', async () => {
    if (!ctx) throw new Error(CONTEXT_NOT_INITIALIZED_ERROR);
    counter++;
    await ctx.client.tables.updateRecord({
      tableId,
      recordId,
      record: {
        fields: {
          [baseValueFieldId]: counter,
        },
      },
    });
  });
});

describe('Formula chain (10 levels) - single record', async () => {
  let tableId: string;
  let recordId: string;
  let baseValueFieldId: string;
  let counter = 0;

  beforeAll(async () => {
    if (!ctx) throw new Error(CONTEXT_NOT_INITIALIZED_ERROR);

    const table = await createFormulaChainTable(ctx, 10);
    tableId = table.tableId;
    baseValueFieldId = table.baseValueFieldId;

    const records = await createRecords(ctx, tableId, baseValueFieldId, 1);
    recordId = records[0];
  });

  bench('update triggers 10-level formula chain', async () => {
    if (!ctx) throw new Error(CONTEXT_NOT_INITIALIZED_ERROR);
    counter++;
    await ctx.client.tables.updateRecord({
      tableId,
      recordId,
      record: {
        fields: {
          [baseValueFieldId]: counter,
        },
      },
    });
  });
});

describe('Formula chain (5 levels) - 100 records', async () => {
  let tableId: string;
  let recordIds: string[];
  let baseValueFieldId: string;
  let counter = 0;

  beforeAll(async () => {
    if (!ctx) throw new Error(CONTEXT_NOT_INITIALIZED_ERROR);

    const table = await createFormulaChainTable(ctx, 5);
    tableId = table.tableId;
    baseValueFieldId = table.baseValueFieldId;

    recordIds = await createRecords(ctx, tableId, baseValueFieldId, 100);
  });

  bench('update single record triggers 5-level formula chain (100 records in table)', async () => {
    if (!ctx) throw new Error(CONTEXT_NOT_INITIALIZED_ERROR);
    counter++;
    const recordId = recordIds[counter % recordIds.length];
    await ctx.client.tables.updateRecord({
      tableId,
      recordId,
      record: {
        fields: {
          [baseValueFieldId]: counter,
        },
      },
    });
  });
});

describe('Formula chain (10 levels) - 100 records', async () => {
  let tableId: string;
  let recordIds: string[];
  let baseValueFieldId: string;
  let counter = 0;

  beforeAll(async () => {
    if (!ctx) throw new Error(CONTEXT_NOT_INITIALIZED_ERROR);

    const table = await createFormulaChainTable(ctx, 10);
    tableId = table.tableId;
    baseValueFieldId = table.baseValueFieldId;

    recordIds = await createRecords(ctx, tableId, baseValueFieldId, 100);
  });

  bench('update single record triggers 10-level formula chain (100 records in table)', async () => {
    if (!ctx) throw new Error(CONTEXT_NOT_INITIALIZED_ERROR);
    counter++;
    const recordId = recordIds[counter % recordIds.length];
    await ctx.client.tables.updateRecord({
      tableId,
      recordId,
      record: {
        fields: {
          [baseValueFieldId]: counter,
        },
      },
    });
  });
});
