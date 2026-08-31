import { BaseId, FieldId, NoopHasher, RecordId, TableId } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import type { ComputedUpdatePlan } from '../ComputedUpdatePlanner';
import {
  buildOutboxTaskInput,
  deserializeComputedUpdatePlan,
  mergeBeforeImageRecordDtos,
  mergeComputedRealtimeOrchestration,
} from './ComputedUpdateOutboxPayload';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const EXTRA_TABLE_ID = `tbl${'x'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;
const SECOND_FIELD_ID = `fld${'f'.repeat(16)}`;
const THIRD_FIELD_ID = `fld${'g'.repeat(16)}`;
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
    {
      tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
      fieldIds: [FieldId.create(SECOND_FIELD_ID)._unsafeUnwrap()],
      level: 1,
    },
  ],
  edges: [],
  estimatedComplexity: 1,
  changeType: 'update',
  sameTableBatches: [
    {
      tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
      steps: [
        {
          tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
          fieldIds: [FieldId.create(FIELD_ID)._unsafeUnwrap()],
          level: 0,
        },
        {
          tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
          fieldIds: [FieldId.create(SECOND_FIELD_ID)._unsafeUnwrap()],
          level: 1,
        },
      ],
      minLevel: 0,
      maxLevel: 1,
    },
  ],
});

describe('ComputedUpdateOutboxPayload', () => {
  it('uses step outputs without refeeding edge targets when steps exist', () => {
    const plan = {
      ...createPlan(),
      edges: [
        {
          fromFieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
          toFieldId: FieldId.create(THIRD_FIELD_ID)._unsafeUnwrap(),
          fromTableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
          toTableId: TableId.create(EXTRA_TABLE_ID)._unsafeUnwrap(),
          propagationMode: 'linkTraversal' as const,
          order: 0,
        },
      ],
    } satisfies ComputedUpdatePlan;
    const task = buildOutboxTaskInput({
      plan,
      syncMaxLevel: 0,
      hasher: testHasher,
      runId: RUN_ID,
      originRunIds: [RUN_ID],
      runTotalSteps: plan.steps.length,
      runCompletedStepsBefore: 0,
    });

    expect(task.affectedFieldIds).toEqual([FIELD_ID, SECOND_FIELD_ID]);
  });

  it('tracks edge target tables for edge-only tasks', () => {
    const plan = {
      ...createPlan(),
      steps: [],
      sameTableBatches: [],
      edges: [
        {
          fromFieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
          toFieldId: FieldId.create(SECOND_FIELD_ID)._unsafeUnwrap(),
          fromTableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
          toTableId: TableId.create(EXTRA_TABLE_ID)._unsafeUnwrap(),
          propagationMode: 'linkTraversal' as const,
          order: 0,
        },
      ],
    } satisfies ComputedUpdatePlan;
    const task = buildOutboxTaskInput({
      plan,
      syncMaxLevel: 0,
      hasher: testHasher,
      runId: RUN_ID,
      originRunIds: [RUN_ID],
      runTotalSteps: 0,
      runCompletedStepsBefore: 0,
    });

    expect(task.affectedTableIds).toContain(EXTRA_TABLE_ID);
  });

  it('carries original mutation field ids on leftover tasks', () => {
    const plan = createPlan();
    const task = buildOutboxTaskInput({
      plan,
      syncMaxLevel: 0,
      hasher: testHasher,
      runId: RUN_ID,
      originRunIds: [RUN_ID],
      runTotalSteps: plan.steps.length,
      runCompletedStepsBefore: 0,
      sourceFieldIds: [FIELD_ID],
    });

    expect(task.sourceFieldIds).toEqual([FIELD_ID]);
  });

  it('preserves the earliest before-image values when merging DTOs', () => {
    const merged = mergeBeforeImageRecordDtos(
      [
        {
          recordId: RECORD_ID,
          fieldValuesByDbName: {
            col_status: 'open',
            col_score: 1,
          },
        },
      ],
      [
        {
          recordId: RECORD_ID,
          fieldValuesByDbName: {
            col_status: 'closed',
            col_owner: 'usr_1',
          },
        },
        {
          recordId: EXTRA_RECORD_ID,
          fieldValuesByDbName: {
            col_status: 'new',
          },
        },
      ]
    );

    expect(merged).toEqual([
      {
        recordId: RECORD_ID,
        fieldValuesByDbName: {
          col_status: 'open',
          col_score: 1,
          col_owner: 'usr_1',
        },
      },
      {
        recordId: EXTRA_RECORD_ID,
        fieldValuesByDbName: {
          col_status: 'new',
        },
      },
    ]);
  });

  it('serializes and deserializes computed update plans', () => {
    const plan = {
      ...createPlan(),
      edges: [
        {
          fromFieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
          toFieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
          fromTableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
          toTableId: TableId.create(EXTRA_TABLE_ID)._unsafeUnwrap(),
          propagationMode: 'allTargetRecords' as const,
          allTargetRecordsReasons: ['conditional_delete' as const],
          order: 0,
        },
      ],
    } satisfies ComputedUpdatePlan;
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
      sameTableBatches: task.sameTableBatches,
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
    expect(deserialized.value.sameTableBatches).toHaveLength(1);
    expect(
      deserialized.value.sameTableBatches[0]?.steps.map((step) => ({
        level: step.level,
        fieldIds: step.fieldIds.map((fieldId) => fieldId.toString()),
      }))
    ).toEqual([
      { level: 0, fieldIds: [FIELD_ID] },
      { level: 1, fieldIds: [SECOND_FIELD_ID] },
    ]);
    expect(deserialized.value.extraSeedRecords[0].tableId.toString()).toBe(EXTRA_TABLE_ID);
    expect(deserialized.value.extraSeedRecords[0].recordIds[0].toString()).toBe(EXTRA_RECORD_ID);
    expect(deserialized.value.edges[0]?.allTargetRecordsReasons).toEqual(['conditional_delete']);
  });

  it('keeps orchestration when merging payloads from the same operation', () => {
    expect(
      mergeComputedRealtimeOrchestration(
        {
          operationId: 'req-a',
          groupId: 'req-a',
          totalRecordCount: 2000,
          totalChunkCount: 4,
          chunkIndex: 1,
          scope: 'chunk',
        },
        {
          operationId: 'req-a',
          groupId: 'req-a',
          totalRecordCount: 2000,
          totalChunkCount: 4,
          chunkIndex: 2,
          scope: 'chunk',
        }
      )
    ).toEqual({
      operationId: 'req-a',
      groupId: 'req-a',
      totalRecordCount: 2000,
      totalChunkCount: 4,
      chunkIndex: 1,
      scope: 'chunk',
    });
  });

  it('drops orchestration when merging payloads from different operations', () => {
    expect(
      mergeComputedRealtimeOrchestration(
        {
          operationId: 'req-a',
          groupId: 'req-a',
          totalRecordCount: 2000,
          totalChunkCount: 4,
          chunkIndex: 0,
          scope: 'operation',
        },
        {
          operationId: 'req-b',
          groupId: 'req-b',
          totalRecordCount: 5,
          totalChunkCount: 1,
          chunkIndex: 0,
          scope: 'operation',
        }
      )
    ).toBeUndefined();
  });
});
