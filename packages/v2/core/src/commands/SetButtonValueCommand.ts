import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { RecordId } from '../domain/table/records/RecordId';
import type { ButtonCellValue } from '../domain/table/records/specs/values/SetButtonValueSpec';
import { TableId } from '../domain/table/TableId';

const buttonValueSchema = z
  .object({
    count: z.number().int().nonnegative(),
  })
  .strict()
  .nullable();

const setButtonValueInputSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
  fieldId: z.string(),
  value: buttonValueSchema,
});

/**
 * Internal public command used only by the persisted undo/redo command bus.
 * HTTP record input never constructs this command.
 */
export class SetButtonValueCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordId: RecordId,
    readonly fieldId: FieldId,
    readonly value: ButtonCellValue | null
  ) {}

  static create(raw: unknown): Result<SetButtonValueCommand, DomainError> {
    const parsed = setButtonValueInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          code: 'button.replay_command_invalid',
          message: 'Invalid SetButtonValueCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return safeTry<SetButtonValueCommand, DomainError>(function* () {
      const tableId = yield* TableId.create(parsed.data.tableId);
      const recordId = yield* RecordId.create(parsed.data.recordId);
      const fieldId = yield* FieldId.create(parsed.data.fieldId);
      return ok(new SetButtonValueCommand(tableId, recordId, fieldId, parsed.data.value));
    });
  }
}
