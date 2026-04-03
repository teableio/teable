import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { type DomainError, domainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import type { RecordSortValue } from '../queries/ListTableRecordsQuery';
import type { RecordFilter } from '../queries/RecordFilterDto';
import { RecordSearch } from '../queries/RecordSearch';
import { deleteByRangeCommandInputSchema, type RecordGroupByValue } from './DeleteByRangeCommand';
import { type RangeType, validateRangesFormat } from './RangeUtils';
import { MAX_SELECTION_STREAM_BATCH_SIZE } from './shared/streamBatchSize';

export const duplicateRecordsStreamCommandInputSchema = deleteByRangeCommandInputSchema.extend({
  batchSize: z.number().int().min(1).max(MAX_SELECTION_STREAM_BATCH_SIZE).optional(),
});

export type IDuplicateRecordsStreamCommandInput = z.input<
  typeof duplicateRecordsStreamCommandInputSchema
>;

export class DuplicateRecordsStreamCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly rawRanges: ReadonlyArray<readonly [number, number]>,
    readonly rangeType: RangeType,
    readonly filter: RecordFilter | undefined,
    readonly sort: ReadonlyArray<RecordSortValue> | undefined,
    readonly search: RecordSearch | undefined,
    readonly groupBy: ReadonlyArray<RecordGroupByValue> | undefined,
    readonly ignoreViewQuery: boolean,
    readonly batchSize?: number
  ) {}

  static create(raw: unknown): Result<DuplicateRecordsStreamCommand, DomainError> {
    const parsed = duplicateRecordsStreamCommandInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DuplicateRecordsStreamCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    if (parsed.data.type === 'columns') {
      return err(
        domainError.validation({
          message: 'DuplicateRecordsStreamCommand does not support column selections',
        })
      );
    }

    const validationResult = validateRangesFormat(parsed.data.ranges, parsed.data.type);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) =>
          new DuplicateRecordsStreamCommand(
            tableId,
            viewId,
            parsed.data.ranges,
            parsed.data.type,
            parsed.data.filter ?? undefined,
            parsed.data.sort ?? undefined,
            RecordSearch.fromOptionalTuple(parsed.data.search),
            parsed.data.groupBy ?? undefined,
            parsed.data.ignoreViewQuery ?? false,
            parsed.data.batchSize
          )
      )
    );
  }
}
