import { describe, expect, it } from 'vitest';

import { getStartCell, normalizeRanges, validateRangesFormat } from './RangeUtils';

describe('RangeUtils', () => {
  describe('validateRangesFormat', () => {
    it('validates cell range with 2 elements', () => {
      const result = validateRangesFormat(
        [
          [0, 0],
          [2, 3],
        ],
        undefined
      );
      expect(result.isOk()).toBe(true);
    });

    it('validates columns type with 1 element', () => {
      const result = validateRangesFormat([[0, 2]], 'columns');
      expect(result.isOk()).toBe(true);
    });

    it('validates rows type with 1 element', () => {
      const result = validateRangesFormat([[1, 5]], 'rows');
      expect(result.isOk()).toBe(true);
    });

    it('rejects cell range with 1 element', () => {
      const result = validateRangesFormat([[0, 0]], undefined);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('2 elements');
    });

    it('accepts columns type with 2 elements (non-contiguous selection)', () => {
      const result = validateRangesFormat(
        [
          [0, 0],
          [2, 2],
        ],
        'columns'
      );
      expect(result.isOk()).toBe(true);
    });

    it('accepts rows type with 2 elements (non-contiguous selection)', () => {
      const result = validateRangesFormat(
        [
          [0, 0],
          [2, 2],
        ],
        'rows'
      );
      expect(result.isOk()).toBe(true);
    });

    it('rejects columns type with 0 elements', () => {
      const result = validateRangesFormat([], 'columns');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('at least 1 element');
    });

    it('rejects rows type with 0 elements', () => {
      const result = validateRangesFormat([], 'rows');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('at least 1 element');
    });

    it('rejects cell range with 0 elements', () => {
      const result = validateRangesFormat([], undefined);
      expect(result.isErr()).toBe(true);
    });

    it('rejects cell range with 3 elements', () => {
      const result = validateRangesFormat(
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        undefined
      );
      expect(result.isErr()).toBe(true);
    });
  });

  describe('normalizeRanges', () => {
    it('normalizes cell range correctly', () => {
      const normalized = normalizeRanges(
        [
          [1, 2],
          [3, 5],
        ],
        undefined,
        100,
        10
      );
      expect(normalized).toEqual([
        [1, 2],
        [3, 5],
      ]);
    });

    it('normalizes columns type correctly', () => {
      const normalized = normalizeRanges([[0, 2]], 'columns', 100, 10);
      expect(normalized).toEqual([
        [0, 0],
        [2, 99],
      ]);
    });

    it('normalizes rows type correctly', () => {
      const normalized = normalizeRanges([[1, 5]], 'rows', 100, 10);
      expect(normalized).toEqual([
        [0, 1],
        [9, 5],
      ]);
    });

    it('handles zero rows for columns type', () => {
      const normalized = normalizeRanges([[0, 2]], 'columns', 0, 10);
      expect(normalized).toEqual([
        [0, 0],
        [2, 0],
      ]);
    });

    it('handles zero cols for rows type', () => {
      const normalized = normalizeRanges([[1, 5]], 'rows', 100, 0);
      expect(normalized).toEqual([
        [0, 1],
        [0, 5],
      ]);
    });

    it('handles single cell range', () => {
      const normalized = normalizeRanges(
        [
          [2, 3],
          [2, 3],
        ],
        undefined,
        100,
        10
      );
      expect(normalized).toEqual([
        [2, 3],
        [2, 3],
      ]);
    });

    it('handles single column selection', () => {
      const normalized = normalizeRanges([[5, 5]], 'columns', 50, 10);
      expect(normalized).toEqual([
        [5, 0],
        [5, 49],
      ]);
    });

    it('handles single row selection', () => {
      const normalized = normalizeRanges([[10, 10]], 'rows', 100, 8);
      expect(normalized).toEqual([
        [0, 10],
        [7, 10],
      ]);
    });
  });

  describe('getStartCell', () => {
    it('returns start cell for cell range', () => {
      const startCell = getStartCell(
        [
          [1, 2],
          [3, 5],
        ],
        undefined
      );
      expect(startCell).toEqual([1, 2]);
    });

    it('returns start cell for columns type', () => {
      const startCell = getStartCell([[2, 5]], 'columns');
      expect(startCell).toEqual([2, 0]);
    });

    it('returns start cell for rows type', () => {
      const startCell = getStartCell([[3, 7]], 'rows');
      expect(startCell).toEqual([0, 3]);
    });
  });
});
