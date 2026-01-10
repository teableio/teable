/* eslint-disable @typescript-eslint/naming-convention */
import { registerV2PostgresBunSqlDb } from '@teable/v2-adapter-db-postgres-bun-sql';
import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-pg';
import { registerV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { registerV2PostgresJsDb } from '@teable/v2-adapter-db-postgres-postgresjs';
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import type { DependencyContainer } from '@teable/v2-di';
import { createSimpleFields, createTextColumns } from '@teable/v2-table-templates';
import { Bench } from 'tinybench';

import type { IBunBenchContext } from './bench-context';
import { createBunBenchContext } from './bench-context';

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

type IDbAdapter = {
  name: string;
  registerDb: (
    container: DependencyContainer,
    config: IV2PostgresDbConfig
  ) => Promise<DependencyContainer | void>;
};

type IBenchTarget = {
  name: string;
  baseId: string;
  client: IBunBenchContext['client'];
  tableIds: Record<string, string>;
  dispose: () => Promise<void>;
};

const adapters: IDbAdapter[] = [
  { name: 'pg', registerDb: registerV2PostgresDb },
  { name: 'postgresjs', registerDb: registerV2PostgresJsDb },
  { name: 'bun-sql', registerDb: registerV2PostgresBunSqlDb },
];

const simpleScenario = 'simple';
const columns200Scenario = 'columns200';

export const runDbAdapterBench = async (): Promise<void> => {
  const targets: IBenchTarget[] = [];

  for (const adapter of adapters) {
    const context = await createBunBenchContext({
      registerDb: adapter.registerDb,
    });
    const tableIds: Record<string, string> = {};

    const createSeedTable = async (scenario: string, fields: ICreateTableRequestDto['fields']) => {
      const response = await context.client.tables.create({
        baseId: context.baseId,
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

    targets.push({
      name: adapter.name,
      baseId: context.baseId,
      client: context.client,
      tableIds,
      dispose: context.dispose,
    });
  }

  type FieldFactory = () => ICreateTableRequestDto['fields'];
  const simpleFieldsFactory: FieldFactory = () => createSimpleFields();
  const fields200Factory: FieldFactory = () => createTextColumns(200);

  const getTarget = (name: string): IBenchTarget => {
    const target = targets.find((item) => item.name === name);
    if (!target) {
      throw new Error(`${name} target is not initialized`);
    }
    return target;
  };

  const runCreateTable = async (
    target: IBenchTarget,
    scenario: string,
    fieldsFactory: FieldFactory
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

  const runBenchGroup = async (title: string, build: (bench: Bench) => void) => {
    const bench = new Bench(benchOptions);
    build(bench);

    console.log(`[bun-bench] running ${title}`);
    await bench.run();

    console.log(`DbAdapter benchmarks (bun): ${title}`);
    console.table(bench.table());
  };

  try {
    await runBenchGroup('create table (3 columns)', (bench) => {
      for (const adapter of adapters) {
        const name = adapter.name;
        bench.add(`bun + ${name}: create table (3 columns)`, async () => {
          await runCreateTable(getTarget(name), simpleScenario, simpleFieldsFactory);
        });
      }
    });

    await runBenchGroup('create table (200 columns)', (bench) => {
      for (const adapter of adapters) {
        const name = adapter.name;
        bench.add(`bun + ${name}: create table (200 columns)`, async () => {
          await runCreateTable(getTarget(name), columns200Scenario, fields200Factory);
        });
      }
    });

    await runBenchGroup('get table by id (3 columns)', (bench) => {
      for (const adapter of adapters) {
        const name = adapter.name;
        bench.add(`bun + ${name}: get table by id (3 columns)`, async () => {
          await runGetTableById(getTarget(name), simpleScenario);
        });
      }
    });

    await runBenchGroup('get table by id (200 columns)', (bench) => {
      for (const adapter of adapters) {
        const name = adapter.name;
        bench.add(`bun + ${name}: get table by id (200 columns)`, async () => {
          await runGetTableById(getTarget(name), columns200Scenario);
        });
      }
    });
  } finally {
    for (const target of targets) {
      await target.dispose();
    }
  }
};
