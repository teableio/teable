/* eslint-disable @typescript-eslint/naming-convention */
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import {
  createAllBaseFields,
  createSimpleFields,
  createTextColumns,
} from '@teable/v2-table-templates';
import { Bench } from 'tinybench';

import type { IBunBenchTarget } from './bench-context';
import { createBunBenchTargets } from './bench-context';

const benchOptions = {
  iterations: 0,
  warmupIterations: 0,
  time: 5000,
  warmupTime: 1000,
  throws: true,
};

const createTableName = (framework: string, scenario: string): string => {
  const random = Math.random().toString(36).slice(2, 8);
  return `Bench_Bun_${framework}_${scenario}_${Date.now()}_${random}`;
};

export const runCreateTableBench = async (): Promise<void> => {
  const context = await createBunBenchTargets();

  try {
    type FieldFactory = () => ICreateTableRequestDto['fields'];
    const simpleFieldsFactory: FieldFactory = () => createSimpleFields();
    const baseFieldsFactory: FieldFactory = () => createAllBaseFields();
    const fields200Factory: FieldFactory = () => createTextColumns(200);
    const fields1000Factory: FieldFactory = () => createTextColumns(1000);

    const runCreateTable = async (
      target: IBunBenchTarget,
      scenario: string,
      fieldsFactory: FieldFactory
    ) => {
      const input = {
        baseId: context.baseId,
        name: createTableName(target.name, scenario),
        fields: fieldsFactory(),
      };

      const response = await target.client.tables.create(input);
      if (!response.ok) {
        throw new Error('Create table failed');
      }
    };

    const runScenario = async (label: string, scenario: string, fieldsFactory: FieldFactory) => {
      const bench = new Bench(benchOptions);
      for (const target of context.targets) {
        bench.add(`${target.name}: create table: ${label}`, async () => {
          await runCreateTable(target, scenario, fieldsFactory);
        });
      }

      console.log(`[bun-bench] running create table benchmarks: ${label}`);
      await bench.run();

      console.log(`CreateTable benchmarks (bun): ${label}`);
      console.table(bench.table());
    };

    await runScenario('3 columns', 'simple', simpleFieldsFactory);
    await runScenario('all base fields', 'base', baseFieldsFactory);
    await runScenario('200 columns', '200', fields200Factory);
    await runScenario('1000 columns', '1000', fields1000Factory);
  } finally {
    await context.dispose();
  }
};
