import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
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
  return `Bench_Bun_${scenario}_${Date.now()}_${random}`;
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

export const runCreateTableBench = async (): Promise<void> => {
  const context = await createBunBenchContext();

  try {
    const bench = new Bench(benchOptions);
    const simpleFields = createSimpleFields();
    const baseFields = createAllBaseFields();
    const fields200 = createTextColumns(200);
    const fields1000 = createTextColumns(1000);

    const runCreateTable = async (scenario: string, fields: ICreateTableRequestDto['fields']) => {
      const input = {
        baseId: context.baseId,
        name: createTableName(scenario),
        fields,
      };

      const response = await context.client.tables.create(input);
      if (!response.ok) {
        throw new Error('Create table failed');
      }
    };

    bench.add('bun: create table: 3 columns', async () => {
      await runCreateTable('simple', simpleFields);
    });

    bench.add('bun: create table: all base fields', async () => {
      await runCreateTable('base', baseFields);
    });

    bench.add('bun: create table: 200 columns', async () => {
      await runCreateTable('200', fields200);
    });

    bench.add('bun: create table: 1000 columns', async () => {
      await runCreateTable('1000', fields1000);
    });

    console.log('[bun-bench] running create table benchmarks');
    await bench.run();

    console.log('CreateTable benchmarks (bun)');
    console.table(bench.table());
  } finally {
    await context.dispose();
  }
};
