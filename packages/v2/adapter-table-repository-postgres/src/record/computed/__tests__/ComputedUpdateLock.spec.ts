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

const createPlan = (recordIds: ReadonlyArray<RecordId>) => ({
  baseId,
  seedTableId: tableId,
  seedRecordIds: recordIds,
  extraSeedRecords: [],
});

describe('ComputedUpdateLock', () => {
  it('uses record locks when seed records are under the limit', () => {
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
    expect(lockPlan.statements.every((statement) => statement.scope === 'record')).toBe(true);
  });

  it('uses batch locks when seed records exceed the limit', () => {
    const plan = createPlan([makeRecordId('a'), makeRecordId('b'), makeRecordId('c')]);
    const lockPlan = buildComputedUpdateLockPlan(plan, {
      ...defaultComputedUpdateLockConfig,
      maxRecordLocks: 1,
      batchShardCount: 4,
    });

    expect(lockPlan.summary.mode).toBe('batch');
    expect(lockPlan.recordLocks).toHaveLength(0);
    expect(lockPlan.batchLocks.length).toBeGreaterThan(0);
    expect(lockPlan.tableLocks).toHaveLength(0);
    expect(new Set(lockPlan.statements.map((statement) => statement.scope))).toEqual(
      new Set(['batch'])
    );
  });

  it('ensures overlapping record sets share at least one batch lock', () => {
    const planA = createPlan([makeRecordId('a'), makeRecordId('b'), makeRecordId('c')]);
    const planB = createPlan([makeRecordId('c'), makeRecordId('d'), makeRecordId('e')]);
    const config = {
      ...defaultComputedUpdateLockConfig,
      maxRecordLocks: 1,
      batchShardCount: 8,
    };

    const lockPlanA = buildComputedUpdateLockPlan(planA, config);
    const lockPlanB = buildComputedUpdateLockPlan(planB, config);

    const keysA = new Set(lockPlanA.batchLocks.map((lock) => lock.key));
    const keysB = new Set(lockPlanB.batchLocks.map((lock) => lock.key));
    const overlap = [...keysA].filter((key) => keysB.has(key));

    expect(overlap.length).toBeGreaterThan(0);
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
});
