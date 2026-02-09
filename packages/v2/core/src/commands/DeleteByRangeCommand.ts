import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { recordFilterSchema, type RecordFilter } from '../queries/RecordFilterDto';
import {
  flexibleRangesSchema,
  normalizeRanges,
  rangeTypeSchema,
  validateRangesFormat,
  type NormalizedRanges,
  type RangeType,
} from './RangeUtils';

const recordSortSchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

const recordSearchSchema = z.tuple([z.string(), z.string(), z.boolean().optional()]);

const recordGroupBySchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

// Types are exported from queries/ListTableRecordsQuery.ts
type RecordSortValue = z.infer<typeof recordSortSchema>;
type RecordSearchValue = z.infer<typeof recordSearchSchema>;
export type RecordGroupByValue = z.infer<typeof recordGroupBySchema>;

export const deleteByRangeCommandInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  /**
   * Target range. Format depends on 'type':
   * - columns: [[startCol, endCol]] - single element array
   * - rows: [[startRow, endRow]] - single element array
   * - default: [[startCol, startRow], [endCol, endRow]] - two element array
   */
  ranges: flexibleRangesSchema,
  /**
   * Selection type:
   * - 'columns': Entire columns selected. ranges = [[startCol, endCol]]
   * - 'rows': Entire rows selected. ranges = [[startRow, endRow]]
   * - undefined: Cell range selected. ranges = [[startCol, startRow], [endCol, endRow]]
   */
  type: rangeTypeSchema,
  /**
   * Filter to apply when querying existing records.
   * This should match the view's current filter to ensure correct row mapping.
   */
  filter: recordFilterSchema.optional(),
  /**
   * Sort order for records. Maps to orderBy in v1 API.
   */
  sort: z.array(recordSortSchema).optional(),
  /**
   * Search filter: [searchTerm, fieldId, hideNotMatch?]
   */
  search: recordSearchSchema.optional(),
  /**
   * Group by configuration for the view.
   * When provided, records are ordered by group before applying range selection.
   */
  groupBy: z.array(recordGroupBySchema).optional(),
});

export type IDeleteByRangeCommandInput = z.input<typeof deleteByRangeCommandInputSchema>;

export class DeleteByRangeCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly rawRanges: ReadonlyArray<readonly [number, number]>,
    readonly rangeType: RangeType,
    readonly filter: RecordFilter | undefined,
    readonly sort: ReadonlyArray<RecordSortValue> | undefined,
    readonly search: RecordSearchValue | undefined,
    readonly groupBy: ReadonlyArray<RecordGroupByValue> | undefined
  ) {}

  static create(raw: unknown): Result<DeleteByRangeCommand, DomainError> {
    const parsed = deleteByRangeCommandInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DeleteByRangeCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    // Validate ranges format based on type
    const { ranges, type } = parsed.data;
    const validationResult = validateRangesFormat(ranges, type);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map((viewId) => {
        return new DeleteByRangeCommand(
          tableId,
          viewId,
          parsed.data.ranges,
          parsed.data.type,
          parsed.data.filter ?? undefined,
          parsed.data.sort ?? undefined,
          parsed.data.search ?? undefined,
          parsed.data.groupBy ?? undefined
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
  normalizeRanges(totalRows: number, totalCols: number): NormalizedRanges {
    return normalizeRanges(this.rawRanges, this.rangeType, totalRows, totalCols);
  }
}
