import { BaseId, FieldId, NoopHasher, RecordId, TableId } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import type { ComputedUpdatePlan } from '../ComputedUpdatePlanner';
import { buildOutboxTaskInput, deserializeComputedUpdatePlan } from './ComputedUpdateOutboxPayload';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const EXTRA_TABLE_ID = `tbl${'x'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;
const RECORD_ID = `rec${'d'.repeat(16)}`;
const EXTRA_RECORD_ID = `rec${'e'.repeat(16)}`;
const RUN_ID = `cur${'r'.repeat(16)}`;

const testHasher = new NoopHasher();

const createPlan = (): ComputedUpdatePlan => ({
  baseId: BaseId.create(BASE_ID)._unsafeUnwrap(),
  seedTableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
  seedRecordIds: [RecordId.create(RECORD_ID)._unsafeUnwrap()],
  extraSeedRecords: [
    {
      tableId: TableId.create(EXTRA_TABLE_ID)._unsafeUnwrap(),
      recordIds: [RecordId.create(EXTRA_RECORD_ID)._unsafeUnwrap()],
    },
  ],
  steps: [
    {
      tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
      fieldIds: [FieldId.create(FIELD_ID)._unsafeUnwrap()],
      level: 0,
    },
  ],
  edges: [],
  estimatedComplexity: 1,
  changeType: 'update',
  sameTableBatches: [],
});

describe('ComputedUpdateOutboxPayload', () => {
  it('serializes and deserializes computed update plans', () => {
    const plan = createPlan();
    const task = buildOutboxTaskInput({
      plan,
      syncMaxLevel: 0,
      hasher: testHasher,
      runId: RUN_ID,
      originRunIds: [RUN_ID],
      runTotalSteps: plan.steps.length,
      runCompletedStepsBefore: 0,
    });

    const deserialized = deserializeComputedUpdatePlan({
      baseId: task.baseId,
      seedTableId: task.seedTableId,
      seedRecordIds: task.seedRecordIds,
      extraSeedRecords: task.extraSeedRecords,
      steps: task.steps,
      edges: task.edges,
      estimatedComplexity: task.estimatedComplexity,
      changeType: task.changeType,
    });

    expect(deserialized.isOk()).toBe(true);
    if (deserialized.isErr()) return;

    expect(deserialized.value.baseId.toString()).toBe(BASE_ID);
    expect(deserialized.value.seedTableId.toString()).toBe(TABLE_ID);
    expect(deserialized.value.seedRecordIds[0].toString()).toBe(RECORD_ID);
    expect(deserialized.value.steps[0].fieldIds[0].toString()).toBe(FIELD_ID);
    expect(deserialized.value.extraSeedRecords[0].tableId.toString()).toBe(EXTRA_TABLE_ID);
    expect(deserialized.value.extraSeedRecords[0].recordIds[0].toString()).toBe(EXTRA_RECORD_ID);
  });
});
