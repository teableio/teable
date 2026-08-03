import { describe, expect, it } from 'vitest';

import type { ComputedUpdateSeedPayload } from './ComputedUpdateSeedPayload';
import { mergeSeedPayloads } from './ComputedUpdateSeedPayload';

describe('ComputedUpdateSeedPayload', () => {
  it('preserves the earliest before-image values per record when merging seed payloads', () => {
    const existing: ComputedUpdateSeedPayload = {
      taskType: 'seed',
      baseId: `bse${'a'.repeat(16)}`,
      seedTableId: `tbl${'b'.repeat(16)}`,
      seedRecordIds: [`rec${'c'.repeat(16)}`],
      extraSeedRecords: [],
      beforeImageRecords: [
        {
          recordId: `rec${'c'.repeat(16)}`,
          fieldValuesByDbName: {
            col_status: 'open',
            col_score: 1,
          },
        },
      ],
      changedFieldIds: [`fld${'d'.repeat(16)}`],
      changeType: 'update',
    };

    const incoming: ComputedUpdateSeedPayload = {
      taskType: 'seed',
      baseId: existing.baseId,
      seedTableId: existing.seedTableId,
      seedRecordIds: [`rec${'e'.repeat(16)}`],
      extraSeedRecords: [],
      beforeImageRecords: [
        {
          recordId: `rec${'c'.repeat(16)}`,
          fieldValuesByDbName: {
            col_status: 'closed',
            col_owner: 'usr_1',
          },
        },
        {
          recordId: `rec${'e'.repeat(16)}`,
          fieldValuesByDbName: {
            col_status: 'new',
          },
        },
      ],
      changedFieldIds: [`fld${'f'.repeat(16)}`],
      changeType: 'update',
    };

    const merged = mergeSeedPayloads(existing, incoming);
    const mergedByRecord = new Map(
      merged.beforeImageRecords.map((record) => [record.recordId, record.fieldValuesByDbName])
    );

    expect(merged.seedRecordIds).toEqual([`rec${'c'.repeat(16)}`, `rec${'e'.repeat(16)}`]);
    expect(mergedByRecord.get(`rec${'c'.repeat(16)}`)).toEqual({
      col_status: 'open',
      col_score: 1,
      col_owner: 'usr_1',
    });
    expect(mergedByRecord.get(`rec${'e'.repeat(16)}`)).toEqual({
      col_status: 'new',
    });
  });
});
