import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import type { RecordQueryPluginScope } from '../ports/RecordQueryPlugin';
import type { IRecordSearchAccessPath } from '../ports/TableRecordQueryRepository';
import { recordFilterSchema, type RecordFilter } from './RecordFilterDto';
import { recordSearchInputSchema, type RecordSearchInput } from './RecordSearch';

export const getCalendarDailyCollectionInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string().min(1).optional(),
  ignoreViewQuery: z.boolean().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  startDateFieldId: z.string().min(1),
  endDateFieldId: z.string().optional(),
  filter: recordFilterSchema.optional(),
  search: recordSearchInputSchema,
  includeHiddenFields: z.boolean().optional(),
});

export interface IGetCalendarDailyCollectionQueryOptions {
  readonly queryScope?: RecordQueryPluginScope;
  readonly table?: Table;
  readonly recordSearchAccessPath?: IRecordSearchAccessPath;
}

export class GetCalendarDailyCollectionQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId | undefined,
    readonly startDate: string,
    readonly endDate: string,
    readonly startDateFieldId: string,
    readonly endDateFieldId: string | undefined,
    readonly filter: RecordFilter | undefined,
    readonly search: RecordSearchInput | undefined,
    readonly includeHiddenFields: boolean,
    readonly ignoreViewQuery: boolean,
    readonly queryScope: RecordQueryPluginScope | undefined,
    readonly table: Table | undefined,
    readonly recordSearchAccessPath: IRecordSearchAccessPath | undefined
  ) {}

  static create(
    raw: unknown,
    options?: IGetCalendarDailyCollectionQueryOptions
  ): Result<GetCalendarDailyCollectionQuery, DomainError> {
    const parsed = getCalendarDailyCollectionInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid GetCalendarDailyCollectionQuery input',
          details: { issues: parsed.error.issues },
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      (parsed.data.viewId ? ViewId.create(parsed.data.viewId) : ok(undefined)).map(
        (viewId) =>
          new GetCalendarDailyCollectionQuery(
            tableId,
            viewId,
            parsed.data.startDate,
            parsed.data.endDate,
            parsed.data.startDateFieldId,
            parsed.data.endDateFieldId,
            parsed.data.filter,
            parsed.data.search,
            parsed.data.includeHiddenFields ?? false,
            parsed.data.ignoreViewQuery ?? false,
            options?.queryScope,
            options?.table,
            options?.recordSearchAccessPath
          )
      )
    );
  }
}
