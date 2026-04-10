import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { type DomainError, domainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { RecordSearch } from '../queries/RecordSearch';
import { ClearCommand, clearCommandInputSchema } from './ClearCommand';
import { MAX_SELECTION_STREAM_BATCH_SIZE } from './shared/streamBatchSize';

export const clearStreamCommandInputSchema = clearCommandInputSchema.extend({
  batchSize: z.number().int().min(1).max(MAX_SELECTION_STREAM_BATCH_SIZE).optional(),
});

export type IClearStreamCommandInput = z.input<typeof clearStreamCommandInputSchema>;

export class ClearStreamCommand extends ClearCommand {
  private constructor(
    tableId: TableId,
    viewId: ViewId,
    rawRanges: ReadonlyArray<readonly [number, number]>,
    rangeType: ClearCommand['rangeType'],
    filter: ClearCommand['filter'],
    search: ClearCommand['search'],
    sort: ClearCommand['sort'],
    groupBy: ClearCommand['groupBy'],
    projection: ClearCommand['projection'],
    ignoreViewQuery: boolean,
    readonly batchSize?: number
  ) {
    super(
      tableId,
      viewId,
      rawRanges,
      rangeType,
      filter,
      search,
      sort,
      groupBy,
      projection,
      ignoreViewQuery
    );
  }

  static override create(raw: unknown): Result<ClearStreamCommand, DomainError> {
    const parsed = clearStreamCommandInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ClearStreamCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    const baseCommandResult = ClearCommand.create(parsed.data);
    if (baseCommandResult.isErr()) {
      return err(baseCommandResult.error);
    }

    const baseCommand = baseCommandResult.value;
    return TableId.create(baseCommand.tableId.toString()).andThen((tableId) =>
      ViewId.create(baseCommand.viewId.toString()).map(
        (viewId) =>
          new ClearStreamCommand(
            tableId,
            viewId,
            baseCommand.rawRanges,
            baseCommand.rangeType,
            baseCommand.filter,
            RecordSearch.fromOptionalTuple(parsed.data.search),
            baseCommand.sort,
            baseCommand.groupBy,
            baseCommand.projection,
            baseCommand.ignoreViewQuery,
            parsed.data.batchSize
          )
      )
    );
  }
}
