import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';
import type { RecordFieldValues } from './CreateRecordCommand';

export const updateRecordInputSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
  fields: z.record(z.string(), z.unknown()).default({}),
  typecast: z.boolean().optional().default(false),
  fieldKeyType: fieldKeyTypeSchema,
});

export type IUpdateRecordCommandInput = z.input<typeof updateRecordInputSchema>;

export class UpdateRecordCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordId: RecordId,
    readonly fieldValues: RecordFieldValues,
    readonly typecast: boolean,
    readonly fieldKeyType: FieldKeyType
  ) {}

  static create(raw: unknown): Result<UpdateRecordCommand, DomainError> {
    const parsed = updateRecordInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateRecordCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      RecordId.create(parsed.data.recordId).map((recordId) => {
        const fieldValues = new Map(Object.entries(parsed.data.fields));
        return new UpdateRecordCommand(
          tableId,
          recordId,
          fieldValues,
          parsed.data.typecast,
          parsed.data.fieldKeyType
        );
      })
    );
  }
}
