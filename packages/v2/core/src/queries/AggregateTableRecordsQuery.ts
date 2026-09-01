import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type {
  TableRecordAggregationFieldInput,
  TableRecordAggregationGroupInput,
} from '../domain/table/records/TableRecordAggregation';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { recordFilterSchema, type RecordFilter } from './RecordFilterDto';
import { recordSearchInputSchema, type RecordSearchInput } from './RecordSearch';

const aggregationFieldSchema = z.object({
  fieldId: z.string().min(1),
  statisticFunc: z.string().min(1),
});

const aggregationGroupSchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

export const aggregateTableRecordsInputSchema = z
  .object({
    tableId: z.string(),
    viewId: z.string(),
    filter: recordFilterSchema.optional(),
    search: recordSearchInputSchema,
    fields: z.array(aggregationFieldSchema).optional(),
    groupBy: z.array(aggregationGroupSchema).optional(),
    orderBy: z.array(aggregationGroupSchema).optional(),
    skip: z.number().int().min(0).optional(),
    take: z.number().int().min(1).optional(),
    ignoreViewQuery: z.boolean().optional(),
    collapsedGroupIds: z.array(z.string().min(1)).optional(),
    includeHiddenFields: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.skip != null && value.take == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'skip requires take',
        path: ['skip'],
      });
    }
  });

export type IAggregateTableRecordsQueryInput = z.input<typeof aggregateTableRecordsInputSchema>;

export type IAggregateTableRecordsQueryOptions = {
  readonly maxGroupPoints?: number;
};
export class AggregateTableRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly filter: RecordFilter | undefined,
    readonly search: RecordSearchInput | undefined,
    readonly fields: ReadonlyArray<TableRecordAggregationFieldInput> | undefined,
    readonly groupBy: ReadonlyArray<TableRecordAggregationGroupInput> | undefined,
    readonly orderBy: ReadonlyArray<TableRecordAggregationGroupInput> | undefined,
    readonly skip: number | undefined,
    readonly take: number | undefined,
    readonly ignoreViewQuery: boolean,
    readonly collapsedGroupIds: ReadonlyArray<string> | undefined,
    readonly includeHiddenFields: boolean,
    readonly maxGroupPoints: number
  ) {}

  static create(
    raw: unknown,
    options?: IAggregateTableRecordsQueryOptions
  ): Result<AggregateTableRecordsQuery, DomainError> {
    const parsed = aggregateTableRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid AggregateTableRecordsQuery input',
          details: { issues: parsed.error.issues },
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) =>
          new AggregateTableRecordsQuery(
            tableId,
            viewId,
            parsed.data.filter,
            parsed.data.search,
            parsed.data.fields,
            parsed.data.groupBy?.slice(0, 3),
            parsed.data.orderBy,
            parsed.data.skip,
            parsed.data.take,
            parsed.data.ignoreViewQuery === true,
            parsed.data.collapsedGroupIds,
            parsed.data.includeHiddenFields ?? false,
            Math.max(1, Math.floor(options?.maxGroupPoints ?? 5_000))
          )
      )
    );
  }
}
