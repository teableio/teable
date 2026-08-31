import { BaseId, RecordId, TableId } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import {
  buildComputedUpdateLockPlan,
  defaultComputedUpdateLockConfig,
} from '../ComputedUpdateLock';

const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();

const makeRecordId = (char: string): RecordId =>
  RecordId.create(`rec${char.repeat(16)}`)._unsafeUnwrap();

const makeIndexedRecordId = (index: number): RecordId =>
  RecordId.create(`rec${index.toString().padStart(16, '0')}`)._unsafeUnwrap();

const createPlan = (recordIds: ReadonlyArray<RecordId>) => ({
  baseId,
  seedTableId: tableId,
  seedRecordIds: recordIds,
  extraSeedRecords: [],
});

const coveringTableStatement = (lockPlan: ReturnType<typeof buildComputedUpdateLockPlan>) =>
  lockPlan.statements.find((statement) => statement.scope === 'table' && statement.shared);

describe('ComputedUpdateLock', () => {
  it('locks each seed record individually and takes a shared table covering lock', () => {
    const plan = createPlan([makeRecordId('a'), makeRecordId('b')]);
    const lockPlan = buildComputedUpdateLockPlan(plan, {
      ...defaultComputedUpdateLockConfig,
      maxRecordLocks: 3,
      batchShardCount: 8,
    });

    expect(lockPlan.summary.mode).toBe('record');
    expect(lockPlan.recordLocks).toHaveLength(2);
    expect(lockPlan.batchLocks).toHaveLength(0);
    expect(lockPlan.tableLocks).toHaveLength(0);
    expect(coveringTableStatement(lockPlan)?.sql).toContain('pg_advisory_xact_lock_shared');
    expect(lockPlan.statements.filter((statement) => statement.scope === 'record')).toHaveLength(2);
    expect(lockPlan.statements.every((statement) => statement.scope !== 'batch')).toBe(true);
  });

  it('makes a small cascade contend with a large cascade covering the same record', () => {
    // T6637/T6747: overlapping cascades must collide. Small sets keep per-record
    // keys plus a shared table covering lock; oversized sets take that same
    // table key exclusively so they serialize without 20k per-record slots.
    const sharedRecord = makeRecordId('o');
    const otherRecord = makeRecordId('p');
    const config = {
      ...defaultComputedUpdateLockConfig,
      maxRecordLocks: 2,
      batchShardCount: 8,
    };
    const smallCascade = buildComputedUpdateLockPlan(createPlan([sharedRecord]), config);
    const largeCascade = buildComputedUpdateLockPlan(
      createPlan([sharedRecord, otherRecord, makeRecordId('q'), makeRecordId('r')]),
      config
    );

    expect(smallCascade.summary.mode).toBe('record');
    expect(largeCascade.summary.mode).toBe('table');
    expect(largeCascade.recordLocks).toHaveLength(0);
    expect(largeCascade.tableLocks).toHaveLength(1);

    const smallCovering = coveringTableStatement(smallCascade);
    const largeTable = largeCascade.statements.find((statement) => statement.scope === 'table');
    expect(smallCovering?.key).toBe(largeTable?.key);
    expect(smallCovering?.shared).toBe(true);
    expect(largeTable?.shared).toBe(false);

    const smallRecordKeys = new Set(
      smallCascade.statements
        .filter((statement) => statement.scope === 'record')
        .map(({ key }) => key)
    );
    const otherKey =
      smallCascade.statements.find((statement) => statement.recordId === otherRecord.toString())
        ?.key ??
      largeCascade.statements.find((statement) => statement.recordId === otherRecord.toString())
        ?.key ??
      '';
    expect(smallRecordKeys.size).toBe(1);
    expect(otherKey).toBe('');
  });

  it('falls back to an exclusive table lock when the seed set exceeds maxRecordLocks', () => {
    const plan = createPlan([makeRecordId('a'), makeRecordId('b'), makeRecordId('c')]);
    const lockPlan = buildComputedUpdateLockPlan(plan, {
      ...defaultComputedUpdateLockConfig,
      maxRecordLocks: 1,
      batchShardCount: 4,
    });

    expect(lockPlan.summary.mode).toBe('table');
    expect(lockPlan.recordLocks).toHaveLength(0);
    expect(lockPlan.batchLocks).toHaveLength(0);
    expect(lockPlan.tableLocks).toHaveLength(1);
    expect(lockPlan.statements).toHaveLength(1);
    expect(lockPlan.statements[0]?.shared).toBe(false);
    expect(new Set(lockPlan.statements.map((statement) => statement.scope))).toEqual(
      new Set(['table'])
    );
  });

  it('caps a 20k-host fan-out to one exclusive table lock T6747', () => {
    const plan = createPlan(
      Array.from({ length: 20_000 }, (_, index) => makeIndexedRecordId(index))
    );
    const lockPlan = buildComputedUpdateLockPlan(plan, defaultComputedUpdateLockConfig);

    expect(lockPlan.summary.mode).toBe('table');
    expect(lockPlan.summary.seedRecordCount).toBe(20_000);
    expect(lockPlan.recordLocks).toHaveLength(0);
    expect(lockPlan.tableLocks).toHaveLength(1);
    expect(lockPlan.statements).toHaveLength(1);
    expect(lockPlan.statements[0]?.shared).toBe(false);
    expect(lockPlan.statements[0]?.sql).toContain('pg_advisory_xact_lock(');
    expect(lockPlan.statements[0]?.sql).not.toContain('pg_advisory_xact_lock_shared');
  });

  it('keeps per-record keys at the maxRecordLocks boundary', () => {
    const plan = createPlan(
      Array.from({ length: defaultComputedUpdateLockConfig.maxRecordLocks }, (_, index) =>
        makeIndexedRecordId(index)
      )
    );
    const lockPlan = buildComputedUpdateLockPlan(plan, defaultComputedUpdateLockConfig);

    expect(lockPlan.summary.mode).toBe('record');
    expect(lockPlan.recordLocks).toHaveLength(defaultComputedUpdateLockConfig.maxRecordLocks);
    expect(lockPlan.tableLocks).toHaveLength(0);
    expect(coveringTableStatement(lockPlan)?.shared).toBe(true);
  });

  it('shares only the overlapping record lock between disjoint small seed sets', () => {
    const shared = makeRecordId('c');
    const planA = createPlan([makeRecordId('a'), makeRecordId('b'), shared]);
    const planB = createPlan([shared, makeRecordId('d'), makeRecordId('e')]);
    const config = {
      ...defaultComputedUpdateLockConfig,
      maxRecordLocks: 10,
      batchShardCount: 8,
    };

    const lockPlanA = buildComputedUpdateLockPlan(planA, config);
    const lockPlanB = buildComputedUpdateLockPlan(planB, config);

    const keysA = lockPlanA.recordLocks.map((lock) => lock.key);
    const keysB = new Set(lockPlanB.recordLocks.map((lock) => lock.key));
    const overlap = keysA.filter((key) => keysB.has(key));

    expect(overlap).toHaveLength(1);
    expect(lockPlanA.recordLocks.find((lock) => lock.recordId === shared.toString())?.key).toBe(
      overlap[0]
    );
    expect(coveringTableStatement(lockPlanA)?.key).toBe(coveringTableStatement(lockPlanB)?.key);
  });

  it('falls back to table locks when batch shards are disabled', () => {
    const plan = createPlan([makeRecordId('a'), makeRecordId('b')]);
    const lockPlan = buildComputedUpdateLockPlan(plan, {
      ...defaultComputedUpdateLockConfig,
      maxRecordLocks: 1,
      batchShardCount: 0,
    });

    expect(lockPlan.summary.mode).toBe('table');
    expect(lockPlan.recordLocks).toHaveLength(0);
    expect(lockPlan.batchLocks).toHaveLength(0);
    expect(lockPlan.tableLocks).toHaveLength(1);
    expect(new Set(lockPlan.statements.map((statement) => statement.scope))).toEqual(
      new Set(['table'])
    );
  });

  it('shares lock keys for the same target across different seed tables', () => {
    // Hybrid dual-worker race (T6300): a User-seed task and an Order-seed task can hold
    // non-overlapping seed locks while both writing Order computed columns. Dirty-target
    // locks for the Order row must collide with the Order seed lock.
    const orderTableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
    const orderRecordId = makeRecordId('o');
    const config = {
      ...defaultComputedUpdateLockConfig,
      maxRecordLocks: 10,
      batchShardCount: 8,
    };

    const orderSeedLocks = buildComputedUpdateLockPlan(
      {
        baseId,
        seedTableId: orderTableId,
        seedRecordIds: [orderRecordId],
        extraSeedRecords: [],
      },
      config
    );
    const userCascadeDirtyLocks = buildComputedUpdateLockPlan(
      {
        baseId,
        seedTableId: tableId,
        seedRecordIds: [],
        extraSeedRecords: [
          {
            tableId: orderTableId,
            recordIds: [orderRecordId],
          },
        ],
      },
      config
    );

    expect(orderSeedLocks.recordLocks).toHaveLength(1);
    expect(userCascadeDirtyLocks.recordLocks).toHaveLength(1);
    expect(orderSeedLocks.recordLocks[0]?.key).toBe(userCascadeDirtyLocks.recordLocks[0]?.key);
    expect(coveringTableStatement(orderSeedLocks)?.key).toBe(
      coveringTableStatement(userCascadeDirtyLocks)?.key
    );
  });

  it('does not lock read-only foreign extra seeds when write tables are given', () => {
    const orderTableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
    const orderRecordId = makeRecordId('o');
    const userRecordId = makeRecordId('u');
    const lockPlan = buildComputedUpdateLockPlan(
      {
        baseId,
        seedTableId: orderTableId,
        seedRecordIds: [orderRecordId],
        extraSeedRecords: [{ tableId, recordIds: [userRecordId] }],
      },
      defaultComputedUpdateLockConfig,
      { writeTableIds: [orderTableId.toString()] }
    );

    expect(lockPlan.recordLocks).toHaveLength(1);
    expect(lockPlan.recordLocks[0]?.tableId).toBe(orderTableId.toString());
    expect(lockPlan.recordLocks[0]?.recordId).toBe(orderRecordId.toString());
    expect(coveringTableStatement(lockPlan)?.tableId).toBe(orderTableId.toString());
  });

  it.each([
    { scope: 'record', maxRecordLocks: 10, batchShardCount: 8 },
    { scope: 'record', maxRecordLocks: 0, batchShardCount: 8 },
    { scope: 'table', maxRecordLocks: 0, batchShardCount: 0 },
  ])('shares $scope target lock keys across different root bases', (lockConfig) => {
    const otherBaseId = BaseId.create(`bse${'z'.repeat(16)}`)._unsafeUnwrap();
    const targetTableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
    const targetRecordId = makeRecordId('o');
    const config = { ...defaultComputedUpdateLockConfig, ...lockConfig };

    const sourceBaseLocks = buildComputedUpdateLockPlan(
      {
        baseId,
        seedTableId: tableId,
        seedRecordIds: [],
        extraSeedRecords: [{ tableId: targetTableId, recordIds: [targetRecordId] }],
      },
      config
    );
    const targetBaseLocks = buildComputedUpdateLockPlan(
      {
        baseId: otherBaseId,
        seedTableId: targetTableId,
        seedRecordIds: [targetRecordId],
        extraSeedRecords: [],
      },
      config
    );

    expect(sourceBaseLocks.statements.map(({ key }) => key)).toEqual(
      targetBaseLocks.statements.map(({ key }) => key)
    );
  });
});
