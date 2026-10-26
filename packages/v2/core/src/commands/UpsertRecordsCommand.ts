import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { RecordCreateSource } from '../domain/table/events/RecordFieldValuesDTO';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import { TableId } from '../domain/table/TableId';
import {
  recordUpsertOnConflictValues,
  type RecordUpsertOnConflict,
} from '../application/services/RecordUpsertService';
import type { RecordFieldValues } from './CreateRecordCommand';
import { PublicCommand } from './PublicCommand';

export const upsertRecordsInputSchema = z.object({
  tableId: z.string(),
  records: z
    .array(
      z.object({
        fields: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .min(1, 'At least one record is required'),
  /** Single unique field id used to match existing rows. */
  matchField: z.string(),
  onConflict: z.enum(recordUpsertOnConflictValues),
  typecast: z.boolean().optional().default(false),
  fieldKeyType: fieldKeyTypeSchema,
});

export type IUpsertRecordsCommandInput = z.input<typeof upsertRecordsInputSchema>;
export type IUpsertRecordsCommandInputParsed = z.infer<typeof upsertRecordsInputSchema>;
export class UpsertRecordsCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordsFieldValues: ReadonlyArray<RecordFieldValues>,
    readonly matchFieldId: string,
    readonly onConflict: RecordUpsertOnConflict,
    readonly typecast: boolean,
    readonly fieldKeyType: FieldKeyType,
    readonly source: RecordCreateSource
  ) {
    super();
  }

  static create(
    raw: unknown,
    options?: {
      source?: RecordCreateSource;
    }
  ): Result<UpsertRecordsCommand, DomainError> {
    const parsed = upsertRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpsertRecordsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).map((tableId) => {
      const recordsFieldValues = parsed.data.records.map(
        (record) => new Map(Object.entries(record.fields)) as RecordFieldValues
      );

      return new UpsertRecordsCommand(
        tableId,
        recordsFieldValues,
        parsed.data.matchField,
        parsed.data.onConflict,
        parsed.data.typecast,
        parsed.data.fieldKeyType,
        options?.source ?? { type: 'user' }
      );
    });
  }
}
