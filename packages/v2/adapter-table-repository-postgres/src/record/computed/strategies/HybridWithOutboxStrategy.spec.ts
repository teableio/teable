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
  domainError,
  ok,
} from '@teable/v2-core';
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { sql } from 'kysely';
import { err } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE } from '../ComputedUpdateLock';
import type { ComputedFieldUpdater, PreparedDirtyState } from '../ComputedFieldUpdater';
import type {
  ComputedUpdatePlan,
  ComputedUpdatePlanner,
  UpdateStep,
} from '../ComputedUpdatePlanner';
import type { IComputedUpdateOutbox } from '../outbox/IComputedUpdateOutbox';
import type { ComputedUpdateWorker } from '../worker/ComputedUpdateWorker';
import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
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

const createMockConditionalLookupField = (fieldId: string): Field => {
  return {
    id: () => FieldId.create(fieldId)._unsafeUnwrap(),
    type: () => FieldType.conditionalLookup(),
  } as unknown as Field;
};

const createMockTableFromFields = (tableId: string, fields: ReadonlyArray<Field>): Table => {
  const fieldsMap = new Map(fields.map((field) => [field.id().toString(), field]));
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

const createMockTable = (tableId: string, fieldIds: string[]): Table => {
  return createMockTableFromFields(
    tableId,
    fieldIds.map((id) => createMockFormulaField(id))
  );
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
    claimById: async () => ok(null),
    renewLease: async () => ok([]),
    releaseForRetry: async () => ok(true),
    markDone: async () => ok(true),
    markFailed: async () => ok(true),
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
    collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
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
    collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
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
    collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
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

  it('enqueues seed-table steps when seedTableOnly dirty count exceeds sync threshold', async () => {
    const plan: ComputedUpdatePlan = {
      ...createPlan(),
      changedFieldIds: [FieldId.create(FIELD_ID_A)._unsafeUnwrap()],
      edges: [
        {
          fromFieldId: FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap(),
          toFieldId: FieldId.create(FIELD_ID_A)._unsafeUnwrap(),
          fromTableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          toTableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          order: 0,
        },
      ],
      steps: [
        {
          tableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          fieldIds: [FieldId.create(FIELD_ID_A)._unsafeUnwrap()],
          level: 0,
        },
        {
          tableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          fieldIds: [FieldId.create(FIELD_ID_B)._unsafeUnwrap()],
          level: 1,
        },
        {
          tableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          fieldIds: [FieldId.create(FIELD_ID_C)._unsafeUnwrap()],
          level: 2,
        },
      ],
    };
    const { updater, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups } =
      createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner } = createPlannerStub();

    const seedTable = createMockTable(SEED_TABLE_ID, [FIELD_ID_A, FIELD_ID_B, FIELD_ID_C]);
    const tableById = new Map([[SEED_TABLE_ID, seedTable]]);

    prepareDirtyState.mockResolvedValue(
      ok(createPreparedState([{ tableId: SEED_TABLE_ID, recordCount: 3000 }], tableById))
    );
    executePreparedSteps.mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
    collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
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

    expect(executePreparedSteps).not.toHaveBeenCalled();
    expect(collectDirtySeedGroups).not.toHaveBeenCalled();
    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    const outboxTask = enqueueOrMerge.mock.calls[0][0];
    expect(outboxTask.steps).toHaveLength(3);
    expect(outboxTask.sourceFieldIds).toEqual([FIELD_ID_A]);
    expect(outboxTask.syncMaxLevel).toBe(-1);
  });

  it('enqueues all-target propagation before preparing dirty state', async () => {
    const plan: ComputedUpdatePlan = {
      ...createPlan(),
      changedFieldIds: [FieldId.create(FIELD_ID_A)._unsafeUnwrap()],
      edges: [
        {
          fromFieldId: FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap(),
          toFieldId: FieldId.create(FIELD_ID_A)._unsafeUnwrap(),
          fromTableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          toTableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          propagationMode: 'allTargetRecords',
          order: 0,
        },
      ],
    };
    const { updater, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups } =
      createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner, planStage } = createPlannerStub();

    prepareDirtyState.mockResolvedValue(
      ok(createPreparedState([{ tableId: SEED_TABLE_ID, recordCount: 1 }]))
    );
    executePreparedSteps.mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
    collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
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

    expect(prepareDirtyState).not.toHaveBeenCalled();
    expect(executePreparedSteps).not.toHaveBeenCalled();
    expect(collectDirtySeedGroups).not.toHaveBeenCalled();
    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    const outboxTask = enqueueOrMerge.mock.calls[0][0];
    expect(outboxTask.steps).toHaveLength(plan.steps.length);
    expect(outboxTask.syncMaxLevel).toBe(-1);
  });

  it('enqueues whole-table seed plans before preparing dirty state', async () => {
    const plan: ComputedUpdatePlan = {
      ...createPlan(),
      seedAllTableIds: [TableId.create(SEED_TABLE_ID)._unsafeUnwrap()],
    };
    const { updater, prepareDirtyState, executePreparedSteps } = createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner } = createPlannerStub();
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

    const result = await strategy.execute(updater, plan, {
      actorId: ActorId.create('usr_test')._unsafeUnwrap(),
    });

    expect(result.isOk()).toBe(true);
    expect(prepareDirtyState).not.toHaveBeenCalled();
    expect(executePreparedSteps).not.toHaveBeenCalled();
    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    expect(enqueueOrMerge.mock.calls[0][0].seedAllTableIds).toEqual([SEED_TABLE_ID]);
  });

  it('preserves edge-only all-target plans when enqueueing before preparation', async () => {
    const edge = {
      fromFieldId: FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap(),
      toFieldId: FieldId.create(FIELD_ID_B)._unsafeUnwrap(),
      fromTableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
      toTableId: TableId.create(OTHER_TABLE_ID)._unsafeUnwrap(),
      propagationMode: 'allTargetRecords' as const,
      order: 0,
    };
    const plan: ComputedUpdatePlan = { ...createPlan(), steps: [], edges: [edge] };
    const { updater, prepareDirtyState } = createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner } = createPlannerStub();
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

    const result = await strategy.execute(updater, plan, {
      actorId: ActorId.create('usr_test')._unsafeUnwrap(),
    });

    expect(result.isOk()).toBe(true);
    expect(prepareDirtyState).not.toHaveBeenCalled();
    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    const outboxTask = enqueueOrMerge.mock.calls[0][0];
    expect(outboxTask.steps).toEqual([]);
    expect(outboxTask.edges).toHaveLength(1);
    expect(outboxTask.affectedFieldIds).toEqual([FIELD_ID_B]);
  });

  it('keeps a small conditional target scan inline for create response parity', async () => {
    const basePlan = createPlan();
    const edge = {
      fromFieldId: FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap(),
      toFieldId: FieldId.create(FIELD_ID_A)._unsafeUnwrap(),
      fromTableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
      toTableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
      propagationMode: 'conditionalFiltered' as const,
      filterCondition: {
        foreignTableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
        filterDto: {
          conjunction: 'and' as const,
          filterSet: [{ fieldId: FIELD_ID_A, operator: 'isNotEmpty' as const }],
        },
        includeBeforeImage: false,
      },
      order: 0,
    };
    const plan: ComputedUpdatePlan = {
      ...basePlan,
      changeType: 'insert',
      steps: basePlan.steps.slice(0, 1),
      edges: [edge],
    };
    const { updater, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups } =
      createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner, planStage } = createPlannerStub();

    const seedTable = createMockTableFromFields(SEED_TABLE_ID, [
      createMockConditionalLookupField(FIELD_ID_A),
    ]);
    prepareDirtyState.mockResolvedValue(
      ok(
        createPreparedState(
          [{ tableId: SEED_TABLE_ID, recordCount: 1 }],
          new Map([[SEED_TABLE_ID, seedTable]])
        )
      )
    );
    executePreparedSteps.mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
    collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
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

    const result = await strategy.execute(updater, plan, {
      actorId: ActorId.create('usr_test')._unsafeUnwrap(),
    });

    expect(result.isOk()).toBe(true);
    expect(prepareDirtyState).toHaveBeenCalledTimes(1);
    expect(executePreparedSteps).toHaveBeenCalledTimes(1);
    expect(enqueueOrMerge).not.toHaveBeenCalled();
  });

  it.each([
    { previousTimeout: '0', expectedInlineTimeout: '15s' },
    { previousTimeout: '5s', expectedInlineTimeout: '5s' },
  ])(
    'caps inline SQL at $expectedInlineTimeout and restores an outer $previousTimeout timeout',
    async ({ previousTimeout, expectedInlineTimeout }) => {
      const { db } = await createPGliteDb();

      try {
        await db.transaction().execute(async (trx) => {
          await sql`select set_config('statement_timeout', ${previousTimeout}, true)`.execute(trx);
          const basePlan = createPlan();
          const plan: ComputedUpdatePlan = { ...basePlan, steps: basePlan.steps.slice(0, 1) };
          const { updater, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups } =
            createUpdaterStub();
          const { outbox } = createOutboxStub();
          const { worker } = createWorkerStub();
          const { planner, planStage } = createPlannerStub();
          const seedTable = createMockTable(SEED_TABLE_ID, [FIELD_ID_A]);

          prepareDirtyState.mockImplementation(async () => {
            const result = await sql<{
              value: string;
            }>`select current_setting('statement_timeout') as value`.execute(trx);
            expect(result.rows[0]?.value).toBe(expectedInlineTimeout);
            return ok({
              ...createPreparedState(
                [{ tableId: SEED_TABLE_ID, recordCount: 1 }],
                new Map([[SEED_TABLE_ID, seedTable]])
              ),
              db: trx as PreparedDirtyState['db'],
            });
          });
          executePreparedSteps.mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
          collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
          planStage.mockResolvedValue(ok({ ...plan, steps: [], edges: [] }));

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
            createEventBusStub(),
            { inlineStatementTimeoutMs: 15_000 }
          );

          const result = await strategy.execute(updater, plan, {
            actorId: ActorId.create('usr_test')._unsafeUnwrap(),
            transaction: new PostgresUnitOfWorkTransaction(trx, 'data'),
          });
          expect(result.isOk()).toBe(true);
          const restored = await sql<{
            value: string;
          }>`select current_setting('statement_timeout') as value`.execute(trx);
          expect(restored.rows[0]?.value).toBe(previousTimeout);
        });
      } finally {
        await db.destroy();
      }
    }
  );

  it('syncs seed-table formula chains when seedTableOnly dirty count stays below thresholds', async () => {
    const plan: ComputedUpdatePlan = {
      ...createPlan(),
      steps: [
        {
          tableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          fieldIds: [FieldId.create(FIELD_ID_A)._unsafeUnwrap()],
          level: 0,
        },
        {
          tableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          fieldIds: [FieldId.create(FIELD_ID_B)._unsafeUnwrap()],
          level: 1,
        },
        {
          tableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          fieldIds: [FieldId.create(FIELD_ID_C)._unsafeUnwrap()],
          level: 2,
        },
      ],
    };
    const { updater, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups } =
      createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner, planStage } = createPlannerStub();

    const seedTable = createMockTable(SEED_TABLE_ID, [FIELD_ID_A, FIELD_ID_B, FIELD_ID_C]);
    const tableById = new Map([[SEED_TABLE_ID, seedTable]]);

    prepareDirtyState.mockResolvedValue(
      ok(createPreparedState([{ tableId: SEED_TABLE_ID, recordCount: 1 }], tableById))
    );
    executePreparedSteps.mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
    collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
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
    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.level)).toEqual([0, 1, 2]);
    expect(enqueueOrMerge).not.toHaveBeenCalled();
  });

  it('syncs seed-table conditional lookup steps and enqueues other tables with seedTableOnly policy', async () => {
    const plan = createPlan();
    const { updater, prepareDirtyState, executePreparedSteps, collectDirtySeedGroups } =
      createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner, planStage } = createPlannerStub();

    const seedTable = createMockTableFromFields(SEED_TABLE_ID, [
      createMockConditionalLookupField(FIELD_ID_A),
    ]);
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
    collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
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
    expect(steps[0].fieldIds.map((id) => id.toString())).toEqual([FIELD_ID_A]);

    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    const outboxTask = enqueueOrMerge.mock.calls[0][0];
    expect(outboxTask.steps).toHaveLength(2);
    expect(
      outboxTask.steps.every((step: UpdateStep) => step.tableId.toString() !== SEED_TABLE_ID)
    ).toBe(true);
  });

  it('enqueues all steps without sync work when sync policy is none', async () => {
    const plan = createPlan();
    const { updater, prepareDirtyState, executePreparedSteps } = createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner } = createPlannerStub();

    prepareDirtyState.mockResolvedValue(
      ok(
        createPreparedState([
          { tableId: SEED_TABLE_ID, recordCount: 1 },
          { tableId: OTHER_TABLE_ID, recordCount: 10 },
          { tableId: THIRD_TABLE_ID, recordCount: 20 },
        ])
      )
    );
    enqueueOrMerge.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));

    const strategy = new HybridWithOutboxStrategy(
      outbox,
      worker,
      {
        syncPolicy: 'none',
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

    expect(executePreparedSteps).not.toHaveBeenCalled();
    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    const outboxTask = enqueueOrMerge.mock.calls[0][0];
    expect(outboxTask.steps).toHaveLength(3);
  });

  it('waits for write-target locks on a small host insert instead of dumping the plan', async () => {
    const basePlan = createPlan();
    const plan = {
      ...basePlan,
      changeType: 'insert' as const,
      steps: basePlan.steps.filter((step) => step.tableId.toString() === SEED_TABLE_ID),
    };
    const {
      updater,
      acquireLocks,
      prepareDirtyState,
      executePreparedSteps,
      collectDirtySeedGroups,
    } = createUpdaterStub();
    const { outbox, enqueueOrMerge } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner, planStage } = createPlannerStub();

    prepareDirtyState.mockResolvedValue(
      ok(createPreparedState([{ tableId: SEED_TABLE_ID, recordCount: 1 }]))
    );
    executePreparedSteps.mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
    collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
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

    expect(acquireLocks).toHaveBeenCalledWith(plan, expect.anything(), {
      logContext: expect.anything(),
      wait: true,
    });
    expect(executePreparedSteps).toHaveBeenCalled();
    expect(enqueueOrMerge.mock.calls[0]?.[0].syncMaxLevel).not.toBe(-1);
  });

  it('does not wait on a small insert that also writes a foreign table', async () => {
    const plan = { ...createPlan(), changeType: 'insert' as const };
    const { updater, acquireLocks, prepareDirtyState } = createUpdaterStub();
    const { outbox, enqueueOrMerge, enqueueSeedTask } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner } = createPlannerStub();

    prepareDirtyState.mockResolvedValue(
      ok(createPreparedState([{ tableId: SEED_TABLE_ID, recordCount: 1 }]))
    );
    acquireLocks.mockResolvedValue(
      err(
        domainError.infrastructure({
          code: COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE,
          message: 'Computed update lock unavailable: lock-key',
        })
      )
    );
    enqueueSeedTask.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));

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

    const result = await strategy.execute(updater, plan, {
      actorId: ActorId.create('usr_test')._unsafeUnwrap(),
    });
    expect(result.isOk()).toBe(true);
    expect(prepareDirtyState).not.toHaveBeenCalled();
    expect(acquireLocks).toHaveBeenCalledWith(plan, expect.anything(), {
      logContext: expect.anything(),
      wait: false,
    });
    expect(enqueueOrMerge).not.toHaveBeenCalled();
    expect(enqueueSeedTask).toHaveBeenCalledTimes(1);
  });

  it('does not wait on a small insert whose plan writes a foreign table', async () => {
    const basePlan = createPlan();
    const plan = {
      ...basePlan,
      changeType: 'insert' as const,
      extraSeedRecords: [
        {
          tableId: TableId.create(OTHER_TABLE_ID)._unsafeUnwrap(),
          recordIds: [RecordId.create(RECORD_ID)._unsafeUnwrap()],
        },
      ],
      steps: basePlan.steps.filter((step) => step.tableId.toString() === SEED_TABLE_ID),
      edges: [
        {
          fromTableId: TableId.create(SEED_TABLE_ID)._unsafeUnwrap(),
          fromFieldId: FieldId.create(FIELD_ID_A)._unsafeUnwrap(),
          toTableId: TableId.create(OTHER_TABLE_ID)._unsafeUnwrap(),
          toFieldId: FieldId.create(FIELD_ID_B)._unsafeUnwrap(),
          linkFieldId: FieldId.create(FIELD_ID_A)._unsafeUnwrap(),
          propagationMode: 'linkTraversal' as const,
          order: 0,
        },
      ],
    };
    const { updater, acquireLocks, prepareDirtyState } = createUpdaterStub();
    const { outbox, enqueueOrMerge, enqueueSeedTask } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner } = createPlannerStub();

    acquireLocks.mockResolvedValue(
      err(
        domainError.infrastructure({
          code: COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE,
          message: 'Computed update lock unavailable: lock-key',
        })
      )
    );
    enqueueSeedTask.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));

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

    const result = await strategy.execute(updater, plan, {
      actorId: ActorId.create('usr_test')._unsafeUnwrap(),
    });
    expect(result.isOk()).toBe(true);
    expect(prepareDirtyState).not.toHaveBeenCalled();
    expect(acquireLocks).toHaveBeenCalledWith(plan, expect.anything(), {
      logContext: expect.anything(),
      wait: false,
    });
    expect(enqueueOrMerge).not.toHaveBeenCalled();
    expect(enqueueSeedTask).toHaveBeenCalledTimes(1);
    const seedTask = enqueueSeedTask.mock.calls[0][0];
    expect(seedTask.taskType).toBe('seed');
    expect(seedTask.extraSeedRecords).toEqual([
      { tableId: OTHER_TABLE_ID, recordIds: [RECORD_ID] },
    ]);
    expect(seedTask.impact?.linkFieldIds).toEqual([FIELD_ID_A]);
  });

  it('keeps small source updates non-blocking so a wide host fan-out can queue', async () => {
    const plan = createPlan();
    const { updater, acquireLocks, prepareDirtyState } = createUpdaterStub();
    const { outbox, enqueueOrMerge, enqueueSeedTask } = createOutboxStub();
    const { worker } = createWorkerStub();
    const { planner } = createPlannerStub();
    prepareDirtyState.mockResolvedValue(
      ok(createPreparedState([{ tableId: OTHER_TABLE_ID, recordCount: 265 }]))
    );
    acquireLocks.mockResolvedValue(
      err(
        domainError.infrastructure({
          code: COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE,
          message: 'Computed update lock unavailable: lock-key',
        })
      )
    );
    enqueueSeedTask.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));

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

    const result = await strategy.execute(updater, plan, {
      actorId: ActorId.create('usr_test')._unsafeUnwrap(),
    });
    expect(result.isOk()).toBe(true);
    expect(acquireLocks).toHaveBeenCalledWith(plan, expect.anything(), {
      logContext: expect.anything(),
      wait: false,
    });
    expect(enqueueOrMerge).not.toHaveBeenCalled();
    expect(enqueueSeedTask).toHaveBeenCalledTimes(1);
  });

  it('queues a seed task instead of waiting when a wide cascade cannot take locks', async () => {
    const plan = createPlan();
    const { updater, acquireLocks, prepareDirtyState, executePreparedSteps } = createUpdaterStub();
    const { outbox, enqueueOrMerge, enqueueSeedTask } = createOutboxStub();
    const { worker, runOnce } = createWorkerStub();
    const { planner } = createPlannerStub();

    prepareDirtyState.mockResolvedValue(
      ok(createPreparedState([{ tableId: OTHER_TABLE_ID, recordCount: 100 }]))
    );
    acquireLocks.mockResolvedValue(
      err(
        domainError.infrastructure({
          code: COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE,
          message: 'Computed update lock unavailable: lock-key',
        })
      )
    );
    enqueueSeedTask.mockResolvedValue(ok({ taskId: 'task-1', merged: false }));

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

      expect(acquireLocks).toHaveBeenCalledWith(plan, expect.anything(), {
        logContext: expect.anything(),
        wait: false,
      });
      expect(executePreparedSteps).not.toHaveBeenCalled();
      expect(enqueueOrMerge).not.toHaveBeenCalled();
      expect(enqueueSeedTask).toHaveBeenCalledTimes(1);
      const seedTask = enqueueSeedTask.mock.calls[0][0];
      expect(seedTask.taskType).toBe('seed');
      expect(seedTask.seedRecordIds).toEqual([RECORD_ID]);
      expect(seedTask.changedFieldIds).toEqual(
        expect.arrayContaining([FIELD_ID_A, FIELD_ID_B, FIELD_ID_C])
      );

      await vi.runAllTimersAsync();
      expect(runOnce).toHaveBeenCalledWith({
        actorId,
        limit: 50,
        requestId: undefined,
        tracer: undefined,
        workerId: 'computed-inline',
      });
    } finally {
      vi.useRealTimers();
    }
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
    collectDirtySeedGroups.mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
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
