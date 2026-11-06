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

/** Fields returned by an already-authorized server read for this record. */
export interface DuplicateRecordSourceSnapshot {
  readonly tableId: string;
  readonly recordId: string;
  readonly fields: ReadonlyMap<string, unknown>;
}

export class DuplicateRecordCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordId: RecordId,
    readonly order?: RecordInsertOrder,
    readonly sourceSnapshot?: DuplicateRecordSourceSnapshot
  ) {}

  static create(
    raw: unknown,
    options?: { sourceSnapshot?: DuplicateRecordSourceSnapshot }
  ): Result<DuplicateRecordCommand, DomainError> {
    const parsed = duplicateRecordInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DuplicateRecordCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    const sourceSnapshot = options?.sourceSnapshot;
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      RecordId.create(parsed.data.recordId).andThen((recordId) => {
        // The snapshot comes from an authorized server read, never from rawBody.
        if (sourceSnapshot && sourceSnapshot.recordId !== recordId.toString()) {
          return err(
            domainError.validation({
              code: 'validation.duplicate.source_snapshot_mismatch',
              message: 'Duplicate source snapshot does not match the requested record',
            })
          );
        }
        if (sourceSnapshot && sourceSnapshot.tableId !== tableId.toString()) {
          return err(
            domainError.validation({
              code: 'validation.duplicate.source_snapshot_mismatch',
              message: 'Duplicate source snapshot does not match the requested table',
            })
          );
        }
        if (parsed.data.order) {
          return RecordInsertOrder.create(parsed.data.order).map((order) => {
            return new DuplicateRecordCommand(tableId, recordId, order, sourceSnapshot);
          });
        }

        return ok(new DuplicateRecordCommand(tableId, recordId, undefined, sourceSnapshot));
      })
    );
  }
}
