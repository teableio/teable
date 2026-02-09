import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { RecordId } from '../domain/table/records/RecordId';
import {
  RecordInsertOrder,
  recordInsertOrderSchema,
} from '../domain/table/records/RecordInsertOrder';
import { TableId } from '../domain/table/TableId';

export const reorderRecordsInputSchema = z.object({
  tableId: z.string(),
  recordIds: z.array(z.string()).min(1, 'At least one recordId is required').max(1000),
  order: recordInsertOrderSchema,
});

export type IReorderRecordsCommandInput = z.input<typeof reorderRecordsInputSchema>;

export class ReorderRecordsCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordIds: ReadonlyArray<RecordId>,
    readonly order: RecordInsertOrder
  ) {}

  static create(raw: unknown): Result<ReorderRecordsCommand, DomainError> {
    const parsed = reorderRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ReorderRecordsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      parseRecordIds(parsed.data.recordIds).andThen((recordIds) =>
        RecordInsertOrder.create(parsed.data.order).map(
          (order) => new ReorderRecordsCommand(tableId, recordIds, order)
        )
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
          message: 'Invalid recordId in ReorderRecordsCommand',
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
