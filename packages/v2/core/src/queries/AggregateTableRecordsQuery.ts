import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type {
  TableRecordAggregationFieldInput,
  TableRecordAggregationGroupInput,
} from '../domain/table/records/TableRecordAggregation';
import type { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import type { RecordQueryPluginScope } from '../ports/RecordQueryPlugin';
import type { IRecordSearchAccessPath } from '../ports/TableRecordQueryRepository';
import { countTableRecordsInputSchema } from './CountTableRecordsQuery';
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
    viewId: z.string().min(1).optional(),
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
    filterLinkCellSelected: countTableRecordsInputSchema.shape.filterLinkCellSelected,
    filterLinkCellCandidate: countTableRecordsInputSchema.shape.filterLinkCellCandidate,
    selectedRecordIds: countTableRecordsInputSchema.shape.selectedRecordIds,
  })
  .superRefine((value, ctx) => {
    if (value.filterLinkCellSelected && value.filterLinkCellCandidate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'filterLinkCellSelected and filterLinkCellCandidate can not be set at the same time',
        path: ['filterLinkCellSelected'],
      });
    }
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
  readonly queryScope?: RecordQueryPluginScope;
  readonly maxGroupPoints?: number;
  readonly recordSearchAccessPath?: IRecordSearchAccessPath;
  readonly table?: Table;
};
export class AggregateTableRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId | undefined,
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
    readonly maxGroupPoints: number,
    readonly recordSearchAccessPath?: IRecordSearchAccessPath,
    readonly table?: Table,
    readonly queryScope?: RecordQueryPluginScope,
    readonly filterLinkCellSelected?: string | [string, string],
    readonly filterLinkCellCandidate?: string | [string, string],
    readonly selectedRecordIds?: ReadonlyArray<string>
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
      (parsed.data.viewId ? ViewId.create(parsed.data.viewId) : ok(undefined)).map(
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
            Math.max(1, Math.floor(options?.maxGroupPoints ?? 5_000)),
            options?.recordSearchAccessPath,
            options?.table,
            options?.queryScope,
            parsed.data.filterLinkCellSelected,
            parsed.data.filterLinkCellCandidate,
            parsed.data.selectedRecordIds
          )
      )
    );
  }
}
