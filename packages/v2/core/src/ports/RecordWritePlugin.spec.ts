import { describe, expect, it } from 'vitest';

import {
  RecordWriteOperationKind,
  recordWriteOperationMayCreateRecords,
} from './RecordWritePlugin';

describe('recordWriteOperationMayCreateRecords', () => {
  it('returns true for operations that may create records', () => {
    expect(recordWriteOperationMayCreateRecords(RecordWriteOperationKind.createOne)).toBe(true);
    expect(recordWriteOperationMayCreateRecords(RecordWriteOperationKind.createMany)).toBe(true);
    expect(recordWriteOperationMayCreateRecords(RecordWriteOperationKind.createStream)).toBe(true);
    expect(recordWriteOperationMayCreateRecords(RecordWriteOperationKind.submit)).toBe(true);
    expect(recordWriteOperationMayCreateRecords(RecordWriteOperationKind.duplicate)).toBe(true);
    expect(recordWriteOperationMayCreateRecords(RecordWriteOperationKind.importAppend)).toBe(true);
    expect(recordWriteOperationMayCreateRecords(RecordWriteOperationKind.paste)).toBe(true);
  });

  it('returns false for operations that do not create records', () => {
    expect(recordWriteOperationMayCreateRecords(RecordWriteOperationKind.updateOne)).toBe(false);
    expect(recordWriteOperationMayCreateRecords(RecordWriteOperationKind.updateMany)).toBe(false);
    expect(recordWriteOperationMayCreateRecords(RecordWriteOperationKind.deleteMany)).toBe(false);
  });
});
