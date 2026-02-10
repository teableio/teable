import {
  ActorId,
  BaseId,
  FieldId,
  FieldType,
  NoopHasher,
  RecordId,
  TableId,
  type Field,
  type Table,
  type IEventBus,
  type ILogger,
  ok,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import type { ComputedFieldUpdater, PreparedDirtyState } from '../ComputedFieldUpdater';
import type {
  ComputedUpdatePlan,
  ComputedUpdatePlanner,
  UpdateStep,
} from '../ComputedUpdatePlanner';
import type { IComputedUpdateOutbox } from '../outbox/IComputedUpdateOutbox';
import type { ComputedUpdateWorker } from '../worker/ComputedUpdateWorker';
import { HybridWithOutboxStrategy } from './HybridWithOutboxStrategy';

const testHasher = new NoopHasher();

const BASE_ID = `bse${'a'.repeat(16)}`;
const SEED_TABLE_ID = `tbl${'b'.repeat(16)}`;
const OTHER_TABLE_ID = `tbl${'c'.repeat(16)}`;
const THIRD_TABLE_ID = `tbl${'d'.repeat(16)}`;
const FIELD_ID_A = `fld${'e'.repeat(16)}`;
const FIELD_ID_B = `fld${'f'.repeat(16)}`;
const FIELD_ID_C = `fld${'g'.repeat(16)}`;
const RECORD_ID = `rec${'h'.repeat(16)}`;

const createPlan = (): ComputedUpdatePlan => ({
  baseId: BaseId.create(BASE_ID)._unsafeUnwrap(),
  seedTableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
  seedRecordIds: [RecordId.create(RECORD_ID)._unsafeUnwrap()],
  extraSeedRecords: [],
  steps: [
    {
      tableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
      fieldIds: [FieldId.create(FIELD_ID_A)._unsafeUnwrap()],
      level: 0,
    },
    {
      tableId: TableId.create(OTHER_TABLE_ID)._unsafeUnwrap(),
      fieldIds: [FieldId.create(FIELD_ID_B)._unsafeUnwrap()],
      level: 1,
    },
    {
      tableId: TableId.create(THIRD_TABLE_ID)._unsafeUnwrap(),
      fieldIds: [FieldId.create(FIELD_ID_C)._unsafeUnwrap()],
      level: 2,
    },
  ],
  edges: [],
  estimatedComplexity: 3,
  changeType: 'update',
  sameTableBatches: [],
});

const createMockFormulaField = (fieldId: string): Field => {
  return {
    id: () => FieldId.create(fieldId)._unsafeUnwrap(),
    type: () => FieldType.formula(),
  } as unknown as Field;
};

const createMockTable = (tableId: string, fieldIds: string[]): Table => {
  const fieldsMap = new Map(fieldIds.map((id) => [id, createMockFormulaField(id)]));
  return {
    id: () => TableId.create(tableId)._unsafeUnwrap(),
    getField: (predicate: (field: Field) => boolean) => {
      for (const field of fieldsMap.values()) {
        if (predicate(field)) return ok(field);
      }
      return ok(undefined);
    },
  } as unknown as Table;
};

const createPreparedState = (
  dirtyStats: PreparedDirtyState['dirtyStats'],
  tableById: Map<string, Table> = new Map()
): PreparedDirtyState => ({
  db: {} as PreparedDirtyState['db'],
  tableById,
  dirtyStats,
  totalDirtyRecords: dirtyStats.reduce((sum, stat) => sum + stat.recordCount, 0),
});

const createUpdaterStub = () => {
  const acquireLocks = vi.fn().mockResolvedValue(
    ok({
      mode: 'record',
      totalLocks: 1,
      recordLocks: 1,
      tableLocks: 0,
      tableLockTableIds: [],
      seedRecordCount: 1,
    })
  );
  const prepareDirtyState = vi.fn();
  const executePreparedSteps = vi.fn();
  const collectDirtySeedGroups = vi.fn();

  const updater = {
    acquireLocks,
    prepareDirtyState,
    executePreparedSteps,
    collectDirtySeedGroups,
  } as unknown as ComputedFieldUpdater;

  return { updater, acquireLocks, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups };
};

const createOutboxStub = () => {
  const enqueueOrMerge = vi.fn();
  const enqueueSeedTask = vi.fn();
  const enqueueFieldBackfill = vi.fn();

  const outbox: IComputedUpdateOutbox = {
    enqueueOrMerge,
    enqueueSeedTask,
    enqueueFieldBackfill,
    claimBatch: async () => ok([]),
    markDone: async () => ok(undefined),
    markFailed: async () => ok(undefined),
  };

  return { outbox, enqueueOrMerge, enqueueSeedTask, enqueueFieldBackfill };
};

const createWorkerStub = () => {
  const runOnce = vi.fn();
  const worker = {
    runOnce,
  } as unknown as ComputedUpdateWorker;

  return { worker, runOnce };
};

const createPlannerStub = () => {
  const planStage = vi.fn();
  const planner = { planStage } as unknown as ComputedUpdatePlanner;
  return { planner, planStage };
};

const createLogger = (): ILogger => ({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => createLogger(),
  scope: () => createLogger(),
});

const createEventBusStub = () =>
  ({
    publishMany: vi.fn().mockResolvedValue(ok(undefined)),
  }) as unknown as IEventBus;

describe('HybridWithOutboxStrategy', () => {
  it('syncs seed-table steps and enqueues remaining levels when threshold exceeded', async () => {
    const plan = createPlan();
    const { updater, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups } =
      createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner, planStage } = createPlannerStub();

    prepareDirtyState.mockResolvedValue(
      ok(
        createPreparedState([
          { tableId: OTHER_TABLE_ID, recordCount: 3000 },
          { tableId: THIRD_TABLE_ID, recordCount: 10 },
        ])
      )
    );
    executePreparedSteps.mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
    collectDirtySeedGroups.mockResolvedValue(ok([]));
    planStage.mockResolvedValue(ok({ ...plan, steps: [], edges: [] }));
    enqueueOrMerge.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));

    const strategy = new HybridWithOutboxStrategy(
      outbox,
      worker,
      {
        syncPolicy: 'threshold',
        syncMaxDirtyPerTable: 2000,
        syncMaxTotalDirty: 5000,
        syncMaxLevelHardCap: 1,
        dispatchMode: 'external',
        dispatchWorkerLimit: 50,
        dispatchWorkerId: 'computed-inline',
        dispatchDelayMs: 0,
      },
      createLogger(),
      testHasher,
      planner,
      createEventBusStub()
    );
    const actorId = ActorId.create('usr_test')._unsafeUnwrap();

    const result = await strategy.execute(updater, plan, { actorId });
    expect(result.isOk()).toBe(true);

    expect(executePreparedSteps).toHaveBeenCalledTimes(1);
    const steps = executePreparedSteps.mock.calls[0][3] as UpdateStep[];
    expect(steps).toHaveLength(1);
    expect(steps[0].tableId.toString()).toBe(SEED_TABLE_ID);

    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    const outboxTask = enqueueOrMerge.mock.calls[0][0];
    expect(outboxTask.steps).toHaveLength(2);
  });

  it('syncs all steps when dirty counts stay below thresholds', async () => {
    const plan = createPlan();
    const { updater, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups } =
      createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner, planStage } = createPlannerStub();

    enqueueOrMerge.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));
    prepareDirtyState.mockResolvedValue(
      ok(
        createPreparedState([
          { tableId: OTHER_TABLE_ID, recordCount: 10 },
          { tableId: THIRD_TABLE_ID, recordCount: 20 },
        ])
      )
    );
    executePreparedSteps.mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
    collectDirtySeedGroups.mockResolvedValue(ok([]));
    planStage.mockResolvedValue(ok({ ...plan, steps: [], edges: [] }));

    const strategy = new HybridWithOutboxStrategy(
      outbox,
      worker,
      {
        syncPolicy: 'threshold',
        syncMaxDirtyPerTable: 2000,
        syncMaxTotalDirty: 5000,
        syncMaxLevelHardCap: 10,
        dispatchMode: 'external',
        dispatchWorkerLimit: 50,
        dispatchWorkerId: 'computed-inline',
        dispatchDelayMs: 0,
      },
      createLogger(),
      testHasher,
      planner,
      createEventBusStub()
    );
    const actorId = ActorId.create('usr_test')._unsafeUnwrap();

    const result = await strategy.execute(updater, plan, { actorId });
    expect(result.isOk()).toBe(true);

    expect(executePreparedSteps).toHaveBeenCalledTimes(1);
    const steps = executePreparedSteps.mock.calls[0][3] as UpdateStep[];
    expect(steps).toHaveLength(3);

    expect(enqueueOrMerge).not.toHaveBeenCalled();
  });

  it('syncs seed-table steps when using seedTableOnly policy', async () => {
    const plan = createPlan();
    const { updater, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups } =
      createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner, planStage } = createPlannerStub();

    // Create tableById with seed table containing formula field
    const seedTable = createMockTable(SEED_TABLE_ID, [FIELD_ID_A]);
    const tableById = new Map([[SEED_TABLE_ID, seedTable]]);

    prepareDirtyState.mockResolvedValue(
      ok(
        createPreparedState(
          [
            { tableId: OTHER_TABLE_ID, recordCount: 10 },
            { tableId: THIRD_TABLE_ID, recordCount: 20 },
          ],
          tableById
        )
      )
    );
    executePreparedSteps.mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
    collectDirtySeedGroups.mockResolvedValue(ok([]));
    planStage.mockResolvedValue(ok({ ...plan, steps: [], edges: [] }));
    enqueueOrMerge.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));

    const strategy = new HybridWithOutboxStrategy(
      outbox,
      worker,
      {
        syncPolicy: 'seedTableOnly',
        syncMaxDirtyPerTable: 2000,
        syncMaxTotalDirty: 5000,
        syncMaxLevelHardCap: 1,
        dispatchMode: 'external',
        dispatchWorkerLimit: 50,
        dispatchWorkerId: 'computed-inline',
        dispatchDelayMs: 0,
      },
      createLogger(),
      testHasher,
      planner,
      createEventBusStub()
    );
    const actorId = ActorId.create('usr_test')._unsafeUnwrap();

    const result = await strategy.execute(updater, plan, { actorId });
    expect(result.isOk()).toBe(true);

    expect(executePreparedSteps).toHaveBeenCalledTimes(1);
    const steps = executePreparedSteps.mock.calls[0][3] as UpdateStep[];
    expect(steps).toHaveLength(1);
    expect(steps[0].tableId.toString()).toBe(SEED_TABLE_ID);

    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
  });

  it('dispatches worker after enqueue when enabled', async () => {
    const plan = createPlan();
    const { updater, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups } =
      createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker, runOnce } = createWorkerStub();
    const { planner, planStage } = createPlannerStub();

    // Create tableById with seed table containing formula field
    const seedTable = createMockTable(SEED_TABLE_ID, [FIELD_ID_A]);
    const tableById = new Map([[SEED_TABLE_ID, seedTable]]);

    prepareDirtyState.mockResolvedValue(
      ok(
        createPreparedState(
          [
            { tableId: OTHER_TABLE_ID, recordCount: 10 },
            { tableId: THIRD_TABLE_ID, recordCount: 20 },
          ],
          tableById
        )
      )
    );
    executePreparedSteps.mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
    collectDirtySeedGroups.mockResolvedValue(ok([]));
    planStage.mockResolvedValue(ok({ ...plan, steps: [], edges: [] }));
    enqueueOrMerge.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));
    runOnce.mockResolvedValue(ok(0));

    vi.useFakeTimers();
    try {
      const strategy = new HybridWithOutboxStrategy(
        outbox,
        worker,
        {
          syncPolicy: 'seedTableOnly',
          syncMaxDirtyPerTable: 2000,
          syncMaxTotalDirty: 5000,
          syncMaxLevelHardCap: 1,
          dispatchMode: 'push',
          dispatchWorkerLimit: 50,
          dispatchWorkerId: 'computed-inline',
          dispatchDelayMs: 0,
        },
        createLogger(),
        testHasher,
        planner,
        createEventBusStub()
      );
      const actorId = ActorId.create('usr_test')._unsafeUnwrap();

      const result = await strategy.execute(updater, plan, { actorId });
      expect(result.isOk()).toBe(true);

      await vi.runAllTimersAsync();
      expect(runOnce).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
