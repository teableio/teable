import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';

const clickButtonInputSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
  fieldId: z.string(),
  shareScope: z
    .object({
      viewId: z.string(),
      includeHiddenFields: z.boolean().default(false),
      includeRecords: z.boolean().default(false),
    })
    .optional(),
});

export type IClickButtonCommandInput = z.input<typeof clickButtonInputSchema>;

export class ClickButtonCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordId: RecordId,
    readonly fieldId: FieldId,
    readonly shareScope:
      | {
          readonly viewId: ViewId;
          readonly includeHiddenFields: boolean;
          readonly includeRecords: boolean;
        }
      | undefined
  ) {}

  static create(raw: unknown): Result<ClickButtonCommand, DomainError> {
    const parsed = clickButtonInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          code: 'button.command_invalid',
          message: 'Invalid ClickButtonCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return safeTry<ClickButtonCommand, DomainError>(function* () {
      const tableId = yield* TableId.create(parsed.data.tableId);
      const recordId = yield* RecordId.create(parsed.data.recordId);
      const fieldId = yield* FieldId.create(parsed.data.fieldId);
      const shareScope = parsed.data.shareScope
        ? {
            viewId: yield* ViewId.create(parsed.data.shareScope.viewId),
            includeHiddenFields: parsed.data.shareScope.includeHiddenFields,
            includeRecords: parsed.data.shareScope.includeRecords,
          }
        : undefined;
      return ok(new ClickButtonCommand(tableId, recordId, fieldId, shareScope));
    });
  }
}
