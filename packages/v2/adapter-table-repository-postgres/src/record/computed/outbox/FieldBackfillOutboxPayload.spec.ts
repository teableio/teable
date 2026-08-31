import { BaseId, FieldId, TableId, type IHasher } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import { buildFieldBackfillTaskInput } from './FieldBackfillOutboxPayload';

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
});
