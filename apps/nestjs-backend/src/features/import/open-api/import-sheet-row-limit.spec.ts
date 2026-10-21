import { describe, expect, it } from 'vitest';
import {
  getImportRowLimitMax,
  remainingImportRowCount,
  resolveTruncatedSheetRetryCap,
} from './import-sheet-row-limit';

describe('import-sheet-row-limit', () => {
  it('reads the row-limit max from table-safety errors', () => {
    expect(
      getImportRowLimitMax({
        code: 'validation.limit.rows_per_table_max',
        details: { max: 1000 },
      })
    ).toBe(1000);
    expect(
      getImportRowLimitMax({
        code: 'validation.limit.create_table_records_max',
        details: { maxRowCount: 500 },
      })
    ).toBe(500);
    expect(getImportRowLimitMax({ code: 'validation.invalid' })).toBeUndefined();
  });

  it('retries only when a tighter cap is available', () => {
    expect(resolveTruncatedSheetRetryCap(undefined, 1000)).toBe(1000);
    expect(resolveTruncatedSheetRetryCap(10_000, 1000)).toBe(1000);
    expect(resolveTruncatedSheetRetryCap(1000, 1000)).toBeUndefined();
    expect(resolveTruncatedSheetRetryCap(500, 1000)).toBeUndefined();
  });

  it('decrements remaining space quota after a sheet import', () => {
    expect(remainingImportRowCount(undefined, 10)).toBeUndefined();
    expect(remainingImportRowCount(1000, 400)).toBe(600);
    expect(remainingImportRowCount(100, 400)).toBe(0);
  });
});
