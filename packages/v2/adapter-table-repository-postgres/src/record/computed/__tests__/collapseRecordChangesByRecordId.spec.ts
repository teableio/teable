import { describe, expect, it } from 'vitest';

import { collapseRecordChangesByRecordId } from '../ComputedFieldUpdater';

describe('collapseRecordChangesByRecordId', () => {
  it('keeps the first oldValue and last newValue for the same field', () => {
    const collapsed = collapseRecordChangesByRecordId([
      {
        recordId: 'recAutomation000001',
        oldVersion: 1,
        changes: [{ fieldId: 'fldLookup00000001', oldValue: 'Alpha', newValue: 'Beta' }],
      },
      {
        recordId: 'recAutomation000001',
        oldVersion: 2,
        changes: [{ fieldId: 'fldLookup00000001', oldValue: 'Beta', newValue: 'Beta' }],
      },
    ]);

    expect(collapsed).toEqual([
      {
        recordId: 'recAutomation000001',
        oldVersion: 1,
        newVersion: 3,
        changes: [{ fieldId: 'fldLookup00000001', oldValue: 'Alpha', newValue: 'Beta' }],
      },
    ]);
  });

  it('keeps a no-op change when that is the only field update', () => {
    const collapsed = collapseRecordChangesByRecordId([
      {
        recordId: 'recAutomation000001',
        oldVersion: 1,
        changes: [{ fieldId: 'fldLookup00000001', oldValue: 'Beta', newValue: 'Beta' }],
      },
    ]);
    expect(collapsed).toEqual([
      {
        recordId: 'recAutomation000001',
        oldVersion: 1,
        newVersion: 2,
        changes: [{ fieldId: 'fldLookup00000001', oldValue: 'Beta', newValue: 'Beta' }],
      },
    ]);
  });
});
