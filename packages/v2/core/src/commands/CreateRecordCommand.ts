import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { RecordCreateSource } from '../domain/table/events/RecordFieldValuesDTO';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import {
  RecordInsertOrder,
  recordInsertOrderSchema,
} from '../domain/table/records/RecordInsertOrder';
import { TableId } from '../domain/table/TableId';

export const createRecordInputSchema = z.object({
  tableId: z.string(),
  fields: z.record(z.string(), z.unknown()).default({}),
  typecast: z.boolean().optional().default(false),
  fieldKeyType: fieldKeyTypeSchema,
  order: recordInsertOrderSchema.optional(),
});

export type ICreateRecordCommandInput = z.input<typeof createRecordInputSchema>;

/**
 * Field value specification for record creation.
 * Maps field keys (fieldId or fieldName) to their raw values.
 */
export type RecordFieldValues = ReadonlyMap<string, unknown>;

export class CreateRecordCommand {
  private constructor(
    readonly tableId: TableId,
    readonly fieldValues: RecordFieldValues,
    readonly typecast: boolean,
    readonly fieldKeyType: FieldKeyType,
    readonly source: RecordCreateSource,
    readonly order?: RecordInsertOrder
  ) {}

  static create(
    raw: unknown,
    options?: {
      source?: RecordCreateSource;
    }
  ): Result<CreateRecordCommand, DomainError> {
    const parsed = createRecordInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid CreateRecordCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) => {
      const fieldValues = new Map(Object.entries(parsed.data.fields));
      const source = options?.source ?? { type: 'user' };

      // Parse order if provided
      if (parsed.data.order) {
        return RecordInsertOrder.create(parsed.data.order).map((order) => {
          return new CreateRecordCommand(
            tableId,
            fieldValues,
            parsed.data.typecast,
            parsed.data.fieldKeyType,
            source,
            order
          );
        });
      }

      return ok(
        new CreateRecordCommand(
          tableId,
          fieldValues,
          parsed.data.typecast,
          parsed.data.fieldKeyType,
          source
        )
      );
    });
  }
}
