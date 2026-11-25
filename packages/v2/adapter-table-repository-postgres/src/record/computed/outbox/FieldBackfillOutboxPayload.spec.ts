import { BaseId, FieldId, TableId, type IHasher } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import {
  buildFieldBackfillTaskInput,
  mergeStageNotificationTargets,
  takeNextValidBackfillStage,
} from './FieldBackfillOutboxPayload';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;
const CURSOR = `rec${'d'.repeat(16)}`;

describe('FieldBackfillOutboxPayload', () => {
  it('includes the resume cursor in continuation identity', () => {
    const hasher: IHasher = {
      sha256: vi.fn((input: string) => input),
    };
    const params = {
      baseId: BaseId.create(BASE_ID)._unsafeUnwrap(),
      tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
      fieldIds: [FieldId.create(FIELD_ID)._unsafeUnwrap()],
      hasher,
      runId: 'run-1',
    };

    const root = buildFieldBackfillTaskInput(params);
    const continuation = buildFieldBackfillTaskInput({ ...params, cursor: CURSOR });

    expect(root.cursor).toBeUndefined();
    expect(continuation.cursor).toBe(CURSOR);
    expect(continuation.planHash).not.toBe(root.planHash);
    expect(continuation.planHash).toContain(CURSOR);
  });

  it('preserves stageChain in payload identity only when provided', () => {
    const hasher: IHasher = {
      sha256: vi.fn((input: string) => input),
    };
    const baseParams = {
      baseId: BaseId.create(BASE_ID)._unsafeUnwrap(),
      tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
      fieldIds: [FieldId.create(FIELD_ID)._unsafeUnwrap()],
      hasher,
      runId: 'run-stage-1',
    };

    const periodicRefresh = {
      sourceFieldId: FIELD_ID,
      sourceTableId: TABLE_ID,
      rangeHash: 'r:abcd1234',
      localDate: '2026-11-23',
      timeZone: 'Asia/Shanghai',
      containsNowPrecision: false,
      triggeredAtIso: '2026-11-23T00:05:00.000Z',
    };
    const plain = buildFieldBackfillTaskInput(baseParams);
    const staged = buildFieldBackfillTaskInput({
      ...baseParams,
      stageChain: {
        remainingStages: [{ tableId: `tbl${'e'.repeat(16)}`, fieldIds: [`fld${'f'.repeat(16)}`] }],
        notifyTargets: [],
        periodicRefresh,
      },
    });

    expect(plain.stageChain).toBeUndefined();
    expect(staged.stageChain).toEqual({
      remainingStages: [{ tableId: `tbl${'e'.repeat(16)}`, fieldIds: [`fld${'f'.repeat(16)}`] }],
      notifyTargets: [],
      periodicRefresh,
    });
    expect(staged.planHash).not.toBe(plain.planHash);
    expect(staged.planHash).toContain('stageChain');
    expect(staged.planHash).toContain('r:abcd1234');
  });

  it('merges notification targets and skips invalid/empty stages in stageChain', () => {
    const table2 = `tbl${'f'.repeat(16)}`;
    const field2 = `fld${'g'.repeat(16)}`;

    expect(
      mergeStageNotificationTargets([{ tableId: TABLE_ID, fieldIds: [FIELD_ID] }], {
        tableId: TABLE_ID,
        fieldIds: [FIELD_ID, field2],
      })
    ).toEqual([{ tableId: TABLE_ID, fieldIds: [FIELD_ID, field2] }]);

    const shifted = takeNextValidBackfillStage([
      { tableId: 'invalid-table', fieldIds: [FIELD_ID] },
      { tableId: TABLE_ID, fieldIds: [] },
      { tableId: table2, fieldIds: [field2, 'bad-field'] },
      { tableId: TABLE_ID, fieldIds: [FIELD_ID] },
    ]);

    expect(shifted.nextStage?.tableId.toString()).toBe(table2);
    expect(shifted.nextStage?.fieldIds.map((id) => id.toString())).toEqual([field2]);
    expect(shifted.remainingStages).toEqual([{ tableId: TABLE_ID, fieldIds: [FIELD_ID] }]);
  });
});
