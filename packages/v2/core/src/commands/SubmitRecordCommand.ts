import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import type { RecordFieldValues } from './CreateRecordCommand';

export const submitRecordInputSchema = z.object({
  tableId: z.string(),
  formId: z.string(),
  fields: z.record(z.string(), z.unknown()).default({}),
  typecast: z.boolean().optional().default(false),
});

export type ISubmitRecordCommandInput = z.input<typeof submitRecordInputSchema>;

export class SubmitRecordCommand {
  private constructor(
    readonly tableId: TableId,
    readonly formId: ViewId,
    readonly fieldValues: RecordFieldValues,
    readonly typecast: boolean
  ) {}

  static create(raw: unknown): Result<SubmitRecordCommand, DomainError> {
    const parsed = submitRecordInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid SubmitRecordCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.formId).map((formId) => {
        const fieldValues = new Map(Object.entries(parsed.data.fields));
        return new SubmitRecordCommand(tableId, formId, fieldValues, parsed.data.typecast);
      })
    );
  }
}
