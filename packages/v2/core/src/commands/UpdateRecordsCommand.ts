import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import {
  RecordInsertOrder,
  recordInsertOrderSchema,
} from '../domain/table/records/RecordInsertOrder';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';
import { recordFilterNodeSchema, type RecordFilterNode } from '../queries/RecordFilterDto';
import type { RecordFieldValues } from './CreateRecordCommand';

const updateRecordItemInputSchema = z.object({
  id: z.string(),
  fields: z.record(z.string(), z.unknown()).default({}),
});

export const updateRecordsInputSchema = z
  .object({
    tableId: z.string(),
    fields: z.record(z.string(), z.unknown()).optional(),
    records: z
      .array(updateRecordItemInputSchema)
      .min(1, 'At least one record is required')
      .optional(),
    filter: recordFilterNodeSchema.optional(),
    recordIds: z.array(z.string()).min(1, 'At least one recordId is required').optional(),
    typecast: z.boolean().optional().default(false),
    deferComputedUpdates: z.boolean().optional().default(false),
    enqueueDeferredComputedUpdates: z.boolean().optional().default(false),
    fieldKeyType: fieldKeyTypeSchema,
    order: recordInsertOrderSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasFilter = value.filter !== undefined;
    const hasRecordIds = value.recordIds !== undefined;
    const hasExplicitRecords = value.records !== undefined;

    if (!hasFilter && !hasRecordIds && !hasExplicitRecords) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['filter'],
        message: 'Either records, filter, or recordIds is required',
      });
    }

    if (hasFilter && hasRecordIds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recordIds'],
        message: 'Provide either filter or recordIds, not both',
      });
    }

    if (hasExplicitRecords && (hasFilter || hasRecordIds)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['records'],
        message: 'Provide either records or selector-based bulk update inputs, not both',
      });
    }

    if (hasExplicitRecords && value.fields !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fields'],
        message: 'Shared fields are not supported when explicit records are provided',
      });
    }

    if (value.order && !hasExplicitRecords) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['order'],
        message: 'Order is only supported when explicit records are provided',
      });
    }
  });

export type IUpdateRecordsCommandInput = z.input<typeof updateRecordsInputSchema>;

export interface IUpdateRecordsItem {
  readonly recordId: RecordId;
  readonly fieldValues: RecordFieldValues;
}

export class UpdateRecordsCommand {
  private constructor(
    readonly tableId: TableId,
    readonly fieldValues: RecordFieldValues,
    readonly filter: RecordFilterNode | undefined,
    readonly recordIds: ReadonlyArray<RecordId> | undefined,
    readonly records: ReadonlyArray<IUpdateRecordsItem> | undefined,
    readonly typecast: boolean,
    readonly deferComputedUpdates: boolean,
    readonly enqueueDeferredComputedUpdates: boolean,
    readonly fieldKeyType: FieldKeyType,
    readonly order: RecordInsertOrder | undefined
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
      parseRecordIds(parsed.data.recordIds).andThen((recordIds) =>
        parseRecordItems(parsed.data.records).andThen((records) =>
          parseOrder(parsed.data.order).map(
            (order) =>
              new UpdateRecordsCommand(
                tableId,
                new Map(Object.entries(parsed.data.fields ?? {})),
                parsed.data.filter,
                recordIds,
                records,
                parsed.data.typecast,
                parsed.data.deferComputedUpdates,
                parsed.data.enqueueDeferredComputedUpdates,
                parsed.data.fieldKeyType,
                order
              )
          )
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

const parseRecordItems = (
  records: ReadonlyArray<z.infer<typeof updateRecordItemInputSchema>> | undefined
): Result<ReadonlyArray<IUpdateRecordsItem> | undefined, DomainError> => {
  if (!records) {
    return ok(undefined);
  }

  const parsed: IUpdateRecordsItem[] = [];
  const seenIds = new Set<string>();

  for (const rawRecord of records) {
    const recordIdResult = RecordId.create(rawRecord.id);
    if (recordIdResult.isErr()) {
      return err(
        domainError.validation({
          message: 'Invalid recordId in UpdateRecordsCommand',
          details: { recordId: rawRecord.id },
        })
      );
    }

    const recordIdText = recordIdResult.value.toString();
    if (seenIds.has(recordIdText)) {
      return err(
        domainError.validation({
          message: 'Duplicate recordId in UpdateRecordsCommand',
          details: { recordId: recordIdText },
        })
      );
    }
    seenIds.add(recordIdText);

    parsed.push({
      recordId: recordIdResult.value,
      fieldValues: new Map(Object.entries(rawRecord.fields)),
    });
  }

  return ok(parsed as ReadonlyArray<IUpdateRecordsItem>);
};

const parseOrder = (
  order: z.infer<typeof recordInsertOrderSchema> | undefined
): Result<RecordInsertOrder | undefined, DomainError> => {
  if (!order) {
    return ok(undefined);
  }

  return RecordInsertOrder.create(order).map((parsedOrder) => parsedOrder);
};
