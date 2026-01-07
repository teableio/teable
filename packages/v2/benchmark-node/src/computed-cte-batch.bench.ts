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
import { FieldId, NoopLogger, v2CoreTokens } from '@teable/v2-core';
import express from 'express';
import { afterAll, beforeAll, bench, describe } from 'vitest';

const benchOptions = {
  iterations: 0,
  warmupIterations: 0,
  time: 5000,
  warmupTime: 1000,
  throws: true,
};

const generateFieldId = () => FieldId.mustGenerate().toString();

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

type BenchClient = ReturnType<typeof createV2HttpClient>;

type BenchContext = {
  testContainer: IV2NodeTestContainer;
  client: BenchClient;
  server: Server;
  baseId: string;
  baseUrl: string;
};

let ctx: BenchContext | null = null;
let setupPromise: Promise<BenchContext> | undefined;

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
    baseUrl,
  };
};

const ensureContext = async (): Promise<BenchContext> => {
  if (!setupPromise) {
    setupPromise = setup();
  }
  ctx = await setupPromise;
  return ctx;
};

const updateRecord = async (
  context: BenchContext,
  input: { tableId: string; recordId: string; fields: Record<string, unknown> }
) => {
  const body = JSON.stringify(input);
  const response = await fetch(`${context.baseUrl}/tables/updateRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Update record failed: ${errorText}`);
  }
  await response.json();
};

const createFormulaChainTable = async (
  context: BenchContext,
  chainLength: number
): Promise<{ tableId: string; baseValueFieldId: string }> => {
  const { fields, baseValueFieldId } = buildFormulaChainFields(chainLength);

  const response = await context.client.tables.create({
    baseId: context.baseId,
    name: `FormulaChain_${chainLength}_${Date.now()}`,
    fields,
  });
  if (!response.ok) {
    throw new Error('Create table failed');
  }

  return { tableId: response.data.table.id, baseValueFieldId };
};

const createRecords = async (
  context: BenchContext,
  tableId: string,
  baseValueFieldId: string,
  count: number
): Promise<string[]> => {
  const records = Array.from({ length: count }, (_, index) => ({
    fields: {
      [baseValueFieldId]: index + 1,
    },
  }));

  const response = await context.client.tables.createRecords({ tableId, records });
  if (!response.ok) {
    throw new Error('Create records failed');
  }

  return response.data.records.map((record) => record.id);
};

beforeAll(async () => {
  await ensureContext();
});

afterAll(async () => {
  if (ctx) {
    await new Promise<void>((resolve) => ctx!.server.close(() => resolve()));
    await ctx.testContainer.dispose();
  }
});

type SingleRecordSetup = {
  table5Id: string;
  record5Id: string;
  baseValue5FieldId: string;
  table10Id: string;
  record10Id: string;
  baseValue10FieldId: string;
};

let singleRecordSetupPromise: Promise<SingleRecordSetup> | undefined;
let singleCounter5 = 0;
let singleCounter10 = 0;

const ensureSingleRecordSetup = async (): Promise<SingleRecordSetup> => {
  if (!singleRecordSetupPromise) {
    singleRecordSetupPromise = (async () => {
      const context = await ensureContext();

      const table5 = await createFormulaChainTable(context, 5);
      const records5 = await createRecords(context, table5.tableId, table5.baseValueFieldId, 1);

      const table10 = await createFormulaChainTable(context, 10);
      const records10 = await createRecords(context, table10.tableId, table10.baseValueFieldId, 1);

      return {
        table5Id: table5.tableId,
        record5Id: records5[0]!,
        baseValue5FieldId: table5.baseValueFieldId,
        table10Id: table10.tableId,
        record10Id: records10[0]!,
        baseValue10FieldId: table10.baseValueFieldId,
      };
    })();
  }
  return singleRecordSetupPromise;
};

describe('Formula chain - single record', () => {
  bench(
    'update triggers 5-level formula chain',
    async () => {
      const context = await ensureContext();
      const setup = await ensureSingleRecordSetup();

      singleCounter5 += 1;
      await updateRecord(context, {
        tableId: setup.table5Id,
        recordId: setup.record5Id,
        fields: {
          [setup.baseValue5FieldId]: singleCounter5,
        },
      });
    },
    benchOptions
  );

  bench(
    'update triggers 10-level formula chain',
    async () => {
      const context = await ensureContext();
      const setup = await ensureSingleRecordSetup();

      singleCounter10 += 1;
      await updateRecord(context, {
        tableId: setup.table10Id,
        recordId: setup.record10Id,
        fields: {
          [setup.baseValue10FieldId]: singleCounter10,
        },
      });
    },
    benchOptions
  );
});

type HundredRecordsSetup = {
  table5Id: string;
  record5Ids: string[];
  baseValue5FieldId: string;
  table10Id: string;
  record10Ids: string[];
  baseValue10FieldId: string;
};

let hundredRecordsSetupPromise: Promise<HundredRecordsSetup> | undefined;
let hundredCounter5 = 0;
let hundredCounter10 = 0;

const ensureHundredRecordsSetup = async (): Promise<HundredRecordsSetup> => {
  if (!hundredRecordsSetupPromise) {
    hundredRecordsSetupPromise = (async () => {
      const context = await ensureContext();

      const table5 = await createFormulaChainTable(context, 5);
      const record5Ids = await createRecords(context, table5.tableId, table5.baseValueFieldId, 100);

      const table10 = await createFormulaChainTable(context, 10);
      const record10Ids = await createRecords(
        context,
        table10.tableId,
        table10.baseValueFieldId,
        100
      );

      return {
        table5Id: table5.tableId,
        record5Ids,
        baseValue5FieldId: table5.baseValueFieldId,
        table10Id: table10.tableId,
        record10Ids,
        baseValue10FieldId: table10.baseValueFieldId,
      };
    })();
  }
  return hundredRecordsSetupPromise;
};

describe('Formula chain - 100 records', () => {
  bench(
    'update single record triggers 5-level formula chain (100 records in table)',
    async () => {
      const context = await ensureContext();
      const setup = await ensureHundredRecordsSetup();

      hundredCounter5 += 1;
      const recordId = setup.record5Ids[hundredCounter5 % setup.record5Ids.length]!;
      await updateRecord(context, {
        tableId: setup.table5Id,
        recordId,
        fields: {
          [setup.baseValue5FieldId]: hundredCounter5,
        },
      });
    },
    benchOptions
  );

  bench(
    'update single record triggers 10-level formula chain (100 records in table)',
    async () => {
      const context = await ensureContext();
      const setup = await ensureHundredRecordsSetup();

      hundredCounter10 += 1;
      const recordId = setup.record10Ids[hundredCounter10 % setup.record10Ids.length]!;
      await updateRecord(context, {
        tableId: setup.table10Id,
        recordId,
        fields: {
          [setup.baseValue10FieldId]: hundredCounter10,
        },
      });
    },
    benchOptions
  );
});
