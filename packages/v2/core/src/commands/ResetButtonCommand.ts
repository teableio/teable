import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';

const resetButtonInputSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
  fieldId: z.string(),
});

export type IResetButtonCommandInput = z.input<typeof resetButtonInputSchema>;

export class ResetButtonCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordId: RecordId,
    readonly fieldId: FieldId
  ) {}

  static create(raw: unknown): Result<ResetButtonCommand, DomainError> {
    const parsed = resetButtonInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          code: 'button.reset_command_invalid',
          message: 'Invalid ResetButtonCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return safeTry<ResetButtonCommand, DomainError>(function* () {
      const tableId = yield* TableId.create(parsed.data.tableId);
      const recordId = yield* RecordId.create(parsed.data.recordId);
      const fieldId = yield* FieldId.create(parsed.data.fieldId);
      return ok(new ResetButtonCommand(tableId, recordId, fieldId));
    });
  }
}
