import {
  ActorId,
  BaseId,
  FieldId,
  NoopHasher,
  RecordId,
  TableId,
  type ILogger,
  ok,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import type { ComputedFieldUpdater, PreparedDirtyState } from '../ComputedFieldUpdater';
import type { ComputedUpdatePlan, UpdateStep } from '../ComputedUpdatePlanner';
import type { IComputedUpdateOutbox } from '../outbox/IComputedUpdateOutbox';
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
});

const createPreparedState = (dirtyStats: PreparedDirtyState['dirtyStats']): PreparedDirtyState => ({
  db: {} as PreparedDirtyState['db'],
  tableById: new Map(),
  dirtyStats,
  totalDirtyRecords: dirtyStats.reduce((sum, stat) => sum + stat.recordCount, 0),
});

const createUpdaterStub = () => {
  const prepareDirtyState = vi.fn();
  const executePreparedSteps = vi.fn();

  const updater = {
    prepareDirtyState,
    executePreparedSteps,
  } as unknown as ComputedFieldUpdater;

  return { updater, prepareDirtyState, executePreparedSteps };
};

const createOutboxStub = () => {
  const enqueueOrMerge = vi.fn();

  const outbox: IComputedUpdateOutbox = {
    enqueueOrMerge,
    claimBatch: async () => ok([]),
    markDone: async () => ok(undefined),
    markFailed: async () => ok(undefined),
  };

  return { outbox, enqueueOrMerge };
};

const createLogger = (): ILogger => ({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => createLogger(),
  scope: () => createLogger(),
});

describe('HybridWithOutboxStrategy', () => {
  it('syncs seed-table steps and enqueues remaining levels when threshold exceeded', async () => {
    const plan = createPlan();
    const { updater, prepareDirtyState, executePreparedSteps } = createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();

    prepareDirtyState.mockResolvedValue(
      ok(
        createPreparedState([
          { tableId: OTHER_TABLE_ID, recordCount: 3000 },
          { tableId: THIRD_TABLE_ID, recordCount: 10 },
        ])
      )
    );
    executePreparedSteps.mockResolvedValue(ok([]));
    enqueueOrMerge.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));

    const strategy = new HybridWithOutboxStrategy(outbox, undefined, createLogger(), testHasher);
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
    const { updater, prepareDirtyState, executePreparedSteps } = createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();

    enqueueOrMerge.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));
    prepareDirtyState.mockResolvedValue(
      ok(
        createPreparedState([
          { tableId: OTHER_TABLE_ID, recordCount: 10 },
          { tableId: THIRD_TABLE_ID, recordCount: 20 },
        ])
      )
    );
    executePreparedSteps.mockResolvedValue(ok([]));

    const strategy = new HybridWithOutboxStrategy(
      outbox,
      {
        syncMaxDirtyPerTable: 2000,
        syncMaxTotalDirty: 5000,
        syncMaxLevelHardCap: 10,
      },
      createLogger(),
      testHasher
    );
    const actorId = ActorId.create('usr_test')._unsafeUnwrap();

    const result = await strategy.execute(updater, plan, { actorId });
    expect(result.isOk()).toBe(true);

    expect(executePreparedSteps).toHaveBeenCalledTimes(1);
    const steps = executePreparedSteps.mock.calls[0][3] as UpdateStep[];
    expect(steps).toHaveLength(3);

    expect(enqueueOrMerge).not.toHaveBeenCalled();
  });
});
