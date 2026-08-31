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

export const aggregateTableRecordsInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  filter: recordFilterSchema.optional(),
  search: recordSearchInputSchema,
  fields: z.array(aggregationFieldSchema).optional(),
  groupBy: z.array(aggregationGroupSchema).optional(),
  includeHiddenFields: z.boolean().optional(),
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
            parsed.data.includeHiddenFields ?? false,
            Math.max(1, Math.floor(options?.maxGroupPoints ?? 5_000))
          )
      )
    );
  }
}
