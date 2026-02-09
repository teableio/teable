import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { recordFilterSchema, type RecordFilter } from '../queries/RecordFilterDto';

/**
 * Selection type for clear operation.
 * - 'columns': Selection is entire columns. Ranges format: [[startCol, endCol]]
 * - 'rows': Selection is entire rows. Ranges format: [[startRow, endRow]]
 * - undefined: Selection is a cell range. Ranges format: [[startCol, startRow], [endCol, endRow]]
 */
export const clearRangeTypeSchema = z.enum(['columns', 'rows']).optional();
export type ClearRangeType = z.infer<typeof clearRangeTypeSchema>;

/**
 * Range format varies by type:
 * - default (cell range): [[startCol, startRow], [endCol, endRow]] - two elements
 * - columns: [[startCol, endCol]] - single element
 * - rows: [[startRow, endRow]] - single element
 */
export const clearFlexibleRangesSchema = z.array(
  z.tuple([z.number().int().min(0), z.number().int().min(0)])
);

/**
 * Normalized range type: [[startCol, startRow], [endCol, endRow]]
 * This is the internal format used after processing the input.
 */
export type ClearNormalizedRanges = [[number, number], [number, number]];

/**
 * Sort configuration for clear operation.
 * Must match the view's sort to ensure correct row mapping.
 */
export const clearSortSchema = z.object({
  fieldId: z.string(),
  order: z.enum(['asc', 'desc']),
});

export type ClearSort = z.infer<typeof clearSortSchema>;

export const clearCommandInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  /**
   * Target range. Format depends on 'type':
   * - columns: [[startCol, endCol]] - single element array
   * - rows: [[startRow, endRow]] - single element array
   * - default: [[startCol, startRow], [endCol, endRow]] - two element array
   */
  ranges: clearFlexibleRangesSchema,
  /**
   * Selection type:
   * - 'columns': Entire columns selected. ranges = [[startCol, endCol]]
   * - 'rows': Entire rows selected. ranges = [[startRow, endRow]]
   * - undefined: Cell range selected. ranges = [[startCol, startRow], [endCol, endRow]]
   */
  type: clearRangeTypeSchema,
  /**
   * Filter to apply when querying existing records.
   * This should match the view's current filter to ensure correct row mapping.
   */
  filter: recordFilterSchema.optional(),
  /**
   * Sort configuration for the view.
   * This is critical for ensuring clear targets the correct rows.
   * If not provided, records are sorted by auto_number (creation order).
   */
  sort: z.array(clearSortSchema).optional(),
});

export type IClearCommandInput = z.input<typeof clearCommandInputSchema>;

export class ClearCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly rawRanges: ReadonlyArray<readonly [number, number]>,
    readonly rangeType: ClearRangeType,
    readonly filter: RecordFilter | undefined,
    readonly sort: ReadonlyArray<ClearSort> | undefined
  ) {}

  static create(raw: unknown): Result<ClearCommand, DomainError> {
    const parsed = clearCommandInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ClearCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    // Validate ranges format based on type
    const { ranges, type } = parsed.data;
    if (type === 'columns' || type === 'rows') {
      // For columns/rows, ranges should be a single element: [[start, end]]
      if (ranges.length !== 1) {
        return err(
          domainError.validation({
            message: `For type '${type}', ranges must have exactly 1 element [[start, end]], got ${ranges.length}`,
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

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map((viewId) => {
        return new ClearCommand(
          tableId,
          viewId,
          parsed.data.ranges,
          parsed.data.type,
          parsed.data.filter ?? undefined,
          parsed.data.sort
        );
      })
    );
  }

  /**
   * Normalize ranges to standard format [[startCol, startRow], [endCol, endRow]].
   * This requires table dimensions for columns/rows type.
   *
   * @param totalRows Total number of rows in the table (needed for 'columns' type)
   * @param totalCols Total number of columns in the table (needed for 'rows' type)
   */
  normalizeRanges(totalRows: number, totalCols: number): ClearNormalizedRanges {
    if (this.rangeType === 'columns') {
      // ranges is [[startCol, endCol]]
      const [startCol, endCol] = this.rawRanges[0]!;
      return [
        [startCol, 0],
        [endCol, Math.max(0, totalRows - 1)],
      ];
    }

    if (this.rangeType === 'rows') {
      // ranges is [[startRow, endRow]]
      const [startRow, endRow] = this.rawRanges[0]!;
      return [
        [0, startRow],
        [Math.max(0, totalCols - 1), endRow],
      ];
    }

    // Default: cell range - ranges is [[startCol, startRow], [endCol, endRow]]
    const startCell = this.rawRanges[0]!;
    const endCell = this.rawRanges[1]!;
    return [
      [startCell[0], startCell[1]],
      [endCell[0], endCell[1]],
    ];
  }
}
