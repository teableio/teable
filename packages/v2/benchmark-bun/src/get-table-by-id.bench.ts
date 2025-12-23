import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import {
  createAllBaseFields,
  createSimpleFields,
  createTextColumns,
} from '@teable/v2-table-templates';
import { Bench } from 'tinybench';

import { createBunBenchContext } from './bench-context';

const benchOptions = {
  iterations: 0,
  warmupIterations: 0,
  time: 5000,
  warmupTime: 1000,
  throws: true,
};

const createTableName = (scenario: string): string => {
  const random = Math.random().toString(36).slice(2, 8);
  return `Bench_Bun_Get_${scenario}_${Date.now()}_${random}`;
};

export const runGetTableByIdBench = async (): Promise<void> => {
  const context = await createBunBenchContext();

  try {
    const tableIds: Record<string, string> = {};

    const createTable = async (scenario: string, fields: ICreateTableRequestDto['fields']) => {
      const input = {
        baseId: context.baseId,
        name: createTableName(scenario),
        fields,
      };

      const response = await context.client.tables.create(input);
      if (!response.ok) {
        throw new Error('Create table failed');
      }

      tableIds[scenario] = response.data.table.id;
    };

    console.log('[bun-bench] seeding tables for get-by-id');
    await createTable('simple', createSimpleFields());
    await createTable('base', createAllBaseFields());
    await createTable('columns200', createTextColumns(200));
    await createTable('columns1000', createTextColumns(1000));
    console.log('[bun-bench] table seed complete');

    const runGetTableById = async (scenario: string) => {
      const tableId = tableIds[scenario];
      if (!tableId) {
        throw new Error(`Missing table for scenario ${scenario}`);
      }

      const response = await context.client.tables.getById({
        baseId: context.baseId,
        tableId,
      });
      if (!response.ok) {
        throw new Error('Get table failed');
      }
    };

    const runScenario = async (label: string, scenario: string) => {
      const bench = new Bench(benchOptions);
      bench.add(`bun: get table by id: ${label}`, async () => {
        await runGetTableById(scenario);
      });

      console.log(`[bun-bench] running get table by id benchmarks: ${label}`);
      await bench.run();

      console.log(`GetTableById benchmarks (bun): ${label}`);
      console.table(bench.table());
    };

    await runScenario('3 columns', 'simple');
    await runScenario('all base fields', 'base');
    await runScenario('200 columns', 'columns200');
    await runScenario('1000 columns', 'columns1000');
  } finally {
    await context.dispose();
  }
};
