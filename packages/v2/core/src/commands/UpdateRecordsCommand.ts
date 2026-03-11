import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';
import { recordFilterNodeSchema, type RecordFilterNode } from '../queries/RecordFilterDto';
import type { RecordFieldValues } from './CreateRecordCommand';

export const updateRecordsInputSchema = z
  .object({
    tableId: z.string(),
    fields: z.record(z.string(), z.unknown()).default({}),
    filter: recordFilterNodeSchema.optional(),
    recordIds: z.array(z.string()).min(1, 'At least one recordId is required').optional(),
    typecast: z.boolean().optional().default(false),
    fieldKeyType: fieldKeyTypeSchema,
  })
  .superRefine((value, ctx) => {
    const hasFilter = value.filter !== undefined;
    const hasRecordIds = value.recordIds !== undefined;

    if (!hasFilter && !hasRecordIds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['filter'],
        message: 'Either filter or recordIds is required',
      });
    }

    if (hasFilter && hasRecordIds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recordIds'],
        message: 'Provide either filter or recordIds, not both',
      });
    }
  });

export type IUpdateRecordsCommandInput = z.input<typeof updateRecordsInputSchema>;

export class UpdateRecordsCommand {
  private constructor(
    readonly tableId: TableId,
    readonly fieldValues: RecordFieldValues,
    readonly filter: RecordFilterNode | undefined,
    readonly recordIds: ReadonlyArray<RecordId> | undefined,
    readonly typecast: boolean,
    readonly fieldKeyType: FieldKeyType
  ) {}

  static create(raw: unknown): Result<UpdateRecordsCommand, DomainError> {
    const parsed = updateRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateRecordsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      parseRecordIds(parsed.data.recordIds).map(
        (recordIds) =>
          new UpdateRecordsCommand(
            tableId,
            new Map(Object.entries(parsed.data.fields)),
            parsed.data.filter,
            recordIds,
            parsed.data.typecast,
            parsed.data.fieldKeyType
          )
      )
    );
  }
}

const parseRecordIds = (
  recordIds: ReadonlyArray<string> | undefined
): Result<ReadonlyArray<RecordId> | undefined, DomainError> => {
  if (!recordIds) {
    return ok(undefined);
  }

  const parsed: RecordId[] = [];

  for (const rawId of recordIds) {
    const idResult = RecordId.create(rawId);
    if (idResult.isErr()) {
      return err(
        domainError.validation({
          message: 'Invalid recordId in UpdateRecordsCommand',
          details: { recordId: rawId },
        })
      );
    }
    parsed.push(idResult.value);
  }

  return parsed.length === 0
    ? err(domainError.validation({ message: 'At least one recordId is required' }))
    : ok(parsed as ReadonlyArray<RecordId>);
};
