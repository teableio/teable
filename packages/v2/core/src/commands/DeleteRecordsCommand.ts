import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';

export const deleteRecordsInputSchema = z.object({
  tableId: z.string(),
  recordIds: z.array(z.string()).min(1, 'At least one recordId is required'),
});

export type IDeleteRecordsCommandInput = z.input<typeof deleteRecordsInputSchema>;

export class DeleteRecordsCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordIds: ReadonlyArray<RecordId>
  ) {}

  static create(raw: unknown): Result<DeleteRecordsCommand, DomainError> {
    const parsed = deleteRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DeleteRecordsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      parseRecordIds(parsed.data.recordIds).map(
        (recordIds) => new DeleteRecordsCommand(tableId, recordIds)
      )
    );
  }
}

const parseRecordIds = (
  recordIds: ReadonlyArray<string>
): Result<ReadonlyArray<RecordId>, DomainError> => {
  const parsed: RecordId[] = [];

  for (const rawId of recordIds) {
    const idResult = RecordId.create(rawId);
    if (idResult.isErr()) {
      return err(
        domainError.validation({
          message: 'Invalid recordId in DeleteRecordsCommand',
          details: { recordId: rawId },
        })
      );
    }
    parsed.push(idResult.value);
  }

  return parsed.length === 0
    ? err(domainError.validation({ message: 'At least one recordId is required' }))
    : (ok(parsed) as Result<ReadonlyArray<RecordId>, DomainError>);
};
