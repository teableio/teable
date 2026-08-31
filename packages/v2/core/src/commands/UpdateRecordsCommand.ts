import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import { RecordId } from '../domain/table/records/RecordId';
import {
  RecordInsertOrder,
  recordInsertOrderSchema,
} from '../domain/table/records/RecordInsertOrder';
import { TableId } from '../domain/table/TableId';
import type { RecordWritePluginRunnerOptions } from '../ports/RecordWritePlugin';
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

export interface IUpdateRecordsCommandOptions {
  readonly recordWritePluginRunnerOptions?: RecordWritePluginRunnerOptions;
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
    readonly order: RecordInsertOrder | undefined,
    readonly recordWritePluginRunnerOptions: RecordWritePluginRunnerOptions | undefined
  ) {}

  static create(
    raw: unknown,
    options?: IUpdateRecordsCommandOptions
  ): Result<UpdateRecordsCommand, DomainError> {
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
        parseRecordItems(parsed.data.records, parsed.data.order !== undefined).andThen((records) =>
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
                order,
                options?.recordWritePluginRunnerOptions
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
  records: ReadonlyArray<z.infer<typeof updateRecordItemInputSchema>> | undefined,
  preserveLastOccurrenceOrder: boolean
): Result<ReadonlyArray<IUpdateRecordsItem> | undefined, DomainError> => {
  if (!records) {
    return ok(undefined);
  }

  // v1 parity: duplicate recordIds in one batch are merged field-by-field with
  // last write winning (v1 applies ops per record in input order). The batch
  // UPDATE ... FROM (VALUES ...) SQL requires one row per record id — feeding
  // it duplicates would make Postgres pick an arbitrary row.
  const mergedById = new Map<string, IUpdateRecordsItem>();

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
    const existing = mergedById.get(recordIdText);
    if (existing) {
      const fieldValues = new Map(existing.fieldValues);
      for (const [fieldKey, value] of Object.entries(rawRecord.fields)) {
        fieldValues.set(fieldKey, value);
      }
      const merged = { recordId: existing.recordId, fieldValues };
      // v1 assigns order in request order, so the final duplicate occurrence
      // determines the record's final position. Map reinsertion models that
      // without changing the long-standing no-order response ordering.
      if (preserveLastOccurrenceOrder) {
        mergedById.delete(recordIdText);
      }
      mergedById.set(recordIdText, merged);
      continue;
    }

    const fieldValues = new Map(Object.entries(rawRecord.fields));
    mergedById.set(recordIdText, {
      recordId: recordIdResult.value,
      fieldValues,
    });
  }

  return ok([...mergedById.values()] as ReadonlyArray<IUpdateRecordsItem>);
};

const parseOrder = (
  order: z.infer<typeof recordInsertOrderSchema> | undefined
): Result<RecordInsertOrder | undefined, DomainError> => {
  if (!order) {
    return ok(undefined);
  }

  return RecordInsertOrder.create(order).map((parsedOrder) => parsedOrder);
};
