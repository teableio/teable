import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import type { RestoreRecordInput } from './RestoreRecordsCommand';

export interface RestoreRecordsStreamInput {
  tableId: string;
  records: AsyncIterable<RestoreRecordInput>;
  batchSize?: number;
  deferComputedUpdates?: boolean;
  enqueueDeferredComputedUpdates?: boolean;
  skipComputedUpdates?: boolean;
}

export class RestoreRecordsStreamCommand {
  private constructor(
    readonly tableId: TableId,
    readonly records: AsyncIterable<RestoreRecordInput>,
    readonly batchSize: number,
    readonly deferComputedUpdates: boolean,
    readonly enqueueDeferredComputedUpdates: boolean,
    readonly skipComputedUpdates: boolean
  ) {}

  static create(
    input: RestoreRecordsStreamInput
  ): Result<RestoreRecordsStreamCommand, DomainError> {
    const tableIdResult = TableId.create(input.tableId);
    if (tableIdResult.isErr()) {
      return err(tableIdResult.error);
    }

    const batchSize = input.batchSize ?? 500;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
      return err(
        domainError.validation({
          message: 'batchSize must be an integer between 1 and 5000',
          code: 'restore_records_stream.invalid_batch_size',
        })
      );
    }

    return ok(
      new RestoreRecordsStreamCommand(
        tableIdResult.value,
        input.records,
        batchSize,
        Boolean(input.deferComputedUpdates),
        Boolean(input.enqueueDeferredComputedUpdates),
        Boolean(input.skipComputedUpdates)
      )
    );
  }
}
