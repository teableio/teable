import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IRecordRemovalReason } from '../domain/table/events/RecordsDeleted';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';
import { recordFilterNodeSchema, type RecordFilterNode } from '../queries/RecordFilterDto';

export const deleteRecordsInputSchema = z
  .object({
    tableId: z.string(),
    recordIds: z.array(z.string()).min(1, 'At least one recordId is required').optional(),
    filter: recordFilterNodeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.recordIds !== undefined) === (value.filter !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['filter'],
        message: 'Provide either filter or recordIds, not both or neither',
      });
    }
  });

export type IDeleteRecordsCommandInput = z.input<typeof deleteRecordsInputSchema>;

export type { IRecordRemovalReason };

export class DeleteRecordsCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordIds: ReadonlyArray<RecordId> | undefined,
    readonly filter: RecordFilterNode | undefined
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
        (recordIds) => new DeleteRecordsCommand(tableId, recordIds, parsed.data.filter)
      )
    );
  }
}

const parseRecordIds = (
  recordIds: ReadonlyArray<string> | undefined
): Result<ReadonlyArray<RecordId> | undefined, DomainError> => {
  if (!recordIds) return ok(undefined);
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
