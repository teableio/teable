import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { recordFilterSchema, type RecordFilter } from './RecordFilterDto';
import { recordSearchInputSchema, type RecordSearchInput } from './RecordSearch';

export const getCalendarDailyCollectionInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  startDateFieldId: z.string().min(1),
  endDateFieldId: z.string().optional(),
  filter: recordFilterSchema.optional(),
  search: recordSearchInputSchema,
  includeHiddenFields: z.boolean().optional(),
});

export class GetCalendarDailyCollectionQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly startDate: string,
    readonly endDate: string,
    readonly startDateFieldId: string,
    readonly endDateFieldId: string | undefined,
    readonly filter: RecordFilter | undefined,
    readonly search: RecordSearchInput | undefined,
    readonly includeHiddenFields: boolean
  ) {}

  static create(raw: unknown): Result<GetCalendarDailyCollectionQuery, DomainError> {
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
      ViewId.create(parsed.data.viewId).map(
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
            parsed.data.includeHiddenFields ?? false
          )
      )
    );
  }
}
