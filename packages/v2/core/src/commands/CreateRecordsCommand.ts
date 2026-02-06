import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import {
  RecordInsertOrder,
  recordInsertOrderSchema,
} from '../domain/table/records/RecordInsertOrder';
import { TableId } from '../domain/table/TableId';
import type { RecordFieldValues } from './CreateRecordCommand';

export const createRecordsInputSchema = z.object({
  tableId: z.string(),
  records: z
    .array(
      z.object({
        fields: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .min(1, 'At least one record is required'),
  typecast: z.boolean().optional().default(false),
  fieldKeyType: fieldKeyTypeSchema,
  order: recordInsertOrderSchema.optional(),
});

export type ICreateRecordsCommandInput = z.input<typeof createRecordsInputSchema>;
export type ICreateRecordsCommandInputParsed = z.infer<typeof createRecordsInputSchema>;

export class CreateRecordsCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordsFieldValues: ReadonlyArray<RecordFieldValues>,
    readonly typecast: boolean,
    readonly fieldKeyType: FieldKeyType,
    readonly order?: RecordInsertOrder
  ) {}

  static create(raw: unknown): Result<CreateRecordsCommand, DomainError> {
    const parsed = createRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid CreateRecordsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) => {
      const recordsFieldValues = parsed.data.records.map(
        (record) => new Map(Object.entries(record.fields)) as RecordFieldValues
      );

      // Parse order if provided
      if (parsed.data.order) {
        return RecordInsertOrder.create(parsed.data.order).map((order) => {
          return new CreateRecordsCommand(
            tableId,
            recordsFieldValues,
            parsed.data.typecast,
            parsed.data.fieldKeyType,
            order
          );
        });
      }

      return ok(
        new CreateRecordsCommand(
          tableId,
          recordsFieldValues,
          parsed.data.typecast,
          parsed.data.fieldKeyType
        )
      );
    });
  }
}
