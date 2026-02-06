/* eslint-disable @typescript-eslint/naming-convention */
import { allFieldTypesTemplate, createTextColumns } from '@teable/v2-table-templates';
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
  return `Bench_Bun_CreateRecord_${framework}_${scenario}_${Date.now()}_${random}`;
};

type SeededTable = {
  tableId: string;
  fields: Record<string, unknown>;
};

const buildTextValues = (fieldIds: ReadonlyArray<string>, valuePrefix: string) => {
  return Object.fromEntries(fieldIds.map((fieldId, index) => [fieldId, `${valuePrefix}${index}`]));
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

export const runCreateRecordBench = async (): Promise<void> => {
  const context = await createBunBenchTargets();

  try {
    if (context.targets.length === 0) {
      throw new Error('No benchmark targets available');
    }

    const seedTarget =
      context.targets.find((target) => target.name === 'bun-rpc') ?? context.targets[0];

    const seedTextTable = async (scenario: string, columnCount: number): Promise<SeededTable> => {
      const response = await seedTarget.client.tables.create({
        baseId: context.baseId,
        name: createTableName(seedTarget.name, scenario),
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

    const seedAllFieldTypesTable = async (): Promise<SeededTable> => {
      const input = allFieldTypesTemplate.createInput(context.baseId, { includeRecords: true });
      const response = await seedTarget.client.tables.createTables(input);
      if (!response.ok) {
        throw new Error('Create tables failed');
      }

      const allTypesTableInput = getTemplateTableInput(input, 'All Field Types');
      const companiesTableInput = getTemplateTableInput(input, 'Companies');

      const allTypesTableId = (allTypesTableInput as { tableId?: unknown }).tableId;
      if (typeof allTypesTableId !== 'string' || allTypesTableId.length === 0) {
        throw new Error('Missing all-types tableId');
      }

      const companyRecordId = (companiesTableInput as { records?: Array<{ id?: string }> })
        .records?.[0]?.id;

      const allTypesFields = allTypesTableInput.fields as ReadonlyArray<{ name: string }>;
      const fields: Record<string, unknown> = {
        [getFieldIdByName(allTypesFields, 'Name')]: 'bench@example.com',
        [getFieldIdByName(allTypesFields, 'Description')]: 'Benchmark record',
        [getFieldIdByName(allTypesFields, 'Amount')]: 42,
        [getFieldIdByName(allTypesFields, 'Priority')]: 3,
        [getFieldIdByName(allTypesFields, 'Done')]: true,
        [getFieldIdByName(allTypesFields, 'Due Date')]: '2025-02-20T00:00:00.000Z',
        [getFieldIdByName(allTypesFields, 'Status')]: getSelectChoiceIdByName(
          allTypesFields,
          'Status'
        ),
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

    console.log('[bun-bench] seeding tables for create-record');
    const seededTables: Record<string, SeededTable> = {
      columns3: await seedTextTable('columns3', 3),
      columns10: await seedTextTable('columns10', 10),
      columns100: await seedTextTable('columns100', 100),
      allTypes: await seedAllFieldTypesTable(),
    };
    console.log('[bun-bench] table seed complete');

    const runCreateRecord = async (target: IBunBenchTarget, scenario: string) => {
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

    const runScenario = async (label: string, scenario: string) => {
      const bench = new Bench(benchOptions);
      for (const target of context.targets) {
        bench.add(`${target.name}: create record: ${label}`, async () => {
          await runCreateRecord(target, scenario);
        });
      }

      console.log(`[bun-bench] running create record benchmarks: ${label}`);
      await bench.run();

      console.log(`CreateRecord benchmarks (bun): ${label}`);
      console.table(bench.table());
    };

    await runScenario('3 columns', 'columns3');
    await runScenario('10 columns', 'columns10');
    await runScenario('100 columns', 'columns100');
    await runScenario('all field types', 'allTypes');
  } finally {
    await context.dispose();
  }
};
