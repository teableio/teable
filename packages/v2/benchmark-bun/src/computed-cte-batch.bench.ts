/* eslint-disable @typescript-eslint/naming-convention */
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import { FieldId } from '@teable/v2-core';
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
  return `Bench_Bun_Cte_${framework}_${scenario}_${Date.now()}_${random}`;
};

const buildFormulaChainFields = (
  chainLength: number
): { fields: ICreateTableRequestDto['fields']; baseValueFieldId: string } => {
  const baseValueFieldId = FieldId.mustGenerate().toString();
  const fields: ICreateTableRequestDto['fields'] = [
    { type: 'number', id: baseValueFieldId, name: 'base_value' },
  ];

  let prevFieldId = baseValueFieldId;

  for (let i = 0; i < chainLength; i += 1) {
    const fieldId = FieldId.mustGenerate().toString();
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

const createFormulaChainTable = async (
  target: IBunBenchTarget,
  baseId: string,
  chainLength: number,
  scenario: string
): Promise<{ tableId: string; baseValueFieldId: string }> => {
  const { fields, baseValueFieldId } = buildFormulaChainFields(chainLength);

  const response = await target.client.tables.create({
    baseId,
    name: createTableName(target.name, scenario),
    fields,
  });
  if (!response.ok) {
    throw new Error('Create table failed');
  }

  return { tableId: response.data.table.id, baseValueFieldId };
};

const createRecords = async (
  target: IBunBenchTarget,
  tableId: string,
  baseValueFieldId: string,
  count: number
): Promise<string[]> => {
  const records = Array.from({ length: count }, (_, index) => ({
    fields: {
      [baseValueFieldId]: index + 1,
    },
  }));

  const response = await target.client.tables.createRecords({ tableId, records });
  if (!response.ok) {
    throw new Error('Create records failed');
  }

  return response.data.records.map((record) => record.id);
};

type SeededChain = {
  tableId: string;
  baseValueFieldId: string;
  recordIds: string[];
};

export const runComputedCteBatchBench = async (): Promise<void> => {
  const context = await createBunBenchTargets();

  try {
    if (context.targets.length === 0) {
      throw new Error('No benchmark targets available');
    }

    const seedTarget =
      context.targets.find((target) => target.name === 'bun-rpc') ?? context.targets[0];

    console.log('[bun-bench] seeding tables for computed cte batch');

    const chain5SingleTable = await createFormulaChainTable(
      seedTarget,
      context.baseId,
      5,
      'chain5_single'
    );
    const chain10SingleTable = await createFormulaChainTable(
      seedTarget,
      context.baseId,
      10,
      'chain10_single'
    );
    const chain5HundredTable = await createFormulaChainTable(
      seedTarget,
      context.baseId,
      5,
      'chain5_100'
    );
    const chain10HundredTable = await createFormulaChainTable(
      seedTarget,
      context.baseId,
      10,
      'chain10_100'
    );

    const seeded: Record<string, SeededChain> = {
      chain5Single: {
        ...chain5SingleTable,
        recordIds: await createRecords(
          seedTarget,
          chain5SingleTable.tableId,
          chain5SingleTable.baseValueFieldId,
          1
        ),
      },
      chain10Single: {
        ...chain10SingleTable,
        recordIds: await createRecords(
          seedTarget,
          chain10SingleTable.tableId,
          chain10SingleTable.baseValueFieldId,
          1
        ),
      },
      chain5Hundred: {
        ...chain5HundredTable,
        recordIds: await createRecords(
          seedTarget,
          chain5HundredTable.tableId,
          chain5HundredTable.baseValueFieldId,
          100
        ),
      },
      chain10Hundred: {
        ...chain10HundredTable,
        recordIds: await createRecords(
          seedTarget,
          chain10HundredTable.tableId,
          chain10HundredTable.baseValueFieldId,
          100
        ),
      },
    };

    console.log('[bun-bench] table seed complete');

    const runScenario = async (
      label: string,
      chainKey: keyof typeof seeded,
      recordSelector: (recordIds: string[], counter: number) => string
    ) => {
      const bench = new Bench(benchOptions);
      for (const target of context.targets) {
        let counter = 0;
        bench.add(`${target.name}: computed cte: ${label}`, async () => {
          const chain = seeded[chainKey];
          counter += 1;
          const recordId = recordSelector(chain.recordIds, counter);
          const response = await target.client.tables.updateRecord({
            tableId: chain.tableId,
            recordId,
            fields: {
              [chain.baseValueFieldId]: counter,
            },
          });
          if (!response.ok) {
            throw new Error('Update record failed');
          }
        });
      }

      console.log(`[bun-bench] running computed cte batch benchmarks: ${label}`);
      await bench.run();

      console.log(`ComputedCteBatch benchmarks (bun): ${label}`);
      console.table(bench.table());
    };

    const pickSingle = (recordIds: string[]) => recordIds[0]!;
    const pickRoundRobin = (recordIds: string[], counter: number) =>
      recordIds[counter % recordIds.length]!;

    await runScenario('single record: 5-level chain', 'chain5Single', pickSingle);
    await runScenario('single record: 10-level chain', 'chain10Single', pickSingle);
    await runScenario('100 records: 5-level chain', 'chain5Hundred', pickRoundRobin);
    await runScenario('100 records: 10-level chain', 'chain10Hundred', pickRoundRobin);
  } finally {
    await context.dispose();
  }
};
