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

export const duplicateRecordInputSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
  order: recordInsertOrderSchema.optional(),
});

export type IDuplicateRecordCommandInput = z.input<typeof duplicateRecordInputSchema>;

export class DuplicateRecordCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordId: RecordId,
    readonly order?: RecordInsertOrder
  ) {}

  static create(raw: unknown): Result<DuplicateRecordCommand, DomainError> {
    const parsed = duplicateRecordInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DuplicateRecordCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      RecordId.create(parsed.data.recordId).andThen((recordId) => {
        // Parse order if provided
        if (parsed.data.order) {
          return RecordInsertOrder.create(parsed.data.order).map((order) => {
            return new DuplicateRecordCommand(tableId, recordId, order);
          });
        }

        return ok(new DuplicateRecordCommand(tableId, recordId));
      })
    );
  }
}
