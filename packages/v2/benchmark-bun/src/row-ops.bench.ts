/* eslint-disable @typescript-eslint/naming-convention */
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import { createSimpleFields, createTextColumns } from '@teable/v2-table-templates';
import { Bench } from 'tinybench';

import type { IBunBenchTarget, IBunBenchTargetsContext } from './bench-context';
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
  return `Bench_Bun_RowOps_${framework}_${scenario}_${Date.now()}_${random}`;
};

type CellRange = [[number, number], [number, number]];

type IFieldProfile = {
  id: string;
  label: string;
  createFields: () => ICreateTableRequestDto['fields'];
  createSeedFields: (fieldIds: ReadonlyArray<string>, index: number) => Record<string, unknown>;
  createPastePayload: (
    row: number,
    iteration: number
  ) => {
    ranges: CellRange;
    content: unknown[][];
  };
  createClearSeedPayload: (
    row: number,
    iteration: number
  ) => {
    ranges: CellRange;
    content: unknown[][];
  };
  createClearPayload: (row: number) => { ranges: CellRange };
};

type IOperationState = {
  tableId: string;
  viewId: string;
  fieldIds: string[];
  rowCount: number;
  nextSeedIndex: number;
  cursor: number;
};

type IScenarioState = {
  key: string;
  tableCount: number;
  profile: IFieldProfile;
  deleteState: IOperationState;
  pasteState: IOperationState;
  clearState: IOperationState;
};

type ApiOkResponse<T> = {
  ok: true;
  data: T;
};

type ApiErrorResponse = {
  ok: false;
};

type ApiResponse<T> = ApiOkResponse<T> | ApiErrorResponse;

const tableCountScenarios = [3, 10, 30] as const;

const simpleProfile: IFieldProfile = {
  id: 'simple3',
  label: '3 columns (text/number/checkbox)',
  createFields: () => createSimpleFields(),
  createSeedFields: (fieldIds, index) => ({
    [fieldIds[0]!]: `simple_${index}`,
    [fieldIds[1]!]: index,
    [fieldIds[2]!]: index % 2 === 0,
  }),
  createPastePayload: (row, iteration) => ({
    ranges: [
      [0, row],
      [2, row + 1],
    ],
    content: [
      [`paste_${iteration}_a`, iteration, iteration % 2 === 0],
      [`paste_${iteration}_b`, iteration + 1, iteration % 2 !== 0],
    ],
  }),
  createClearSeedPayload: (row, iteration) => ({
    ranges: [
      [0, row],
      [2, row],
    ],
    content: [[`clear_${iteration}`, iteration * 10, true]],
  }),
  createClearPayload: (row) => ({
    ranges: [
      [0, row],
      [2, row],
    ],
  }),
};

const text50Profile: IFieldProfile = {
  id: 'text50',
  label: '50 text columns',
  createFields: () => createTextColumns(50),
  createSeedFields: (fieldIds, index) => ({
    [fieldIds[0]!]: `t0_${index}`,
    [fieldIds[1]!]: `t1_${index}`,
    [fieldIds[2]!]: `t2_${index}`,
    [fieldIds[3]!]: `t3_${index}`,
    [fieldIds[4]!]: `t4_${index}`,
  }),
  createPastePayload: (row, iteration) => ({
    ranges: [
      [0, row],
      [4, row + 1],
    ],
    content: [
      [
        `paste_${iteration}_0a`,
        `paste_${iteration}_1a`,
        `paste_${iteration}_2a`,
        `paste_${iteration}_3a`,
        `paste_${iteration}_4a`,
      ],
      [
        `paste_${iteration}_0b`,
        `paste_${iteration}_1b`,
        `paste_${iteration}_2b`,
        `paste_${iteration}_3b`,
        `paste_${iteration}_4b`,
      ],
    ],
  }),
  createClearSeedPayload: (row, iteration) => ({
    ranges: [
      [0, row],
      [4, row],
    ],
    content: [
      [
        `clear_${iteration}_0`,
        `clear_${iteration}_1`,
        `clear_${iteration}_2`,
        `clear_${iteration}_3`,
        `clear_${iteration}_4`,
      ],
    ],
  }),
  createClearPayload: (row) => ({
    ranges: [
      [0, row],
      [4, row],
    ],
  }),
};

const fieldProfiles: ReadonlyArray<IFieldProfile> = [simpleProfile, text50Profile];

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isObjectLike = (value: unknown): value is object => {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
};

const toApiResponse = <T>(value: unknown): ApiResponse<T> => {
  if (!isObject(value) || typeof value.ok !== 'boolean') {
    throw new Error('Invalid API response shape');
  }

  if (!value.ok) {
    return { ok: false };
  }

  if (!('data' in value)) {
    throw new Error('Missing data in API response');
  }

  return {
    ok: true,
    data: value.data as T,
  };
};

const getTableMethods = (target: IBunBenchTarget): object => {
  const client = target.client as unknown;
  if (!isObjectLike(client)) {
    throw new Error('Benchmark client is missing tables methods');
  }

  const tables = Reflect.get(client, 'tables');
  if (!isObjectLike(tables)) {
    throw new Error('Benchmark client tables object is invalid');
  }

  return tables;
};

const callTableMethod = async <T>(
  target: IBunBenchTarget,
  method: string,
  input: unknown
): Promise<ApiResponse<T>> => {
  const tableMethods = getTableMethods(target);
  const methodFn = Reflect.get(tableMethods, method);

  if (typeof methodFn !== 'function') {
    throw new Error(`Missing table method: ${method}`);
  }

  const result = await methodFn(input);
  return toApiResponse<T>(result);
};

const createOperationTable = async (
  target: IBunBenchTarget,
  baseId: string,
  scenarioKey: string,
  operation: 'delete' | 'paste' | 'clear',
  profile: IFieldProfile
): Promise<IOperationState> => {
  const response = await callTableMethod<{
    table: { id: string; views: Array<{ id: string }>; fields: Array<{ id: string }> };
  }>(target, 'create', {
    baseId,
    name: createTableName(target.name, `${scenarioKey}_${operation}`),
    fields: profile.createFields(),
    views: [{ type: 'grid' }],
  });

  if (!response.ok) {
    throw new Error('Create operation table failed');
  }

  const viewId = response.data.table.views[0]?.id;
  if (!viewId) {
    throw new Error('Missing view id for operation table');
  }

  return {
    tableId: response.data.table.id,
    viewId,
    fieldIds: response.data.table.fields.map((field: { id: string }) => field.id),
    rowCount: 0,
    nextSeedIndex: 0,
    cursor: 0,
  };
};

const createFillerTables = async (
  target: IBunBenchTarget,
  baseId: string,
  scenarioKey: string,
  profile: IFieldProfile,
  count: number
) => {
  for (let index = 0; index < count; index += 1) {
    const response = await callTableMethod<{ table: { id: string } }>(target, 'create', {
      baseId,
      name: createTableName(target.name, `${scenarioKey}_filler_${index}`),
      fields: profile.createFields(),
      views: [{ type: 'grid' }],
    });

    if (!response.ok) {
      throw new Error('Create filler table failed');
    }
  }
};

const seedRecords = async (
  target: IBunBenchTarget,
  state: IOperationState,
  profile: IFieldProfile,
  count: number
) => {
  const chunkSize = 100;
  let remaining = count;

  while (remaining > 0) {
    const size = Math.min(chunkSize, remaining);
    const records = Array.from({ length: size }, (_, index) => ({
      fields: profile.createSeedFields(state.fieldIds, state.nextSeedIndex + index),
    }));

    const response = await callTableMethod<{ records: Array<{ id: string }> }>(
      target,
      'createRecords',
      {
        tableId: state.tableId,
        records,
      }
    );

    if (!response.ok) {
      throw new Error('Seed records failed');
    }

    state.nextSeedIndex += size;
    state.rowCount += response.data.records.length;
    remaining -= size;
  }
};

const setupScenario = async (
  target: IBunBenchTarget,
  baseId: string,
  tableCount: number,
  profile: IFieldProfile
): Promise<IScenarioState> => {
  const key = `${tableCount}_${profile.id}`;

  const deleteState = await createOperationTable(target, baseId, key, 'delete', profile);
  const pasteState = await createOperationTable(target, baseId, key, 'paste', profile);
  const clearState = await createOperationTable(target, baseId, key, 'clear', profile);

  await seedRecords(target, deleteState, profile, 600);
  await seedRecords(target, pasteState, profile, 200);
  await seedRecords(target, clearState, profile, 200);

  if (tableCount > 3) {
    await createFillerTables(target, baseId, key, profile, tableCount - 3);
  }

  return {
    key,
    tableCount,
    profile,
    deleteState,
    pasteState,
    clearState,
  };
};

const ensureRows = async (
  target: IBunBenchTarget,
  state: IOperationState,
  profile: IFieldProfile,
  threshold: number,
  refillCount: number
) => {
  if (state.rowCount < threshold) {
    await seedRecords(target, state, profile, refillCount);
  }
};

const runDeleteRow = async (target: IBunBenchTarget, scenario: IScenarioState) => {
  const state = scenario.deleteState;
  await ensureRows(target, state, scenario.profile, 200, 400);

  if (state.rowCount <= 0) {
    throw new Error('No rows available for delete benchmark');
  }

  const rowIndex = state.cursor % state.rowCount;
  const response = await callTableMethod<{ deletedCount: number }>(target, 'deleteByRange', {
    tableId: state.tableId,
    viewId: state.viewId,
    ranges: [[rowIndex, rowIndex]],
    type: 'rows',
  });

  if (!response.ok) {
    throw new Error('Delete row failed');
  }

  state.rowCount = Math.max(0, state.rowCount - response.data.deletedCount);
  state.cursor += 1;
};

const runPaste = async (target: IBunBenchTarget, scenario: IScenarioState) => {
  const state = scenario.pasteState;
  await ensureRows(target, state, scenario.profile, 20, 80);

  if (state.rowCount <= 1) {
    throw new Error('Not enough rows for paste benchmark');
  }

  const maxStartRow = Math.max(0, state.rowCount - 2);
  const row = maxStartRow === 0 ? 0 : state.cursor % maxStartRow;
  const payload = scenario.profile.createPastePayload(row, state.cursor);

  const response = await callTableMethod<{ createdCount: number }>(target, 'paste', {
    tableId: state.tableId,
    viewId: state.viewId,
    ranges: payload.ranges,
    content: payload.content,
  });

  if (!response.ok) {
    throw new Error('Paste failed');
  }

  state.rowCount += response.data.createdCount;
  state.cursor += 1;
};

const runClear = async (target: IBunBenchTarget, scenario: IScenarioState) => {
  const state = scenario.clearState;
  await ensureRows(target, state, scenario.profile, 20, 80);

  if (state.rowCount <= 0) {
    throw new Error('No rows available for clear benchmark');
  }

  const row = state.cursor % state.rowCount;
  const seedPayload = scenario.profile.createClearSeedPayload(row, state.cursor);
  const seedResponse = await callTableMethod<{ createdCount: number }>(target, 'paste', {
    tableId: state.tableId,
    viewId: state.viewId,
    ranges: seedPayload.ranges,
    content: seedPayload.content,
  });

  if (!seedResponse.ok) {
    throw new Error('Pre-seed before clear failed');
  }

  state.rowCount += seedResponse.data.createdCount;

  const clearPayload = scenario.profile.createClearPayload(row);
  const response = await callTableMethod<{ updatedCount: number }>(target, 'clear', {
    tableId: state.tableId,
    viewId: state.viewId,
    ranges: clearPayload.ranges,
  });

  if (!response.ok) {
    throw new Error('Clear failed');
  }

  state.cursor += 1;
};

const runBenchGroup = async (
  targets: ReadonlyArray<IBunBenchTarget>,
  title: string,
  runner: (target: IBunBenchTarget) => Promise<void>
) => {
  const bench = new Bench(benchOptions);

  for (const target of targets) {
    bench.add(`${target.name}: ${title}`, async () => {
      await runner(target);
    });
  }

  console.log(`[bun-bench] running row ops benchmarks: ${title}`);
  await bench.run();

  console.log(`RowOps benchmarks (bun): ${title}`);
  console.table(bench.table());
};

export const runRowOpsBench = async (sharedContext?: IBunBenchTargetsContext): Promise<void> => {
  const context = sharedContext ?? (await createBunBenchTargets());
  const ownsContext = !sharedContext;

  try {
    if (context.targets.length === 0) {
      throw new Error('No benchmark targets available');
    }

    const seedTarget =
      context.targets.find((target) => target.name === 'bun-rpc') ?? context.targets[0];

    const scenarios: IScenarioState[] = [];
    for (const tableCount of tableCountScenarios) {
      for (const profile of fieldProfiles) {
        scenarios.push(await setupScenario(seedTarget, context.baseId, tableCount, profile));
      }
    }

    for (const scenario of scenarios) {
      await runBenchGroup(
        context.targets,
        `delete row (${scenario.tableCount} tables, ${scenario.profile.id})`,
        async (target) => {
          await runDeleteRow(target, scenario);
        }
      );

      await runBenchGroup(
        context.targets,
        `paste (${scenario.tableCount} tables, ${scenario.profile.id})`,
        async (target) => {
          await runPaste(target, scenario);
        }
      );

      await runBenchGroup(
        context.targets,
        `clear (${scenario.tableCount} tables, ${scenario.profile.id})`,
        async (target) => {
          await runClear(target, scenario);
        }
      );
    }
  } finally {
    if (ownsContext) {
      await context.dispose();
    }
  }
};
