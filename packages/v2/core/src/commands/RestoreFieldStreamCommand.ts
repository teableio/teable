import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { MAX_SELECTION_STREAM_BATCH_SIZE } from './shared/streamBatchSize';

export interface RestoreFieldStreamInput {
  tableId: string;
  trashId: string;
  batchSize?: number;
  deferComputedUpdates?: boolean;
  enqueueDeferredComputedUpdates?: boolean;
  skipComputedUpdates?: boolean;
}

export class RestoreFieldStreamCommand {
  private constructor(
    readonly tableId: TableId,
    readonly trashId: string,
    readonly batchSize: number,
    readonly deferComputedUpdates: boolean,
    readonly enqueueDeferredComputedUpdates: boolean,
    readonly skipComputedUpdates: boolean
  ) {}

  static create(input: RestoreFieldStreamInput): Result<RestoreFieldStreamCommand, DomainError> {
    const tableIdResult = TableId.create(input.tableId);
    if (tableIdResult.isErr()) {
      return err(tableIdResult.error);
    }

    if (!input.trashId) {
      return err(
        domainError.validation({
          message: 'trashId is required',
          code: 'restore_field_stream.invalid_trash_id',
        })
      );
    }

    const batchSize = input.batchSize ?? 500;
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > MAX_SELECTION_STREAM_BATCH_SIZE
    ) {
      return err(
        domainError.validation({
          message: `batchSize must be an integer between 1 and ${MAX_SELECTION_STREAM_BATCH_SIZE}`,
          code: 'restore_field_stream.invalid_batch_size',
        })
      );
    }

    return ok(
      new RestoreFieldStreamCommand(
        tableIdResult.value,
        input.trashId,
        batchSize,
        Boolean(input.deferComputedUpdates),
        Boolean(input.enqueueDeferredComputedUpdates),
        Boolean(input.skipComputedUpdates)
      )
    );
  }
}
