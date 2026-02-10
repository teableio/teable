import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';

/**
 * Selection type for range operations (paste, clear, delete by range).
 * - 'columns': Selection is entire columns. Ranges format: [[startCol, endCol]]
 * - 'rows': Selection is entire rows. Ranges format: [[startRow, endRow]]
 * - undefined: Selection is a cell range. Ranges format: [[startCol, startRow], [endCol, endRow]]
 */
export const rangeTypeSchema = z.enum(['columns', 'rows']).optional();
export type RangeType = z.infer<typeof rangeTypeSchema>;

/**
 * Range format varies by type:
 * - default (cell range): [[startCol, startRow], [endCol, endRow]] - two elements
 * - columns: [[startCol, endCol]] - single element
 * - rows: [[startRow, endRow]] - single element
 */
export const flexibleRangesSchema = z.array(
  z.tuple([z.number().int().min(0), z.number().int().min(0)])
);

export type FlexibleRanges = z.infer<typeof flexibleRangesSchema>;

/**
 * Normalized range type: [[startCol, startRow], [endCol, endRow]]
 * This is the internal format used after processing the input.
 */
export type NormalizedRanges = [[number, number], [number, number]];

/**
 * Validate that the ranges format matches the expected format for the given type.
 *
 * @param ranges The raw ranges array
 * @param type The range type ('columns', 'rows', or undefined for cell range)
 * @returns Ok if valid, Err with validation error if invalid
 */
export function validateRangesFormat(
  ranges: ReadonlyArray<readonly [number, number]>,
  type: RangeType
): Result<void, DomainError> {
  if (type === 'columns' || type === 'rows') {
    // For columns/rows, ranges should be at least one element: [[start, end], ...]
    // Multiple elements represent non-contiguous selections
    if (ranges.length < 1) {
      return err(
        domainError.validation({
          message: `For type '${type}', ranges must have at least 1 element [[start, end]], got ${ranges.length}`,
        })
      );
    }
  } else {
    // For cell range (default), ranges should be two elements: [[startCol, startRow], [endCol, endRow]]
    if (ranges.length !== 2) {
      return err(
        domainError.validation({
          message: `For cell range, ranges must have exactly 2 elements [[startCol, startRow], [endCol, endRow]], got ${ranges.length}`,
        })
      );
    }
  }

  return ok(undefined);
}

/**
 * Normalize ranges to standard format [[startCol, startRow], [endCol, endRow]].
 * This requires table dimensions for columns/rows type.
 *
 * @param rawRanges The raw ranges array from user input
 * @param rangeType The range type ('columns', 'rows', or undefined for cell range)
 * @param totalRows Total number of rows in the table (needed for 'columns' type)
 * @param totalCols Total number of columns in the table (needed for 'rows' type)
 * @returns Normalized ranges in [[startCol, startRow], [endCol, endRow]] format
 */
export function normalizeRanges(
  rawRanges: ReadonlyArray<readonly [number, number]>,
  rangeType: RangeType,
  totalRows: number,
  totalCols: number
): NormalizedRanges {
  if (rangeType === 'columns') {
    // ranges is [[startCol, endCol]]
    const [startCol, endCol] = rawRanges[0]!;
    return [
      [startCol, 0],
      [endCol, Math.max(0, totalRows - 1)],
    ];
  }

  if (rangeType === 'rows') {
    // ranges is [[startRow, endRow]]
    const [startRow, endRow] = rawRanges[0]!;
    return [
      [0, startRow],
      [Math.max(0, totalCols - 1), endRow],
    ];
  }

  // Default: cell range - ranges is [[startCol, startRow], [endCol, endRow]]
  const startCell = rawRanges[0]!;
  const endCell = rawRanges[1]!;
  return [
    [startCell[0], startCell[1]],
    [endCell[0], endCell[1]],
  ];
}

/**
 * Calculate the start cell (top-left) from raw ranges and range type.
 *
 * @param rawRanges The raw ranges array
 * @param rangeType The range type
 * @returns [startCol, startRow] tuple
 */
export function getStartCell(
  rawRanges: ReadonlyArray<readonly [number, number]>,
  rangeType: RangeType
): [number, number] {
  if (rangeType === 'columns') {
    const [startCol] = rawRanges[0]!;
    return [startCol, 0];
  }

  if (rangeType === 'rows') {
    const [startRow] = rawRanges[0]!;
    return [0, startRow];
  }

  return [rawRanges[0]![0], rawRanges[0]![1]];
}
