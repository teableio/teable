import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { recordFilterSchema, type RecordFilter } from '../queries/RecordFilterDto';
import {
  flexibleRangesSchema,
  getStartCell,
  normalizeRanges,
  rangeTypeSchema,
  validateRangesFormat,
  type NormalizedRanges,
  type RangeType,
} from './RangeUtils';

/**
 * Source field metadata for intelligent type conversion during paste.
 * When pasting from another table, this helps convert values appropriately.
 */
export const sourceFieldMetaSchema = z.object({
  name: z.string().optional(),
  type: z.string(),
  cellValueType: z.string().optional(),
  isComputed: z.boolean().optional(),
  isLookup: z.boolean().optional(),
  isMultipleCellValue: z.boolean().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

export type SourceFieldMeta = z.infer<typeof sourceFieldMetaSchema>;

/**
 * Sort configuration for paste operation.
 * Must match the view's sort to ensure correct row mapping.
 */
export const pasteSortSchema = z.object({
  fieldId: z.string(),
  order: z.enum(['asc', 'desc']),
});

export type PasteSort = z.infer<typeof pasteSortSchema>;

/**
 * Parse clipboard text (tab-separated values) into a 2D array.
 * Handles both Unix and Windows line endings.
 */
function parseClipboardText(content: string): string[][] {
  const windowsNewline = '\r\n';
  const newline = '\n';
  const delimiter = '\t';

  const _newline = content.includes(windowsNewline) ? windowsNewline : newline;

  // Remove trailing/leading newlines
  if (content.endsWith(_newline)) {
    content = content.slice(0, -_newline.length);
  }
  if (content.startsWith(_newline)) {
    content = content.slice(_newline.length);
  }

  // Simple case: no quotes
  if (!content.includes('"')) {
    return content.split(_newline).map((row) => row.split(delimiter));
  }

  // Complex case: handle quoted cells
  const len = content.length;
  let cursor = 0;
  const tableData: string[][] = [];
  let row: string[] = [];
  let endOfRow = false;

  while (cursor < len) {
    let cell = '';
    let quoted = false;
    let endOfCell = false;

    if (content[cursor] === '"') {
      quoted = true;
    } else if (content[cursor] === delimiter) {
      endOfCell = true;
    } else if (content[cursor] === _newline) {
      endOfCell = true;
      endOfRow = true;
    } else {
      cell += content[cursor];
    }

    while (!endOfCell) {
      cursor++;
      if (cursor >= len) {
        endOfCell = true;
        endOfRow = true;
        cell = quoted ? `"${cell}` : cell;
        break;
      }
      if (content[cursor] === '"' && quoted) {
        if (content[cursor + 1] === '"') {
          cell += '"';
          cursor++;
        } else if (cell.includes(delimiter) || cell.includes(_newline)) {
          quoted = false;
        } else {
          cell = `"${cell}"`;
          quoted = false;
        }
      } else if (content[cursor] === delimiter) {
        if (quoted) {
          cell += delimiter;
        } else {
          endOfCell = true;
          break;
        }
      } else if (
        content[cursor] === _newline ||
        `${content[cursor]}${content[cursor + 1]}` === _newline
      ) {
        if (quoted) {
          cell += _newline;
        } else {
          endOfCell = true;
          endOfRow = true;
        }
        if (`${content[cursor]}${content[cursor + 1]}` === _newline) {
          cursor++;
        }
      } else {
        cell += content[cursor];
      }
    }
    cursor++;
    row.push(cell);

    // Handle trailing empty column (e.g., "text1"\t"text2"\t)
    if (endOfCell && cursor >= len && content[cursor - 1] === '\t') {
      endOfRow = true;
      row.push('');
    }

    if (endOfRow) {
      tableData.push(row);
      row = [];
      endOfRow = false;
    }
  }
  return tableData;
}

export const pasteCommandInputSchema = z.object({
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
   * Paste content: Either a tab-separated string (clipboard format) or
   * a 2D array where outer array is rows, inner array is columns.
   * Values can be any type and will be converted based on target field types.
   */
  content: z.string().or(z.array(z.array(z.unknown()))),
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
   * Filter to determine which records can be updated.
   * Records matching this filter will be updated; non-matching records will be skipped.
   * This is separate from `filter` to allow querying all records but only updating allowed ones.
   */
  updateFilter: recordFilterSchema.optional(),
  /**
   * Source field metadata (optional).
   * Used for intelligent type conversion when pasting from another table.
   */
  sourceFields: z.array(sourceFieldMetaSchema).optional(),
  /**
   * Enable type conversion (e.g., "123" → 123 for number fields).
   * Also enables link title resolution (converting display titles to record IDs).
   */
  typecast: z.boolean().default(true),
  /**
   * Custom field order for paste operation.
   * When provided, paste content columns map to these field IDs in order,
   * instead of using the view's column order.
   */
  projection: z.array(z.string()).optional(),
  /**
   * Sort configuration for the view.
   * This is critical for ensuring paste targets the correct rows.
   * If not provided, records are sorted by auto_number (creation order).
   */
  sort: z.array(pasteSortSchema).optional(),
});

export type IPasteCommandInput = z.input<typeof pasteCommandInputSchema>;

export class PasteCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly rawRanges: ReadonlyArray<readonly [number, number]>,
    readonly rangeType: RangeType,
    readonly content: ReadonlyArray<ReadonlyArray<unknown>>,
    readonly filter: RecordFilter | undefined,
    readonly updateFilter: RecordFilter | undefined,
    readonly sourceFields: ReadonlyArray<SourceFieldMeta> | undefined,
    readonly typecast: boolean,
    readonly projection: ReadonlyArray<string> | undefined,
    readonly sort: ReadonlyArray<PasteSort> | undefined
  ) {}

  static create(raw: unknown): Result<PasteCommand, DomainError> {
    const parsed = pasteCommandInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid PasteCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    const { ranges, type } = parsed.data;
    const validationResult = validateRangesFormat(ranges, type);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }
    // Paste currently supports a single contiguous range for rows/columns.
    if ((type === 'columns' || type === 'rows') && ranges.length !== 1) {
      return err(
        domainError.validation({
          message: `For type '${type}', ranges must have exactly 1 element [[start, end]], got ${ranges.length}`,
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map((viewId) => {
        // Parse content if it's a string (clipboard format)
        const content =
          typeof parsed.data.content === 'string'
            ? parseClipboardText(parsed.data.content)
            : parsed.data.content;

        return new PasteCommand(
          tableId,
          viewId,
          parsed.data.ranges,
          parsed.data.type,
          content,
          parsed.data.filter ?? undefined,
          parsed.data.updateFilter ?? undefined,
          parsed.data.sourceFields,
          parsed.data.typecast,
          parsed.data.projection,
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
  normalizeRanges(totalRows: number, totalCols: number): NormalizedRanges {
    return normalizeRanges(this.rawRanges, this.rangeType, totalRows, totalCols);
  }

  /** The top-left cell of the target selection. */
  get startCell(): [number, number] {
    return getStartCell(this.rawRanges, this.rangeType);
  }

  /** The start column of the target selection. */
  get startCol(): number {
    return this.startCell[0];
  }

  /** The start row of the target selection. */
  get startRow(): number {
    return this.startCell[1];
  }

  /** Get the number of rows in the paste content */
  get rowCount(): number {
    return this.content.length;
  }

  /** Get the number of columns in the paste content */
  get colCount(): number {
    return this.content[0]?.length ?? 0;
  }

  /**
   * Generate an iterable of row data with their target row indices.
   * Useful for streaming processing.
   * Note: startRow is calculated from normalized ranges.
   */
  *rows(
    startRow: number = this.startRow
  ): Generator<{ rowIndex: number; data: ReadonlyArray<unknown> }> {
    for (let i = 0; i < this.content.length; i++) {
      yield {
        rowIndex: startRow + i,
        data: this.content[i]!,
      };
    }
  }
}
