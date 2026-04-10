import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { type DomainError, domainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { RecordSearch } from '../queries/RecordSearch';
import { MAX_SELECTION_STREAM_BATCH_SIZE } from './shared/streamBatchSize';
import {
  pasteCommandInputSchema,
  type PasteGroup,
  parseClipboardText,
  type PasteSort,
  type SourceFieldMeta,
} from './PasteCommand';
import {
  normalizeRanges,
  type NormalizedRanges,
  type RangeType,
  validateRangesFormat,
} from './RangeUtils';
import type { RecordFilter } from '../queries/RecordFilterDto';

export const pasteStreamCommandInputSchema = pasteCommandInputSchema.extend({
  batchSize: z.number().int().min(1).max(MAX_SELECTION_STREAM_BATCH_SIZE).optional(),
});

export type IPasteStreamCommandInput = z.input<typeof pasteStreamCommandInputSchema>;

export class PasteStreamCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly rawRanges: ReadonlyArray<readonly [number, number]>,
    readonly rangeType: RangeType,
    readonly content: ReadonlyArray<ReadonlyArray<unknown>>,
    readonly filter: RecordFilter | undefined,
    readonly updateFilter: RecordFilter | undefined,
    readonly search: RecordSearch | undefined,
    readonly sourceFields: ReadonlyArray<SourceFieldMeta> | undefined,
    readonly typecast: boolean,
    readonly projection: ReadonlyArray<string> | undefined,
    readonly sort: ReadonlyArray<PasteSort> | undefined,
    readonly groupBy: ReadonlyArray<PasteGroup> | undefined,
    readonly ignoreViewQuery: boolean,
    readonly batchSize?: number
  ) {}

  static create(raw: unknown): Result<PasteStreamCommand, DomainError> {
    const parsed = pasteStreamCommandInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid PasteStreamCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    const { ranges, type } = parsed.data;
    const validationResult = validateRangesFormat(ranges, type);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    if ((type === 'columns' || type === 'rows') && ranges.length !== 1) {
      return err(
        domainError.validation({
          message: `For type '${type}', ranges must have exactly 1 element [[start, end]], got ${ranges.length}`,
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map((viewId) => {
        const content =
          typeof parsed.data.content === 'string'
            ? parseClipboardText(parsed.data.content)
            : parsed.data.content;

        return new PasteStreamCommand(
          tableId,
          viewId,
          parsed.data.ranges,
          parsed.data.type,
          content,
          parsed.data.filter ?? undefined,
          parsed.data.updateFilter ?? undefined,
          RecordSearch.fromOptionalTuple(parsed.data.search),
          parsed.data.sourceFields,
          parsed.data.typecast,
          parsed.data.projection,
          parsed.data.sort,
          parsed.data.groupBy,
          parsed.data.ignoreViewQuery ?? false,
          parsed.data.batchSize
        );
      })
    );
  }

  normalizeRanges(totalRows: number, totalCols: number): NormalizedRanges {
    return normalizeRanges(this.rawRanges, this.rangeType, totalRows, totalCols);
  }
}
